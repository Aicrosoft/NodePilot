# NodePilot 桌面客户端模块 (`app/`)

> 本目录为 NodePilot 桌面图形客户端的主模块，基于 [Wails v2](https://wails.io) 框架构建，深度融合系统原生视窗交互与高吞吐网络基准测试。

---

## 🏛️ 模块架构

```text
app/
├── app.go                  # Wails 应用核心业务控制器 (IPC 桥接、测速调度、设置管理)
├── app_test.go             # 控制器单元测试与备份验证
├── main.go                 # 桌面主入口、窗口初始化与托盘生命周期管理
├── version.go              # 法定版本信息定义与提取
├── wails.json              # Wails 项目配置与版本单真理源 (SSOT)
│
├── build/                  # 系统级平台资源 (应用图标、Info.plist、NSIS 配置)
│   ├── appicon.png         # 应用高清图标源文件
│   ├── darwin/             # macOS 专属打包元数据与 Plist 模板
│   └── windows/            # Windows 多尺寸 ICO 图标与清单定义
│
└── frontend/               # 原生 ESM 现代化前端工程
    ├── package.json        # 前端开发依赖与 Jest 测试配置
    ├── src/
    │   ├── index.html      # 主视窗结构与骨架
    │   ├── main.css        # 全局设计规范与主题变量
    │   ├── fragments/      # 抽屉与弹窗异步装配 HTML 片段 (Drawer / Modal)
    │   └── js/             # 纯 JS 模块化业务逻辑 (Store, Benchmark, Chart, i18n)
    └── test/               # 前端自动化单元测试套件 (62 项全量断言)
```

---

## 🚀 本地开发与调试

### 1. 运行环境要求
- Go 1.22+
- Node.js 18+ / 20+
- Wails CLI v2 (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

### 2. 热重载开发模式 (Live Development)
在 `app/` 目录下执行：
```bash
wails dev
```
此命令将同时启动 Go 后端与前端 Vite 热重载服务，修改代码即可实时在桌面视窗中查看效果。

### 3. 运行前端与控制器测试
```bash
# 运行 Go 控制器测试
go test -v ./...

# 运行前端 62 项单元测试
cd frontend && npm test
```

---

## 📦 生产包构建

```bash
# 构建当前平台生产包
wails build -s

# 针对 macOS Universal (Apple Silicon + Intel) 构建
wails build -platform darwin/universal -s

# 针对 Windows 64-bit 构建
wails build -platform windows/amd64 -s
```

---

## 📖 关联文档

- 桌面端全景功能特性蓝图：[FEATURES.md](FEATURES.md)
- 桌面端最新发版说明：[RELEASE_NOTES.md](RELEASE_NOTES.md)
- 项目主说明文档：[../README.md](../README.md)
