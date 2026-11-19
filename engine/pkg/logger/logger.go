// Package logger 提供统一的运行期日志分级与持久化服务。
// 支持动态日志级别控制、多 Writer 输出（标准输出与文件流）以及按月分目录自动按天轮转机制（logs/YYYY-MM/YYYY-MM-DD.log）。
package logger

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Level 定义日志级别整型枚举。
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

var (
	mu           sync.Mutex
	logDir       string
	currentDate  string
	logFile      *os.File
	writers      []io.Writer
	currentLevel = LevelInfo
)

// parseLevel 解析大小写不敏感的日志级别字符串，未知级别回退至 LevelInfo。
func parseLevel(level string) Level {
	switch strings.ToUpper(strings.TrimSpace(level)) {
	case "DEBUG":
		return LevelDebug
	case "INFO":
		return LevelInfo
	case "WARN", "WARNING":
		return LevelWarn
	case "ERROR":
		return LevelError
	}
	return LevelInfo
}

// SetLogLevel 动态配置全局日志输出级别 ("DEBUG", "INFO", "WARN", "ERROR")。
// 当日志级别发生实质改变时返回 true；若与当前级别相同则返回 false。
func SetLogLevel(levelStr string) bool {
	mu.Lock()
	defer mu.Unlock()
	newLevel := parseLevel(levelStr)
	if newLevel == currentLevel {
		return false
	}
	currentLevel = newLevel
	return true
}

// GetLogLevel 获取当前全局日志输出级别的大写字符串表示。
func GetLogLevel() string {
	mu.Lock()
	defer mu.Unlock()
	switch currentLevel {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	}
	return "INFO"
}

// findProjectRoot 向上递归探测项目根目录（寻找 build.sh 或 .git 标记）。
func findProjectRoot() string {
	cwd, err := os.Getwd()
	if err != nil {
		return "."
	}
	dir := cwd
	for {
		if _, err := os.Stat(filepath.Join(dir, "build.sh")); err == nil {
			return dir
		}
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return cwd
}

func init() {
	// 默认输出至标准输出并初始化当日日志文件流
	writers = []io.Writer{os.Stdout}
	ensureDailyLogFileLocked(time.Now())
}

// resolveCandidateLogDir 解析并创建具备写入权限的日志目录优先级候选路径。
func resolveCandidateLogDir() string {
	root := findProjectRoot()
	candidates := []string{
		filepath.Join(root, "logs"),
		"logs",
		filepath.Join(os.TempDir(), "nodepilot-logs"),
	}
	for _, dir := range candidates {
		if err := os.MkdirAll(dir, 0755); err != nil {
			continue
		}
		if abs, err := filepath.Abs(dir); err == nil {
			return abs
		}
		return dir
	}
	return "."
}

// ensureDailyLogFileLocked 检查并执行每日日志文件轮转（调用者必须持有 mu.Lock() 互斥锁）。
func ensureDailyLogFileLocked(now time.Time) {
	today := now.Format("2006-01-02")
	month := now.Format("2006-01")
	if today == currentDate && logFile != nil {
		return
	}

	if logDir == "" {
		logDir = resolveCandidateLogDir()
	}

	// 将每日日志整理归档至按月子目录中：logs/YYYY-MM/YYYY-MM-DD.log
	monthDir := filepath.Join(logDir, month)
	_ = os.MkdirAll(monthDir, 0755)

	filename := fmt.Sprintf("%s.log", today)
	targetPath := filepath.Join(monthDir, filename)

	f, err := os.OpenFile(targetPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err == nil {
		if logFile != nil {
			_ = logFile.Close()
		}
		logFile = f
		currentDate = today
		writers = []io.Writer{os.Stdout, f}
		fmt.Printf("[LOGGER] Daily test log rotated to: %s\n", targetPath)
	}
}

// logMessage 格式化并分发日志条目至所有已注册的输出流中（支持并发保护与日志级别过滤）。
func logMessage(level, tag, format string, args ...interface{}) {
	mu.Lock()
	defer mu.Unlock()

	if parseLevel(level) < currentLevel {
		return
	}

	now := time.Now()
	ensureDailyLogFileLocked(now)

	timestamp := now.Format("2006-01-02 15:04:05.000")
	msg := fmt.Sprintf(format, args...)
	line := fmt.Sprintf("[%s] [%s] [%s] %s\n", timestamp, level, tag, msg)

	for _, w := range writers {
		_, _ = fmt.Fprint(w, line)
	}
}

// Info 输出 INFO 级别运行时日志。
func Info(tag string, format string, args ...interface{}) {
	logMessage("INFO", tag, format, args...)
}

// Warn 输出 WARN 级别警告日志。
func Warn(tag string, format string, args ...interface{}) {
	logMessage("WARN", tag, format, args...)
}

// Error 输出 ERROR 级别错误日志。
func Error(tag string, format string, args ...interface{}) {
	logMessage("ERROR", tag, format, args...)
}

// Debug 输出 DEBUG 级别调试日志。
func Debug(tag string, format string, args ...interface{}) {
	logMessage("DEBUG", tag, format, args...)
}

// GetLogFilePath 获取当前运行期日志文件的绝对路径。
func GetLogFilePath() string {
	mu.Lock()
	defer mu.Unlock()
	ensureDailyLogFileLocked(time.Now())

	if logFile != nil {
		p, err := filepath.Abs(logFile.Name())
		if err == nil {
			return p
		}
		return logFile.Name()
	}
	return ""
}

// GetLogDir 获取存放当前运行期日志文件的上层目录绝对路径。
func GetLogDir() string {
	mu.Lock()
	defer mu.Unlock()
	ensureDailyLogFileLocked(time.Now())

	if logFile != nil {
		p, err := filepath.Abs(filepath.Dir(logFile.Name()))
		if err == nil {
			return p
		}
		return filepath.Dir(logFile.Name())
	}
	if logDir != "" {
		return logDir
	}
	return ""
}
