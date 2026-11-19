// Package cmd 提供 NodePilot Engine 的命令行客户端命令实现与参数绑定。
//
// 架构概述：
//   - 基于 Cobra 构建 CLI 命令树，支持本地 YAML 配置加载、远程订阅拉取、自定义探针扩展与直连基准探测；
//   - 负责编排 runner 引擎的并发评测、scorer 的加权归一化排序，并通过 exporter 导出控制台表格、Clash 策略组及 Markdown 报告；
//   - 被 engine/main.go 入口调用，对外提供可独立执行的 CLI 工具二进制。
package cmd

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"nodepilot/engine/pkg/exporter"
	"nodepilot/engine/pkg/model"
	"nodepilot/engine/pkg/parser"
	"nodepilot/engine/pkg/probe"
	"nodepilot/engine/pkg/runner"
	"nodepilot/engine/pkg/scorer"
	"github.com/spf13/cobra"
)

var (
	configFile      string
	subscribeURL    string
	serviceFilter   string
	customProfile   string
	workers         int
	timeoutSec      int
	outputClashFile string
	outputMDFile    string
	directTestOnly  bool
)

// rootCmd 定义 CLI 根命令与全局帮助说明
var rootCmd = &cobra.Command{
	Use:   "engine",
	Short: "NodePilot Engine - Multi-dimensional benchmark engine for AI IDE proxy nodes",
	Long: `NodePilot Engine is a multi-dimensional benchmark and evaluation tool designed specifically for AI IDEs (Antigravity, Cursor, Windsurf, Copilot, etc.).
It moves beyond simple ping latency to comprehensively measure TTFT, TPS, Token Jitter, Ingress upload bandwidth, and Proxy Buffering.`,
	RunE: runBenchmark,
}

// Execute 执行根命令，接管 CLI 生命周期并在异常时终止进程
func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	// 绑定命令行参数标志
	rootCmd.Flags().StringVarP(&configFile, "config", "c", "", "Local Clash/Mihomo configuration file path (YAML)")
	rootCmd.Flags().StringVarP(&subscribeURL, "url", "u", "", "Remote proxy subscription URL")
	rootCmd.Flags().StringVarP(&serviceFilter, "service", "s", "all", "Target AI service filter (all, antigravity, gemini, openai, claude, cursor)")
	rootCmd.Flags().StringVarP(&customProfile, "profile", "p", "", "Custom AI probe configuration file path (YAML)")
	rootCmd.Flags().IntVarP(&workers, "workers", "w", 5, "Number of concurrent workers")
	rootCmd.Flags().IntVarP(&timeoutSec, "timeout", "t", 10, "Single probe timeout in seconds")
	rootCmd.Flags().StringVarP(&outputClashFile, "output-clash", "o", "", "Output file path for selected best Clash proxy groups (YAML)")
	rootCmd.Flags().StringVarP(&outputMDFile, "output-md", "m", "", "Output file path for benchmark evaluation report (Markdown)")
	rootCmd.Flags().BoolVar(&directTestOnly, "direct", false, "Use local direct connection only for baseline benchmark testing")
}

// runBenchmark 执行评测主流程：节点获取、探针装载、并发测试、评分排序与多格式输出
func runBenchmark(cmd *cobra.Command, args []string) error {
	var nodes []model.Node

	if directTestOnly {
		nodes = append(nodes, model.Node{
			Name: "Local-Direct",
			Type: "direct",
		})
	} else if configFile != "" {
		fmt.Printf("📂 Loading nodes from file: %s\n", configFile)
		n, err := parser.ParseClashFromFile(configFile)
		if err != nil {
			return fmt.Errorf("failed to parse configuration file: %w", err)
		}
		nodes = append(nodes, n...)
	} else if subscribeURL != "" {
		fmt.Printf("🌐 Fetching nodes from subscription URL: %s\n", subscribeURL)
		n, err := parser.ParseClashFromURL(subscribeURL)
		if err != nil {
			return fmt.Errorf("failed to fetch subscription: %w", err)
		}
		nodes = append(nodes, n...)
	} else {
		// 默认回退为本地直连探测，提供零配置开箱即用的基准体验
		fmt.Println("ℹ️ No configuration file or subscription URL specified, using [Local-Direct] as baseline probe.")
		nodes = append(nodes, model.Node{
			Name: "Local-Direct",
			Type: "direct",
		})
	}

	if len(nodes) == 0 {
		return fmt.Errorf("no valid nodes found to benchmark")
	}

	// 加载并过滤目标 AI 服务探针配置
	profiles := selectProfiles(serviceFilter)
	if customProfile != "" {
		cp, err := probe.LoadProfileFromFile(customProfile)
		if err != nil {
			return fmt.Errorf("failed to load custom probe profile: %w", err)
		}
		profiles = append(profiles, *cp)
	}

	fmt.Printf("🚀 Preparing benchmark for %d nodes with %d target probes, concurrency: %d...\n", len(nodes), len(profiles), workers)

	engine := runner.NewBenchmarkEngine(runner.EngineOptions{
		Concurrency: workers,
		Timeout:     time.Duration(timeoutSec) * time.Second,
	})

	ctx := context.Background()
	rawResults := engine.Run(ctx, nodes, profiles)

	// 计算多维度加权得分并依服务分组降序排名
	rankedResults := scorer.CalculateScoresAndRank(rawResults)

	// 格式化并在终端输出评测表格
	tableOut := exporter.FormatTerminalTable(rankedResults)
	fmt.Println(tableOut)

	// 导出最优 Clash 策略组配置
	if outputClashFile != "" {
		clashYaml, err := exporter.GenerateBestGroupsYAML(rankedResults, 5)
		if err == nil {
			_ = os.WriteFile(outputClashFile, []byte(clashYaml), 0644)
			fmt.Printf("✅ Successfully exported best proxy groups to: %s\n", outputClashFile)
		}
	}

	// 导出 Markdown 格式评测报告
	if outputMDFile != "" {
		mdReport := exporter.GenerateMarkdownReport(rankedResults)
		_ = os.WriteFile(outputMDFile, []byte(mdReport), 0644)
		fmt.Printf("✅ Successfully exported benchmark report to: %s\n", outputMDFile)
	}

	return nil
}

// selectProfiles 根据用户传入的过滤关键词筛选待测试的目标探针；若无匹配或为 "all" 则返回全部内置探针
func selectProfiles(filter string) []model.ProbeProfile {
	all := probe.DefaultProfiles()
	filter = strings.ToLower(strings.TrimSpace(filter))
	if filter == "all" || filter == "" {
		return all
	}

	var matched []model.ProbeProfile
	for _, p := range all {
		if strings.Contains(strings.ToLower(p.ID), filter) || strings.Contains(strings.ToLower(p.Name), filter) {
			matched = append(matched, p)
		}
	}

	if len(matched) == 0 {
		return all
	}
	return matched
}

