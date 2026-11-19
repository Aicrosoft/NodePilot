// Package model 定义 NodePilot 跨端与引擎层流转的核心数据模型与类型契约。
//
// 架构概述：
//   - 定义代理节点 (Node)、网络性能指标 (NetworkMetrics)、流式吞吐抖动指标 (StreamMetrics)；
//   - 定义服务可用性多态状态机枚举 (AvailabilityStatus)、AI 探针规约 (ProbeProfile) 与评测终态结果 (BenchmarkResult)；
//   - 结构体的序列化标签与枚举常量具有严格的黄金基线契约保护，是前端 UI、持久化数据库与后端评测管线的通用实体。
package model

import (
	"time"
)

// AvailabilityStatus 表示细粒度的 AI 服务可用性状态枚举。
type AvailabilityStatus string

const (
	StatusAvailable              AvailabilityStatus = "Available"
	StatusAuthenticationRequired AvailabilityStatus = "Authentication Required"
	StatusRestricted             AvailabilityStatus = "Restricted"
	StatusTimeout                AvailabilityStatus = "Timeout"
	StatusUnavailable            AvailabilityStatus = "Unavailable"
)

// Node 表示待测代理节点的数据结构。
type Node struct {
	AirportName string                 `json:"airport_name,omitempty" yaml:"airport_name,omitempty"`
	Name        string                 `json:"name" yaml:"name"`
	Type        string                 `json:"type" yaml:"type"`
	Server      string                 `json:"server" yaml:"server"`
	Port        int                    `json:"port" yaml:"port"`
	Password    string                 `json:"password,omitempty" yaml:"password,omitempty"`
	Raw         map[string]interface{} `json:"raw,omitempty" yaml:"raw,omitempty"`
}

// NetworkMetrics 记录底层网络连接与 HTTP 阶段微秒级耗时指标。
type NetworkMetrics struct {
	DNSLookup    time.Duration `json:"dns_lookup"`
	TCPConnect   time.Duration `json:"tcp_connect"`
	TLSHandshake time.Duration `json:"tls_handshake"`
	TTFB         time.Duration `json:"ttfb"` // 首字节到达时间 (Time to First Byte)
	TotalTime    time.Duration `json:"total_time"`
}

// StreamMetrics 针对 AI 大模型流式输出 (SSE/Chunked) 的专用性能与平滑度指标。
type StreamMetrics struct {
	TTFT                 time.Duration `json:"ttft"`                   // 首 Token / 分块响应延迟 (Time to First Token)
	TPS                  float64       `json:"tps"`                    // 每秒 Token 输出吞吐率 (Tokens Per Second)
	TotalTokens          int           `json:"total_tokens"`           // 本次评测接收到的 Token / 响应块总数
	JitterVarianceMs     float64       `json:"jitter_variance_ms"`     // 分块到达时间间隔方差 (毫秒)，衡量流式平滑度
	MaxChunkGap          time.Duration `json:"max_chunk_gap"`          // 相邻分块之间的最大停顿卡顿时间
	ProxyBufferDetected  bool          `json:"proxy_buffer_detected"`  // 是否检测到代理节点劫持或聚合缓冲行为 (Buffer Dumping)
	IngressSpeedBytesSec float64       `json:"ingress_speed_byte_sec"` // 上行大上下文代码上传带宽吞吐 (Bytes/s)
}

// BenchmarkResult 记录单个节点针对特定 AI 服务的综合评测指标与终态得分。
type BenchmarkResult struct {
	AirportName string             `json:"airport_name,omitempty"`
	NodeName    string             `json:"node_name"`
	ServiceName string             `json:"service_name"`
	AIOffer     string             `json:"ai_offer,omitempty"` // AI 服务类型或模型别名
	Status      AvailabilityStatus `json:"status"`
	StatusCode  int                `json:"status_code"`
	PingMs      int64              `json:"ping_ms"`            // 节点底层连通性往返握手延迟 (RTT，毫秒)
	PingStatus  string             `json:"ping_status"`        // 握手状态: "ok" | "unreachable" | "timeout" | "skipped"
	Network     NetworkMetrics     `json:"network"`
	Stream      StreamMetrics      `json:"stream"`
	Score       float64            `json:"score"`
	Rank        int                `json:"rank,omitempty"`
	ErrorMsg    string             `json:"error_msg,omitempty"`
	TestedAt    time.Time          `json:"tested_at"`
}

// ProbeProfile 定义可扩展的 AI 服务端点探测规范。
type ProbeProfile struct {
	ID          string            `json:"id" yaml:"id"`
	Name        string            `json:"name" yaml:"name"`
	Category    string            `json:"category" yaml:"category"`
	Method      string            `json:"method" yaml:"method"`
	Endpoint    string            `json:"endpoint" yaml:"endpoint"`
	Headers     map[string]string `json:"headers,omitempty" yaml:"headers,omitempty"`
	BodyPayload string            `json:"body_payload,omitempty" yaml:"body_payload,omitempty"`

	// 可用性判定规则
	Validation ValidationRule `json:"validation" yaml:"validation"`

	// 性能基准测试开关
	TestIngress         bool `json:"test_ingress" yaml:"test_ingress"`
	IngressPayloadBytes int  `json:"ingress_payload_bytes" yaml:"ingress_payload_bytes"`
	TestStream          bool `json:"test_stream" yaml:"test_stream"`

	// 凭证与深度基准测试配置
	APIKey      string `json:"api_key,omitempty" yaml:"api_key,omitempty"`
	CustomModel string `json:"custom_model,omitempty" yaml:"custom_model,omitempty"`
}

// ValidationRule 定义目标服务的多态可用性评估逻辑。
type ValidationRule struct {
	StatusCodes        []int    `json:"status_codes" yaml:"status_codes"`
	AuthRequiredCodes  []int    `json:"auth_required_codes" yaml:"auth_required_codes"`
	RestrictedKeywords []string `json:"restricted_keywords" yaml:"restricted_keywords"`
	ExpectedContent    string   `json:"expected_content" yaml:"expected_content"`
}

