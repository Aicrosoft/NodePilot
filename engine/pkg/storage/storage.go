// Package storage 提供基于本地嵌入式 SQLite (modernc.org/sqlite) 的全量持久化仓库实现。
//
// 架构概述：
//   - 负责历史评测大盘记录 (benchmark_history)、应用全局偏好配置 (app_settings) 的落盘；
//   - 负责多机场与双层节点 (airports: rawNodes 与 nodes 物理隔离) 的无损持久化；
//   - 负责规则过滤库 (rule_library) 以及最新评测离线快照 (benchmark_latest) 的事务级读写；
//   - 严格采用单写者连接池与 WAL (Write-Ahead Logging) 模式，保障跨平台高并发与崩溃事务安全。
package storage

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// HistoryRecord 对应 SQLite 数据库中的单条基准评测历史明细实体。
type HistoryRecord struct {
	ID                  int64   `json:"id,omitempty"`
	BatchID             string  `json:"batch_id"`
	AirportName         string  `json:"airport_name"`
	NodeName            string  `json:"node_name"`
	NodeType            string  `json:"node_type"`
	Server              string  `json:"server"`
	Port                int     `json:"port"`
	ServiceName         string  `json:"service_name"`
	AIOffer             string  `json:"ai_offer"`
	Status              string  `json:"status"`
	PingMs              int64   `json:"ping_ms"`
	PingStatus          string  `json:"ping_status"`
	Score               float64 `json:"score"`
	TTFBMs              float64 `json:"ttfb_ms"`
	TTFTMs              float64 `json:"ttft_ms"`
	TPS                 float64 `json:"tps"`
	JitterMs            float64 `json:"jitter_ms"`
	BandwidthBps        float64 `json:"bandwidth_bps"`
	ProxyBufferDetected bool    `json:"proxy_buffer_detected"`
	Rank                int     `json:"rank"`
	TestedAt            string  `json:"tested_at"`
	TestedTimeDisplay   string  `json:"tested_time_display"`
	BatchTime           string  `json:"batch_time"`
}

// HistoryStats 汇总历史评测数据库的宏观统计指标。
type HistoryStats struct {
	TotalRecords int64  `json:"total_records"`
	FirstTested  string `json:"first_tested"`
	LastTested   string `json:"last_tested"`
	AirportCount int    `json:"airport_count"`
	NodeCount    int    `json:"node_count"`
}

// HistoryStorage 封装本地 SQLite 数据库连接池与线程安全读写操作。
type HistoryStorage struct {
	dbPath string
	db     *sql.DB
	mu     sync.RWMutex
}

var (
	defaultStorage *HistoryStorage
	storageOnce    sync.Once
)

// DefaultDBPath 返回推荐的跨平台标准 SQLite 数据库存储绝对路径。
func DefaultDBPath() string {
	if env := os.Getenv("NODEPILOT_DB_PATH"); env != "" {
		return env
	}

	configDir, err := os.UserConfigDir()
	if err != nil {
		home, err := os.UserHomeDir()
		if err != nil {
			return "nodepilot.db"
		}
		return filepath.Join(home, ".nodepilot", "nodepilot.db")
	}
	return filepath.Join(configDir, "NodePilot", "nodepilot.db")
}

// NewHistoryStorage 初始化或连接到指定的 SQLite 评测历史数据库。
func NewHistoryStorage(dbPath string) (*HistoryStorage, error) {
	if dbPath == "" {
		dbPath = DefaultDBPath()
	}

	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// 启用 WAL 模式、5秒忙等待超时与常规同步级别以获得最佳写入性能
	dsn := fmt.Sprintf("%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open SQLite database: %w", err)
	}

	// 配置连接池属性：单连接保障 SQLite 事务级串行安全写入，彻底杜绝 database is locked 竞争
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(time.Hour)

	hs := &HistoryStorage{
		dbPath: dbPath,
		db:     db,
	}

	if err := hs.initSchema(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("failed to initialize database schema: %w", err)
	}

	return hs, nil
}

// GetDefaultStorage 获取全局单例默认 HistoryStorage 仓库实例。
func GetDefaultStorage() (*HistoryStorage, error) {
	var err error
	storageOnce.Do(func() {
		defaultStorage, err = NewHistoryStorage("")
	})
	return defaultStorage, err
}

// initSchema 初始化数据库表结构、索引与视图。
func (s *HistoryStorage) initSchema() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	createTableSQL := `
	CREATE TABLE IF NOT EXISTS benchmark_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		batch_id TEXT NOT NULL,
		airport_name TEXT NOT NULL,
		node_name TEXT NOT NULL,
		node_type TEXT DEFAULT '',
		server TEXT DEFAULT '',
		port INTEGER DEFAULT 0,
		service_name TEXT NOT NULL,
		ai_offer TEXT DEFAULT '',
		status TEXT NOT NULL,
		ping_ms INTEGER DEFAULT 0,
		ping_status TEXT DEFAULT '',
		score REAL NOT NULL,
		ttfb_ms REAL DEFAULT 0,
		ttft_ms REAL DEFAULT 0,
		tps REAL DEFAULT 0,
		jitter_ms REAL DEFAULT 0,
		bandwidth_bps REAL DEFAULT 0,
		proxy_buffer_detected INTEGER DEFAULT 0,
		rank INTEGER DEFAULT 0,
		tested_at TEXT NOT NULL,
		tested_time_display TEXT NOT NULL,
		batch_time TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_hist_tested_at ON benchmark_history(tested_at);
	CREATE INDEX IF NOT EXISTS idx_hist_airport ON benchmark_history(airport_name);
	CREATE INDEX IF NOT EXISTS idx_hist_service ON benchmark_history(service_name);
	CREATE INDEX IF NOT EXISTS idx_hist_batch ON benchmark_history(batch_id);

	-- 2. 全局应用偏好设置表 (并发数、超时时间、语言、主题、选项状态)
	CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	-- 3. 机场与订阅配置表 (物理无损持久化)
	CREATE TABLE IF NOT EXISTS airports (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		url TEXT DEFAULT '',
		enabled INTEGER DEFAULT 1,
		updated_at TEXT NOT NULL,
		data_json TEXT NOT NULL
	);

	-- 4. 节点正则与过滤规则库表
	CREATE TABLE IF NOT EXISTS rule_library (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		data_json TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	-- 5. 最新评测快照表 (用于排行榜与离线 UI 快速直出渲染)
	CREATE TABLE IF NOT EXISTS benchmark_latest (
		key TEXT PRIMARY KEY,
		data_json TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	`

	_, err := s.db.Exec(createTableSQL)
	return err
}

// Close 安全关闭 SQLite 数据库连接。
func (s *HistoryStorage) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// SaveRecords 在单个原子事务内批量写入多条历史基准测试记录。
func (s *HistoryStorage) SaveRecords(records []HistoryRecord) error {
	if len(records) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin write transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.Prepare(`
	INSERT INTO benchmark_history (
		batch_id, airport_name, node_name, node_type, server, port,
		service_name, ai_offer, status, ping_ms, ping_status, score,
		ttfb_ms, ttft_ms, tps, jitter_ms, bandwidth_bps, proxy_buffer_detected,
		rank, tested_at, tested_time_display, batch_time
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("failed to prepare insert statement: %w", err)
	}
	defer stmt.Close()

	for _, r := range records {
		bufferDetectedInt := 0
		if r.ProxyBufferDetected {
			bufferDetectedInt = 1
		}

		testedAt := r.TestedAt
		if testedAt == "" {
			testedAt = time.Now().UTC().Format(time.RFC3339)
		}
		testedTimeDisplay := r.TestedTimeDisplay
		if testedTimeDisplay == "" {
			testedTimeDisplay = time.Now().Format("2006-01-02 15:04:05")
		}
		batchTime := r.BatchTime
		if batchTime == "" {
			batchTime = testedAt
		}

		_, err := stmt.Exec(
			r.BatchID, r.AirportName, r.NodeName, r.NodeType, r.Server, r.Port,
			r.ServiceName, r.AIOffer, r.Status, r.PingMs, r.PingStatus, r.Score,
			r.TTFBMs, r.TTFTMs, r.TPS, r.JitterMs, r.BandwidthBps, bufferDetectedInt,
			r.Rank, testedAt, testedTimeDisplay, batchTime,
		)
		if err != nil {
			return fmt.Errorf("failed to execute batch insert: %w", err)
		}
	}

	return tx.Commit()
}

// QueryRecords 依测试时间升序分页查询评测历史记录。
func (s *HistoryStorage) QueryRecords(limit int, offset int) ([]HistoryRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if limit <= 0 {
		limit = 5000
	}
	if offset < 0 {
		offset = 0
	}

	query := `
	SELECT id, batch_id, airport_name, node_name, node_type, server, port,
	       service_name, ai_offer, status, ping_ms, ping_status, score,
	       ttfb_ms, ttft_ms, tps, jitter_ms, bandwidth_bps, proxy_buffer_detected,
	       rank, tested_at, tested_time_display, batch_time
	FROM benchmark_history
	ORDER BY tested_at ASC, id ASC
	LIMIT ? OFFSET ?
	`

	rows, err := s.db.Query(query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query benchmark history: %w", err)
	}
	defer rows.Close()

	var results []HistoryRecord
	for rows.Next() {
		var r HistoryRecord
		var bufferDetectedInt int

		err := rows.Scan(
			&r.ID, &r.BatchID, &r.AirportName, &r.NodeName, &r.NodeType, &r.Server, &r.Port,
			&r.ServiceName, &r.AIOffer, &r.Status, &r.PingMs, &r.PingStatus, &r.Score,
			&r.TTFBMs, &r.TTFTMs, &r.TPS, &r.JitterMs, &r.BandwidthBps, &bufferDetectedInt,
			&r.Rank, &r.TestedAt, &r.TestedTimeDisplay, &r.BatchTime,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to read history record row: %w", err)
		}

		r.ProxyBufferDetected = (bufferDetectedInt == 1)
		results = append(results, r)
	}

	return results, nil
}

// ClearAll 清空表中所有的历史测试数据并执行 VACUUM 回收磁盘物理页。
func (s *HistoryStorage) ClearAll() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.db.Exec("DELETE FROM benchmark_history")
	if err != nil {
		return fmt.Errorf("failed to clear benchmark history: %w", err)
	}
	_, _ = s.db.Exec("VACUUM")
	return nil
}

// GetStats 汇总并返回历史数据库的大盘宏观统计信息。
func (s *HistoryStorage) GetStats() (HistoryStats, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var stats HistoryStats
	var firstTested sql.NullString
	var lastTested sql.NullString

	query := `
	SELECT COUNT(*),
	       MIN(tested_at),
	       MAX(tested_at),
	       COUNT(DISTINCT airport_name),
	       COUNT(DISTINCT node_name)
	FROM benchmark_history
	`

	row := s.db.QueryRow(query)
	err := row.Scan(&stats.TotalRecords, &firstTested, &lastTested, &stats.AirportCount, &stats.NodeCount)
	if err != nil {
		return stats, err
	}

	if firstTested.Valid {
		stats.FirstTested = firstTested.String
	}
	if lastTested.Valid {
		stats.LastTested = lastTested.String
	}

	return stats, nil
}

// SetSetting 持久化保存单项应用偏好配置到 SQLite（存在则覆盖更新）。
func (s *HistoryStorage) SetSetting(key string, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	query := `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
	ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
	_, err := s.db.Exec(query, key, value, now)
	return err
}

// GetSetting 从 SQLite 查询单项应用偏好配置（键不存在时返回空字符串，不产生错误）。
func (s *HistoryStorage) GetSetting(key string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var val string
	err := s.db.QueryRow("SELECT value FROM app_settings WHERE key = ?", key).Scan(&val)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return val, err
}

// GetAllSettings 查询所有已持久化的全局应用偏好配置字典。
func (s *HistoryStorage) GetAllSettings() (map[string]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query("SELECT key, value FROM app_settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			res[k] = v
		}
	}
	return res, nil
}

// SetSettingsBatch 在事务内批量持久化保存应用偏好设置字典。
func (s *HistoryStorage) SetSettingsBatch(settings map[string]string) error {
	if len(settings) == 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC().Format(time.RFC3339)
	stmt, err := tx.Prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
	ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for k, v := range settings {
		if _, err := stmt.Exec(k, v, now); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// SaveAirportsJSON 将完整的机场与节点实体列表 JSON 事务性持久化写入 SQLite。
func (s *HistoryStorage) SaveAirportsJSON(airportsJSON string) error {
	var list []map[string]interface{}
	if err := json.Unmarshal([]byte(airportsJSON), &list); err != nil {
		return fmt.Errorf("failed to parse airports JSON: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 原子清空与重新全量插入，确保用户在前端删除的机场被彻底清除
	if _, err := tx.Exec("DELETE FROM airports"); err != nil {
		return err
	}

	stmt, err := tx.Prepare(`INSERT INTO airports (id, name, url, enabled, updated_at, data_json) VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	for _, item := range list {
		id, _ := item["id"].(string)
		name, _ := item["name"].(string)
		url, _ := item["url"].(string)
		enabled := 1
		if en, ok := item["enabled"].(bool); ok && !en {
			enabled = 0
		}
		rawBytes, _ := json.Marshal(item)
		if id == "" {
			id = fmt.Sprintf("ap_%d", time.Now().UnixNano())
		}
		if name == "" {
			name = id
		}
		if _, err := stmt.Exec(id, name, url, enabled, now, string(rawBytes)); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetAirportsJSON 从 SQLite 读取全部机场与节点配置 JSON 文本。
func (s *HistoryStorage) GetAirportsJSON() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query("SELECT data_json FROM airports ORDER BY rowid ASC")
	if err != nil {
		return "[]", err
	}
	defer rows.Close()

	list := make([]map[string]interface{}, 0)
	for rows.Next() {
		var dj string
		if err := rows.Scan(&dj); err == nil {
			var item map[string]interface{}
			if err := json.Unmarshal([]byte(dj), &item); err == nil {
				list = append(list, item)
			}
		}
	}

	resBytes, err := json.Marshal(list)
	if err != nil {
		return "[]", err
	}
	return string(resBytes), nil
}

// SaveRuleLibraryJSON 将规则过滤库持久化保存至 SQLite。
func (s *HistoryStorage) SaveRuleLibraryJSON(rulesJSON string) error {
	var list []map[string]interface{}
	if err := json.Unmarshal([]byte(rulesJSON), &list); err != nil {
		return fmt.Errorf("failed to parse rule library JSON: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec("DELETE FROM rule_library"); err != nil {
		return err
	}

	stmt, err := tx.Prepare("INSERT INTO rule_library (id, name, data_json, updated_at) VALUES (?, ?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC().Format(time.RFC3339)
	for _, item := range list {
		id, _ := item["id"].(string)
		name, _ := item["name"].(string)
		rawBytes, _ := json.Marshal(item)
		if id == "" {
			id = fmt.Sprintf("rule_%d", time.Now().UnixNano())
		}
		if _, err := stmt.Exec(id, name, string(rawBytes), now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetRuleLibraryJSON 从 SQLite 查询已持久化的规则过滤库 JSON。
func (s *HistoryStorage) GetRuleLibraryJSON() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	rows, err := s.db.Query("SELECT data_json FROM rule_library ORDER BY rowid ASC")
	if err != nil {
		return "[]", err
	}
	defer rows.Close()

	list := make([]map[string]interface{}, 0)
	for rows.Next() {
		var dj string
		if err := rows.Scan(&dj); err == nil {
			var item map[string]interface{}
			if err := json.Unmarshal([]byte(dj), &item); err == nil {
				list = append(list, item)
			}
		}
	}

	resBytes, err := json.Marshal(list)
	if err != nil {
		return "[]", err
	}
	return string(resBytes), nil
}

// SaveLatestBenchmarkResultsJSON 保存最近一次评测快照供离线排行榜秒开展示。
func (s *HistoryStorage) SaveLatestBenchmarkResultsJSON(resultsJSON string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now().UTC().Format(time.RFC3339)
	query := `INSERT INTO benchmark_latest (key, data_json, updated_at) VALUES ('latest', ?, ?)
	ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`
	_, err := s.db.Exec(query, resultsJSON, now)
	return err
}

// GetLatestBenchmarkResultsJSON 从 SQLite 读取最新评测快照 JSON。
func (s *HistoryStorage) GetLatestBenchmarkResultsJSON() (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var jsonStr string
	err := s.db.QueryRow("SELECT data_json FROM benchmark_latest WHERE key = 'latest'").Scan(&jsonStr)
	if err == sql.ErrNoRows {
		return "[]", nil
	}
	return jsonStr, err
}
