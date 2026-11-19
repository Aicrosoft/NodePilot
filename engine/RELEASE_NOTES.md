# NodePilot Engine v0.1 发版说明 (2026-11-19)

> 🚀 **首发版本！高性能、模块化且跨平台的网络协议解析与基准测试核心引擎。**

---

## 🌟 核心亮点 (Highlights)

- **高性能并发测速框架**：基于 Go 协程池架构打造的并发执行引擎，支持弹性并发控制与毫秒级超时上下文熔断。
- **丰富的协议矩阵与订阅解析**：原生支持 Shadowsocks、VMess、VLESS、Trojan、Hysteria2 等主流网络协议的自动化解析与容错清洗。
- **纯 Go 嵌入式存储**：集成高性能嵌入式 SQLite 存储，具备强一致性事务保障与快速检索能力，免去外部数据库依赖。

---

## ✨ 核心能力与组件交付 (Capabilities & Components)

### 1. 协议解析套件 (`parser`)
- 原生支持多协议节点 URI（SS/SSR/VMess/VLESS/Trojan/Hysteria2）及 Base64 编码的订阅源快速解码；
- 支持 Clash YAML 配置及各类复杂订阅格式的自动探测与字段提取；
- 内置输入容错与字段规范化清洗机制，保障异构节点输出标准一致。

### 2. 调度执行与多层探测栈 (`runner` & `probe`)
- 支持阶梯式链路连通性探测：TCP 握手延时、TLS 握手延时、HTTP/HTTPS 首包响应时间 (TTFB)；
- 提供针对主流 AI 服务端点（OpenAI、Anthropic、Gemini）的专线接口探测方案；
- 全流程受 `context.Context` 约束，支持外部优雅中断与高并发背压控制。

### 3. 多因子算法评分体系 (`scorer`)
- 结合响应延迟、丢包率、抖动方差与综合可用性状态的多维度加权评估模型；
- 输出分级评定（A/B/C/D）与标准枚举状态（Available / Degraded / Unavailable）。

### 4. 嵌入式仓储与导出器 (`storage` & `exporter`)
- 提供统一的 Storage 抽象接口，内置纯 Go SQLite 持久化实现与高效的内存测试仓储；
- 支持将选优节点导出为 Clash 配置、Sing-Box 规则及标准 JSON/CSV 报表。

### 5. 契约稳定性与黄金测试 (`model`)
- 关键领域模型配备不可篡改 Golden Tests 契约断言，确保对外数据模型向后兼容。

---

## 📌 集成指引 (Integration Guide)

作为 Go 模块引入或以独立 CLI 形式构建：

```bash
# 运行完整单元测试与黄金契约断言
go test -v ./engine/...

# 构建引擎示例命令行
go build -o bin/nodepilot-engine ./engine/cmd/...
```
