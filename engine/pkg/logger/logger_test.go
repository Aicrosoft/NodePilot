package logger

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestSetLogLevelChangeDetection 验证日志级别动态变更与幂等防重入逻辑。
func TestSetLogLevelChangeDetection(t *testing.T) {
	// 先重置为默认 INFO 级别
	SetLogLevel("INFO")
	if GetLogLevel() != "INFO" {
		t.Fatalf("expected level INFO, got %s", GetLogLevel())
	}

	// 设置为相同级别时应当返回 false（无变更）
	if changed := SetLogLevel("INFO"); changed {
		t.Errorf("expected changed=false when setting same level INFO, got true")
	}

	// 大小写不同但实际级别相同时应忽略差异并返回 false
	if changed := SetLogLevel("info "); changed {
		t.Errorf("expected changed=false when setting case-insensitive INFO, got true")
	}

	// 切换为 DEBUG 级别时应当返回 true
	if changed := SetLogLevel("DEBUG"); !changed {
		t.Errorf("expected changed=true when switching to DEBUG, got false")
	}
	if GetLogLevel() != "DEBUG" {
		t.Fatalf("expected level DEBUG, got %s", GetLogLevel())
	}

	// 再次设置为 DEBUG 应当返回 false
	if changed := SetLogLevel("DEBUG"); changed {
		t.Errorf("expected changed=false when setting same level DEBUG, got true")
	}

	// 测试结束重置回 INFO 级别
	SetLogLevel("INFO")
}

// TestDailyLogFilePathFormat 验证每日日志路径格式契约（logs/YYYY-MM/YYYY-MM-DD.log）。
func TestDailyLogFilePathFormat(t *testing.T) {
	path := GetLogFilePath()
	if path == "" {
		t.Fatalf("expected non-empty log file path")
	}

	// 必须满足 logs/YYYY-MM/YYYY-MM-DD.log 路径结构
	today := time.Now().Format("2006-01-02")
	month := time.Now().Format("2006-01")
	expectedSuffix := filepath.Join(month, today+".log")

	if !strings.HasSuffix(path, expectedSuffix) {
		t.Errorf("log file path %q does not have expected monthly suffix %q", path, expectedSuffix)
	}

	dir := GetLogDir()
	if !strings.HasSuffix(dir, month) {
		t.Errorf("log directory %q does not end with month %q", dir, month)
	}
}
