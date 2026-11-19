// Package runner 包含对底层代理拨号器构建与连通性的单元测试。
package runner

import (
	"context"
	"testing"
	"time"

	"nodepilot/engine/pkg/model"
)

func TestMihomoProxyDialer(t *testing.T) {
	node := &model.Node{
		Name:   "test-ss",
		Type:   "ss",
		Server: "127.0.0.1",
		Port:   8388,
		Raw: map[string]interface{}{
			"name":     "test-ss",
			"type":     "ss",
			"server":   "127.0.0.1",
			"port":     8388,
			"cipher":   "aes-128-gcm",
			"password": "test-password",
		},
	}

	dialer, err := CreateDialerForNode(node, 3*time.Second)
	if err != nil {
		t.Fatalf("failed to create dialer: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	// 拨号虚拟模拟地址；预期捕获连接拒绝或超时，且杜绝任何 panic 崩溃
	_, err = dialer.DialContext(ctx, "tcp", "1.1.1.1:80")
	t.Logf("dialer returned: %v (expected error since target is unreachable mock)", err)
}
