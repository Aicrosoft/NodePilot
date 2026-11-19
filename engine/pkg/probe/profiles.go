// Package probe 定义内置 AI 服务探针预设与外部自定义 YAML 探针加载器。
//
// 架构概述：
//   - 维护 Google Antigravity、Google Gemini、OpenAI、Anthropic Claude 与 Cursor IDE Gateway 五大核心 AI 服务探测元数据；
//   - 配置各服务专属的多态判定状态码、鉴权特征码、地域封锁特征关键字与上行负载基准；
//   - 支持通过 YAML 动态加载第三方私有大模型或网关探测配置文件。
package probe

import (
	"fmt"
	"os"

	"nodepilot/engine/pkg/model"
	"gopkg.in/yaml.v3"
)

// DefaultProfiles 返回内置开箱即用的核心 AI 服务探针规范列表。
func DefaultProfiles() []model.ProbeProfile {
	return []model.ProbeProfile{
		{
			ID:       "google-antigravity",
			Name:     "Google Antigravity",
			Category: "ide",
			Method:   "GET",
			Endpoint: "https://cloudcode-pa.googleapis.com",
			Validation: model.ValidationRule{
				StatusCodes:        []int{200, 401, 403, 404},
				AuthRequiredCodes:  []int{401, 403},
				RestrictedKeywords: []string{"blocked", "access denied", "region"},
			},
			TestIngress:         true,
			IngressPayloadBytes: 256 * 1024, // 模拟 256KB 大上下文代码上行
			TestStream:          false,
		},
		{
			ID:       "google-gemini",
			Name:     "Google Gemini",
			Category: "llm",
			Method:   "GET",
			Endpoint: "https://generativelanguage.googleapis.com",
			Validation: model.ValidationRule{
				StatusCodes:        []int{200, 401, 403, 404},
				AuthRequiredCodes:  []int{401, 403},
				RestrictedKeywords: []string{"location is not supported", "blocked", "waf"},
			},
			TestIngress:         true,
			IngressPayloadBytes: 128 * 1024,
			TestStream:          false,
		},
		{
			ID:       "openai",
			Name:     "OpenAI / ChatGPT",
			Category: "llm",
			Method:   "GET",
			Endpoint: "https://api.openai.com/v1/models",
			Validation: model.ValidationRule{
				StatusCodes:        []int{200, 401},
				AuthRequiredCodes:  []int{401},
				RestrictedKeywords: []string{"country, region, or territory", "cloudflare", "challenge"},
			},
			TestIngress:         true,
			IngressPayloadBytes: 128 * 1024,
			TestStream:          false,
		},
		{
			ID:       "anthropic-claude",
			Name:     "Anthropic Claude",
			Category: "llm",
			Method:   "GET",
			Endpoint: "https://api.anthropic.com/v1/messages",
			Validation: model.ValidationRule{
				StatusCodes:        []int{200, 401, 405},
				AuthRequiredCodes:  []int{401},
				RestrictedKeywords: []string{"restricted", "blocked", "cloudflare"},
			},
			TestIngress:         true,
			IngressPayloadBytes: 128 * 1024,
			TestStream:          false,
		},
		{
			ID:       "cursor",
			Name:     "Cursor IDE Gateway",
			Category: "ide",
			Method:   "GET",
			Endpoint: "https://api2.cursor.sh",
			Validation: model.ValidationRule{
				StatusCodes:        []int{200, 401, 403, 404},
				AuthRequiredCodes:  []int{401, 403},
				RestrictedKeywords: []string{"blocked", "forbidden"},
			},
			TestIngress:         true,
			IngressPayloadBytes: 128 * 1024,
			TestStream:          false,
		},
	}
}

// LoadProfileFromFile 从外部 YAML 文件解析并加载自定义 AI 探针规范。
// 入参：filePath 为本地 YAML 文件路径；出参：解析后的探针对象或格式错误。
func LoadProfileFromFile(filePath string) (*model.ProbeProfile, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read profile file: %w", err)
	}

	var profile model.ProbeProfile
	err = yaml.Unmarshal(data, &profile)
	if err != nil {
		return nil, fmt.Errorf("failed to parse profile yaml: %w", err)
	}

	return &profile, nil
}

