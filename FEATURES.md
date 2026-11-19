# NodePilot 全景功能特性蓝图 (FEATURES)

> 本文档为 NodePilot 项目全景功能特性的静态蓝图与全局能力矩阵，记录整体系统的能力边界与子交付单元拓扑。

---

## 一、 系统全景能力矩阵 (System Capabilities Matrix)

| 核心领域 | 关键特性 | 交付载体 | 状态 | 说明 |
| :--- | :--- | :---: | :---: | :--- |
| **桌面交互体系** | 跨平台桌面客户端 | `app/` | ✅ | 支持 macOS、Windows、Linux 原生窗口渲染与状态记忆 |
| | 系统托盘与常驻菜单 | `app/` | ✅ | 图标状态感知、快速唤起/隐藏主界面、便捷退出 |
| | 深浅主题与双语国际化 | `app/` | ✅ | 支持明亮/暗黑主题自适应，界面即时切换中英双语 |
| **节点与订阅管理** | 多协议多源订阅导入 | `engine/` + `app/` | ✅ | 支持 Shadowsocks、VMess、VLESS、Trojan、Hysteria2 等主流协议 |
| | 容错解码与特征清洗 | `engine/` | ✅ | 支持 Base64 订阅流与 Clash YAML 配置自动识别与清洗 |
| | 多维模糊检索与过滤 | `app/` | ✅ | 按名称、地区、协议与可用性状态毫秒级过滤节点 |
| **智能基准测试体系** | 高并发 Goroutine 探测池 | `engine/` | ✅ | 弹性并发控制、超时上下文截断、平滑任务取消 |
| | 多层次链路探测栈 | `engine/` | ✅ | TCP 握手时延、TLS 协商时延、HTTP/HTTPS 首包响应时间 (TTFB) |
| | 动态加权评分与分级模型 | `engine/` | ✅ | 综合时延、丢包率与抖动计算综合得分，输出 A/B/C/D 梯队等级 |
| | AI 专线大模型端点探针 | `engine/` + `app/` | ✅ | 支持针对 OpenAI、Anthropic、Gemini 等 API 接口连通度测试 |
| **数据指标与可视化** | 实时测速控制台看板 | `app/` | ✅ | 实时回传百分比进度、平均时延与实时测速状态 |
| | 双 Y 轴历史演进走势图 | `app/` | ✅ | 节点时延与丢包率联动曲线分析 |
| **存储与配置导出** | 嵌入式 SQLite 持久化 | `engine/` | ✅ | 零 CGO 纯 Go 驱动，保障历史测速与节点元数据事务读写 |
| | 规则与多格式配置转换 | `engine/` + `app/` | ✅ | 支持将选优节点导出为 Clash 配置、Sing-Box 规则及 CSV 报表 |
| | 全量数据备份与还原 | `app/` | ✅ | 支持应用配置、订阅源与节点全量导入导出备份 |

---

## 二、 交付单元自治拓扑

```text
NodePilot/ (项目根目录)
├── FEATURES.md                       # 【全局总成】产品全景能力蓝图 (本文档)
├── RELEASE_NOTES.md                  # 【全局总成】项目整体当前发版说明快照
├── CHANGELOG.md                      # 【全生命周期】里程碑演进高光索引
├── changes/                          # 【全量归档】版本技术档案 (v0.1.md)
│
├── app/                              # 【桌面客户端交付单元】
│   ├── FEATURES.md                   # 桌面 GUI 静态功能清单
│   └── RELEASE_NOTES.md              # 桌面客户端用户发版说明
│
└── engine/                           # 【核心引擎与 CLI 交付单元】
    ├── FEATURES.md                   # 核心协议与探测引擎能力矩阵
    └── RELEASE_NOTES.md              # 引擎与 CLI 用户发版说明
```

- **桌面端专属文档**：详见 [app/FEATURES.md](app/FEATURES.md)
- **核心引擎专属文档**：详见 [engine/FEATURES.md](engine/FEATURES.md)
