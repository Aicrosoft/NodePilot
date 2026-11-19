// Package main 是 NodePilot 桌面 GUI 客户端程序的入口。
//
// 架构概述：
//   - 基于 Wails v2 框架构建跨平台轻量桌面应用；
//   - 内嵌由前端打包产物（frontend/src），配置多平台（macOS、Windows）窗口特性、深色主题基线与桥接绑定。
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	// 创建后端核心 App 桥接实例
	app := NewApp()

	// 配置并启动 Wails 应用程序运行时
	err := wails.Run(&options.App{
		Title:  "NodePilot · AI IDE Proxy Benchmark & Smart Selector",
		Width:  1200,
		Height: 820,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 7, G: 13, B: 24, A: 1}, // 严格对齐深色主题背景色 --bg-dark: #070d18
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarDefault(),
			Appearance:           mac.NSAppearanceNameDarkAqua, // 深色主题外观并启用原生独立标题栏
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			Theme:                windows.Dark,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
