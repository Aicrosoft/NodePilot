package runner

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync"
	"time"

	"nodepilot/engine/pkg/logger"
	"nodepilot/engine/pkg/model"
)

// EngineOptions 控制基准评测引擎的并发能力、超时限制与熔断选项。
type EngineOptions struct {
	Concurrency    int
	Timeout        time.Duration
	EnablePrePing  bool          // 是否开启前置轻量 Ping 连通性探测与失败快速熔断短路
	PrePingTimeout time.Duration // 前置 Ping 探测超时阈值（默认 2 秒）
}

// BenchmarkEngine 管理多节点与多 AI 探针的并发执行与多维度性能指标收集。
type BenchmarkEngine struct {
	options EngineOptions
}

// NewBenchmarkEngine 构造函数创建并初始化评测引擎实例。
func NewBenchmarkEngine(opts EngineOptions) *BenchmarkEngine {
	if opts.Concurrency <= 0 {
		opts.Concurrency = 5
	}
	if opts.Timeout <= 0 {
		opts.Timeout = 10 * time.Second
	}
	if opts.PrePingTimeout <= 0 {
		opts.PrePingTimeout = 2 * time.Second
	}
	return &BenchmarkEngine{options: opts}
}

type testTask struct {
	node    model.Node
	profile model.ProbeProfile
}

// Run 并发执行所有节点与目标 AI 探针之间的笛卡尔积测试任务集。
// 入参：
//   - ctx: 控制全生命周期取消的上下文；
//   - nodes: 待测代理节点切片；
//   - profiles: 启用的 AI 探针规约切片。
// 出参：
//   - 未排序的原始评测结果切片。
func (e *BenchmarkEngine) Run(ctx context.Context, nodes []model.Node, profiles []model.ProbeProfile) []model.BenchmarkResult {
	var tasks []testTask
	for _, n := range nodes {
		for _, p := range profiles {
			tasks = append(tasks, testTask{node: n, profile: p})
		}
	}

	taskCh := make(chan testTask, len(tasks))
	for _, t := range tasks {
		taskCh <- t
	}
	close(taskCh)

	resCh := make(chan model.BenchmarkResult, len(tasks))
	var wg sync.WaitGroup

	for i := 0; i < e.options.Concurrency; i++ {
		wg.Add(1)
		go e.workerLoop(ctx, taskCh, resCh, &wg)
	}

	wg.Wait()
	close(resCh)

	var results []model.BenchmarkResult
	for r := range resCh {
		results = append(results, r)
	}

	return results
}

// workerLoop 并发工作协程循环消费任务通道中的探测任务项，支持上下文取消。
func (e *BenchmarkEngine) workerLoop(ctx context.Context, taskCh <-chan testTask, resCh chan<- model.BenchmarkResult, wg *sync.WaitGroup) {
	defer wg.Done()
	for task := range taskCh {
		select {
		case <-ctx.Done():
			return
		default:
			res := e.testSingle(ctx, task.node, task.profile)
			resCh <- res
		}
	}
}

// isNoticeOrPlaceholderNode 智能识别常见的机场公告、提示、流量统计及本地环回等非代理占位节点。
func isNoticeOrPlaceholderNode(node *model.Node) bool {
	if node == nil {
		return true
	}
	name := strings.ToLower(node.Name)
	keywords := []string{
		"失效", "重新复制", "重新导入", "到期", "剩余流量", "更新订阅",
		"官网", "购买", "公告", "通知", "群组", "频道",
		"notice", "expire", "traffic", "update", "website",
	}
	for _, kw := range keywords {
		if strings.Contains(name, kw) {
			return true
		}
	}
	if node.Server == "" || node.Server == "127.0.0.1" || node.Server == "0.0.0.0" || node.Server == "localhost" || node.Port <= 0 {
		return true
	}
	return false
}

// PingNode 执行底层轻量连通性与握手往返延迟探测（毫秒级 Ping RTT）。
// 探测机制：
//   - 对于直连模式：立即返回 1ms；
//   - 对于 TCP 代理协议（Trojan、Shadowsocks、VMess 等）：直接向节点 IP:Port 发起原生 TCP 握手测量 RTT；
//   - 对于 UDP/QUIC 代理协议（Hysteria2、TUIC 等）：通过代理隧道建立快速测试连接测量往返耗时。
func PingNode(ctx context.Context, node *model.Node, timeout time.Duration) (int64, error) {
	if node == nil || node.Server == "" || node.Port <= 0 {
		return 0, fmt.Errorf("node server address or port is invalid")
	}
	if node.Type == "direct" {
		return 1, nil
	}

	dialTimeout := timeout
	if dialTimeout <= 0 {
		dialTimeout = 2 * time.Second
	}

	isUDPProto := false
	lowerType := strings.ToLower(node.Type)
	if strings.Contains(lowerType, "hysteria") || strings.Contains(lowerType, "hy2") || lowerType == "tuic" || lowerType == "wireguard" {
		isUDPProto = true
	}

	start := time.Now()

	if !isUDPProto {
		// 1. TCP 代理协议：对底层节点地址发起原生 TCP 握手 RTT 探测
		addr := fmt.Sprintf("%s:%d", node.Server, node.Port)
		var d net.Dialer
		dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
		defer cancel()

		conn, err := d.DialContext(dialCtx, "tcp", addr)
		if err != nil {
			return 0, err
		}
		_ = conn.Close()
		rtt := time.Since(start).Milliseconds()
		if rtt <= 0 {
			rtt = 1
		}
		return rtt, nil
	}

	// 2. UDP/QUIC 代理协议：通过出站隧道发起握手测试
	dialer, err := CreateDialerForNode(node, dialTimeout)
	if err != nil {
		return 0, err
	}

	dialCtx, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()

	// 发起极轻量端点连接以验证底层 QUIC 握手与认证有效性
	conn, err := dialer.DialContext(dialCtx, "tcp", "cp.cloudflare.com:80")
	if err != nil {
		return 0, err
	}
	_ = conn.Close()

	rtt := time.Since(start).Milliseconds()
	if rtt <= 0 {
		rtt = 1
	}
	return rtt, nil
}

// testSingle 针对单个代理节点执行单项 AI 服务探针测试与指标萃取。
func (e *BenchmarkEngine) testSingle(parentCtx context.Context, node model.Node, profile model.ProbeProfile) model.BenchmarkResult {
	res := model.BenchmarkResult{
		AirportName: node.AirportName,
		NodeName:    node.Name,
		ServiceName: profile.Name,
		AIOffer:     profile.Name,
		Status:      model.StatusUnavailable,
		TestedAt:    time.Now(),
	}

	// 1. 过滤公告或占位符节点
	if isNoticeOrPlaceholderNode(&node) {
		res.Status = model.StatusUnavailable
		res.PingStatus = "unreachable"
		res.ErrorMsg = "Non-proxy node (notice/placeholder/expired)"
		return res
	}

	// 2. 前置 Ping 探测与快速失败熔断
	if e.options.EnablePrePing {
		pingTimeout := e.options.PrePingTimeout
		if pingTimeout <= 0 {
			pingTimeout = 2 * time.Second
		}
		pingMs, pingErr := PingNode(parentCtx, &node, pingTimeout)
		if pingErr != nil {
			logger.Warn("PING", "Pre-ping failed for node [%s] (%s:%d): %v",
				node.Name, node.Server, node.Port, pingErr)
			res.Status = model.StatusUnavailable
			res.PingMs = 0
			res.PingStatus = "unreachable"
			res.ErrorMsg = fmt.Sprintf("Node connectivity failed (ping timeout/rejected): %v", pingErr)
			return res // 快速熔断短路：跳过后续所有深层 AI 探测，保护网络带宽！
		}
		res.PingMs = pingMs
		res.PingStatus = "ok"
	} else {
		res.PingStatus = "skipped"
	}

	ctx, cancel := context.WithTimeout(parentCtx, e.options.Timeout)
	defer cancel()

	dialer, err := CreateDialerForNode(&node, e.options.Timeout)
	if err != nil {
		res.ErrorMsg = fmt.Sprintf("dialer error: %v", err)
		return res
	}

	traceCollector, clientTrace := NewTraceCollector()
	traceCtx := httptrace.WithClientTrace(ctx, clientTrace)

	transport := &http.Transport{
		DialContext:         dialer.DialContext,
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
		DisableKeepAlives:   true,
		MaxIdleConnsPerHost: -1,
	}

	client := &http.Client{
		Transport: transport,
		Timeout:   e.options.Timeout,
	}

	req, err := http.NewRequestWithContext(traceCtx, profile.Method, profile.Endpoint, nil)
	if err != nil {
		res.ErrorMsg = fmt.Sprintf("invalid request: %v", err)
		return res
	}

	for k, v := range profile.Headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "NodePilot/1.0 (AI-Aware)")
	}

	traceCollector.MarkRequestStart()
	startTime := time.Now()
	logger.Info("PROBE", "Starting probe for node [%s] targeting [%s] (%s)", node.Name, profile.Name, profile.Endpoint)

	resp, err := client.Do(req)
	requestDuration := time.Since(startTime)
	traceCollector.MarkRequestDone()
	res.Network = traceCollector.Metrics

	// 关键回退保障：在通过代理隧道转发时，底层部分 httptrace 阶段钩子可能被旁路或省略。
	// client.Do 成功返回说明响应头已完全接收，此时使用实际端到端往返耗时作为兜底 TTFB。
	if res.Network.TTFB <= 0 {
		res.Network.TTFB = requestDuration
	}
	if res.Network.TotalTime <= 0 {
		res.Network.TotalTime = requestDuration
	}

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			res.Status = model.StatusTimeout
			res.ErrorMsg = "request timeout"
		} else {
			res.Status = model.StatusUnavailable
			res.ErrorMsg = err.Error()
		}
		logger.Error("PROBE", "Probe FAILED for node [%s] on [%s]: status=%s, duration=%v, err=%v",
			node.Name, profile.Name, res.Status, requestDuration, err)
		return res
	}
	defer resp.Body.Close()

	res.StatusCode = resp.StatusCode

	// 解析流式响应与 Token 抖动特征
	var bodyText string
	isStreaming := profile.TestStream || strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/event-stream")
	if isStreaming {
		streamAnalyzer := NewStreamAnalyzer(startTime)
		streamMetrics, text, err := streamAnalyzer.AnalyzeStream(resp.Body)
		if err == nil {
			res.Stream = streamMetrics
			bodyText = text
		}
	} else {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
		bodyText = string(bodyBytes)
		res.Stream = model.StreamMetrics{
			TTFT:                res.Network.TTFB,
			TPS:                 0,
			TotalTokens:         0,
			JitterVarianceMs:    0,
			ProxyBufferDetected: false,
		}
	}

	// 若未产生流式多块输出（例如非流式探针或普通 API），将 TTFT 对齐为 TTFB 首字节耗时
	if res.Stream.TTFT <= 0 && res.Network.TTFB > 0 {
		res.Stream.TTFT = res.Network.TTFB
	}

	// 评估服务多态可用性状态
	res.Status = evaluateStatus(resp.StatusCode, bodyText, profile.Validation)

	logger.Info("PROBE", "Probe FINISHED for node [%s] on [%s]: httpCode=%d, status=%s, ttfb=%v, duration=%v",
		node.Name, profile.Name, resp.StatusCode, res.Status, res.Network.TTFB, requestDuration)

	// 若节点通道健康且启用了上行吞吐测试，进一步测量工程上下文大 Payload 上传能力
	if (res.Status == model.StatusAvailable || res.Status == model.StatusAuthenticationRequired) && profile.TestIngress {
		speed, _ := MeasureIngressSpeed(ctx, client, profile.Endpoint, profile.IngressPayloadBytes)
		res.Stream.IngressSpeedBytesSec = speed
	}

	return res
}

// evaluateStatus 根据 HTTP 状态码、响应体关键字与校验规则多态解耦判定可用性。
func evaluateStatus(code int, body string, rule model.ValidationRule) model.AvailabilityStatus {
	bodyLower := strings.ToLower(body)

	// 1. 检查是否存在地域政策或 WAF 拦截特征词 (Restricted)
	for _, kw := range rule.RestrictedKeywords {
		if strings.Contains(bodyLower, strings.ToLower(kw)) {
			return model.StatusRestricted
		}
	}

	// 2. 检查符合预期的鉴权端点（401/403 判定为网络链路可达但需凭证）
	for _, ac := range rule.AuthRequiredCodes {
		if code == ac {
			return model.StatusAuthenticationRequired
		}
	}

	// 3. 检查常规成功响应状态码 (Available)
	for _, sc := range rule.StatusCodes {
		if code == sc {
			return model.StatusAvailable
		}
	}

	// 4. 其他服务端错误 (5xx) 判定为服务不可用 (Unavailable)
	if code >= 500 {
		return model.StatusUnavailable
	}

	return model.StatusRestricted
}

