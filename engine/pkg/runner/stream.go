package runner

import (
	"bufio"
	"io"
	"math"
	"strings"
	"time"

	"nodepilot/engine/pkg/model"
)

// StreamAnalyzer 解析流式响应并精确测量 Token 节奏、时延与网络抖动方差。
type StreamAnalyzer struct {
	requestStartTime time.Time
}

// NewStreamAnalyzer 创建流式响应分析器实例。
// 入参：reqStartTime 为 HTTP 请求发起的绝对时间戳，用于精准衡量 TTFT。
func NewStreamAnalyzer(reqStartTime time.Time) *StreamAnalyzer {
	return &StreamAnalyzer{
		requestStartTime: reqStartTime,
	}
}

// AnalyzeStream 从 reader 实时读取流式数据，计算 TTFT、TPS、抖动方差以及代理缓冲 (Buffering) 特征。
// 核心逻辑：
//   - 逐行扫描 SSE/Chunk 数据流，滤除心跳空行与注释；
//   - 捕获第一块有效数据到达时间并推导首 Token 延迟 (TTFT)；
//   - 统计相邻响应块之间的微秒级间隔，计算间隔方差（Jitter Variance）与最大停顿间隔；
//   - 启发式检测代理聚合缓冲（若块数较多但平均间隔 <3ms 且 TTFT 较高，判定为假流式缓冲倾倒）。
func (s *StreamAnalyzer) AnalyzeStream(r io.Reader) (model.StreamMetrics, string, error) {
	metrics := model.StreamMetrics{}

	scanner := bufio.NewScanner(r)
	// 单行最大允许扩容至 256KB，防止大 JSON 块溢出
	buf := make([]byte, 64*1024)
	scanner.Buffer(buf, 256*1024)

	var chunkTimestamps []time.Time
	var sb strings.Builder
	var firstTokenReceived bool

	for scanner.Scan() {
		now := time.Now()
		line := scanner.Text()

		// 忽略 SSE 保活心跳空行与冒号注释行
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, ":") {
			continue
		}

		if !firstTokenReceived {
			firstTokenReceived = true
			metrics.TTFT = now.Sub(s.requestStartTime)
		}

		chunkTimestamps = append(chunkTimestamps, now)
		metrics.TotalTokens++
		sb.WriteString(line)
		sb.WriteString("\n")
	}

	if err := scanner.Err(); err != nil && err != io.EOF {
		return metrics, sb.String(), err
	}

	totalChunks := len(chunkTimestamps)
	if totalChunks <= 1 {
		// 单分块或非流式响应降级处理
		if totalChunks == 1 {
			metrics.TPS = 1.0
		}
		return metrics, sb.String(), nil
	}

	// 计算相邻分块到达时间间隔序列（毫秒）
	var intervals []float64
	var totalInterval float64
	var maxGap time.Duration

	for i := 1; i < totalChunks; i++ {
		gap := chunkTimestamps[i].Sub(chunkTimestamps[i-1])
		if gap > maxGap {
			maxGap = gap
		}
		gapMs := float64(gap.Microseconds()) / 1000.0
		intervals = append(intervals, gapMs)
		totalInterval += gapMs
	}

	metrics.MaxChunkGap = maxGap

	// 计算平均时间间隔与抖动方差 (Jitter Variance)
	avgInterval := totalInterval / float64(len(intervals))
	var varianceSum float64
	for _, v := range intervals {
		diff := v - avgInterval
		varianceSum += diff * diff
	}
	metrics.JitterVarianceMs = varianceSum / float64(len(intervals))

	// 计算吞吐率 TPS (Tokens Per Second)
	streamDuration := chunkTimestamps[totalChunks-1].Sub(chunkTimestamps[0])
	if streamDuration.Seconds() > 0 {
		metrics.TPS = float64(metrics.TotalTokens) / streamDuration.Seconds()
	} else {
		metrics.TPS = float64(metrics.TotalTokens) * 100.0 // 极短时间内并发刷出
	}

	// 代理聚合缓冲检测 (Proxy Buffering Detection)：
	// 若分块数较多，但首包等待时间极长 (TTFT > 800ms) 且后续分块平均间隔极短 (<3ms)，
	// 说明中间代理节点或网关开启了响应缓冲倾倒，严重破坏了实时流式交互体验。
	if metrics.TotalTokens > 5 {
		if avgInterval < 3.0 && metrics.TTFT > 800*time.Millisecond {
			metrics.ProxyBufferDetected = true
		}
	}

	// 防御性校验，避免浮点数计算异常出现 NaN 或 Inf
	if math.IsNaN(metrics.JitterVarianceMs) || math.IsInf(metrics.JitterVarianceMs, 0) {
		metrics.JitterVarianceMs = 0
	}

	return metrics, sb.String(), nil
}

