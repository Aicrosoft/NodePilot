// Package exporter 提供测试结果的多维度报表导出能力。
// 包括 Clash/Mihomo 自动化策略组生成、控制台表格格式化以及 Markdown 总结报告导出。
package exporter

import (
	"fmt"
	"strings"

	"nodepilot/engine/pkg/model"
	"gopkg.in/yaml.v3"
)

// ClashProxyGroup 表示 Clash / Mihomo 配置文件中的代理组 (Proxy Group) 结构定义。
type ClashProxyGroup struct {
	Name     string   `yaml:"name"`
	Type     string   `yaml:"type"`
	Proxies  []string `yaml:"proxies"`
	URL      string   `yaml:"url,omitempty"`
	Interval int      `yaml:"interval,omitempty"`
}

// ClashExportConfig 表示导出的 YAML 结构，封装根据测试结果提炼出的最优节点策略组切片。
type ClashExportConfig struct {
	ProxyGroups []ClashProxyGroup `yaml:"proxy-groups"`
}

// GenerateBestGroupsYAML 根据压测与评分结果，为每个 AI 服务生成排名前 Top-N 的最优 fallback 代理组 YAML 配置。
// 若 topN <= 0，则默认截取 Top 5 节点。
func GenerateBestGroupsYAML(results []model.BenchmarkResult, topN int) (string, error) {
	if topN <= 0 {
		topN = 5
	}

	// 1. 按 AI 服务名称进行归类聚合
	serviceNodes := make(map[string][]string)
	serviceEndpoints := make(map[string]string)

	for _, r := range results {
		if r.Rank > 0 && r.Rank <= topN {
			serviceNodes[r.ServiceName] = append(serviceNodes[r.ServiceName], r.NodeName)
		}
		if serviceEndpoints[r.ServiceName] == "" {
			serviceEndpoints[r.ServiceName] = guessEndpoint(r.ServiceName)
		}
	}

	var groups []ClashProxyGroup
	for sName, nodes := range serviceNodes {
		if len(nodes) == 0 {
			continue
		}
		groupName := fmt.Sprintf("⚡ %s-Best", cleanServiceName(sName))
		groups = append(groups, ClashProxyGroup{
			Name:     groupName,
			Type:     "fallback",
			Proxies:  nodes,
			URL:      serviceEndpoints[sName],
			Interval: 300,
		})
	}

	cfg := ClashExportConfig{
		ProxyGroups: groups,
	}

	out, err := yaml.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("failed to marshal proxy groups: %w", err)
	}

	return string(out), nil
}

// cleanServiceName 清洗服务名称中的特殊符号与空格，生成符合 Clash 配置规范的标识符。
func cleanServiceName(s string) string {
	s = strings.ReplaceAll(s, " ", "-")
	s = strings.ReplaceAll(s, "/", "-")
	return s
}

// guessEndpoint 根据服务标识推测其最佳存活探活/健康检查 URL 端点。
func guessEndpoint(s string) string {
	sLower := strings.ToLower(s)
	if strings.Contains(sLower, "antigravity") {
		return "https://cloudcode-pa.googleapis.com"
	}
	if strings.Contains(sLower, "gemini") {
		return "https://generativelanguage.googleapis.com"
	}
	if strings.Contains(sLower, "openai") {
		return "https://api.openai.com/v1/models"
	}
	if strings.Contains(sLower, "claude") || strings.Contains(sLower, "anthropic") {
		return "https://api.anthropic.com/v1/messages"
	}
	return "https://www.google.com/generate_204"
}

