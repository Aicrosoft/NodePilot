// Package exporter 提供测试结果的多维度报表导出能力。
package exporter

import (
	"fmt"
	"strings"

	"nodepilot/engine/pkg/model"
)

// FormatTerminalTable 将压测基准与评分结果格式化为控制台友好的 ASCII 表格字符串。
// 支持按目标服务分组聚合、指标对齐以及对缓冲代理 ([Buffer!]) 节点的高亮标记。
func FormatTerminalTable(results []model.BenchmarkResult) string {
	var sb strings.Builder

	// 按目标 AI 服务进行分组
	grouped := make(map[string][]model.BenchmarkResult)
	for _, r := range results {
		grouped[r.ServiceName] = append(grouped[r.ServiceName], r)
	}

	for sName, list := range grouped {
		sb.WriteString(fmt.Sprintf("\n=================== Target Service: %s ===================\n", sName))
		sb.WriteString(fmt.Sprintf("%-4s  %-20s  %-12s  %-9s  %-9s  %-7s  %-9s  %-8s  %-5s\n",
			"Rank", "Node Name", "Status", "TTFB", "TTFT", "TPS", "Jitter", "Ingress", "Score"))
		sb.WriteString(strings.Repeat("-", 95) + "\n")

		for _, r := range list {
			rankStr := "-"
			if r.Rank > 0 {
				rankStr = fmt.Sprintf("#%d", r.Rank)
			}

			ttfbStr := fmt.Sprintf("%dms", r.Network.TTFB.Milliseconds())
			ttftStr := "-"
			if r.Stream.TTFT > 0 {
				ttftStr = fmt.Sprintf("%dms", r.Stream.TTFT.Milliseconds())
			}

			tpsStr := "-"
			if r.Stream.TPS > 0 {
				tpsStr = fmt.Sprintf("%.1f", r.Stream.TPS)
			}

			jitterStr := "-"
			if r.Stream.JitterVarianceMs > 0 {
				jitterStr = fmt.Sprintf("%.1fms", r.Stream.JitterVarianceMs)
			}

			ingressStr := "-"
			if r.Stream.IngressSpeedBytesSec > 0 {
				mb := r.Stream.IngressSpeedBytesSec / (1024 * 1024)
				ingressStr = fmt.Sprintf("%.2fMB/s", mb)
			}

			bufferFlag := ""
			if r.Stream.ProxyBufferDetected {
				bufferFlag = " [Buffer!]"
			}

			sb.WriteString(fmt.Sprintf("%-4s  %-20s  %-12s  %-9s  %-9s  %-7s  %-9s  %-8s  %5.1f%s\n",
				rankStr, truncate(r.NodeName, 20), truncate(string(r.Status), 12),
				ttfbStr, ttftStr, tpsStr, jitterStr, ingressStr, r.Score, bufferFlag))
		}
	}

	return sb.String()
}

// GenerateMarkdownReport 将压测基准与评分结果渲染为标准 GFM (GitHub Flavored Markdown) 格式报表。
func GenerateMarkdownReport(results []model.BenchmarkResult) string {
	var sb strings.Builder
	sb.WriteString("# AI IDE Benchmark Report\n\n")

	grouped := make(map[string][]model.BenchmarkResult)
	for _, r := range results {
		grouped[r.ServiceName] = append(grouped[r.ServiceName], r)
	}

	for sName, list := range grouped {
		sb.WriteString(fmt.Sprintf("## Service: %s\n\n", sName))
		sb.WriteString("| Rank | Node Name | Status | TTFB | TTFT | TPS | Jitter | Ingress | Score |\n")
		sb.WriteString("| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n")

		for _, r := range list {
			rankStr := "-"
			if r.Rank > 0 {
				rankStr = fmt.Sprintf("%d", r.Rank)
			}
			ttftStr := "-"
			if r.Stream.TTFT > 0 {
				ttftStr = fmt.Sprintf("%dms", r.Stream.TTFT.Milliseconds())
			}
			tpsStr := "-"
			if r.Stream.TPS > 0 {
				tpsStr = fmt.Sprintf("%.1f", r.Stream.TPS)
			}
			jitterStr := "-"
			if r.Stream.JitterVarianceMs > 0 {
				jitterStr = fmt.Sprintf("%.1fms", r.Stream.JitterVarianceMs)
			}
			ingressStr := "-"
			if r.Stream.IngressSpeedBytesSec > 0 {
				ingressStr = fmt.Sprintf("%.2f MB/s", r.Stream.IngressSpeedBytesSec/(1024*1024))
			}
			bufferNote := ""
			if r.Stream.ProxyBufferDetected {
				bufferNote = " ⚠️(Buffer)"
			}

			sb.WriteString(fmt.Sprintf("| %s | %s | %s | %dms | %s | %s | %s | %s | %.1f%s |\n",
				rankStr, r.NodeName, r.Status, r.Network.TTFB.Milliseconds(),
				ttftStr, tpsStr, jitterStr, ingressStr, r.Score, bufferNote))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

// truncate 按照 Unicode 字符（Rune）切分截断过长字符串并追加省略号，防止控制台排版被破坏。
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen-3]) + "..."
}

