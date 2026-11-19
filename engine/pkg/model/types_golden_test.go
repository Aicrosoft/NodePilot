// Package model 包含核心数据模型序列化与枚举常量的 Golden Contract（黄金契约）测试。
package model

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Node 的不可变 Golden JSON 序列化基准快照
const goldenNodeJSON = `{"airport_name":"Fast-HK","name":"HK-BGP-01","type":"hysteria2","server":"hk1.nodepilot.com","port":443,"password":"secret-pass","raw":{"skip-cert-verify":true}}`

func TestNode_GoldenContract(t *testing.T) {
	node := Node{
		AirportName: "Fast-HK",
		Name:        "HK-BGP-01",
		Type:        "hysteria2",
		Server:      "hk1.nodepilot.com",
		Port:        443,
		Password:    "secret-pass",
		Raw: map[string]interface{}{
			"skip-cert-verify": true,
		},
	}

	bytes, err := json.Marshal(node)
	if err != nil {
		t.Fatalf("failed to marshal Node: %v", err)
	}

	if string(bytes) != goldenNodeJSON {
		t.Errorf("Node JSON serialization drifted from golden baseline!\nExpected: %s\nGot:      %s", goldenNodeJSON, string(bytes))
	}

	var decoded Node
	if err := json.Unmarshal([]byte(goldenNodeJSON), &decoded); err != nil {
		t.Fatalf("failed to unmarshal golden Node JSON: %v", err)
	}

	if decoded.AirportName != "Fast-HK" || decoded.Name != "HK-BGP-01" || decoded.Type != "hysteria2" ||
		decoded.Server != "hk1.nodepilot.com" || decoded.Port != 443 || decoded.Password != "secret-pass" {
		t.Errorf("decoded Node fields do not match expected values: %+v", decoded)
	}
}

// BenchmarkResult 的不可变 Golden JSON 序列化基准快照
const goldenBenchmarkResultJSON = `{"airport_name":"VIP-Airport","node_name":"US-Silicon-01","service_name":"google-gemini","ai_offer":"gemini-1.5-pro","status":"Available","status_code":200,"ping_ms":35,"ping_status":"ok","network":{"dns_lookup":15000000,"tcp_connect":25000000,"tls_handshake":45000000,"ttfb":120000000,"total_time":1500000000},"stream":{"ttft":250000000,"tps":48.5,"total_tokens":120,"jitter_variance_ms":12.4,"max_chunk_gap":85000000,"proxy_buffer_detected":false,"ingress_speed_byte_sec":5242880},"score":94.5,"rank":1,"tested_at":"2026-11-18T10:00:00Z"}`

func TestBenchmarkResult_GoldenContract(t *testing.T) {
	testedTime, _ := time.Parse(time.RFC3339, "2026-11-18T10:00:00Z")

	res := BenchmarkResult{
		AirportName: "VIP-Airport",
		NodeName:    "US-Silicon-01",
		ServiceName: "google-gemini",
		AIOffer:     "gemini-1.5-pro",
		Status:      StatusAvailable,
		StatusCode:  200,
		PingMs:      35,
		PingStatus:  "ok",
		Network: NetworkMetrics{
			DNSLookup:    15 * time.Millisecond,
			TCPConnect:   25 * time.Millisecond,
			TLSHandshake: 45 * time.Millisecond,
			TTFB:         120 * time.Millisecond,
			TotalTime:    1500 * time.Millisecond,
		},
		Stream: StreamMetrics{
			TTFT:                 250 * time.Millisecond,
			TPS:                  48.5,
			TotalTokens:          120,
			JitterVarianceMs:     12.4,
			MaxChunkGap:          85 * time.Millisecond,
			ProxyBufferDetected:  false,
			IngressSpeedBytesSec: 5 * 1024 * 1024,
		},
		Score:    94.5,
		Rank:     1,
		ErrorMsg: "",
		TestedAt: testedTime,
	}

	bytes, err := json.Marshal(res)
	if err != nil {
		t.Fatalf("failed to marshal BenchmarkResult: %v", err)
	}

	if string(bytes) != goldenBenchmarkResultJSON {
		t.Errorf("BenchmarkResult JSON serialization drifted from golden baseline!\nExpected: %s\nGot:      %s", goldenBenchmarkResultJSON, string(bytes))
	}

	var decoded BenchmarkResult
	if err := json.Unmarshal([]byte(goldenBenchmarkResultJSON), &decoded); err != nil {
		t.Fatalf("failed to unmarshal golden BenchmarkResult JSON: %v", err)
	}

	if decoded.NodeName != "US-Silicon-01" || decoded.Status != StatusAvailable || decoded.Score != 94.5 || decoded.Rank != 1 {
		t.Errorf("decoded BenchmarkResult does not match golden fields: %+v", decoded)
	}
	if decoded.Stream.TPS != 48.5 || decoded.Stream.JitterVarianceMs != 12.4 || decoded.Stream.ProxyBufferDetected != false {
		t.Errorf("decoded StreamMetrics drifted: %+v", decoded.Stream)
	}
}

func TestAvailabilityStatus_GoldenEnumContract(t *testing.T) {
	// 校验契约强依赖的状态枚举字符串常量绝对未发生漂移
	expectedStatuses := map[AvailabilityStatus]string{
		StatusAvailable:              "Available",
		StatusAuthenticationRequired: "Authentication Required",
		StatusRestricted:             "Restricted",
		StatusTimeout:                "Timeout",
		StatusUnavailable:            "Unavailable",
	}

	for status, expectedStr := range expectedStatuses {
		if string(status) != expectedStr {
			t.Errorf("AvailabilityStatus constant drifted! Status %v != expected %s", status, expectedStr)
		}
	}
}

func TestProbeProfile_GoldenContract(t *testing.T) {
	profile := ProbeProfile{
		ID:          "antigravity",
		Name:        "Google Antigravity",
		Category:    "ide",
		Method:      "POST",
		Endpoint:    "https://cloudcode-pa.googleapis.com",
		Headers:     map[string]string{"Content-Type": "application/json"},
		BodyPayload: `{"prompt":"ping"}`,
		Validation: ValidationRule{
			StatusCodes:        []int{200, 204},
			AuthRequiredCodes:  []int{401, 403},
			RestrictedKeywords: []string{"Cloudflare", "Access Denied"},
			ExpectedContent:    "ok",
		},
		TestIngress:         true,
		IngressPayloadBytes: 262144,
		TestStream:          true,
		APIKey:              "test-key",
		CustomModel:         "claude-3-5-sonnet",
	}

	bytes, err := json.Marshal(profile)
	if err != nil {
		t.Fatalf("failed to marshal ProbeProfile: %v", err)
	}

	jsonStr := string(bytes)
	for _, requiredKey := range []string{
		`"id":"antigravity"`,
		`"endpoint":"https://cloudcode-pa.googleapis.com"`,
		`"status_codes":[200,204]`,
		`"auth_required_codes":[401,403]`,
		`"ingress_payload_bytes":262144`,
		`"test_stream":true`,
	} {
		if !strings.Contains(jsonStr, requiredKey) {
			t.Errorf("ProbeProfile JSON missing required golden key segment: %s\nFull JSON: %s", requiredKey, jsonStr)
		}
	}
}
