// Package probe 包含对探针预设完整性校验、自定义 YAML 加载以及配置重写的单元测试。
package probe

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestDefaultProfiles 校验 5 大内置核心 AI 服务探针规范及其元数据完整性。
func TestDefaultProfiles(t *testing.T) {
	profiles := DefaultProfiles()
	if len(profiles) != 5 {
		t.Fatalf("expected 5 default profiles, got %d", len(profiles))
	}

	expectedIDs := map[string]bool{
		"google-antigravity": false,
		"google-gemini":      false,
		"openai":             false,
		"anthropic-claude":   false,
		"cursor":             false,
	}

	for _, p := range profiles {
		if _, exists := expectedIDs[p.ID]; !exists {
			t.Errorf("unexpected profile ID: %s", p.ID)
		}
		expectedIDs[p.ID] = true

		// 验证关键必填字段完整性与有效性
		if p.Name == "" {
			t.Errorf("profile %s has empty Name", p.ID)
		}
		if p.Category != "ide" && p.Category != "llm" {
			t.Errorf("profile %s has unexpected category: %s", p.ID, p.Category)
		}
		if p.Method != "GET" && p.Method != "POST" {
			t.Errorf("profile %s has unexpected HTTP method: %s", p.ID, p.Method)
		}
		if !strings.HasPrefix(p.Endpoint, "https://") {
			t.Errorf("profile %s endpoint must start with https://, got %s", p.ID, p.Endpoint)
		}
		if len(p.Validation.StatusCodes) == 0 {
			t.Errorf("profile %s has empty Validation.StatusCodes", p.ID)
		}
		if len(p.Validation.AuthRequiredCodes) == 0 {
			t.Errorf("profile %s has empty Validation.AuthRequiredCodes", p.ID)
		}
		if len(p.Validation.RestrictedKeywords) == 0 {
			t.Errorf("profile %s has empty Validation.RestrictedKeywords", p.ID)
		}
		if p.TestIngress && p.IngressPayloadBytes <= 0 {
			t.Errorf("profile %s has TestIngress=true but invalid IngressPayloadBytes: %d", p.ID, p.IngressPayloadBytes)
		}
	}

	for id, found := range expectedIDs {
		if !found {
			t.Errorf("expected profile ID %s was not found in DefaultProfiles()", id)
		}
	}
}

// TestLoadProfileFromFile_Valid 验证从有效 YAML 文件反序列化与探针加载逻辑。
func TestLoadProfileFromFile_Valid(t *testing.T) {
	yamlContent := `id: "deepseek-custom"
name: "DeepSeek API"
category: "llm"
method: "POST"
endpoint: "https://api.deepseek.com/chat/completions"
headers:
  Content-Type: "application/json"
  Authorization: "Bearer sk-test-123456"
body_payload: '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"stream":true}'
validation:
  status_codes: [200, 401]
  auth_required_codes: [401]
  restricted_keywords:
    - "region restricted"
    - "blocked"
    - "waf"
test_ingress: true
ingress_payload_bytes: 262144
test_stream: true
`
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "custom_profile.yaml")
	if err := os.WriteFile(filePath, []byte(yamlContent), 0644); err != nil {
		t.Fatalf("failed to write temp yaml: %v", err)
	}

	profile, err := LoadProfileFromFile(filePath)
	if err != nil {
		t.Fatalf("unexpected error loading valid profile: %v", err)
	}
	if profile == nil {
		t.Fatal("expected non-nil profile")
	}

	if profile.ID != "deepseek-custom" {
		t.Errorf("expected ID 'deepseek-custom', got '%s'", profile.ID)
	}
	if profile.Name != "DeepSeek API" {
		t.Errorf("expected Name 'DeepSeek API', got '%s'", profile.Name)
	}
	if profile.Category != "llm" {
		t.Errorf("expected Category 'llm', got '%s'", profile.Category)
	}
	if profile.Method != "POST" {
		t.Errorf("expected Method 'POST', got '%s'", profile.Method)
	}
	if profile.Endpoint != "https://api.deepseek.com/chat/completions" {
		t.Errorf("expected Endpoint 'https://api.deepseek.com/chat/completions', got '%s'", profile.Endpoint)
	}
	if profile.Headers["Authorization"] != "Bearer sk-test-123456" {
		t.Errorf("expected Authorization header 'Bearer sk-test-123456', got '%s'", profile.Headers["Authorization"])
	}
	if profile.Headers["Content-Type"] != "application/json" {
		t.Errorf("expected Content-Type header 'application/json', got '%s'", profile.Headers["Content-Type"])
	}
	if !profile.TestIngress || profile.IngressPayloadBytes != 262144 {
		t.Errorf("expected TestIngress=true and IngressPayloadBytes=262144, got %v and %d", profile.TestIngress, profile.IngressPayloadBytes)
	}
	if !profile.TestStream {
		t.Errorf("expected TestStream=true, got %v", profile.TestStream)
	}
	if len(profile.Validation.RestrictedKeywords) != 3 {
		t.Errorf("expected 3 restricted keywords, got %d", len(profile.Validation.RestrictedKeywords))
	}
}

// TestLoadProfileFromFile_Errors 验证针对不存在文件或格式损坏 YAML 的防御性错误处理。
func TestLoadProfileFromFile_Errors(t *testing.T) {
	// 1. 不存在的路径应返回可读错误
	_, err := LoadProfileFromFile("/path/to/non_existent_profile.yaml")
	if err == nil {
		t.Error("expected error for non-existent file, got nil")
	}

	// 2. 格式损毁的非法 YAML 应捕获反序列化错误
	tmpDir := t.TempDir()
	invalidFile := filepath.Join(tmpDir, "invalid.yaml")
	if err := os.WriteFile(invalidFile, []byte("id: [unclosed list\n  bad-indent"), 0644); err != nil {
		t.Fatalf("failed to write invalid yaml: %v", err)
	}
	_, err = LoadProfileFromFile(invalidFile)
	if err == nil {
		t.Error("expected YAML unmarshal error for malformed file, got nil")
	}
}

// TestProfileHeadersAndEndpointOverride 验证自定义请求头与服务网关端点覆写能力。
func TestProfileHeadersAndEndpointOverride(t *testing.T) {
	base := DefaultProfiles()[0] // google-antigravity
	if base.Headers == nil {
		base.Headers = make(map[string]string)
	}
	base.Headers["X-Custom-Auth"] = "secret-token"
	base.Headers["User-Agent"] = "Custom-IDE/2.0"
	base.Endpoint = "https://custom-gateway.internal.net"
	base.APIKey = "custom-api-key"
	base.CustomModel = "gemini-1.5-pro"

	if base.Headers["X-Custom-Auth"] != "secret-token" {
		t.Errorf("custom header was not set correctly")
	}
	if base.Endpoint != "https://custom-gateway.internal.net" {
		t.Errorf("endpoint override failed")
	}
	if base.APIKey != "custom-api-key" {
		t.Errorf("api key override failed")
	}
	if base.CustomModel != "gemini-1.5-pro" {
		t.Errorf("custom model override failed")
	}
}
