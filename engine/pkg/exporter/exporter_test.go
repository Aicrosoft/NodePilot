package exporter

import (
	"strings"
	"testing"
	"time"

	"nodepilot/engine/pkg/model"
	"gopkg.in/yaml.v3"
)

// TestFormatTerminalTable 验证控制台表格渲染逻辑。
// 包括表头存在性、指标格式化、节点名称截断、缓冲代理 [Buffer!] 高亮标记及空结果边界。
func TestFormatTerminalTable(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "US-Fast-Node",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       95.2,
			Network: model.NetworkMetrics{
				TTFB: 120 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 140 * time.Millisecond,
				TPS:                  85.2,
				JitterVarianceMs:     4.5,
				IngressSpeedBytesSec: 3.5 * 1024 * 1024,
				ProxyBufferDetected:  false,
			},
		},
		{
			NodeName:    "US-Buffered-Very-Long-Name-Node-Exceeding-Limit",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Rank:        2,
			Score:       72.8,
			Network: model.NetworkMetrics{
				TTFB: 220 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 260 * time.Millisecond,
				TPS:                  42.0,
				JitterVarianceMs:     18.2,
				IngressSpeedBytesSec: 1.2 * 1024 * 1024,
				ProxyBufferDetected:  true, // 触发 [Buffer!] 高亮标识
			},
		},
		{
			NodeName:    "JP-Claude-Node",
			ServiceName: "Anthropic Claude",
			Status:      model.StatusRestricted,
			Rank:        0, // 未上榜节点
			Score:       35.0,
			Network: model.NetworkMetrics{
				TTFB: 80 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				ProxyBufferDetected: false,
			},
		},
	}

	table := FormatTerminalTable(results)

	// 1. 验证目标服务分块标题
	if !strings.Contains(table, "Target Service: Google Antigravity") {
		t.Errorf("expected table to contain Google Antigravity section, got: %s", table)
	}
	if !strings.Contains(table, "Target Service: Anthropic Claude") {
		t.Errorf("expected table to contain Anthropic Claude section, got: %s", table)
	}

	// 2. 验证核心表头字段的存在性
	headers := []string{"Rank", "Node Name", "Status", "TTFB", "TTFT", "TPS", "Jitter", "Ingress", "Score"}
	for _, h := range headers {
		if !strings.Contains(table, h) {
			t.Errorf("expected column header '%s' in table, got: %s", h, table)
		}
	}

	// 3. 验证排名输出格式 (#1, #2)
	if !strings.Contains(table, "#1") || !strings.Contains(table, "#2") {
		t.Errorf("expected ranks #1 and #2 in table, got: %s", table)
	}

	// 4. 验证过长节点名称截断（超过 20 字符以 '...' 结尾）
	if !strings.Contains(table, "US-Buffered-Very-...") {
		t.Errorf("expected truncated node name with '...', got: %s", table)
	}

	// 5. 核心断言：检测到中转缓冲代理时必须附带 [Buffer!] 警告标签
	if !strings.Contains(table, "[Buffer!]") {
		t.Errorf("expected '[Buffer!]' marker for proxy buffer detected node, got: %s", table)
	}

	// 验证未缓冲节点不包含 [Buffer!]
	lines := strings.Split(table, "\n")
	for _, line := range lines {
		if strings.Contains(line, "US-Fast-Node") && strings.Contains(line, "[Buffer!]") {
			t.Errorf("unbuffered node should not have [Buffer!] flag: %s", line)
		}
	}

	// 6. 空结果切片边界验证
	emptyTable := FormatTerminalTable(nil)
	if emptyTable != "" {
		t.Errorf("expected empty string for nil results, got: %s", emptyTable)
	}
}

// TestGenerateMarkdownReport 验证 Markdown 格式报表渲染逻辑。
// 包括 GFM 标题、表格表头、对齐线、节点数据行、缓冲警告标签及空结果测试。
func TestGenerateMarkdownReport(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "HK-Premium-01",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       96.5,
			Network: model.NetworkMetrics{
				TTFB: 45 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 60 * time.Millisecond,
				TPS:                  98.2,
				JitterVarianceMs:     2.1,
				IngressSpeedBytesSec: 8.5 * 1024 * 1024,
				ProxyBufferDetected:  false,
			},
		},
		{
			NodeName:    "SG-Buffer-01",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Rank:        2,
			Score:       68.0,
			Network: model.NetworkMetrics{
				TTFB: 110 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 180 * time.Millisecond,
				TPS:                  35.0,
				JitterVarianceMs:     25.0,
				IngressSpeedBytesSec: 2.0 * 1024 * 1024,
				ProxyBufferDetected:  true, // 缓冲代理警告
			},
		},
	}

	md := GenerateMarkdownReport(results)

	// 1. 验证报告主标题与服务二级标题
	if !strings.HasPrefix(md, "# AI IDE Benchmark Report\n\n") {
		t.Errorf("expected markdown report to start with '# AI IDE Benchmark Report', got: %s", md)
	}
	if !strings.Contains(md, "## Service: Google Antigravity\n\n") {
		t.Errorf("expected service subtitle, got: %s", md)
	}

	// 2. 验证 Markdown 表格结构
	tableHeader := "| Rank | Node Name | Status | TTFB | TTFT | TPS | Jitter | Ingress | Score |"
	tableDivider := "| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |"
	if !strings.Contains(md, tableHeader) {
		t.Errorf("expected markdown table header '%s', got: %s", tableHeader, md)
	}
	if !strings.Contains(md, tableDivider) {
		t.Errorf("expected markdown table divider '%s', got: %s", tableDivider, md)
	}

	// 3. 验证节点与指标渲染行
	if !strings.Contains(md, "| 1 | HK-Premium-01 | Available | 45ms | 60ms | 98.2 | 2.1ms | 8.50 MB/s | 96.5 |") {
		t.Errorf("expected row for HK-Premium-01, got: %s", md)
	}

	// 4. 验证缓冲警告 ⚠️(Buffer)
	if !strings.Contains(md, "⚠️(Buffer)") {
		t.Errorf("expected '⚠️(Buffer)' warning for SG-Buffer-01, got: %s", md)
	}

	// 5. 空结果切片边界验证
	emptyMD := GenerateMarkdownReport(nil)
	expectedEmpty := "# AI IDE Benchmark Report\n\n"
	if emptyMD != expectedEmpty {
		t.Errorf("expected '%s' for empty results, got '%s'", expectedEmpty, emptyMD)
	}
}

// TestGenerateBestGroupsYAML 验证基于压测排名的 Clash 策略组 YAML 导出功能。
// 涵盖 Top-N 截断、降级策略组参数契约（fallback、健康检查 URL、间隔）、默认 Top-5 回退及全未上榜空配置边界。
func TestGenerateBestGroupsYAML(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "Node-Antigravity-1",
			ServiceName: "Google Antigravity",
			Rank:        1,
		},
		{
			NodeName:    "Node-Antigravity-2",
			ServiceName: "Google Antigravity",
			Rank:        2,
		},
		{
			NodeName:    "Node-Antigravity-3",
			ServiceName: "Google Antigravity",
			Rank:        3,
		},
		{
			NodeName:    "Node-OpenAI-1",
			ServiceName: "OpenAI",
			Rank:        1,
		},
		{
			NodeName:    "Node-Unranked",
			ServiceName: "Google Gemini",
			Rank:        0, // 未上榜节点，不应出现在策略组中
		},
	}

	// 1. 测试 topN = 2 策略组生成
	yamlStr, err := GenerateBestGroupsYAML(results, 2)
	if err != nil {
		t.Fatalf("GenerateBestGroupsYAML failed: %v", err)
	}

	var cfg ClashExportConfig
	if err := yaml.Unmarshal([]byte(yamlStr), &cfg); err != nil {
		t.Fatalf("failed to unmarshal generated YAML: %v\nYAML content:\n%s", err, yamlStr)
	}

	// 验证仅包含具有有效排名节点的服务（Antigravity 与 OpenAI；Gemini 因无上榜节点不应生成策略组）
	if len(cfg.ProxyGroups) != 2 {
		t.Fatalf("expected 2 proxy groups, got %d", len(cfg.ProxyGroups))
	}

	groupMap := make(map[string]ClashProxyGroup)
	for _, g := range cfg.ProxyGroups {
		groupMap[g.Name] = g
	}

	// 2. 验证 Antigravity 策略组字段契约
	agGroup, ok := groupMap["⚡ Google-Antigravity-Best"]
	if !ok {
		t.Fatalf("expected group '⚡ Google-Antigravity-Best', available: %+v", groupMap)
	}
	if agGroup.Type != "fallback" {
		t.Errorf("expected group type 'fallback', got '%s'", agGroup.Type)
	}
	if agGroup.URL != "https://cloudcode-pa.googleapis.com" {
		t.Errorf("expected URL 'https://cloudcode-pa.googleapis.com', got '%s'", agGroup.URL)
	}
	if agGroup.Interval != 300 {
		t.Errorf("expected interval 300, got %d", agGroup.Interval)
	}
	if len(agGroup.Proxies) != 2 {
		t.Errorf("expected 2 proxies in top-2 group, got %d: %+v", len(agGroup.Proxies), agGroup.Proxies)
	}
	if agGroup.Proxies[0] != "Node-Antigravity-1" || agGroup.Proxies[1] != "Node-Antigravity-2" {
		t.Errorf("unexpected proxies list: %+v", agGroup.Proxies)
	}

	// 3. 验证 OpenAI 策略组字段契约
	aiGroup, ok := groupMap["⚡ OpenAI-Best"]
	if !ok {
		t.Fatalf("expected group '⚡ OpenAI-Best', available: %+v", groupMap)
	}
	if aiGroup.Type != "fallback" {
		t.Errorf("expected group type 'fallback', got '%s'", aiGroup.Type)
	}
	if aiGroup.URL != "https://api.openai.com/v1/models" {
		t.Errorf("expected URL 'https://api.openai.com/v1/models', got '%s'", aiGroup.URL)
	}
	if len(aiGroup.Proxies) != 1 || aiGroup.Proxies[0] != "Node-OpenAI-1" {
		t.Errorf("unexpected OpenAI proxies list: %+v", aiGroup.Proxies)
	}

	// 4. 边界测试：topN <= 0 时默认截取 Top 5
	yamlDefault, err := GenerateBestGroupsYAML(results, 0)
	if err != nil {
		t.Fatalf("GenerateBestGroupsYAML with topN=0 failed: %v", err)
	}
	var cfgDefault ClashExportConfig
	_ = yaml.Unmarshal([]byte(yamlDefault), &cfgDefault)
	for _, g := range cfgDefault.ProxyGroups {
		if g.Name == "⚡ Google-Antigravity-Best" {
			// Rank 1, 2, 3 全部包含在内
			if len(g.Proxies) != 3 {
				t.Errorf("expected 3 proxies when defaulting to top-5, got %d", len(g.Proxies))
			}
		}
	}

	// 5. 边界测试：空结果切片
	yamlEmpty, err := GenerateBestGroupsYAML(nil, 5)
	if err != nil {
		t.Fatalf("GenerateBestGroupsYAML on nil results failed: %v", err)
	}
	var cfgEmpty ClashExportConfig
	_ = yaml.Unmarshal([]byte(yamlEmpty), &cfgEmpty)
	if len(cfgEmpty.ProxyGroups) != 0 {
		t.Errorf("expected 0 proxy groups for empty results, got %d", len(cfgEmpty.ProxyGroups))
	}
}

// TestGuessEndpoint 验证基于 AI 服务名推断其健康检查 URL 的逻辑。
func TestGuessEndpoint(t *testing.T) {
	cases := []struct {
		service  string
		expected string
	}{
		{"Google Antigravity", "https://cloudcode-pa.googleapis.com"},
		{"Google Gemini", "https://generativelanguage.googleapis.com"},
		{"OpenAI / ChatGPT", "https://api.openai.com/v1/models"},
		{"Anthropic Claude", "https://api.anthropic.com/v1/messages"},
		{"Other Custom Service", "https://www.google.com/generate_204"},
	}

	for _, tc := range cases {
		ep := guessEndpoint(tc.service)
		if ep != tc.expected {
			t.Errorf("guessEndpoint(%s) = %s, expected %s", tc.service, ep, tc.expected)
		}
	}
}

// TestExporter_OnlyUnavailableNodes 验证所有节点均处于不可用或受限状态时的容错处理。
// 确保控制台表格、Markdown 报表均正确显示占位符 '-'，且 Clash 配置不产生空策略组。
func TestExporter_OnlyUnavailableNodes(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "Broken-Node-01",
			ServiceName: "Google Antigravity",
			Status:      model.StatusUnavailable,
			Rank:        0,
			Score:       0.0,
			Network: model.NetworkMetrics{
				TTFB: 0,
			},
			Stream: model.StreamMetrics{
				TTFT:                 0,
				TPS:                  0,
				JitterVarianceMs:     0,
				IngressSpeedBytesSec: 0,
				ProxyBufferDetected:  false,
			},
		},
		{
			NodeName:    "Restricted-Node-02",
			ServiceName: "Google Antigravity",
			Status:      model.StatusRestricted,
			Rank:        0,
			Score:       10.0,
			Network: model.NetworkMetrics{
				TTFB: 350 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 0,
				TPS:                  0,
				JitterVarianceMs:     0,
				IngressSpeedBytesSec: 0,
				ProxyBufferDetected:  false,
			},
		},
	}

	// 1. 控制台表格输出：所有未测得指标与未上榜节点应统一显示为 "-"
	table := FormatTerminalTable(results)
	if !strings.Contains(table, "Target Service: Google Antigravity") {
		t.Errorf("expected table to contain Google Antigravity section")
	}
	if !strings.Contains(table, "Unavailable") || !strings.Contains(table, "Restricted") {
		t.Errorf("expected status Unavailable and Restricted in table")
	}
	if strings.Contains(table, "#0") {
		t.Errorf("unranked nodes should display '-' rather than '#0'")
	}

	// 2. Markdown 报告输出：未上榜与零值指标统一显示为 "-"
	md := GenerateMarkdownReport(results)
	if !strings.Contains(md, "## Service: Google Antigravity") {
		t.Errorf("expected markdown to contain service header")
	}
	if !strings.Contains(md, "| - | Broken-Node-01 | Unavailable | 0ms | - | - | - | - | 0.0 |") {
		t.Errorf("expected markdown to show dash for missing stream metrics, got:\n%s", md)
	}

	// 3. 策略组导出：当所有节点均未上榜时，不应生成空代理组
	yamlStr, err := GenerateBestGroupsYAML(results, 3)
	if err != nil {
		t.Fatalf("GenerateBestGroupsYAML failed: %v", err)
	}
	var cfg ClashExportConfig
	if err := yaml.Unmarshal([]byte(yamlStr), &cfg); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if len(cfg.ProxyGroups) != 0 {
		t.Errorf("expected 0 proxy groups when all nodes are unranked/unavailable, got %d", len(cfg.ProxyGroups))
	}
}

// TestExporter_MultiServiceAndUnicodeRuneHandling 验证多服务聚合、Unicode / Emoji 字符安全截断与策略组名称合法化。
func TestExporter_MultiServiceAndUnicodeRuneHandling(t *testing.T) {
	// 验证多字节 UTF-8 字符（中文、Emoji）、超长节点名称截断以及多厂商混合结果处理
	longUnicodeName := "🚀 香港优质专线-节点名称超过二十个字符测试边界溢出"
	results := []model.BenchmarkResult{
		{
			NodeName:    longUnicodeName,
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       99.0,
			Network:     model.NetworkMetrics{TTFB: 50 * time.Millisecond},
			Stream:      model.StreamMetrics{TTFT: 70 * time.Millisecond, TPS: 120.5},
		},
		{
			NodeName:    "US-Claude-Node",
			ServiceName: "Anthropic Claude",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       91.2,
			Network:     model.NetworkMetrics{TTFB: 180 * time.Millisecond},
			Stream:      model.StreamMetrics{TTFT: 210 * time.Millisecond, TPS: 65.0},
		},
		{
			NodeName:    "SG-OpenAI-Node",
			ServiceName: "OpenAI / ChatGPT",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       88.5,
			Network:     model.NetworkMetrics{TTFB: 150 * time.Millisecond},
			Stream:      model.StreamMetrics{TTFT: 170 * time.Millisecond, TPS: 70.0},
		},
		{
			NodeName:    "EU-Custom-Node",
			ServiceName: "Custom / Private LLM",
			Status:      model.StatusAvailable,
			Rank:        1,
			Score:       85.0,
			Network:     model.NetworkMetrics{TTFB: 200 * time.Millisecond},
			Stream:      model.StreamMetrics{TTFT: 230 * time.Millisecond, TPS: 50.0},
		},
	}

	// 1. 验证控制台表格：Unicode 截断安全无 panic，且保留 17 个 rune + "..."
	table := FormatTerminalTable(results)
	for _, sName := range []string{"Google Antigravity", "Anthropic Claude", "OpenAI / ChatGPT", "Custom / Private LLM"} {
		if !strings.Contains(table, sName) {
			t.Errorf("missing service section in table: %s", sName)
		}
	}
	if !strings.Contains(table, "...") {
		t.Errorf("expected truncated string with '...' for long unicode name")
	}

	// 2. 验证 Markdown 报告完整包含所有 4 个服务
	md := GenerateMarkdownReport(results)
	for _, sName := range []string{"Google Antigravity", "Anthropic Claude", "OpenAI / ChatGPT", "Custom / Private LLM"} {
		if !strings.Contains(md, "## Service: "+sName) {
			t.Errorf("missing service header in markdown: %s", sName)
		}
	}
	// Markdown 报告应完整保留未截断的原始名称
	if !strings.Contains(md, longUnicodeName) {
		t.Errorf("expected full untruncated unicode name in markdown report")
	}

	// 3. 验证策略组导出：包含斜杠的服务名被安全规范化为 "-"
	yamlStr, err := GenerateBestGroupsYAML(results, 5)
	if err != nil {
		t.Fatalf("GenerateBestGroupsYAML error: %v", err)
	}
	var cfg ClashExportConfig
	if err := yaml.Unmarshal([]byte(yamlStr), &cfg); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	if len(cfg.ProxyGroups) != 4 {
		t.Fatalf("expected 4 proxy groups, got %d", len(cfg.ProxyGroups))
	}

	groupNames := make([]string, 0, len(cfg.ProxyGroups))
	for _, g := range cfg.ProxyGroups {
		groupNames = append(groupNames, g.Name)
		if strings.Contains(g.Name, "/") {
			t.Errorf("proxy group name contains illegal slash: %s", g.Name)
		}
	}
}
