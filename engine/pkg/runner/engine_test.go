// Package runner 包含对评测引擎多协程并发调度、前置熔断、占位符拦截与状态机判定的单元测试。
package runner

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"nodepilot/engine/pkg/model"
)

// TestIsNoticeOrPlaceholderNode 验证对机场公告、到期提示、剩余流量卡片与无效环回地址节点的识别与拦截。
func TestIsNoticeOrPlaceholderNode(t *testing.T) {
	testCases := []struct {
		name     string
		node     *model.Node
		expected bool
	}{
		{
			name:     "nil node",
			node:     nil,
			expected: true,
		},
		{
			name: "Expiration time placeholder node",
			node: &model.Node{
				Name:   "到期时间: 2026-12-31",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "Remaining traffic placeholder node",
			node: &model.Node{
				Name:   "剩余流量: 250GB",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "Website address placeholder node",
			node: &model.Node{
				Name:   "官网: https://airport.example.com",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "Notification channel placeholder node",
			node: &model.Node{
				Name:   "TG通知群组与频道",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "English Notice placeholder node",
			node: &model.Node{
				Name:   "Notice: Please update your subscription",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "English Traffic placeholder node",
			node: &model.Node{
				Name:   "Traffic Left: 100GB",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "English Expire placeholder node",
			node: &model.Node{
				Name:   "Expire at 2027-01-01",
				Server: "1.2.3.4",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "Loopback address 127.0.0.1 invalid node",
			node: &model.Node{
				Name:   "Fake-Loopback",
				Server: "127.0.0.1",
				Port:   1080,
			},
			expected: true,
		},
		{
			name: "Loopback address 0.0.0.0 invalid node",
			node: &model.Node{
				Name:   "Zero-IP",
				Server: "0.0.0.0",
				Port:   1080,
			},
			expected: true,
		},
		{
			name: "Loopback hostname localhost invalid node",
			node: &model.Node{
				Name:   "Localhost-Node",
				Server: "localhost",
				Port:   1080,
			},
			expected: true,
		},
		{
			name: "Empty server address",
			node: &model.Node{
				Name:   "Empty-Server-Node",
				Server: "",
				Port:   443,
			},
			expected: true,
		},
		{
			name: "Port less than or equal to 0",
			node: &model.Node{
				Name:   "Zero-Port-Node",
				Server: "1.2.3.4",
				Port:   0,
			},
			expected: true,
		},
		{
			name: "Valid Shadowsocks real proxy node",
			node: &model.Node{
				Name:   "Hong Kong 01 - BGP High Speed",
				Server: "185.199.108.153",
				Port:   443,
				Type:   "ss",
			},
			expected: false,
		},
		{
			name: "Valid Trojan real proxy node",
			node: &model.Node{
				Name:   "Tokyo 02 - IPLC Direct",
				Server: "tokyo.gateway.example.com",
				Port:   8443,
				Type:   "trojan",
			},
			expected: false,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actual := isNoticeOrPlaceholderNode(tc.node)
			if actual != tc.expected {
				t.Errorf("case [%s]: expected isNoticeOrPlaceholderNode = %v, got %v", tc.name, tc.expected, actual)
			}
		})
	}
}

// TestEvaluateStatus 验证多态可用性状态机的评估规则与优先级匹配逻辑。
func TestEvaluateStatus(t *testing.T) {
	rule := model.ValidationRule{
		StatusCodes:        []int{200, 204, 401},
		AuthRequiredCodes:  []int{401, 403},
		RestrictedKeywords: []string{"country, region, or territory", "blocked", "waf", "challenge"},
	}

	testCases := []struct {
		name           string
		code           int
		body           string
		expectedStatus model.AvailabilityStatus
	}{
		{
			name:           "Normal 200 response",
			code:           200,
			body:           `{"data": "success"}`,
			expectedStatus: model.StatusAvailable,
		},
		{
			name:           "Normal 204 no content response",
			code:           204,
			body:           ``,
			expectedStatus: model.StatusAvailable,
		},
		{
			name:           "401 Authentication required (API key missing or invalid but channel intact)",
			code:           401,
			body:           `{"error": {"message": "Invalid API key provided", "type": "invalid_request_error"}}`,
			expectedStatus: model.StatusAuthenticationRequired,
		},
		{
			name:           "403 Forbidden credential endpoint",
			code:           403,
			body:           `{"message": "Forbidden access"}`,
			expectedStatus: model.StatusAuthenticationRequired,
		},
		{
			name:           "Trigger region restriction keyword (OpenAI geo-blocking)",
			code:           403,
			body:           `{"error": {"code": "unsupported_country", "message": "Country, region, or territory is not supported"}}`,
			expectedStatus: model.StatusRestricted,
		},
		{
			name:           "200 Response intercepted by WAF (page contains blocked keyword)",
			code:           200,
			body:           `<html><body>Request was blocked by Cloudflare WAF</body></html>`,
			expectedStatus: model.StatusRestricted,
		},
		{
			name:           "Encounter Cloudflare challenge",
			code:           403,
			body:           `<html><title>Just a moment...</title><body>Checking your browser - Challenge required</body></html>`,
			expectedStatus: model.StatusRestricted,
		},
		{
			name:           "Server 500 internal error",
			code:           500,
			body:           `Internal Server Error`,
			expectedStatus: model.StatusUnavailable,
		},
		{
			name:           "Server 502 bad gateway",
			code:           502,
			body:           `Bad Gateway`,
			expectedStatus: model.StatusUnavailable,
		},
		{
			name:           "Server 503 service unavailable",
			code:           503,
			body:           `Service Unavailable`,
			expectedStatus: model.StatusUnavailable,
		},
		{
			name:           "Unexpected error status code (e.g. 418 Teapot)",
			code:           418,
			body:           `I'm a teapot`,
			expectedStatus: model.StatusRestricted,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actual := evaluateStatus(tc.code, tc.body, rule)
			if actual != tc.expectedStatus {
				t.Errorf("case [%s]: expected status %s, got %s", tc.name, tc.expectedStatus, actual)
			}
		})
	}
}

// TestPingNode 验证底层轻量连通性探测 (Ping RTT) 与失败熔断机制。
func TestPingNode(t *testing.T) {
	ctx := context.Background()

	// 1. 非法节点参数防御校验
	_, err := PingNode(ctx, nil, time.Second)
	if err == nil {
		t.Error("expected error for nil node, got nil")
	}

	invalidNode := &model.Node{Server: "", Port: 0}
	_, err = PingNode(ctx, invalidNode, time.Second)
	if err == nil {
		t.Error("expected error for invalid node address/port, got nil")
	}

	// 2. direct 本地直连模式立即返回 1ms
	directNode := &model.Node{
		Type:   "direct",
		Server: "localhost",
		Port:   80,
	}
	rtt, err := PingNode(ctx, directNode, time.Second)
	if err != nil {
		t.Fatalf("unexpected error for direct node: %v", err)
	}
	if rtt != 1 {
		t.Errorf("expected 1ms for direct node, got %d", rtt)
	}

	// 3. 本地 TCP 端口监听模拟真实 TCP Ping 握手
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to create local test listener: %v", err)
	}
	defer ln.Close()

	// 启动接收协程处理握手
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	_, portStr, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatalf("failed to parse port: %v", err)
	}
	port, _ := strconv.Atoi(portStr)

	tcpNode := &model.Node{
		Name:   "Mock-TCP-Node",
		Type:   "ss",
		Server: "127.0.0.1",
		Port:   port,
	}

	pingRtt, err := PingNode(ctx, tcpNode, 2*time.Second)
	if err != nil {
		t.Fatalf("PingNode failed for valid local TCP listener: %v", err)
	}
	if pingRtt <= 0 {
		t.Errorf("expected ping RTT >= 1ms, got %d", pingRtt)
	}

	// 4. 超时/连接拒绝快速熔断短路
	unreachableNode := &model.Node{
		Name:   "Unreachable-TCP-Node",
		Type:   "ss",
		Server: "127.0.0.1",
		Port:   59999, // 未开放端口
	}
	_, err = PingNode(ctx, unreachableNode, 100*time.Millisecond)
	if err == nil {
		t.Error("expected connection refused error, got nil")
	}
}

// TestMeasureIngressSpeed 验证工程大上下文上行吞吐测速逻辑。
func TestMeasureIngressSpeed(t *testing.T) {
	var receivedBytes int64

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "expected POST", http.StatusBadRequest)
			return
		}
		if !strings.Contains(r.Header.Get("Content-Type"), "application/octet-stream") {
			http.Error(w, "expected octet-stream", http.StatusBadRequest)
			return
		}
		n, _ := io.Copy(io.Discard, r.Body)
		receivedBytes = n
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	ctx := context.Background()
	client := ts.Client()

	// 1. 标准 64KB 上行测速
	payloadBytes := 64 * 1024
	speed, err := MeasureIngressSpeed(ctx, client, ts.URL, payloadBytes)
	if err != nil {
		t.Fatalf("unexpected error in MeasureIngressSpeed: %v", err)
	}
	if speed <= 0 {
		t.Errorf("expected speed > 0, got %f", speed)
	}
	if receivedBytes != int64(payloadBytes) {
		t.Errorf("expected server to receive %d bytes, got %d", payloadBytes, receivedBytes)
	}

	// 2. payloadBytes <= 0 时的默认回退测试（默认 128KB）
	speedDefault, err := MeasureIngressSpeed(ctx, client, ts.URL, 0)
	if err != nil {
		t.Fatalf("unexpected error with 0 payloadBytes: %v", err)
	}
	if speedDefault <= 0 {
		t.Errorf("expected speedDefault > 0, got %f", speedDefault)
	}
	if receivedBytes != 128*1024 {
		t.Errorf("expected default 128KB (131072 bytes), got %d", receivedBytes)
	}

	// 3. 服务端异常关闭时的错误捕获
	ts.Close()
	_, err = MeasureIngressSpeed(ctx, client, ts.URL, 1024)
	if err == nil {
		t.Error("expected error for closed server endpoint, got nil")
	}
}

// TestBenchmarkEngine_PlaceholderShortCircuit 验证评测引擎对占位符节点的快速短路。
func TestBenchmarkEngine_PlaceholderShortCircuit(t *testing.T) {
	engine := NewBenchmarkEngine(EngineOptions{
		Concurrency: 2,
		Timeout:     time.Second,
	})

	nodes := []model.Node{
		{
			Name:   "到期时间: 2026-12-31",
			Server: "1.2.3.4",
			Port:   443,
		},
		{
			Name:   "剩余流量: 100GB",
			Server: "1.2.3.4",
			Port:   443,
		},
		{
			Name:   "官网通知群",
			Server: "0.0.0.0",
			Port:   0,
		},
	}

	profiles := []model.ProbeProfile{
		{
			ID:       "test-llm",
			Name:     "Test LLM",
			Endpoint: "https://api.test.com/v1",
			Method:   "GET",
		},
	}

	results := engine.Run(context.Background(), nodes, profiles)
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	for _, res := range results {
		if res.Status != model.StatusUnavailable {
			t.Errorf("expected StatusUnavailable for placeholder node [%s], got %s", res.NodeName, res.Status)
		}
		if res.PingStatus != "unreachable" {
			t.Errorf("expected PingStatus unreachable, got %s", res.PingStatus)
		}
		if !strings.Contains(res.ErrorMsg, "notice/placeholder/expired") {
			t.Errorf("expected ErrorMsg to mention placeholder, got '%s'", res.ErrorMsg)
		}
	}
}

// TestBenchmarkEngine_PrePingFailFast 验证前置 Ping 探测失败时的快速失败熔断短路。
func TestBenchmarkEngine_PrePingFailFast(t *testing.T) {
	engine := NewBenchmarkEngine(EngineOptions{
		Concurrency:    1,
		Timeout:        time.Second,
		EnablePrePing:  true,
		PrePingTimeout: 100 * time.Millisecond,
	})

	// 使用测试保留 IP (RFC 5737 TEST-NET-1) 代替本地环回
	nodes := []model.Node{
		{
			Name:   "US West 01 - Unreachable Node",
			Type:   "ss",
			Server: "192.0.2.1",
			Port:   59998,
		},
	}

	profiles := []model.ProbeProfile{
		{
			ID:       "openai",
			Name:     "OpenAI",
			Endpoint: "https://api.openai.com/v1/models",
			Method:   "GET",
		},
	}

	start := time.Now()
	results := engine.Run(context.Background(), nodes, profiles)
	elapsed := time.Since(start)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	res := results[0]
	if res.Status != model.StatusUnavailable {
		t.Errorf("expected StatusUnavailable for offline node, got %s", res.Status)
	}
	if res.PingStatus != "unreachable" {
		t.Errorf("expected PingStatus unreachable, got %s", res.PingStatus)
	}
	if !strings.Contains(res.ErrorMsg, "Node connectivity failed") {
		t.Errorf("expected ErrorMsg to indicate connectivity failure, got '%s'", res.ErrorMsg)
	}
	// 验证快速熔断退出，未耗尽长时间超时
	if elapsed > 1*time.Second {
		t.Errorf("expected fail-fast in < 1s, took %v", elapsed)
	}
}
