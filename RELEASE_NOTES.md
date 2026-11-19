# NodePilot v0.1 发版说明 (2026-11-19)

> 🎉 **NodePilot v0.1 首发版本正式发布！轻量、优雅且专业的跨平台网络节点测速与智能调度中心。**

---

## 🌟 重磅发布亮点 (Highlights)

- **桌面客户端全平台就绪**：基于现代化架构打造的原生桌面客户端，现已全面支持 macOS (Apple Silicon / Intel 双架构)、Windows 与 Linux，开箱即用。
- **高并发极速基准测速**：底层搭载纯 Go 自研的高性能网络测试引擎，毫秒级探测链路时延、丢包率与抖动指标，支持百级节点并发快速探活。
- **直观的数据可视化图表**：内置双 Y 轴历史演进走势图与多维健康度评分看板，节点可用性与网络波动一目了然。
- **AI 专线联通度深度探测**：原生支持针对主流人工智能端点（如 OpenAI、Claude、Gemini 等）的专线可用性测试，API Key 仅保存在本地设备，安全无忧。

---

## ✨ 交付单元发版说明索引 (Delivery Units)

NodePilot 采用高内聚、分层解耦的工程设计，各子系统的独立发版说明请查阅：

- 🖥️ **桌面客户端应用**：详见 [app/RELEASE_NOTES.md](app/RELEASE_NOTES.md)（托盘生命周期、GUI 界面、图表交互、多语言设置与配置导入导出）
- ⚙️ **核心网络与 CLI 引擎**：详见 [engine/RELEASE_NOTES.md](engine/RELEASE_NOTES.md)（协议解析器、高并发探测池、嵌入式 SQLite 存储与配置导出器）

---

## 🛠️ 快速安装与体验 (Getting Started)

1. 从 GitHub Releases 下载适配你操作系统的最新安装包：
   - **macOS**: `NodePilot-0.1-darwin-universal.dmg`
   - **Windows**: `NodePilot-0.1-windows-amd64-installer.exe`
   - **Linux**: `NodePilot-0.1-linux-amd64.tar.gz`
2. 启动应用，在「订阅管理」中导入节点链接；
3. 点击「开始测速」，系统将自动为你分析并呈现最佳网络节点。
