// Package parser 提供多源、多格式代理节点与订阅配置的解析引擎。
//
// 架构概述：
//   - 负责从本地 YAML 文件、HTTP/HTTPS 订阅 URL、Base64 编码流或纯协议链接中提取标准代理节点；
//   - 适配 Clash/Mihomo 的标准 `proxies` / `Proxy` 列表、顶层直接数组、Base64 安全解密与自动补齐填充；
//   - 支持主流代理协议 URI 解析：VMess (base64 JSON)、Shadowsocks (SIP002 与传统 base64)、Trojan、VLESS、Hysteria2/HY2、TUIC、Socks5、HTTP/HTTPS；
//   - 自动剔除 UTF-8 BOM，保持原始节点配置字典 (raw) 供 Mihomo 内核开箱透传。
package parser

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"nodepilot/engine/pkg/model"
	"gopkg.in/yaml.v3"
)

// ParseClashFromBytes 从 YAML 字节流、Base64 编码串或按行协议 URI 列表中解析代理节点。
// 解析策略（阶梯式回退）：
//  1. 尝试直接作为 Clash / Mihomo YAML 反序列化（提取 proxies/Proxy 键或顶层数组）；
//  2. 尝试 Base64 安全解码（自动清洗空白与补齐 '='），解码后依次尝试 YAML 与 URI 行解析；
//  3. 尝试直接按行解析明文协议 URI 链接列表。
func ParseClashFromBytes(data []byte) ([]model.Node, error) {
	// 去除 UTF-8 BOM 标头与首尾空白字符
	cleaned := strings.TrimSpace(string(data))
	cleaned = strings.TrimPrefix(cleaned, "\xef\xbb\xbf")
	if cleaned == "" {
		return nil, fmt.Errorf("subscription or configuration content is empty")
	}

	// 1. 优先尝试直接按 Clash / Mihomo YAML 结构解析
	nodes, err := parseYAMLContent([]byte(cleaned))
	if err == nil && len(nodes) > 0 {
		return nodes, nil
	}

	// 2. 尝试 Base64 安全解码（广泛用于机场订阅链接与编码 YAML）
	if decodedBytes, decErr := decodeBase64Safe(cleaned); decErr == nil && len(decodedBytes) > 0 {
		// 2.1 检查解码后的内容是否为 Clash YAML
		if subNodes, yErr := parseYAMLContent(decodedBytes); yErr == nil && len(subNodes) > 0 {
			return subNodes, nil
		}
		// 2.2 检查解码后的内容是否为协议 URI 列表 (vmess://, ss:// 等)
		if uriNodes := parseURILines(string(decodedBytes)); len(uriNodes) > 0 {
			return uriNodes, nil
		}
	}

	// 3. 尝试直接作为明文协议 URI 列表按行解析
	if uriNodes := parseURILines(cleaned); len(uriNodes) > 0 {
		return uriNodes, nil
	}

	return nil, fmt.Errorf("failed to parse valid proxy nodes (tried Clash YAML, Base64 decode, and protocol URIs)")
}

// parseYAMLContent 从 YAML 结构中提取代理节点列表
func parseYAMLContent(data []byte) ([]model.Node, error) {
	var root map[string]interface{}
	if err := yaml.Unmarshal(data, &root); err == nil && root != nil {
		var rawList []interface{}
		// 兼容不同机场的大小写差异: proxies, Proxy, proxy
		for _, key := range []string{"proxies", "Proxy", "proxy"} {
			if p, ok := root[key].([]interface{}); ok && len(p) > 0 {
				rawList = p
				break
			}
		}
		if len(rawList) > 0 {
			nodes := parseRawProxies(rawList)
			if len(nodes) > 0 {
				return nodes, nil
			}
		}
	}

	// 兼容顶层直接由列表构成的 YAML 配置文件
	var listDirect []map[string]interface{}
	if err := yaml.Unmarshal(data, &listDirect); err == nil && len(listDirect) > 0 {
		var rawList []interface{}
		for _, item := range listDirect {
			rawList = append(rawList, item)
		}
		nodes := parseRawProxies(rawList)
		if len(nodes) > 0 {
			return nodes, nil
		}
	}

	return nil, fmt.Errorf("not valid clash proxies yaml")
}

// parseRawProxies 将未类型化的原始 map 切片转换为强类型 model.Node 实体
func parseRawProxies(rawList []interface{}) []model.Node {
	var nodes []model.Node
	for _, item := range rawList {
		raw, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		name, _ := raw["name"].(string)
		nodeType, _ := raw["type"].(string)
		server := parseString(raw, "server", "address", "host", "ip")
		port := parsePort(raw["port"])
		password := parseString(raw, "password", "uuid", "auth", "token", "psk")

		if strings.TrimSpace(name) == "" || strings.TrimSpace(server) == "" || port <= 0 {
			continue
		}

		nodes = append(nodes, model.Node{
			Name:     strings.TrimSpace(name),
			Type:     strings.ToLower(strings.TrimSpace(nodeType)),
			Server:   strings.TrimSpace(server),
			Port:     port,
			Password: password,
			Raw:      raw,
		})
	}
	return nodes
}

func parseString(raw map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		if v, ok := raw[k]; ok && v != nil {
			if s, ok := v.(string); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func parsePort(v interface{}) int {
	switch p := v.(type) {
	case int:
		return p
	case int64:
		return int(p)
	case float64:
		return int(p)
	case string:
		port, _ := strconv.Atoi(strings.TrimSpace(p))
		return port
	case uint:
		return int(p)
	case uint64:
		return int(p)
	}
	return 0
}

// decodeBase64Safe 对标准与 URL-safe Base64 进行防御性容错解码（自动去除换行、空格并补齐尾部 '=' 填充）
func decodeBase64Safe(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	s = strings.ReplaceAll(s, " ", "")

	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.URLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}

	if m := len(s) % 4; m != 0 {
		s += strings.Repeat("=", 4-m)
		if b, err := base64.StdEncoding.DecodeString(s); err == nil {
			return b, nil
		}
		if b, err := base64.URLEncoding.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, fmt.Errorf("invalid base64")
}

// parseURILines 从按行组织的协议 URI 字符串中提取所有可用节点
func parseURILines(content string) []model.Node {
	var nodes []model.Node
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		node, err := parseSingleURI(line)
		if err == nil && node != nil {
			nodes = append(nodes, *node)
		}
	}
	return nodes
}

// parseSingleURI 解析单条代理协议 URI
func parseSingleURI(uri string) (*model.Node, error) {
	if strings.HasPrefix(uri, "vmess://") {
		return parseVMessURI(uri)
	}
	if strings.HasPrefix(uri, "ss://") {
		return parseShadowsocksURI(uri)
	}

	commonSchemes := []string{
		"trojan://", "vless://", "hysteria2://", "hy2://",
		"tuic://", "socks5://", "socks://", "http://", "https://",
	}
	for _, scheme := range commonSchemes {
		if strings.HasPrefix(uri, scheme) {
			return parseStandardSchemeURI(uri)
		}
	}

	return nil, fmt.Errorf("unsupported uri protocol: %s", uri)
}

// parseVMessURI 解析 VMess 协议 URI: vmess://[base64(json)]
func parseVMessURI(uri string) (*model.Node, error) {
	b64 := strings.TrimPrefix(uri, "vmess://")
	b, err := decodeBase64Safe(b64)
	if err != nil {
		return nil, err
	}
	var vmap map[string]interface{}
	if err := json.Unmarshal(b, &vmap); err != nil {
		return nil, err
	}
	name := parseString(vmap, "ps")
	server := parseString(vmap, "add")
	port := parsePort(vmap["port"])
	uuid := parseString(vmap, "id")
	if server == "" || port <= 0 {
		return nil, fmt.Errorf("invalid vmess node")
	}
	if name == "" {
		name = fmt.Sprintf("vmess-%s:%d", server, port)
	}
	return &model.Node{
		Name:     name,
		Type:     "vmess",
		Server:   server,
		Port:     port,
		Password: uuid,
		Raw:      vmap,
	}, nil
}

// parseShadowsocksURI 解析 Shadowsocks URI（同时支持标准 SIP002 与传统 base64 格式）
func parseShadowsocksURI(uri string) (*model.Node, error) {
	rawURI := strings.TrimPrefix(uri, "ss://")
	var name string
	if idx := strings.Index(rawURI, "#"); idx != -1 {
		name, _ = url.QueryUnescape(rawURI[idx+1:])
		rawURI = rawURI[:idx]
	}

	// 1. 优先解析标准 SIP002 格式: ss://[base64(method:password)]@server:port
	if atIdx := strings.Index(rawURI, "@"); atIdx != -1 {
		return parseSSStandardPart(rawURI[:atIdx], rawURI[atIdx+1:], name)
	}

	// 2. 兼容旧版传统格式: ss://[base64(method:password@server:port)]
	decoded, err := decodeBase64Safe(rawURI)
	if err != nil {
		return nil, fmt.Errorf("invalid ss legacy base64: %w", err)
	}

	dStr := string(decoded)
	atIdx := strings.Index(dStr, "@")
	if atIdx == -1 {
		return nil, fmt.Errorf("invalid ss node format: missing @")
	}

	return parseSSStandardPart(
		base64.StdEncoding.EncodeToString([]byte(dStr[:atIdx])),
		dStr[atIdx+1:],
		name,
	)
}

// parseSSStandardPart 提取 Shadowsocks 认证信息、目标地址与端口
func parseSSStandardPart(authB64, hostPart, name string) (*model.Node, error) {
	if qIdx := strings.Index(hostPart, "/"); qIdx != -1 {
		hostPart = hostPart[:qIdx]
	}
	if qIdx := strings.Index(hostPart, "?"); qIdx != -1 {
		hostPart = hostPart[:qIdx]
	}

	host, portStr, err := net.SplitHostPort(hostPart)
	if err != nil {
		return nil, err
	}
	port, _ := strconv.Atoi(portStr)

	authBytes, _ := decodeBase64Safe(authB64)
	authParts := strings.SplitN(string(authBytes), ":", 2)
	var password string
	if len(authParts) == 2 {
		password = authParts[1]
	}
	if name == "" {
		name = fmt.Sprintf("ss-%s:%d", host, port)
	}

	return &model.Node{
		Name:     name,
		Type:     "ss",
		Server:   host,
		Port:     port,
		Password: password,
		Raw: map[string]interface{}{
			"name":     name,
			"type":     "ss",
			"server":   host,
			"port":     port,
			"password": password,
		},
	}, nil
}

// parseStandardSchemeURI 解析符合标准 URL 规范的代理链接（trojan, vless, hysteria2, hy2, tuic 等）
func parseStandardSchemeURI(uri string) (*model.Node, error) {
	u, err := url.Parse(uri)
	if err != nil {
		return nil, err
	}

	server := u.Hostname()
	port, _ := strconv.Atoi(u.Port())
	if server == "" || port <= 0 {
		return nil, fmt.Errorf("invalid host or port in %s", uri)
	}

	name := u.Fragment
	if unescaped, err := url.QueryUnescape(name); err == nil && unescaped != "" {
		name = unescaped
	}
	if name == "" {
		name = fmt.Sprintf("%s-%s:%d", u.Scheme, server, port)
	}

	var password string
	if u.User != nil {
		password, _ = u.User.Password()
		if password == "" {
			password = u.User.Username()
		}
	}

	nodeType := strings.ToLower(u.Scheme)
	if nodeType == "socks" {
		nodeType = "socks5"
	} else if nodeType == "hy2" {
		nodeType = "hysteria2"
	}

	return &model.Node{
		Name:     name,
		Type:     nodeType,
		Server:   server,
		Port:     port,
		Password: password,
		Raw: map[string]interface{}{
			"name":     name,
			"type":     nodeType,
			"server":   server,
			"port":     port,
			"password": password,
		},
	}, nil
}

// ParseClashFromFile 从本地 YAML 配置文件读取并解析代理节点列表。
func ParseClashFromFile(filePath string) ([]model.Node, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file %s: %w", filePath, err)
	}
	return ParseClashFromBytes(data)
}

// ParseClashFromURL 从 HTTP/HTTPS 远程订阅地址抓取并解析代理节点列表。
func ParseClashFromURL(subscribeURL string) ([]model.Node, error) {
	client := &http.Client{
		Timeout: 20 * time.Second,
	}

	req, err := http.NewRequest("GET", subscribeURL, nil)
	if err != nil {
		return nil, fmt.Errorf("invalid subscription url: %w", err)
	}

	// 注入标准 Clash 客户端 User-Agent，确保机场后端返回完整 YAML/Mihomo 节点配置而非空响应
	req.Header.Set("User-Agent", "Clash.Meta; Clash/1.18.0; NodePilot/1.0")
	req.Header.Set("Accept", "text/yaml, text/plain, application/json, */*")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch subscription from %s: %w", subscribeURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("subscription request returned HTTP %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	return ParseClashFromBytes(data)
}
