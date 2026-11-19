// Package main 为 NodePilot Engine 独立命令行评测工具的执行入口。
//
// 架构概述：
//   - 负责引导 Cobra 命令行基础设施并分发子命令执行；
//   - 供 CI 自动化测试流水线、无头服务 (Headless) 或 CLI 开发者直接调用评测引擎。
package main

import (
	"nodepilot/engine/cmd"
)

func main() {
	cmd.Execute()
}

