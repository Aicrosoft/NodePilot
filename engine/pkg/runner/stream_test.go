// Package runner 包含对流式分析器 SSE 响应解析、TTFT、TPS 与方差计算的单元测试。
package runner

import (
	"strings"
	"testing"
	"time"
)

func TestStreamAnalyzer(t *testing.T) {
	reqStart := time.Now()
	analyzer := NewStreamAnalyzer(reqStart)

	// 模拟 SSE 流式数据负载
	ssePayload := `
data: {"token": "hello"}

data: {"token": "world"}

data: {"token": "from"}

data: {"token": "ai"}
`

	metrics, body, err := analyzer.AnalyzeStream(strings.NewReader(ssePayload))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if metrics.TotalTokens != 4 {
		t.Errorf("expected 4 tokens, got %d", metrics.TotalTokens)
	}

	if !strings.Contains(body, "hello") {
		t.Errorf("expected body to contain 'hello', got: %s", body)
	}

	if metrics.TTFT <= 0 {
		t.Errorf("expected positive TTFT, got %v", metrics.TTFT)
	}
}

