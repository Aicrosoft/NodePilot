// Package main 包含针对 Wails App 后端桥接各核心方法的单元测试与边界防御用例。
package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"nodepilot/engine/pkg/logger"
	"nodepilot/engine/pkg/model"
	"nodepilot/engine/pkg/storage"
)

func TestMain(m *testing.M) {
	tempDir, err := os.MkdirTemp("", "nodepilot-app-test-*")
	if err != nil {
		panic(err)
	}
	defer os.RemoveAll(tempDir)

	testDBPath := filepath.Join(tempDir, "nodepilot_test.db")
	_ = os.Setenv("NODEPILOT_DB_PATH", testDBPath)

	os.Exit(m.Run())
}

// TestApp_LogLevel 测试日志等级的动态切换、大小写不敏感性以及去重防重入机制。
func TestApp_LogLevel(t *testing.T) {
	app := NewApp()

	// 1. 验证初始默认基线
	app.SetLogLevel("INFO")
	if got := app.GetLogLevel(); got != "INFO" {
		t.Fatalf("expected initial log level INFO, got %s", got)
	}

	// 2. 重复等级设置检查（应返回 false 以避免冗余写锁）
	if app.SetLogLevel("INFO") {
		t.Errorf("expected duplicate SetLogLevel(INFO) to return false, but got true")
	}
	if app.SetLogLevel("info") {
		t.Errorf("expected case-insensitive duplicate SetLogLevel(info) to return false, but got true")
	}
	if app.SetLogLevel("  INFO  ") {
		t.Errorf("expected trimmed duplicate SetLogLevel('  INFO  ') to return false, but got true")
	}

	// 3. 有效等级切换测试矩阵
	testCases := []struct {
		input       string
		expected    string
		shouldAlter bool
	}{
		{"DEBUG", "DEBUG", true},
		{"debug", "DEBUG", false}, // 重复等级不触发更新
		{"WARN", "WARN", true},
		{"warning", "WARN", false}, // 别名且为相同等级
		{"ERROR", "ERROR", true},
		{"error", "ERROR", false},
		{"INFO", "INFO", true},
	}

	for _, tc := range testCases {
		changed := app.SetLogLevel(tc.input)
		if changed != tc.shouldAlter {
			t.Errorf("SetLogLevel(%q) changed = %v, expected %v", tc.input, changed, tc.shouldAlter)
		}
		if got := app.GetLogLevel(); got != tc.expected {
			t.Errorf("GetLogLevel() after %q = %v, expected %v", tc.input, got, tc.expected)
		}
	}
}

// TestApp_SettingsCRUD 测试全局应用偏好设置的单项与批量 CRUD 闭环读写。
func TestApp_SettingsCRUD(t *testing.T) {
	app := NewApp()

	// 1. 单项设置的写入与回读验证
	testKey := "nodepilot_test_workers"
	testVal := "12"

	err := app.SaveAppSetting(testKey, testVal)
	if err != nil {
		t.Fatalf("SaveAppSetting failed: %v", err)
	}

	gotVal, err := app.GetAppSetting(testKey)
	if err != nil {
		t.Fatalf("GetAppSetting failed: %v", err)
	}
	if gotVal != testVal {
		t.Errorf("GetAppSetting expected %s, got %s", testVal, gotVal)
	}

	// 2. 批量配置的原子写入与完整回读校验
	batchSettings := map[string]string{
		"nodepilot_default_workers": "8",
		"nodepilot_default_timeout": "15",
		"nodepilot_enable_pre_ping": "true",
		"nodepilot_custom_tag":      "unit-test-env",
	}

	err = app.SaveSettings(batchSettings)
	if err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	allSettings, err := app.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}

	for k, expected := range batchSettings {
		if actual, ok := allSettings[k]; !ok || actual != expected {
			t.Errorf("setting %s mismatch: expected %s, got %s", k, expected, actual)
		}
	}

	// 3. 读取不存在的键应安全返回空字符串，不产生异常
	nonExistent, err := app.GetAppSetting("non_existent_key_xyz_123")
	if err != nil {
		t.Errorf("GetAppSetting for non-existent key returned error: %v", err)
	}
	if nonExistent != "" {
		t.Errorf("expected empty string for non-existent key, got %s", nonExistent)
	}
}

// TestApp_ExportAndImportBackup 测试系统配置导出、备份 Schema 结构校验与导入恢复流程。
func TestApp_ExportAndImportBackup(t *testing.T) {
	app := NewApp()

	// 1. 准备基准数据并预填充至 SQLite
	testAirports := `[
		{
			"id": "ap-test-1",
			"name": "HK-Dedicated-Airport",
			"type": "url",
			"url": "https://example.com/sub/hk",
			"nodeCount": 2,
			"rawNodes": [
				{"name": "HK-BGP-01", "server": "1.1.1.1", "port": 443, "type": "hysteria2"},
				{"name": "HK-BGP-02", "server": "1.1.1.2", "port": 443, "type": "trojan"}
			]
		}
	]`
	testRules := `[
		{
			"id": "rule-clean",
			"name": "Clean-Ads-Rule",
			"include": "",
			"exclude": "(官网|到期)"
		}
	]`
	testSettings := map[string]string{
		"nodepilot_backup_test_key": "backup_v1",
	}

	if err := app.SaveAirportsJSON(testAirports); err != nil {
		t.Fatalf("SaveAirportsJSON failed: %v", err)
	}
	if err := app.SaveRuleLibraryJSON(testRules); err != nil {
		t.Fatalf("SaveRuleLibraryJSON failed: %v", err)
	}
	if err := app.SaveSettings(testSettings); err != nil {
		t.Fatalf("SaveSettings failed: %v", err)
	}

	// 2. 测试 ExportBackup 生成与 Schema 校验
	backupJSON, err := app.ExportBackup()
	if err != nil {
		t.Fatalf("ExportBackup failed: %v", err)
	}
	if backupJSON == "" {
		t.Fatalf("ExportBackup returned empty string")
	}

	// 校验导出 JSON 满足 BackupPayload 结构规约
	var payload BackupPayload
	if err := json.Unmarshal([]byte(backupJSON), &payload); err != nil {
		t.Fatalf("ExportBackup output is not valid BackupPayload JSON: %v", err)
	}

	if payload.Version != "1.0" {
		t.Errorf("expected backup version 1.0, got %s", payload.Version)
	}
	if payload.App != "NodePilot" {
		t.Errorf("expected backup app NodePilot, got %s", payload.App)
	}
	if payload.TotalAirports < 1 {
		t.Errorf("expected totalAirports >= 1, got %d", payload.TotalAirports)
	}
	if len(payload.Airports) == 0 {
		t.Errorf("expected non-empty airports in exported backup")
	}
	if payload.Settings["nodepilot_backup_test_key"] != "backup_v1" {
		t.Errorf("expected setting to be preserved in exported backup")
	}

	// 3. 测试 ImportBackup 恢复流程
	// 构造待导入的新备份数据
	newBackup := `{
		"version": "1.0",
		"app": "NodePilot",
		"exportTime": "2026-11-18 12:00:00",
		"totalAirports": 1,
		"airports": [
			{
				"id": "ap-imported-99",
				"name": "Restored-JP-Airport",
				"type": "file",
				"filePath": "/tmp/test.yaml",
				"nodeCount": 1
			}
		],
		"ruleLibrary": [
			{
				"id": "rule-jp-only",
				"name": "JP-Only-Rule",
				"include": "JP|Japan"
			}
		],
		"settings": {
			"nodepilot_restored_setting": "restored_success"
		}
	}`

	if err := app.ImportBackup(newBackup); err != nil {
		t.Fatalf("ImportBackup failed: %v", err)
	}

	// 验证恢复落盘的数据
	restoredAirports, err := app.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	if !strings.Contains(restoredAirports, "Restored-JP-Airport") {
		t.Errorf("restored airports missing expected airport, got: %s", restoredAirports)
	}

	restoredRules, err := app.GetRuleLibraryJSON()
	if err != nil {
		t.Fatalf("GetRuleLibraryJSON failed: %v", err)
	}
	if !strings.Contains(restoredRules, "JP-Only-Rule") {
		t.Errorf("restored rules missing expected rule, got: %s", restoredRules)
	}

	restoredSettingVal, err := app.GetAppSetting("nodepilot_restored_setting")
	if err != nil {
		t.Fatalf("GetAppSetting failed: %v", err)
	}
	if restoredSettingVal != "restored_success" {
		t.Errorf("expected restored setting 'restored_success', got %s", restoredSettingVal)
	}

	// 4. 测试纯数组向下兼容模式的导入处理
	arrayOnlyBackup := `[
		{
			"id": "ap-array-1",
			"name": "纯数组机场",
			"nodeCount": 3
		}
	]`
	if err := app.ImportBackup(arrayOnlyBackup); err != nil {
		t.Fatalf("ImportBackup with array format failed: %v", err)
	}

	airportsAfterArray, _ := app.GetAirportsJSON()
	if !strings.Contains(airportsAfterArray, "纯数组机场") {
		t.Errorf("expected pure array import to succeed, got: %s", airportsAfterArray)
	}
}

// TestApp_ImportBackupValidationFailures 测试 ImportBackup 的防御性结构校验与错误阻断。
func TestApp_ImportBackupValidationFailures(t *testing.T) {
	app := NewApp()

	// 1. 内容为空或全空白字符
	if err := app.ImportBackup(""); err == nil {
		t.Errorf("expected error for empty backup string, got nil")
	}
	if err := app.ImportBackup("   \n\t  "); err == nil {
		t.Errorf("expected error for whitespace backup string, got nil")
	}

	// 2. 格式损坏的非法 JSON
	if err := app.ImportBackup("{ invalid json syntax ... "); err == nil {
		t.Errorf("expected error for malformed JSON, got nil")
	}

	// 3. 根结构缺少必需的 'airports' 字段
	missingAirportsJSON := `{
		"version": "1.0",
		"app": "NodePilot",
		"settings": {"k": "v"}
	}`
	if err := app.ImportBackup(missingAirportsJSON); err == nil {
		t.Errorf("expected error for missing 'airports' field, got nil")
	}

	// 4. 'airports' 字段类型不合法（非数组类型）
	invalidAirportsTypeJSON := `{
		"version": "1.0",
		"app": "NodePilot",
		"airports": "not-an-array"
	}`
	if err := app.ImportBackup(invalidAirportsTypeJSON); err == nil {
		t.Errorf("expected error when airports is not an array, got nil")
	}
}

// TestApp_DefensiveErrorHandling 测试 App 各公开接口的防御性入参校验与边界错误处理。
func TestApp_DefensiveErrorHandling(t *testing.T) {
	app := NewApp()

	// 1. ParseNodesFromFile 针对空路径与不存在文件的防御拦截
	if _, err := app.ParseNodesFromFile(""); err == nil {
		t.Errorf("expected error when path is empty, got nil")
	}
	if _, err := app.ParseNodesFromFile("non_existent_config_file_xyz_123.yaml"); err == nil {
		t.Errorf("expected error when file does not exist, got nil")
	}

	// 2. ParseNodesFromURL 针对空 URL 的防御校验
	if _, err := app.ParseNodesFromURL(""); err == nil {
		t.Errorf("expected error when url is empty, got nil")
	}

	// 3. RunBenchmark 针对待测节点切片为空的防御校验
	if _, err := app.RunBenchmark(nil, []string{"openai"}, 5, 10, true); err == nil {
		t.Errorf("expected error when nodes slice is nil, got nil")
	}
	if _, err := app.RunBenchmark([]model.Node{}, []string{"openai"}, 5, 10, true); err == nil {
		t.Errorf("expected error when nodes slice is empty, got nil")
	}

	// 4. ReadImportAirportsFile 针对空路径与不存在文件的校验
	if _, err := app.ReadImportAirportsFile(""); err == nil {
		t.Errorf("expected error when filePath is empty, got nil")
	}
	if _, err := app.ReadImportAirportsFile("non_existent_backup_file_999.json"); err == nil {
		t.Errorf("expected error when file does not exist, got nil")
	}

	// 5. ReadImportAirportsFile 真实文件读取成功流程
	tempFile := filepath.Join(t.TempDir(), "valid_backup.json")
	sampleContent := `{"test": true}`
	if err := os.WriteFile(tempFile, []byte(sampleContent), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	readContent, err := app.ReadImportAirportsFile(tempFile)
	if err != nil {
		t.Fatalf("ReadImportAirportsFile failed: %v", err)
	}
	if readContent != sampleContent {
		t.Errorf("expected read content %s, got %s", sampleContent, readContent)
	}

	// 6. GetRecentLogs limit 分页参数边界
	logs, err := app.GetRecentLogs(10)
	if err != nil {
		t.Errorf("GetRecentLogs(10) returned unexpected error: %v", err)
	}
	_ = logs

	// 7. GetAvailableServices 非空可用服务列表测试
	services := app.GetAvailableServices()
	if len(services) == 0 {
		t.Errorf("expected non-empty available services, got 0")
	}

	// 8. 历史记录与宏观统计接口防御调用
	stats, err := app.GetHistoryStats()
	if err != nil {
		t.Errorf("GetHistoryStats returned error: %v", err)
	}
	_ = stats

	historyRecords, err := app.GetHistoryRecords(10)
	if err != nil {
		t.Errorf("GetHistoryRecords returned error: %v", err)
	}
	_ = historyRecords

	testHistory := []storage.HistoryRecord{
		{
			BatchID:     "b-1",
			AirportName: "AP-1",
			NodeName:    "Node-1",
			ServiceName: "openai",
			Status:      "Available",
			Score:       90.0,
			TestedAt:    time.Now().Format(time.RFC3339),
		},
	}
	if err := app.SaveHistoryRecords(testHistory); err != nil {
		t.Errorf("SaveHistoryRecords returned error: %v", err)
	}

	if err := app.ClearHistoryRecords(); err != nil {
		t.Errorf("ClearHistoryRecords returned error: %v", err)
	}

	// 9. 评测最新快照存储与回读
	if err := app.SaveLatestBenchmarkResultsJSON(`[{"node": "test"}]`); err != nil {
		t.Errorf("SaveLatestBenchmarkResultsJSON failed: %v", err)
	}
	latestJSON, err := app.GetLatestBenchmarkResultsJSON()
	if err != nil || !strings.Contains(latestJSON, "test") {
		t.Errorf("GetLatestBenchmarkResultsJSON failed or content mismatch: %v, %s", err, latestJSON)
	}

	// 10. 运行时日志文件路径获取
	logPath := app.GetRuntimeLogPath()
	if logPath == "" {
		t.Errorf("GetRuntimeLogPath returned empty string")
	}

	// 11. 日志等级查询
	_ = logger.GetLogLevel()
}

func TestApp_GetAppVersion(t *testing.T) {
	app := NewApp()
	ver := app.GetAppVersion()
	if ver == "" {
		t.Fatalf("expected non-empty app version, got empty")
	}
	if ver == "dev" {
		t.Fatalf("expected authoritative version from wails.json, got fallback dev")
	}
	if !strings.Contains(ver, ".") {
		t.Errorf("expected dotted version string, got %s", ver)
	}
}
