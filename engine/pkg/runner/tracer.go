package runner

import (
	"crypto/tls"
	"net/http/httptrace"
	"time"

	"nodepilot/engine/pkg/model"
)

// TraceCollector 基于 net/http/httptrace 收集单次 HTTP 往返全生命周期中各阶段的微秒级耗时指标。
type TraceCollector struct {
	Metrics model.NetworkMetrics

	dnsStart time.Time
	tcpStart time.Time
	tlsStart time.Time
	reqStart time.Time
}

// NewTraceCollector 实例化并返回 TraceCollector 及其关联的 httptrace.ClientTrace 钩子对象。
func NewTraceCollector() (*TraceCollector, *httptrace.ClientTrace) {
	tc := &TraceCollector{}

	trace := &httptrace.ClientTrace{
		DNSStart: func(info httptrace.DNSStartInfo) {
			tc.dnsStart = time.Now()
		},
		DNSDone: func(info httptrace.DNSDoneInfo) {
			if !tc.dnsStart.IsZero() {
				tc.Metrics.DNSLookup = time.Since(tc.dnsStart)
			}
		},
		ConnectStart: func(network, addr string) {
			tc.tcpStart = time.Now()
		},
		ConnectDone: func(network, addr string, err error) {
			if !tc.tcpStart.IsZero() {
				tc.Metrics.TCPConnect = time.Since(tc.tcpStart)
			}
		},
		TLSHandshakeStart: func() {
			tc.tlsStart = time.Now()
		},
		TLSHandshakeDone: func(state tls.ConnectionState, err error) {
			if !tc.tlsStart.IsZero() {
				tc.Metrics.TLSHandshake = time.Since(tc.tlsStart)
			}
		},
		GotFirstResponseByte: func() {
			if !tc.reqStart.IsZero() {
				tc.Metrics.TTFB = time.Since(tc.reqStart)
			}
		},
	}

	return tc, trace
}

// MarkRequestStart 记录 HTTP 请求开始发起的绝对时间戳。
func (tc *TraceCollector) MarkRequestStart() {
	tc.reqStart = time.Now()
}

// MarkRequestDone 计算并锁定 HTTP 请求端到端总体耗时 (TotalTime)。
func (tc *TraceCollector) MarkRequestDone() {
	if !tc.reqStart.IsZero() {
		tc.Metrics.TotalTime = time.Since(tc.reqStart)
	}
}

