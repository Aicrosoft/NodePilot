# NodePilot 核心网络引擎模块 (`engine/`)

> 本目录为 NodePilot 的底层核心网络协议解析与基准测速引擎，采用 Clean Architecture 架构与模块化分层设计，支持作为独立库被桌面应用集成或构建为无头 CLI 独立执行。

---

## 🏛️ 核心包与模块划分

```text
engine/
├── cmd/                    # 命令行独立入口与参数绑定 (基于 Cobra)
│   ├── root.go             # 核心 CLI 命令与参数解析
│   └── root_test.go        # 命令行参数单元测试
│
└── pkg/                    # 核心领域与网络实现包
    ├── model/              # 核心领域模型、强类型枚举与不可篡改 Golden Tests
    ├── parser/             # 多协议订阅解码流水线 (SS/SSR/VMess/VLESS/Trojan/Hysteria2/Clash)
    ├── probe/              # 阶梯式链路探测栈 (TCP, TLS, HTTP TTFB 与 AI 服务专线探针)
    ├── runner/             # 高性能并发协程池、上下文超时与背压调度引擎
    ├── scorer/             # 多因子加权动态评分、中转缓冲惩罚与健康度分级算法
    ├── storage/            # 嵌入式 SQLite 纯 Go 事务持久化仓储 (零外部 CGO 依赖)
    ├── exporter/           # 策略组导出器 (Clash YAML, Sing-Box 规则, CSV, Markdown 报表)
    └── logger/             # 日志统一格式化、等级动态热切换与日轮转归档
```

---

## 🧪 测试与质量保障

核心引擎包含完备的单元测试、并发竞态检测与 Golden Contract 不可篡改黄金断言：

```bash
# 运行核心引擎全量单元测试与黄金契约测试
go test -v ./...

# 启用高并发数据竞态检测 (Race Detector)
go test -race ./pkg/runner/... ./pkg/storage/...
```

---

## 🔨 独立 CLI 构建

可将核心引擎独立构建为无 GUI 依赖的跨平台命令行执行文件：

```bash
# 编译本地平台引擎命令行
mkdir -p bin
go build -v -o bin/nodepilot-engine ./cmd/...

# 查看命令行支持的全部参数与用法
./bin/nodepilot-engine --help
```

---

## 📖 关联文档

- 核心引擎全景能力清单：[FEATURES.md](FEATURES.md)
- 核心引擎发版说明：[RELEASE_NOTES.md](RELEASE_NOTES.md)
- 项目主说明文档：[../README.md](../README.md)
