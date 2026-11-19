// Package cmd 包含对 CLI 根命令参数解析、默认值契约与探针过滤规则的单元测试。
package cmd

import (
	"testing"

	"nodepilot/engine/pkg/probe"
)

func TestSelectProfiles(t *testing.T) {
	allProfiles := probe.DefaultProfiles()
	totalCount := len(allProfiles)

	tests := []struct {
		name          string
		filter        string
		expectedCount int
		checkFirstID  string
	}{
		{
			name:          "Empty filter returns all profiles",
			filter:        "",
			expectedCount: totalCount,
		},
		{
			name:          "Lowercase 'all' returns all profiles",
			filter:        "all",
			expectedCount: totalCount,
		},
		{
			name:          "Uppercase 'ALL' returns all profiles",
			filter:        "ALL",
			expectedCount: totalCount,
		},
		{
			name:          "Padded whitespace '  all  ' returns all profiles",
			filter:        "  all  ",
			expectedCount: totalCount,
		},
		{
			name:          "Specific 'antigravity' matches Google Antigravity",
			filter:        "antigravity",
			expectedCount: 1,
			checkFirstID:  "google-antigravity",
		},
		{
			name:          "Uppercase 'ANTIGRAVITY' case-insensitive match",
			filter:        "ANTIGRAVITY",
			expectedCount: 1,
			checkFirstID:  "google-antigravity",
		},
		{
			name:          "Full name 'Google Antigravity' match",
			filter:        "Google Antigravity",
			expectedCount: 1,
			checkFirstID:  "google-antigravity",
		},
		{
			name:          "Specific 'gemini' matches Google Gemini",
			filter:        "gemini",
			expectedCount: 1,
			checkFirstID:  "google-gemini",
		},
		{
			name:          "Specific 'openai' matches OpenAI probe",
			filter:        "openai",
			expectedCount: 1,
			checkFirstID:  "openai",
		},
		{
			name:          "Specific 'claude' matches Anthropic Claude",
			filter:        "claude",
			expectedCount: 1,
			checkFirstID:  "anthropic-claude",
		},
		{
			name:          "Specific 'cursor' matches Cursor Gateway",
			filter:        "cursor",
			expectedCount: 1,
			checkFirstID:  "cursor",
		},
		{
			name:          "Nonexistent filter triggers safe fallback to all profiles",
			filter:        "nonexistent-probe-xyz",
			expectedCount: totalCount,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			res := selectProfiles(tc.filter)
			if len(res) != tc.expectedCount {
				t.Errorf("filter '%s': expected %d profiles, got %d", tc.filter, tc.expectedCount, len(res))
			}
			if tc.checkFirstID != "" && len(res) > 0 {
				if res[0].ID != tc.checkFirstID {
					t.Errorf("filter '%s': expected first ID '%s', got '%s'", tc.filter, tc.checkFirstID, res[0].ID)
				}
			}
		})
	}
}

func TestRootCmdFlagsDefinitionAndDefaults(t *testing.T) {
	flags := rootCmd.Flags()

	// 1. 验证所有必需的命令行参数定义及其默认值契约
	flagChecks := []struct {
		name         string
		shorthand    string
		defaultValue string
	}{
		{"config", "c", ""},
		{"url", "u", ""},
		{"service", "s", "all"},
		{"profile", "p", ""},
		{"workers", "w", "5"},
		{"timeout", "t", "10"},
		{"output-clash", "o", ""},
		{"output-md", "m", ""},
		{"direct", "", "false"},
	}

	for _, fc := range flagChecks {
		f := flags.Lookup(fc.name)
		if f == nil {
			t.Fatalf("expected flag '--%s' to be defined", fc.name)
		}
		if fc.shorthand != "" && f.Shorthand != fc.shorthand {
			t.Errorf("flag '--%s': expected shorthand '-%s', got '-%s'", fc.name, fc.shorthand, f.Shorthand)
		}
		if f.DefValue != fc.defaultValue {
			t.Errorf("flag '--%s': expected default value '%s', got '%s'", fc.name, fc.defaultValue, f.DefValue)
		}
	}
}

func TestRootCmdFlagsParsing(t *testing.T) {
	// 保存初始状态并在测试结束后自动还原，避免污染全局变量
	origConfigFile := configFile
	origSubscribeURL := subscribeURL
	origServiceFilter := serviceFilter
	origCustomProfile := customProfile
	origWorkers := workers
	origTimeoutSec := timeoutSec
	origOutputClash := outputClashFile
	origOutputMD := outputMDFile
	origDirect := directTestOnly

	defer func() {
		configFile = origConfigFile
		subscribeURL = origSubscribeURL
		serviceFilter = origServiceFilter
		customProfile = origCustomProfile
		workers = origWorkers
		timeoutSec = origTimeoutSec
		outputClashFile = origOutputClash
		outputMDFile = origOutputMD
		directTestOnly = origDirect
	}()

	args := []string{
		"-c", "test_config.yaml",
		"-u", "https://example.com/subscribe",
		"-s", "gemini",
		"-p", "custom_probe.yaml",
		"-w", "12",
		"-t", "25",
		"-o", "best_clash.yaml",
		"-m", "report.md",
		"--direct",
	}

	if err := rootCmd.ParseFlags(args); err != nil {
		t.Fatalf("ParseFlags failed: %v", err)
	}

	if configFile != "test_config.yaml" {
		t.Errorf("expected configFile 'test_config.yaml', got '%s'", configFile)
	}
	if subscribeURL != "https://example.com/subscribe" {
		t.Errorf("expected subscribeURL 'https://example.com/subscribe', got '%s'", subscribeURL)
	}
	if serviceFilter != "gemini" {
		t.Errorf("expected serviceFilter 'gemini', got '%s'", serviceFilter)
	}
	if customProfile != "custom_probe.yaml" {
		t.Errorf("expected customProfile 'custom_probe.yaml', got '%s'", customProfile)
	}
	if workers != 12 {
		t.Errorf("expected workers 12, got %d", workers)
	}
	if timeoutSec != 25 {
		t.Errorf("expected timeoutSec 25, got %d", timeoutSec)
	}
	if outputClashFile != "best_clash.yaml" {
		t.Errorf("expected outputClashFile 'best_clash.yaml', got '%s'", outputClashFile)
	}
	if outputMDFile != "report.md" {
		t.Errorf("expected outputMDFile 'report.md', got '%s'", outputMDFile)
	}
	if !directTestOnly {
		t.Errorf("expected directTestOnly true, got false")
	}
}
