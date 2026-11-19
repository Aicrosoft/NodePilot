// Package storage 包含对 SQLite 数据库事务写入、双层节点隔离、配置 CRUD 与快照管理的单元测试。
package storage

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHistoryStorage(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_nodepilot.db")

	store, err := NewHistoryStorage(dbPath)
	if err != nil {
		t.Fatalf("NewHistoryStorage failed: %v", err)
	}
	defer store.Close()

	// 1. 验证初始数据库为空
	stats, err := store.GetStats()
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}
	if stats.TotalRecords != 0 {
		t.Errorf("expected 0 records, got %d", stats.TotalRecords)
	}

	// 2. 批量事务插入评测记录
	records := []HistoryRecord{
		{
			BatchID:             "batch-001",
			AirportName:         "Airport-A",
			NodeName:            "Node-US-01",
			NodeType:            "ss",
			Server:              "1.2.3.4",
			Port:                443,
			ServiceName:         "Google Antigravity",
			AIOffer:             "Antigravity",
			Status:              "Available",
			PingMs:              120,
			PingStatus:          "ok",
			Score:               88.5,
			TTFBMs:              140.2,
			TTFTMs:              140.2,
			TPS:                 120000.0,
			JitterMs:            12.5,
			BandwidthBps:        5000000,
			ProxyBufferDetected: false,
			Rank:                1,
			TestedAt:            time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339),
			TestedTimeDisplay:   "2026-11-16 20:00:00",
			BatchTime:           "2026-11-16 20:00:00",
		},
		{
			BatchID:             "batch-001",
			AirportName:         "Airport-B",
			NodeName:            "Node-JP-02",
			NodeType:            "vmess",
			Server:              "5.6.7.8",
			Port:                8443,
			ServiceName:         "Google Antigravity",
			AIOffer:             "Antigravity",
			Status:              "Available",
			PingMs:              65,
			PingStatus:          "ok",
			Score:               92.1,
			TTFBMs:              75.0,
			TTFTMs:              75.0,
			TPS:                 250000.0,
			JitterMs:            5.2,
			BandwidthBps:        10000000,
			ProxyBufferDetected: false,
			Rank:                2,
			TestedAt:            time.Now().UTC().Format(time.RFC3339),
			TestedTimeDisplay:   "2026-11-16 20:10:00",
			BatchTime:           "2026-11-16 20:00:00",
		},
	}

	err = store.SaveRecords(records)
	if err != nil {
		t.Fatalf("SaveRecords failed: %v", err)
	}

	// 3. 验证宏观统计聚合
	stats, err = store.GetStats()
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}
	if stats.TotalRecords != 2 {
		t.Errorf("expected 2 records, got %d", stats.TotalRecords)
	}
	if stats.AirportCount != 2 {
		t.Errorf("expected 2 airports, got %d", stats.AirportCount)
	}
	if stats.NodeCount != 2 {
		t.Errorf("expected 2 nodes, got %d", stats.NodeCount)
	}

	// 4. 验证分页查询与时间排序
	queryResults, err := store.QueryRecords(10, 0)
	if err != nil {
		t.Fatalf("QueryRecords failed: %v", err)
	}
	if len(queryResults) != 2 {
		t.Fatalf("expected 2 results, got %d", len(queryResults))
	}
	if queryResults[0].AirportName != "Airport-A" || queryResults[1].AirportName != "Airport-B" {
		t.Errorf("unexpected query results order: %+v", queryResults)
	}

	// 5. 验证清空所有记录与 VACUUM
	err = store.ClearAll()
	if err != nil {
		t.Fatalf("ClearAll failed: %v", err)
	}

	statsAfterClear, err := store.GetStats()
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}
	if statsAfterClear.TotalRecords != 0 {
		t.Errorf("expected 0 records after clear, got %d", statsAfterClear.TotalRecords)
	}

	// 6. 验证应用配置单项与批量 CRUD
	err = store.SetSetting("theme", "dark")
	if err != nil {
		t.Fatalf("SetSetting failed: %v", err)
	}
	val, err := store.GetSetting("theme")
	if err != nil || val != "dark" {
		t.Errorf("expected setting 'dark', got '%s', err: %v", val, err)
	}

	batchSettings := map[string]string{
		"workers": "8",
		"timeout": "15",
	}
	err = store.SetSettingsBatch(batchSettings)
	if err != nil {
		t.Fatalf("SetSettingsBatch failed: %v", err)
	}
	allSettings, err := store.GetAllSettings()
	if err != nil || allSettings["workers"] != "8" || allSettings["timeout"] != "15" {
		t.Errorf("expected batch settings, got %+v", allSettings)
	}

	// 7. 验证机场列表全量持久化
	airportsJSON := `[{"id":"ap_1","name":"TestAP1","url":"https://example.com/sub","enabled":true,"nodes":[{"name":"node1"}]}]`
	err = store.SaveAirportsJSON(airportsJSON)
	if err != nil {
		t.Fatalf("SaveAirportsJSON failed: %v", err)
	}
	readAirports, err := store.GetAirportsJSON()
	if err != nil || len(readAirports) < 10 {
		t.Errorf("GetAirportsJSON failed: %v, got %s", err, readAirports)
	}

	// 8. 验证规则库持久化
	rulesJSON := `[{"id":"r_1","name":"IPLC Filter","include":"IPLC"}]`
	err = store.SaveRuleLibraryJSON(rulesJSON)
	if err != nil {
		t.Fatalf("SaveRuleLibraryJSON failed: %v", err)
	}
	readRules, err := store.GetRuleLibraryJSON()
	if err != nil || len(readRules) < 10 {
		t.Errorf("GetRuleLibraryJSON failed: %v, got %s", err, readRules)
	}
}

// TestAirportsCRUD 验证机场管理的完整 CRUD 生命周期
func TestAirportsCRUD(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_airports_crud.db")

	store, err := NewHistoryStorage(dbPath)
	if err != nil {
		t.Fatalf("NewHistoryStorage failed: %v", err)
	}
	defer store.Close()

	// 1. 验证初始为空
	initialJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	if initialJSON != "[]" {
		t.Errorf("expected empty array, got %s", initialJSON)
	}

	// 2. 插入两个机场
	apList := []map[string]interface{}{
		{
			"id":      "ap_01",
			"name":    "Airport One",
			"url":     "https://sub.one.com/clash",
			"enabled": true,
			"nodes":   []interface{}{map[string]interface{}{"name": "Node-1"}},
		},
		{
			"id":      "ap_02",
			"name":    "Airport Two",
			"url":     "https://sub.two.com/clash",
			"enabled": false,
			"nodes":   []interface{}{map[string]interface{}{"name": "Node-2"}},
		},
	}
	bytes, _ := json.Marshal(apList)
	if err := store.SaveAirportsJSON(string(bytes)); err != nil {
		t.Fatalf("SaveAirportsJSON failed: %v", err)
	}

	// 3. 验证回读
	savedJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	var readList []map[string]interface{}
	if err := json.Unmarshal([]byte(savedJSON), &readList); err != nil {
		t.Fatalf("Unmarshal saved airports failed: %v", err)
	}
	if len(readList) != 2 {
		t.Fatalf("expected 2 airports, got %d", len(readList))
	}
	if readList[0]["id"] != "ap_01" || readList[0]["name"] != "Airport One" {
		t.Errorf("unexpected airport 1: %+v", readList[0])
	}
	if readList[1]["id"] != "ap_02" || readList[1]["name"] != "Airport Two" {
		t.Errorf("unexpected airport 2: %+v", readList[1])
	}

	// 4. 更新机场 (修改 ap_01 名称与启用状态)
	readList[0]["name"] = "Airport One Modified"
	readList[0]["enabled"] = false
	updateBytes, _ := json.Marshal(readList)
	if err := store.SaveAirportsJSON(string(updateBytes)); err != nil {
		t.Fatalf("SaveAirportsJSON update failed: %v", err)
	}

	updatedJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	var afterUpdate []map[string]interface{}
	_ = json.Unmarshal([]byte(updatedJSON), &afterUpdate)
	if len(afterUpdate) != 2 {
		t.Fatalf("expected 2 airports after update, got %d", len(afterUpdate))
	}
	if afterUpdate[0]["name"] != "Airport One Modified" {
		t.Errorf("expected 'Airport One Modified', got '%v'", afterUpdate[0]["name"])
	}

	// 5. 删除机场 (从列表中移除 ap_02)
	deleteList := []map[string]interface{}{afterUpdate[0]}
	deleteBytes, _ := json.Marshal(deleteList)
	if err := store.SaveAirportsJSON(string(deleteBytes)); err != nil {
		t.Fatalf("SaveAirportsJSON delete failed: %v", err)
	}

	afterDeleteJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	var afterDelete []map[string]interface{}
	_ = json.Unmarshal([]byte(afterDeleteJSON), &afterDelete)
	if len(afterDelete) != 1 {
		t.Fatalf("expected 1 airport after delete, got %d", len(afterDelete))
	}
	if afterDelete[0]["id"] != "ap_01" {
		t.Errorf("expected ap_01 remaining, got %v", afterDelete[0]["id"])
	}

	// 6. 清空所有机场
	if err := store.SaveAirportsJSON("[]"); err != nil {
		t.Fatalf("SaveAirportsJSON clear failed: %v", err)
	}
	clearedJSON, err := store.GetAirportsJSON()
	if err != nil || clearedJSON != "[]" {
		t.Errorf("expected '[]', got '%s', err: %v", clearedJSON, err)
	}

	// 7. 非法 JSON 防御校验
	if err := store.SaveAirportsJSON("invalid-json"); err == nil {
		t.Errorf("expected error when saving invalid JSON, got nil")
	}
}

// TestDualLayerNodesPersistence 验证 rawNodes 与 nodes 的双层物理持久化与隔离机制，
// 确保前端执行正则过滤操作时绝对不会冲刷或破坏机场的原始节点源 (rawNodes)
func TestDualLayerNodesPersistence(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_dual_layer.db")

	store, err := NewHistoryStorage(dbPath)
	if err != nil {
		t.Fatalf("NewHistoryStorage failed: %v", err)
	}
	defer store.Close()

	// 构造 5 个原始源节点
	rawNodes := []map[string]interface{}{
		{"name": "US-SiliconValley-01", "type": "ss", "server": "1.1.1.1", "port": 443},
		{"name": "US-SiliconValley-02", "type": "vmess", "server": "1.1.1.2", "port": 443},
		{"name": "JP-Tokyo-01", "type": "trojan", "server": "2.2.2.1", "port": 443},
		{"name": "HK-BGP-01", "type": "ss", "server": "3.3.3.1", "port": 443},
		{"name": "HK-BGP-02", "type": "ss", "server": "3.3.3.2", "port": 443},
	}

	// 初始状态：未过滤，激活节点等于 rawNodes
	initialAirport := map[string]interface{}{
		"id":             "ap_dual_test",
		"name":           "Dual Layer Airport",
		"url":            "https://sub.example.com",
		"enabled":        true,
		"totalNodeCount": 5,
		"nodeCount":      5,
		"filterRules": map[string]interface{}{
			"include": "",
			"exclude": "",
		},
		"rawNodes": rawNodes,
		"nodes":    rawNodes,
	}

	initBytes, _ := json.Marshal([]map[string]interface{}{initialAirport})
	if err := store.SaveAirportsJSON(string(initBytes)); err != nil {
		t.Fatalf("SaveAirportsJSON failed: %v", err)
	}

	// 读取初始保存的数据
	savedJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	var readAirports []map[string]interface{}
	_ = json.Unmarshal([]byte(savedJSON), &readAirports)
	if len(readAirports) != 1 {
		t.Fatalf("expected 1 airport, got %d", len(readAirports))
	}

	savedRaw := readAirports[0]["rawNodes"].([]interface{})
	savedActive := readAirports[0]["nodes"].([]interface{})
	if len(savedRaw) != 5 || len(savedActive) != 5 {
		t.Fatalf("expected 5 raw nodes and 5 active nodes, got raw=%d, active=%d", len(savedRaw), len(savedActive))
	}

	// 模拟用户在前端执行正则过滤（只保留 US 节点）：
	// 此时 active nodes 减少为 2 个，但 rawNodes 必须依旧完整保留 5 个节点！
	filteredActiveNodes := []map[string]interface{}{
		{"name": "US-SiliconValley-01", "type": "ss", "server": "1.1.1.1", "port": 443},
		{"name": "US-SiliconValley-02", "type": "vmess", "server": "1.1.1.2", "port": 443},
	}
	filteredAirport := map[string]interface{}{
		"id":             "ap_dual_test",
		"name":           "Dual Layer Airport",
		"url":            "https://sub.example.com",
		"enabled":        true,
		"totalNodeCount": 5,
		"nodeCount":      2,
		"filterRules": map[string]interface{}{
			"include": "US",
			"exclude": "",
		},
		"rawNodes": rawNodes, // 原始源节点保持不变
		"nodes":    filteredActiveNodes,
	}

	filterBytes, _ := json.Marshal([]map[string]interface{}{filteredAirport})
	if err := store.SaveAirportsJSON(string(filterBytes)); err != nil {
		t.Fatalf("SaveAirportsJSON after filter failed: %v", err)
	}

	// 重新读取并严格验证双层物理持久化与隔离
	afterFilterJSON, err := store.GetAirportsJSON()
	if err != nil {
		t.Fatalf("GetAirportsJSON failed: %v", err)
	}
	var afterFilterAirports []map[string]interface{}
	_ = json.Unmarshal([]byte(afterFilterJSON), &afterFilterAirports)

	persistedRaw := afterFilterAirports[0]["rawNodes"].([]interface{})
	persistedActive := afterFilterAirports[0]["nodes"].([]interface{})

	// 核心断言：过滤保存决不允许擦除原始源节点！
	if len(persistedRaw) != 5 {
		t.Errorf("critical failure: rawNodes count altered! expected 5, got %d", len(persistedRaw))
	}
	if len(persistedActive) != 2 {
		t.Errorf("active nodes count expected 2, got %d", len(persistedActive))
	}
	totalNodeCount := int(afterFilterAirports[0]["totalNodeCount"].(float64))
	nodeCount := int(afterFilterAirports[0]["nodeCount"].(float64))
	if totalNodeCount != 5 || nodeCount != 2 {
		t.Errorf("expected totalNodeCount=5 and nodeCount=2, got total=%d, active=%d", totalNodeCount, nodeCount)
	}

	// 模拟用户重置过滤器：从持久化的 rawNodes 还原回 5 个节点
	restoredAirport := map[string]interface{}{
		"id":             "ap_dual_test",
		"name":           "Dual Layer Airport",
		"url":            "https://sub.example.com",
		"enabled":        true,
		"totalNodeCount": 5,
		"nodeCount":      5,
		"filterRules": map[string]interface{}{
			"include": "",
			"exclude": "",
		},
		"rawNodes": persistedRaw,
		"nodes":    persistedRaw,
	}
	restoreBytes, _ := json.Marshal([]map[string]interface{}{restoredAirport})
	if err := store.SaveAirportsJSON(string(restoreBytes)); err != nil {
		t.Fatalf("SaveAirportsJSON restore failed: %v", err)
	}

	restoredJSON, _ := store.GetAirportsJSON()
	var restoredAirports []map[string]interface{}
	_ = json.Unmarshal([]byte(restoredJSON), &restoredAirports)
	if len(restoredAirports[0]["nodes"].([]interface{})) != 5 {
		t.Errorf("expected 5 active nodes after filter reset, got %d", len(restoredAirports[0]["nodes"].([]interface{})))
	}
}

// TestAppSettingsDetailCRUD 验证应用配置的详细 CRUD 与覆盖写入
func TestAppSettingsDetailCRUD(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_settings_detail.db")

	store, err := NewHistoryStorage(dbPath)
	if err != nil {
		t.Fatalf("NewHistoryStorage failed: %v", err)
	}
	defer store.Close()

	// 1. 查询不存在的键安全返回空字符串，不产生错误
	nonExistent, err := store.GetSetting("not_exist_key")
	if err != nil {
		t.Fatalf("GetSetting on missing key returned error: %v", err)
	}
	if nonExistent != "" {
		t.Errorf("expected empty string for missing key, got '%s'", nonExistent)
	}

	// 2. 单项新增与回读
	if err := store.SetSetting("concurrency", "8"); err != nil {
		t.Fatalf("SetSetting failed: %v", err)
	}
	val, err := store.GetSetting("concurrency")
	if err != nil || val != "8" {
		t.Errorf("expected '8', got '%s', err: %v", val, err)
	}

	// 3. 单项覆写更新
	if err := store.SetSetting("concurrency", "16"); err != nil {
		t.Fatalf("SetSetting update failed: %v", err)
	}
	val, err = store.GetSetting("concurrency")
	if err != nil || val != "16" {
		t.Errorf("expected updated '16', got '%s', err: %v", val, err)
	}

	// 4. 批量保存与批量读取
	batch := map[string]string{
		"timeout":  "20",
		"language": "zh-CN",
		"theme":    "system",
	}
	if err := store.SetSettingsBatch(batch); err != nil {
		t.Fatalf("SetSettingsBatch failed: %v", err)
	}

	all, err := store.GetAllSettings()
	if err != nil {
		t.Fatalf("GetAllSettings failed: %v", err)
	}
	if all["concurrency"] != "16" || all["timeout"] != "20" || all["language"] != "zh-CN" || all["theme"] != "system" {
		t.Errorf("unexpected all settings: %+v", all)
	}

	// 5. 覆盖更新单项配置
	if err := store.SetSettingsBatch(map[string]string{"theme": "dark"}); err != nil {
		t.Fatalf("SetSettingsBatch overwrite failed: %v", err)
	}
	themeVal, _ := store.GetSetting("theme")
	if themeVal != "dark" {
		t.Errorf("expected 'dark', got '%s'", themeVal)
	}

	// 6. 空配置批次安全处理
	if err := store.SetSettingsBatch(map[string]string{}); err != nil {
		t.Errorf("empty SetSettingsBatch should not error, got %v", err)
	}
}

// TestRuleLibraryAndLatestBenchmark 验证规则库与最新评测快照的持久化
func TestRuleLibraryAndLatestBenchmark(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test_rules_latest.db")

	store, err := NewHistoryStorage(dbPath)
	if err != nil {
		t.Fatalf("NewHistoryStorage failed: %v", err)
	}
	defer store.Close()

	// 1. 规则库初始为空
	initRules, err := store.GetRuleLibraryJSON()
	if err != nil || initRules != "[]" {
		t.Errorf("expected '[]', got '%s', err: %v", initRules, err)
	}

	// 2. 规则库持久化与回读
	rules := `[{"id":"rule_01","name":"AI Dedicated","include":"(US|JP)","exclude":"(0.1x)"}]`
	if err := store.SaveRuleLibraryJSON(rules); err != nil {
		t.Fatalf("SaveRuleLibraryJSON failed: %v", err)
	}
	readRules, err := store.GetRuleLibraryJSON()
	if err != nil {
		t.Fatalf("GetRuleLibraryJSON failed: %v", err)
	}
	if !strings.Contains(readRules, "AI Dedicated") {
		t.Errorf("expected saved rule to contain 'AI Dedicated', got %s", readRules)
	}

	// 3. 评测快照初始为空
	initLatest, err := store.GetLatestBenchmarkResultsJSON()
	if err != nil || initLatest != "[]" {
		t.Errorf("expected '[]', got '%s', err: %v", initLatest, err)
	}

	// 4. 评测快照保存与覆盖
	latestData := `[{"node_name":"Node-1","score":95.5}]`
	if err := store.SaveLatestBenchmarkResultsJSON(latestData); err != nil {
		t.Fatalf("SaveLatestBenchmarkResultsJSON failed: %v", err)
	}
	readLatest, err := store.GetLatestBenchmarkResultsJSON()
	if err != nil || readLatest != latestData {
		t.Errorf("expected '%s', got '%s', err: %v", latestData, readLatest, err)
	}
}
