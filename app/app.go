// Package main 提供 NodePilot 桌面客户端后端核心胶水层与跨进程通信桥梁。
//
// 架构概述：
//   - 本文件定义 Wails 运行时桥接结构体 App，负责连接前端 UI 与后端各领域模块（Mihomo 代理内核、基准测试引擎、SQLite 持久化仓库等）；
//   - 被 main.go 实例化并绑定到 Wails 运行时的 IPC 管道，前端通过 window.go.main.App.* 远程调用其对外暴露的方法；
//   - 内部编排 nodepilot/engine/pkg 下的 parser、runner、scorer、storage、exporter、logger、probe 等各子系统。
package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"nodepilot/engine/pkg/exporter"
	"nodepilot/engine/pkg/logger"
	"nodepilot/engine/pkg/model"
	"nodepilot/engine/pkg/parser"
	"nodepilot/engine/pkg/probe"
	"nodepilot/engine/pkg/runner"
	"nodepilot/engine/pkg/scorer"
	"nodepilot/engine/pkg/storage"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App 结构体作为 Wails 后端桥接接口，封装应用程序全局上下文并暴露给前端。
type App struct {
	ctx context.Context
}

// NewApp 构造函数创建并初始化 App 实例。
func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

//go:embed wails.json
var wailsConfigRaw []byte

type wailsConfigMeta struct {
	Info struct {
		ProductVersion string `json:"productVersion"`
	} `json:"info"`
}

// GetAppVersion 从内嵌的 wails.json 读取权威产品版本号；若未配置或解析失败则回退为 "dev"。
func (a *App) GetAppVersion() string {
	var cfg wailsConfigMeta
	if err := json.Unmarshal(wailsConfigRaw, &cfg); err == nil && cfg.Info.ProductVersion != "" {
		return cfg.Info.ProductVersion
	}
	return "dev"
}

// SelectConfigFile 唤起系统原生文件选择对话框，用于选取本地 Clash / Mihomo YAML 配置文件。
// 入参：无；出参：用户选中的文件绝对路径，若用户取消则返回空字符串。
func (a *App) SelectConfigFile() (string, error) {
	filePath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Clash / Mihomo Configuration File",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "YAML Configuration (*.yaml;*.yml)", Pattern: "*.yaml;*.yml"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	return filePath, err
}

// ParseNodesFromFile 解析本地配置文件中的代理节点。
// 入参：path 为文件路径；出参：解析出的节点切片或错误。
func (a *App) ParseNodesFromFile(path string) ([]model.Node, error) {
	if path == "" {
		return nil, fmt.Errorf("file path cannot be empty")
	}
	return parser.ParseClashFromFile(path)
}

// ParseNodesFromURL 从远程订阅链接抓取并解析代理节点。
// 入参：url 为订阅 HTTP/HTTPS 地址；出参：解析出的节点切片或错误。
func (a *App) ParseNodesFromURL(url string) ([]model.Node, error) {
	if url == "" {
		return nil, fmt.Errorf("subscription URL cannot be empty")
	}
	return parser.ParseClashFromURL(url)
}

// GetAvailableServices 获取所有内置支持评测的 AI 服务名称列表。
func (a *App) GetAvailableServices() []string {
	profiles := probe.DefaultProfiles()
	var names []string
	for _, p := range profiles {
		names = append(names, p.Name)
	}
	return names
}

// benchmarkTask 封装单个节点与单个探测探针构成的并发测试任务项。
type benchmarkTask struct {
	node    model.Node
	profile model.ProbeProfile
}

// filterActiveProfiles 根据用户选中的服务名称或标识过滤探针配置；若无匹配或未指定则回退为全量探针。
func filterActiveProfiles(allProfiles []model.ProbeProfile, selectedServices []string) []model.ProbeProfile {
	if len(selectedServices) == 0 {
		return allProfiles
	}
	var matched []model.ProbeProfile
	for _, p := range allProfiles {
		for _, s := range selectedServices {
			if strings.EqualFold(p.Name, s) || strings.EqualFold(p.ID, s) {
				matched = append(matched, p)
				break
			}
		}
	}
	if len(matched) == 0 {
		return allProfiles
	}
	return matched
}

// RunBenchmark 执行多节点与多服务的高性能并发基准测试，并通过 Wails 事件总线实时推送进度。
// 入参：
//   - nodes: 待测代理节点切片；
//   - selectedServices: 用户选中的服务 ID/名称过滤列表，为空表示测试全部；
//   - workers: 并发工作协程数；
//   - timeoutSec: 单次探测超时秒数；
//   - enablePrePing: 是否开启轻量预检 Ping 快速熔断机制。
// 出参：
//   - 经过归一化加权评分与排序后的评测结果切片。
func (a *App) RunBenchmark(nodes []model.Node, selectedServices []string, workers int, timeoutSec int, enablePrePing bool) ([]model.BenchmarkResult, error) {
	if len(nodes) == 0 {
		return nil, fmt.Errorf("no valid nodes to benchmark")
	}
	if workers <= 0 {
		workers = 5
	}
	if timeoutSec <= 0 {
		timeoutSec = 10
	}

	activeProfiles := filterActiveProfiles(probe.DefaultProfiles(), selectedServices)

	// 从持久化存储中读取用户配置的 API Key 与自定义模型，组装凭证用于深度基准测试
	if settings, err := a.GetAllAppSettings(); err == nil && settings != nil {
		for i := range activeProfiles {
			kKey := fmt.Sprintf("nodepilot_probe_apikey_%s", activeProfiles[i].ID)
			mKey := fmt.Sprintf("nodepilot_probe_model_%s", activeProfiles[i].ID)
			if keyVal, ok := settings[kKey]; ok && keyVal != "" {
				activeProfiles[i].APIKey = keyVal
			} else if keyVal, ok := settings[fmt.Sprintf("probe_apikey_%s", activeProfiles[i].ID)]; ok && keyVal != "" {
				activeProfiles[i].APIKey = keyVal
			}
			if modelVal, ok := settings[mKey]; ok && modelVal != "" {
				activeProfiles[i].CustomModel = modelVal
			} else if modelVal, ok := settings[fmt.Sprintf("probe_model_%s", activeProfiles[i].ID)]; ok && modelVal != "" {
				activeProfiles[i].CustomModel = modelVal
			}
		}
	}

	totalTasks := len(nodes) * len(activeProfiles)
	var completed int32

	engine := runner.NewBenchmarkEngine(runner.EngineOptions{
		Concurrency:    workers,
		Timeout:        time.Duration(timeoutSec) * time.Second,
		EnablePrePing:  enablePrePing,
		PrePingTimeout: 2 * time.Second,
	})

	taskCh := make(chan benchmarkTask, totalTasks)
	for _, n := range nodes {
		for _, p := range activeProfiles {
			taskCh <- benchmarkTask{node: n, profile: p}
		}
	}
	close(taskCh)

	resCh := make(chan model.BenchmarkResult, totalTasks)
	var wg sync.WaitGroup

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go a.benchmarkWorker(engine, taskCh, resCh, &completed, totalTasks, &wg)
	}

	wg.Wait()
	close(resCh)

	var allResults []model.BenchmarkResult
	for r := range resCh {
		allResults = append(allResults, r)
	}

	ranked := scorer.CalculateScoresAndRank(allResults)
	return ranked, nil
}

// benchmarkWorker 为并发评测工作协程，从通道消费任务并通过 Wails 事件向前端实时推送单步进度。
func (a *App) benchmarkWorker(
	engine *runner.BenchmarkEngine,
	taskCh <-chan benchmarkTask,
	resCh chan<- model.BenchmarkResult,
	completed *int32,
	totalTasks int,
	wg *sync.WaitGroup,
) {
	defer wg.Done()
	for task := range taskCh {
		resList := engine.Run(a.ctx, []model.Node{task.node}, []model.ProbeProfile{task.profile})
		if len(resList) == 0 {
			continue
		}
		res := resList[0]
		resCh <- res
		cur := atomic.AddInt32(completed, 1)

		// 实时向前端派发单条评测进度事件
		wailsRuntime.EventsEmit(a.ctx, "benchmark_progress", map[string]interface{}{
			"completed": cur,
			"total":     totalTasks,
			"percent":   int(float64(cur) / float64(totalTasks) * 100),
			"latest":    res,
		})
	}
}

// ExportClashGroups 生成并导出每个 AI 服务最优的 Top-N Clash 代理策略组 YAML 配置。
func (a *App) ExportClashGroups(results []model.BenchmarkResult, topN int) (string, error) {
	return exporter.GenerateBestGroupsYAML(results, topN)
}

// ExportMarkdownReport 生成格式化的 Markdown 评测报告文本。
func (a *App) ExportMarkdownReport(results []model.BenchmarkResult) string {
	return exporter.GenerateMarkdownReport(results)
}

// GetRuntimeLogPath 获取当前运行时日志文件的物理绝对路径。
func (a *App) GetRuntimeLogPath() string {
	return logger.GetLogFilePath()
}

// GetRecentLogs 读取当前运行时日志文件末尾的 N 行日志，用于前端日志面板渲染。
func (a *App) GetRecentLogs(limit int) (string, error) {
	logPath := logger.GetLogFilePath()
	if logPath == "" {
		return "Log file not ready yet", nil
	}

	data, err := os.ReadFile(logPath)
	if err != nil {
		return "", err
	}

	lines := strings.Split(string(data), "\n")
	if limit > 0 && len(lines) > limit {
		lines = lines[len(lines)-limit:]
	}
	return strings.Join(lines, "\n"), nil
}

// SetLogLevel 动态切换日志记录级别（支持 "DEBUG"、"INFO"、"WARN"、"ERROR"）。
// 返回值：若级别发生变更则返回 true，若与当前级别相同无须变更则返回 false。
func (a *App) SetLogLevel(level string) bool {
	changed := logger.SetLogLevel(level)
	if changed {
		logger.Info("SETTINGS", "Log level switched to: %s", logger.GetLogLevel())
	}
	return changed
}

// GetLogLevel 获取当前生效的日志输出级别。
func (a *App) GetLogLevel() string {
	return logger.GetLogLevel()
}

// OpenLogDir 唤起宿主机系统文件管理器（macOS Finder / Windows 资源管理器 / Linux xdg-open）定位至日志目录。
func (a *App) OpenLogDir() error {
	dir := logger.GetLogDir()
	if dir == "" {
		return fmt.Errorf("log directory not initialized")
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", dir)
	case "windows":
		cmd = exec.Command("explorer", dir)
	default: // linux, freebsd
		cmd = exec.Command("xdg-open", dir)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to open log directory: %w", err)
	}

	logger.Info("APP", "Successfully opened log storage directory: %s", dir)
	return nil
}

// ExportAirportsConfig 唤起系统原生另存为对话框，将机场与节点配置 JSON 备份持久化到本地磁盘。
func (a *App) ExportAirportsConfig(jsonContent string, defaultFilename string) (string, error) {
	if defaultFilename == "" {
		defaultFilename = fmt.Sprintf("nodepilot_airports_%s.json", time.Now().Format("20060102_150405"))
	}

	savePath, err := wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Export All Airport and Node Configurations",
		DefaultFilename: defaultFilename,
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "NodePilot Configuration (*.json)", Pattern: "*.json"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil {
		return "", err
	}
	if savePath == "" {
		return "", nil // 用户取消保存对话框
	}

	err = os.WriteFile(savePath, []byte(jsonContent), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	logger.Info("BACKUP", "Successfully exported airports and nodes backup file: %s (size: %d bytes)", savePath, len(jsonContent))
	return savePath, nil
}

// SelectImportAirportsFile 唤起系统原生打开对话框，选取待导入的机场 JSON 备份文件。
func (a *App) SelectImportAirportsFile() (string, error) {
	filePath, err := wailsRuntime.OpenFileDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select Airport and Node Configuration File to Import",
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "NodePilot Configuration (*.json)", Pattern: "*.json"},
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
		},
	})
	return filePath, err
}

// ReadImportAirportsFile 读取本地选取的备份配置文件内容。
func (a *App) ReadImportAirportsFile(filePath string) (string, error) {
	if filePath == "" {
		return "", fmt.Errorf("file path cannot be empty")
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read configuration file: %w", err)
	}

	logger.Info("BACKUP", "Successfully read imported airport configuration: %s (size: %d bytes)", filePath, len(data))
	return string(data), nil
}

// SetNativeTheme 动态同步原生窗口标题栏外观与背景色（支持 "dark"、"light"、"auto"）。
func (a *App) SetNativeTheme(theme string) {
	if a.ctx == nil {
		return
	}

	switch strings.ToLower(theme) {
	case "dark":
		wailsRuntime.WindowSetDarkTheme(a.ctx)
		wailsRuntime.WindowSetBackgroundColour(a.ctx, 7, 13, 24, 255) // 严格对齐深色主题 #070d18
	case "light":
		wailsRuntime.WindowSetLightTheme(a.ctx)
		wailsRuntime.WindowSetBackgroundColour(a.ctx, 240, 244, 249, 255) // #f0f4f9
	case "auto":
		wailsRuntime.WindowSetSystemDefaultTheme(a.ctx)
	}
}

// SaveHistoryRecords 将基准测试历史记录批量持久化写入本地 SQLite 数据库。
func (a *App) SaveHistoryRecords(records []storage.HistoryRecord) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		logger.Error("DB", "Failed to get SQLite history repository: %v", err)
		return err
	}
	if err := store.SaveRecords(records); err != nil {
		logger.Error("DB", "Failed to batch write benchmark history records to SQLite: %v", err)
		return err
	}
	logger.Info("DB", "Successfully written %d benchmark history records to local SQLite database", len(records))
	return nil
}

// GetHistoryRecords 从 SQLite 数据库查询指定条数（最大支持 5000 条）的历史评测记录。
func (a *App) GetHistoryRecords(limit int) ([]storage.HistoryRecord, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		logger.Error("DB", "Failed to get SQLite history repository: %v", err)
		return nil, err
	}
	return store.QueryRecords(limit, 0)
}

// ClearHistoryRecords 清空本地 SQLite 数据库中存储的所有历史测试数据并执行 VACUUM。
func (a *App) ClearHistoryRecords() error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	if err := store.ClearAll(); err != nil {
		return err
	}
	logger.Info("DB", "Successfully cleared local SQLite benchmark history database")
	return nil
}

// GetHistoryStats 从 SQLite 获取评测历史的宏观统计指标（测试总数、时间跨度、机场与节点数）。
func (a *App) GetHistoryStats() (storage.HistoryStats, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return storage.HistoryStats{}, err
	}
	return store.GetStats()
}

// SaveAppSetting 持久化保存单项全局应用偏好配置到 SQLite。
func (a *App) SaveAppSetting(key string, value string) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	return store.SetSetting(key, value)
}

// GetAppSetting 从 SQLite 查询单项全局应用偏好配置。
func (a *App) GetAppSetting(key string) (string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return "", err
	}
	return store.GetSetting(key)
}

// GetAllAppSettings 获取所有持久化的应用偏好配置键值对映射。
func (a *App) GetAllAppSettings() (map[string]string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return nil, err
	}
	return store.GetAllSettings()
}

// SaveAppSettingsBatch 批量持久化保存应用配置键值对。
func (a *App) SaveAppSettingsBatch(settings map[string]string) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	return store.SetSettingsBatch(settings)
}

// GetSettings 为 GetAllAppSettings 的友好别名，供前端统一调用。
func (a *App) GetSettings() (map[string]string, error) {
	return a.GetAllAppSettings()
}

// SaveSettings 为 SaveAppSettingsBatch 的友好别名，供前端统一调用。
func (a *App) SaveSettings(settings map[string]string) error {
	return a.SaveAppSettingsBatch(settings)
}

// BackupPayload 定义系统级完整配置备份与导出的数据模型。
type BackupPayload struct {
	Version       string            `json:"version"`
	App           string            `json:"app"`
	ExportTime    string            `json:"exportTime"`
	TotalAirports int               `json:"totalAirports"`
	Airports      []any             `json:"airports"`
	RuleLibrary   []any             `json:"ruleLibrary,omitempty"`
	Settings      map[string]string `json:"settings,omitempty"`
}

// ExportBackup 生成包含机场、规则库与全部配置的完整系统备份 JSON 字符串。
func (a *App) ExportBackup() (string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return "", fmt.Errorf("failed to get storage: %w", err)
	}

	airportsJSON, err := store.GetAirportsJSON()
	if err != nil {
		airportsJSON = "[]"
	}
	var airports []any
	_ = json.Unmarshal([]byte(airportsJSON), &airports)

	rulesJSON, err := store.GetRuleLibraryJSON()
	if err != nil {
		rulesJSON = "[]"
	}
	var rules []any
	_ = json.Unmarshal([]byte(rulesJSON), &rules)

	settings, err := store.GetAllSettings()
	if err != nil {
		settings = make(map[string]string)
	}

	payload := BackupPayload{
		Version:       "1.0",
		App:           "NodePilot",
		ExportTime:    time.Now().Format("2006-01-02 15:04:05"),
		TotalAirports: len(airports),
		Airports:      airports,
		RuleLibrary:   rules,
		Settings:      settings,
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", fmt.Errorf("failed to marshal backup data: %w", err)
	}
	return string(data), nil
}

// ImportBackup 解析并恢复备份配置，严格校验 Schema 并按需落盘恢复到持久化存储。
func (a *App) ImportBackup(backupJSON string) error {
	if strings.TrimSpace(backupJSON) == "" {
		return fmt.Errorf("backup content cannot be empty")
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal([]byte(backupJSON), &raw); err != nil {
		// 向下兼容纯数组格式（直接的机场数组备份）
		var list []any
		if errArr := json.Unmarshal([]byte(backupJSON), &list); errArr != nil {
			return fmt.Errorf("invalid backup json: %w", err)
		}
		return a.SaveAirportsJSON(backupJSON)
	}

	store, err := storage.GetDefaultStorage()
	if err != nil {
		return fmt.Errorf("failed to get storage: %w", err)
	}

	// 结构校验：根对象必须包含 'airports' 字段
	airportsRaw, hasAirports := raw["airports"]
	if !hasAirports {
		return fmt.Errorf("invalid backup structure: missing 'airports' field")
	}

	var airportsList []any
	if err := json.Unmarshal(airportsRaw, &airportsList); err != nil {
		return fmt.Errorf("invalid airports structure: %w", err)
	}

	if err := store.SaveAirportsJSON(string(airportsRaw)); err != nil {
		return fmt.Errorf("failed to save airports: %w", err)
	}

	if rulesRaw, hasRules := raw["ruleLibrary"]; hasRules && len(rulesRaw) > 0 {
		var rulesList []any
		if err := json.Unmarshal(rulesRaw, &rulesList); err == nil {
			_ = store.SaveRuleLibraryJSON(string(rulesRaw))
		}
	}

	if settingsRaw, hasSettings := raw["settings"]; hasSettings && len(settingsRaw) > 0 {
		var settingsMap map[string]string
		if err := json.Unmarshal(settingsRaw, &settingsMap); err == nil {
			_ = store.SetSettingsBatch(settingsMap)
		}
	}

	logger.Info("BACKUP", "Successfully imported backup containing %d airports", len(airportsList))
	return nil
}

// SaveAirportsJSON 将完整的机场列表 JSON 持久化写入 SQLite。
func (a *App) SaveAirportsJSON(airportsJSON string) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	if err := store.SaveAirportsJSON(airportsJSON); err != nil {
		logger.Error("DB", "Failed to save airports to SQLite: %v", err)
		return err
	}
	return nil
}

// GetAirportsJSON 从 SQLite 读取全部机场与节点配置 JSON。
func (a *App) GetAirportsJSON() (string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return "[]", err
	}
	return store.GetAirportsJSON()
}

// SaveRuleLibraryJSON 将规则过滤库持久化保存到 SQLite。
func (a *App) SaveRuleLibraryJSON(rulesJSON string) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	return store.SaveRuleLibraryJSON(rulesJSON)
}

// GetRuleLibraryJSON 从 SQLite 查询已持久化的规则过滤库。
func (a *App) GetRuleLibraryJSON() (string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return "[]", err
	}
	return store.GetRuleLibraryJSON()
}

// SaveLatestBenchmarkResultsJSON 将最近一次评测快照持久化保存到 SQLite，供离线排行榜展示。
func (a *App) SaveLatestBenchmarkResultsJSON(resultsJSON string) error {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return err
	}
	return store.SaveLatestBenchmarkResultsJSON(resultsJSON)
}

// GetLatestBenchmarkResultsJSON 从 SQLite 读取最近一次评测快照 JSON。
func (a *App) GetLatestBenchmarkResultsJSON() (string, error) {
	store, err := storage.GetDefaultStorage()
	if err != nil {
		return "[]", err
	}
	return store.GetLatestBenchmarkResultsJSON()
}
