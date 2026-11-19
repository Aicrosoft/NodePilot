// Package scorer 提供多服务隔离的加权评分与降序排名算法引擎。
//
// 架构概述：
//   - 针对不同 AI 厂商服务（Antigravity, Gemini, OpenAI, Claude, Cursor 等）进行独立分组评测与打分隔离；
//   - 实施硬门禁（Hard Gate）过滤：仅当状态为 Available 或 AuthenticationRequired 且具备有效往返网络耗时时方可入围；
//   - 动态权重分配：根据当前测试批次中实际激活的指标维度（首字时延、TPS 吞吐率、抖动方差、上行带宽、TCP/TLS 握手耗时）自适应重新计算权重占比；
//   - 代理聚合缓冲检测惩罚机制：若节点被检测出伪流式聚合缓冲倾倒 (ProxyBufferDetected)，综合得分严格削减 30%；
//   - 极值归一化防除零边界保护：单节点或所有节点指标相同时平滑归一为 1.0，彻底杜绝 NaN 或 Inf。
package scorer

import (
	"math"
	"sort"
	"time"

	"nodepilot/engine/pkg/model"
)

// CalculateScoresAndRank 对所有评测结果执行服务分组、归一化加权评分与排序。
func CalculateScoresAndRank(results []model.BenchmarkResult) []model.BenchmarkResult {
	// 1. 按 AI 目标服务独立分组
	grouped := make(map[string][]model.BenchmarkResult)
	for _, r := range results {
		grouped[r.ServiceName] = append(grouped[r.ServiceName], r)
	}

	var allRanked []model.BenchmarkResult

	// 2. 每个 AI 服务内部独立执行归一化评分与排名
	for _, group := range grouped {
		scoredGroup := scoreServiceGroup(group)
		allRanked = append(allRanked, scoredGroup...)
	}

	return allRanked
}

func scoreServiceGroup(results []model.BenchmarkResult) []model.BenchmarkResult {
	var usable []model.BenchmarkResult
	var unusable []model.BenchmarkResult

	for _, r := range results {
		// 硬门禁过滤：状态必须为 Available 或 AuthenticationRequired，且必须具备有效的端到端往返耗时
		hasValidNetwork := r.Network.TTFB > 0 || r.Network.TotalTime > 0
		if (r.Status == model.StatusAvailable || r.Status == model.StatusAuthenticationRequired) && hasValidNetwork {
			usable = append(usable, r)
		} else {
			if r.Status == model.StatusAvailable && !hasValidNetwork {
				r.Status = model.StatusUnavailable
				r.ErrorMsg = "no response byte received"
			}
			r.Score = 0
			r.Rank = -1
			unusable = append(unusable, r)
		}
	}

	if len(usable) == 0 {
		return unusable
	}

	// 提取极值用于 Min-Max 归一化
	minTTFB, maxTTFB := math.MaxFloat64, 0.0
	minTTFT, maxTTFT := math.MaxFloat64, 0.0
	minTPS, maxTPS := 0.0, 0.0
	minJitter, maxJitter := math.MaxFloat64, 0.0
	minIngress, maxIngress := 0.0, 0.0

	for _, r := range usable {
		ttfbMs := float64(r.Network.TTFB.Microseconds()) / 1000.0
		if ttfbMs > 0 {
			if ttfbMs < minTTFB {
				minTTFB = ttfbMs
			}
			if ttfbMs > maxTTFB {
				maxTTFB = ttfbMs
			}
		}

		ttftMs := float64(r.Stream.TTFT.Microseconds()) / 1000.0
		if ttftMs > 0 {
			if ttftMs < minTTFT {
				minTTFT = ttftMs
			}
			if ttftMs > maxTTFT {
				maxTTFT = ttftMs
			}
		}

		if r.Stream.TPS > maxTPS {
			maxTPS = r.Stream.TPS
		}

		if r.Stream.JitterVarianceMs > 0 {
			if r.Stream.JitterVarianceMs < minJitter {
				minJitter = r.Stream.JitterVarianceMs
			}
			if r.Stream.JitterVarianceMs > maxJitter {
				maxJitter = r.Stream.JitterVarianceMs
			}
		}

		if r.Stream.IngressSpeedBytesSec > maxIngress {
			maxIngress = r.Stream.IngressSpeedBytesSec
		}
	}

	// 动态检测本次测试批次中实际产生了非零有效数据的指标维度
	hasLatency := maxTTFB > 0 || maxTTFT > 0
	hasTPS := maxTPS > 0
	hasJitter := maxJitter > 0
	hasIngress := maxIngress > 0
	hasConnect := true // 基础 TCP/TLS 链路健康度

	wLatency := 0.0
	wTPS := 0.0
	wJitter := 0.0
	wIngress := 0.0
	wConnect := 0.0

	if hasLatency {
		wLatency = 35.0
	}
	if hasTPS {
		wTPS = 30.0
	}
	if hasJitter {
		wJitter = 15.0
	}
	if hasIngress {
		wIngress = 10.0
	}
	if hasConnect {
		wConnect = 10.0
	}

	totalActiveWeight := wLatency + wTPS + wJitter + wIngress + wConnect
	if totalActiveWeight <= 0 {
		totalActiveWeight = 1.0
	}

	// 计算各节点综合得分
	for i := range usable {
		score := 0.0

		// 1. TTFB / TTFT 响应延迟得分（越低越好，采用负向归一化）
		if hasLatency {
			targetLatencyMs := float64(usable[i].Network.TTFB.Microseconds()) / 1000.0
			if usable[i].Stream.TTFT > 0 {
				targetLatencyMs = float64(usable[i].Stream.TTFT.Microseconds()) / 1000.0
			}
			minLat := minTTFB
			maxLat := maxTTFB
			if usable[i].Stream.TTFT > 0 && maxTTFT > 0 {
				minLat = minTTFT
				maxLat = maxTTFT
			}
			score += normInverse(targetLatencyMs, minLat, maxLat) * wLatency
		}

		// 2. TPS 流式输出吞吐率得分（越高越好，采用正向归一化）
		if hasTPS {
			score += normDirect(usable[i].Stream.TPS, minTPS, maxTPS) * wTPS
		}

		// 3. Jitter 抖动方差平滑度得分（方差越小越平滑，采用负向归一化）
		if hasJitter {
			score += normInverse(usable[i].Stream.JitterVarianceMs, minJitter, maxJitter) * wJitter
		}

		// 4. Ingress 上行大上下文代码上传带宽得分（越高越好，采用正向归一化）
		if hasIngress {
			score += normDirect(usable[i].Stream.IngressSpeedBytesSec, minIngress, maxIngress) * wIngress
		}

		// 5. 基础建连时延得分 (TCP 握手 + TLS 握手，越低越好)
		if hasConnect {
			connectTimeMs := float64((usable[i].Network.TCPConnect + usable[i].Network.TLSHandshake).Milliseconds())
			score += normInverse(connectTimeMs, 20.0, 1000.0) * wConnect
		}

		// 归一化折算至 100 分制
		finalScore := (score / totalActiveWeight) * 100.0

		// 惩罚机制：若检测到代理聚合缓冲，得分严格扣减 30%
		if usable[i].Stream.ProxyBufferDetected {
			finalScore *= 0.70
		}

		if finalScore > 100.0 {
			finalScore = 100.0
		}
		if finalScore < 0.0 {
			finalScore = 0.0
		}
		usable[i].Score = math.Round(finalScore*10) / 10
	}

	// 按得分降序排序，若得分相同则按总耗时升序排序
	sort.Slice(usable, func(i, j int) bool {
		if usable[i].Score != usable[j].Score {
			return usable[i].Score > usable[j].Score
		}
		return usable[i].Network.TotalTime < usable[j].Network.TotalTime
	})

	for i := range usable {
		usable[i].Rank = i + 1
	}

	return append(usable, unusable...)
}

// normDirect 执行正向归一化：数值越大得分越高（如 TPS 吞吐率、Ingress 上行带宽）。
// 无有效数据返回 0；当所有节点数值相同且有效时返回满分 1.0。
func normDirect(val, min, max float64) float64 {
	if val <= 0 || max <= 0 {
		return 0.0
	}
	if max <= min {
		return 1.0
	}
	res := (val - min) / (max - min)
	if res < 0 {
		return 0.0
	}
	if res > 1.0 {
		return 1.0
	}
	return res
}

// normInverse 执行负向归一化：数值越小得分越高（如 TTFB、TTFT、抖动方差、建连耗时）。
// 延迟非法 (<=0) 时返回 0；当所有节点数值相同且有效时返回满分 1.0。
func normInverse(val, min, max float64) float64 {
	if val <= 0 || min <= 0 {
		return 0.0
	}
	if max <= min {
		return 1.0
	}
	// 数值越小得分越高
	res := 1.0 - ((val - min) / (max - min))
	if res < 0 {
		return 0.0
	}
	if res > 1.0 {
		return 1.0
	}
	return res
}

func DurationMs(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}

