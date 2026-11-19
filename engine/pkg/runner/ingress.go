package runner

import (
	"bytes"
	"context"
	"crypto/rand"
	"net/http"
	"time"
)

// MeasureIngressSpeed 向目标端点传输指定大小的随机字节载荷，精准测量代理通道的上行写入吞吐速率 (Bytes/s)。
// 应用场景：AI IDE（如 Antigravity、Cursor）在向云端大模型发送大量工程上下文文件时，极度依赖代理节点的上行带宽。
func MeasureIngressSpeed(ctx context.Context, client *http.Client, targetURL string, payloadBytes int) (float64, error) {
	if payloadBytes <= 0 {
		payloadBytes = 128 * 1024 // 默认基准载荷为 128KB
	}

	payload := make([]byte, payloadBytes)
	_, _ = rand.Read(payload)

	req, err := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")

	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	elapsed := time.Since(start).Seconds()
	if elapsed <= 0 {
		elapsed = 0.001
	}

	speed := float64(payloadBytes) / elapsed
	return speed, nil
}

