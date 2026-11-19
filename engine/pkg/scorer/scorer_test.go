// Package scorer 包含对多服务加权打分、多态状态机判定、代理缓冲惩罚与归一化边界的单元测试。
package scorer

import (
	"math"
	"testing"
	"time"

	"nodepilot/engine/pkg/model"
)

func TestScoreAndRank(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "Fast-Node",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TCPConnect:   15 * time.Millisecond,
				TLSHandshake: 15 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 150 * time.Millisecond,
				TPS:                  60.0,
				JitterVarianceMs:     5.0,
				IngressSpeedBytesSec: 2 * 1024 * 1024,
			},
		},
		{
			NodeName:    "Buffering-Node",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         300 * time.Millisecond,
				TCPConnect:   25 * time.Millisecond,
				TLSHandshake: 25 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 800 * time.Millisecond,
				TPS:                  20.0,
				JitterVarianceMs:     120.0,
				ProxyBufferDetected:  true,
				IngressSpeedBytesSec: 500 * 1024,
			},
		},
		{
			NodeName:    "Blocked-Node",
			ServiceName: "Google Antigravity",
			Status:      model.StatusRestricted,
		},
	}

	ranked := CalculateScoresAndRank(results)
	if len(ranked) != 3 {
		t.Fatalf("expected 3 results, got %d", len(ranked))
	}

	if ranked[0].NodeName != "Fast-Node" || ranked[0].Rank != 1 {
		t.Errorf("expected Fast-Node to be rank 1, got %+v", ranked[0])
	}
	if ranked[1].NodeName != "Buffering-Node" || ranked[1].Rank != 2 {
		t.Errorf("expected Buffering-Node to be rank 2, got %+v", ranked[1])
	}
	if ranked[2].Rank != -1 || ranked[2].Score != 0 {
		t.Errorf("expected Blocked-Node to have score 0, got %f", ranked[2].Score)
	}
}

// TestScoreAndRank_ProxyBufferPenalty 验证检测到代理缓冲劫持时严格扣减 30% 综合得分
func TestScoreAndRank_ProxyBufferPenalty(t *testing.T) {
	// 构造两个除 ProxyBufferDetected 外其余网络与流式指标完全一致的节点
	results := []model.BenchmarkResult{
		{
			NodeName:    "Standard-Stream-Node",
			ServiceName: "OpenAI",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 120 * time.Millisecond,
				TPS:                  50.0,
				JitterVarianceMs:     10.0,
				IngressSpeedBytesSec: 1024 * 1024,
				ProxyBufferDetected:  false,
			},
		},
		{
			NodeName:    "Buffering-Hijack-Node",
			ServiceName: "OpenAI",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 120 * time.Millisecond,
				TPS:                  50.0,
				JitterVarianceMs:     10.0,
				IngressSpeedBytesSec: 1024 * 1024,
				ProxyBufferDetected:  true,
			},
		},
	}

	ranked := CalculateScoresAndRank(results)
	var stdScore, bufScore float64
	for _, r := range ranked {
		if r.NodeName == "Standard-Stream-Node" {
			stdScore = r.Score
		} else if r.NodeName == "Buffering-Hijack-Node" {
			bufScore = r.Score
		}
	}

	if stdScore <= 0 {
		t.Fatalf("expected Standard-Stream-Node score > 0, got %f", stdScore)
	}

	// 断言：由于除缓冲检测外指标完全一致，基准分为 100.0，缓冲节点得分应为 100.0 * 0.70 = 70.0
	expectedBufScore := math.Round(stdScore*0.70*10) / 10
	if math.Abs(bufScore-expectedBufScore) > 0.1 {
		t.Errorf("expected buffering node score to be %.1f, got %.1f (stdScore=%.1f)",
			expectedBufScore, bufScore, stdScore)
	}
}

// TestScoreAndRank_PolymorphicAvailability 验证多态可用性状态机的入围与评分断言
// 401/403 (Authentication Required) 被评定为健康通道链路并正常入围参与加权排名；
// Unavailable / Timeout / Restricted 状态节点强制 0 分且 Rank = -1
func TestScoreAndRank_PolymorphicAvailability(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "AuthRequired-Node",
			ServiceName: "Google Gemini",
			Status:      model.StatusAuthenticationRequired,
			Network: model.NetworkMetrics{
				TTFB:         120 * time.Millisecond,
				TotalTime:    150 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
		{
			NodeName:    "FullyAvailable-Node",
			ServiceName: "Google Gemini",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         200 * time.Millisecond,
				TotalTime:    250 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
		{
			NodeName:    "Restricted-Node",
			ServiceName: "Google Gemini",
			Status:      model.StatusRestricted,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TotalTime:    120 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
		{
			NodeName:    "Timeout-Node",
			ServiceName: "Google Gemini",
			Status:      model.StatusTimeout,
		},
		{
			NodeName:    "Unavailable-Node",
			ServiceName: "Google Gemini",
			Status:      model.StatusUnavailable,
		},
	}

	ranked := CalculateScoresAndRank(results)
	if len(ranked) != 5 {
		t.Fatalf("expected 5 results, got %d", len(ranked))
	}

	var authNode, availNode, restrNode, timeoutNode, unavailNode *model.BenchmarkResult
	for i := range ranked {
		switch ranked[i].NodeName {
		case "AuthRequired-Node":
			authNode = &ranked[i]
		case "FullyAvailable-Node":
			availNode = &ranked[i]
		case "Restricted-Node":
			restrNode = &ranked[i]
		case "Timeout-Node":
			timeoutNode = &ranked[i]
		case "Unavailable-Node":
			unavailNode = &ranked[i]
		}
	}

	// 1. AuthRequired-Node 必须入围参与打分且 Rank > 0
	if authNode == nil || authNode.Score <= 0 || authNode.Rank <= 0 {
		t.Errorf("expected AuthRequired-Node to be scored and ranked, got %+v", authNode)
	}

	// 2. FullyAvailable-Node 必须入围参与打分
	if availNode == nil || availNode.Score <= 0 || availNode.Rank <= 0 {
		t.Errorf("expected FullyAvailable-Node to be scored and ranked, got %+v", availNode)
	}

	// 3. Restricted-Node 必须得 0 分且 Rank 为 -1
	if restrNode == nil || restrNode.Score != 0 || restrNode.Rank != -1 {
		t.Errorf("expected Restricted-Node to have score 0 and rank -1, got %+v", restrNode)
	}

	// 4. Timeout-Node 必须得 0 分且 Rank 为 -1
	if timeoutNode == nil || timeoutNode.Score != 0 || timeoutNode.Rank != -1 {
		t.Errorf("expected Timeout-Node to have score 0 and rank -1, got %+v", timeoutNode)
	}

	// 5. Unavailable-Node 必须得 0 分且 Rank 为 -1
	if unavailNode == nil || unavailNode.Score != 0 || unavailNode.Rank != -1 {
		t.Errorf("expected Unavailable-Node to have score 0 and rank -1, got %+v", unavailNode)
	}
}

// TestScoreAndRank_ZeroMetricsNodeMustHaveZeroScore 验证全零指标节点的防御性断言
func TestScoreAndRank_ZeroMetricsNodeMustHaveZeroScore(t *testing.T) {
	// 所有指标均为 0（空）：坚决杜绝产生虚假高分
	results := []model.BenchmarkResult{
		{
			NodeName:    "Notice-Node-1",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable, // 即便被误标为 Available
			Network:     model.NetworkMetrics{}, // TTFB=0, TotalTime=0
			Stream:      model.StreamMetrics{},  // TTFT=0, TPS=0, Jitter=0
		},
		{
			NodeName:    "Real-Node",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         150 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
	}

	ranked := CalculateScoresAndRank(results)
	var noticeResult, realResult model.BenchmarkResult
	for _, r := range ranked {
		if r.NodeName == "Notice-Node-1" {
			noticeResult = r
		} else if r.NodeName == "Real-Node" {
			realResult = r
		}
	}

	if noticeResult.Score != 0 || noticeResult.Status != model.StatusUnavailable {
		t.Fatalf("expected Notice-Node-1 to be Unavailable with score 0, got status=%s score=%f", noticeResult.Status, noticeResult.Score)
	}
	if noticeResult.Rank != -1 {
		t.Fatalf("expected Notice-Node-1 rank to be -1, got %d", noticeResult.Rank)
	}
	if noticeResult.ErrorMsg != "no response byte received" {
		t.Fatalf("expected ErrorMsg 'no response byte received', got '%s'", noticeResult.ErrorMsg)
	}
	if realResult.Score <= 0 {
		t.Fatalf("expected Real-Node with 150ms TTFB to have positive score, got %f", realResult.Score)
	}
}

// TestScoreAndRank_SingleNodeAndIdenticalMetricsNormalization 验证单节点与完全相同指标时的归一化极值防除零边界
func TestScoreAndRank_SingleNodeAndIdenticalMetricsNormalization(t *testing.T) {
	// 1. 仅存在单个可用节点时的满分归一化
	singleResult := []model.BenchmarkResult{
		{
			NodeName:    "Solo-Node",
			ServiceName: "Cursor",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         150 * time.Millisecond,
				TotalTime:    200 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
			Stream: model.StreamMetrics{
				TTFT:                 180 * time.Millisecond,
				TPS:                  35.0,
				JitterVarianceMs:     12.0,
				IngressSpeedBytesSec: 1024 * 512,
			},
		},
	}

	rankedSingle := CalculateScoresAndRank(singleResult)
	if len(rankedSingle) != 1 {
		t.Fatalf("expected 1 result, got %d", len(rankedSingle))
	}
	if rankedSingle[0].Score != 100.0 {
		t.Errorf("expected single node score to be 100.0, got %f", rankedSingle[0].Score)
	}
	if rankedSingle[0].Rank != 1 {
		t.Errorf("expected single node rank to be 1, got %d", rankedSingle[0].Rank)
	}

	// 2. 当两个可用节点指标完全相同时，防止除以零产生 NaN 或 Inf
	identicalResults := []model.BenchmarkResult{
		{
			NodeName:    "Node-A",
			ServiceName: "Cursor",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TotalTime:    120 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
		{
			NodeName:    "Node-B",
			ServiceName: "Cursor",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TotalTime:    120 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
	}

	rankedIdentical := CalculateScoresAndRank(identicalResults)
	if len(rankedIdentical) != 2 {
		t.Fatalf("expected 2 results, got %d", len(rankedIdentical))
	}
	for _, r := range rankedIdentical {
		if math.IsNaN(r.Score) || math.IsInf(r.Score, 0) {
			t.Fatalf("score evaluated to NaN or Inf for %s", r.NodeName)
		}
		if r.Score != 100.0 {
			t.Errorf("expected score 100.0 for identical node %s, got %f", r.NodeName, r.Score)
		}
	}
}

// TestScoreAndRank_MultiServiceIsolation 验证多服务隔离独立评分体系
func TestScoreAndRank_MultiServiceIsolation(t *testing.T) {
	results := []model.BenchmarkResult{
		{
			NodeName:    "Node-1",
			ServiceName: "OpenAI",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         100 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
		{
			NodeName:    "Node-1",
			ServiceName: "Google Antigravity",
			Status:      model.StatusAvailable,
			Network: model.NetworkMetrics{
				TTFB:         300 * time.Millisecond,
				TCPConnect:   10 * time.Millisecond,
				TLSHandshake: 10 * time.Millisecond,
			},
		},
	}

	ranked := CalculateScoresAndRank(results)
	if len(ranked) != 2 {
		t.Fatalf("expected 2 results, got %d", len(ranked))
	}

	// 由于分属不同目标服务，各自在服务内为独苗节点，分别归一化为 100.0 分与 Rank 1
	for _, r := range ranked {
		if r.Rank != 1 {
			t.Errorf("expected Rank 1 for isolated service %s, got %d", r.ServiceName, r.Rank)
		}
		if r.Score != 100.0 {
			t.Errorf("expected Score 100.0 for isolated service %s, got %f", r.ServiceName, r.Score)
		}
	}
}
