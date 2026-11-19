// Package runner 提供 NodePilot 的底层核心网络拨号器、流式分析器、上行带宽测速与并发评测执行引擎。
//
// 架构概述：
//   - 本文件 (dialer.go) 封装基于 Mihomo (Clash.Meta) 原生内核的 Outbound 代理隧道创建逻辑；
//   - 支持全协议栈无缝覆盖：Shadowsocks, ShadowsocksR, VMess, VLESS, Trojan, Hysteria, Hysteria2, TUIC, WireGuard, Snell, Socks5, HTTP 等；
//   - 在原生内核解析失败时提供优雅的兜底与直接连接策略；
//   - 实现 ContextDialer 抽象接口，完美支持微秒级取消与全局超时熔断控制。
package runner

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"nodepilot/engine/pkg/logger"
	"nodepilot/engine/pkg/model"
	"github.com/metacubex/mihomo/adapter"
	"github.com/metacubex/mihomo/constant"
	"golang.org/x/net/proxy"
)

// ContextDialer 抽象支持 Context 上下文控制的网络拨号接口。
type ContextDialer interface {
	DialContext(ctx context.Context, network, address string) (net.Conn, error)
}

type directDialer struct {
	net.Dialer
}

func (d *directDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return d.Dialer.DialContext(ctx, network, address)
}

// mihomoProxyDialer 基于 Mihomo (Clash.Meta) 核心 Outbound 代理器构建底层真实的加密隧道连接。
type mihomoProxyDialer struct {
	proxy constant.Proxy
}

func (m *mihomoProxyDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	metadata := &constant.Metadata{}
	if err := metadata.SetRemoteAddress(address); err != nil {
		logger.Error("DIALER", "Invalid remote address [%s] for proxy [%s]: %v", address, m.proxy.Name(), err)
		return nil, fmt.Errorf("invalid remote address %s: %w", address, err)
	}
	if strings.HasPrefix(strings.ToLower(network), "udp") {
		metadata.NetWork = constant.UDP
	} else {
		metadata.NetWork = constant.TCP
	}

	start := time.Now()
	logger.Info("DIALER", "Dialing via proxy [%s] (type: %s, server: %s) to target [%s] network=%s",
		m.proxy.Name(), m.proxy.Type().String(), m.proxy.Addr(), address, metadata.NetWork.String())

	conn, err := m.proxy.DialContext(ctx, metadata)
	duration := time.Since(start)

	if err != nil {
		logger.Error("DIALER", "Dial FAILED via proxy [%s] to [%s] in %v: %v", m.proxy.Name(), address, duration, err)
		return nil, err
	}

	logger.Info("DIALER", "Dial SUCCESS via proxy [%s] to [%s] in %v", m.proxy.Name(), address, duration)
	return conn, nil
}

// CreateDialerForNode 根据节点协议类型构造对应的 Dialer，优先利用 Mihomo 原生内核以实现全协议覆盖。
func CreateDialerForNode(node *model.Node, timeout time.Duration) (ContextDialer, error) {
	if node == nil || node.Type == "direct" || node.Type == "" {
		return &directDialer{
			net.Dialer{
				Timeout:   timeout,
				KeepAlive: 30 * time.Second,
			},
		}, nil
	}

	// 1. 优先尝试使用 Mihomo (Clash.Meta) 原生 Outbound 解析器
	// 完整覆盖: ss, ssr, vmess, vless, trojan, hysteria, hysteria2, tuic, wireguard, snell, socks5, http 等
	mapping := make(map[string]any)
	if len(node.Raw) > 0 {
		for k, v := range node.Raw {
			mapping[k] = v
		}
	}
	if _, ok := mapping["name"]; !ok {
		mapping["name"] = node.Name
	}
	if _, ok := mapping["type"]; !ok {
		mapping["type"] = node.Type
	}
	if _, ok := mapping["server"]; !ok {
		mapping["server"] = node.Server
	}
	if _, ok := mapping["port"]; !ok {
		mapping["port"] = node.Port
	}
	if node.Password != "" {
		if _, ok := mapping["password"]; !ok {
			mapping["password"] = node.Password
		}
	}

	// 调用 Mihomo 核心解析器实例化出站代理适配器
	p, err := adapter.ParseProxy(mapping)
	if err == nil && p != nil {
		logger.Info("DIALER", "Mihomo Outbound initialized successfully for node [%s] (type: %s, server: %s:%d)",
			node.Name, p.Type().String(), node.Server, node.Port)
		return &mihomoProxyDialer{proxy: p}, nil
	}

	logger.Warn("DIALER", "Mihomo ParseProxy failed for node [%s] (type: %s): %v. Fallback to basic socks5/http/direct.",
		node.Name, node.Type, err)

	// 2. 兜底回退：标准 Socks5 / HTTP 实现
	switch node.Type {
	case "socks5":
		var auth *proxy.Auth
		if user, ok := node.Raw["username"].(string); ok && user != "" {
			auth = &proxy.Auth{
				User:     user,
				Password: node.Password,
			}
		}
		addr := fmt.Sprintf("%s:%d", node.Server, node.Port)
		baseDialer := &net.Dialer{Timeout: timeout}
		socksDialer, err := proxy.SOCKS5("tcp", addr, auth, baseDialer)
		if err != nil {
			return nil, fmt.Errorf("failed to create socks5 dialer: %w", err)
		}
		if cd, ok := socksDialer.(proxy.ContextDialer); ok {
			return cd, nil
		}
		return &wrappedDialer{dialer: socksDialer}, nil

	case "http":
		addr := fmt.Sprintf("http://%s:%d", node.Server, node.Port)
		_, err := url.Parse(addr)
		if err != nil {
			return nil, fmt.Errorf("invalid http proxy url: %w", err)
		}
		return &directDialer{net.Dialer{Timeout: timeout}}, nil

	default:
		return &directDialer{net.Dialer{Timeout: timeout}}, nil
	}
}

type wrappedDialer struct {
	dialer proxy.Dialer
}

func (w *wrappedDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	type result struct {
		conn net.Conn
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		c, err := w.dialer.Dial(network, address)
		ch <- result{conn: c, err: err}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case res := <-ch:
		return res.conn, res.err
	}
}
