# NodePilot 特性规约：机场订阅解析、节点过滤引擎与数据持久化

> **文档标识**：`docs/features/02_subscriptions_nodes_and_filtering.md`  
> **所属模块**：`engine/pkg/parser/`, `engine/pkg/storage/`, `app/app.go`, `app/frontend/src/js/`  
> **状态**：固化与特性基线规约 (Feature Specification & Baseline)

---

## 目录 (Table of Contents)

1. [背景动机与架构全景 (Why)](#一背景动机与架构全景-why)
2. [订阅协议与多源解析体系 (What & How - Parser)](#二订阅协议与多源解析体系-what--how---parser)
   - 2.1 支持的订阅格式与多协议矩阵
   - 2.2 健壮的 Base64 容错解码与多格式探测流水线
   - 2.3 占位节点、广告与公告过滤机制
   - 2.4 网络订阅抓取与防拦截客户端模拟
3. [双向正则过滤引擎 (What & How - Filtering Engine)](#三双向正则过滤引擎-what--how---filtering-engine)
   - 3.1 核心匹配逻辑与文本拓扑
   - 3.2 大小写敏感控制与语法防御
   - 3.3 预设过滤规则库设计
   - 3.4 规则库持久化与自定义管理机制
   - 3.5 实时交互式匹配预览与排除归因标注
4. [本地 SQLite 数据架构与状态同步机制 (What & How - Storage)](#四本地-sqlite-数据架构与状态同步机制-what--how---storage)
   - 4.1 嵌入式无 CGO SQLite 选型与连接池优化
   - 4.2 物理数据库路径跨平台解析
   - 4.3 核心表结构设计 (Schema)
   - 4.4 原始节点与过滤生效节点的两层分离模型
   - 4.5 评测指标回写与时序历史批量事务写入
   - 4.6 前端 LocalStorage 与 SQLite 的平滑迁移与双轨同步
5. [配置与机场数据备份恢复体系 (Backup & Restore)](#五配置与机场数据备份恢复体系-backup--restore)
   - 5.1 JSON 备份结构设计
   - 5.2 原生文件对话框与 Web Blob 双通道导出
   - 5.3 智能导入合并与冲突处理策略
6. [测试固化验收断言 (Test Solidification & Acceptance Assertions)](#六测试固化验收断言-test-solidification--acceptance-assertions)
   - 6.1 订阅解析引擎测试断言
   - 6.2 正则过滤引擎测试断言
   - 6.3 SQLite 存储与状态流转测试断言
   - 6.4 备份导入导出测试断言

---

## 一、背景动机与架构全景 (Why)

### 1.1 业务动机与核心挑战
在 AI 代理与多模型应用评测平台（NodePilot）中，评测任务的输入直接依赖于代理节点网络。现实中，机场订阅呈现出以下痛点：
1. **格式碎片化**：不同机场下发的格式五花八门，涵盖标准 Clash/Mihomo YAML、纯 Base64 编码的 URI 列表、加密/混淆的 Base64 YAML、以及单条协议链接。
2. **噪声节点泛滥**：机场经常在订阅中混入大量“公告”、“剩余流量提示”、“回国/广告”、“已过期”或“0.1x / 10x 异常倍率”节点，若全部纳入评测将严重浪费并发资源与 AI API 配额。
3. **数据一致性与丢失风险**：浏览器端的 `localStorage` 容量受限（一般 5MB 限制）且缺乏事务保证；当用户节点规模达到数千甚至上万、历史评测记录达数十万条时，极易发生截断崩溃。
4. **过滤与测速割裂**：用户需要按业务场景（如仅测试 AI 适用地区、低倍率节点、特定低延迟专线）精确筛选目标节点，并实时观测过滤影响，确保测试集合高信噪比。

### 1.2 架构分层全景
NodePilot 构筑了“后端解析与存储引擎（Go + SQLite）+ Wails IPC 桥接层 + 前端交互控制器（原生 JS + 响应式抽屉）”三层闭环架构：

```mermaid
graph TD
    subgraph Frontend ["前端展现与控制层 (Frontend)"]
        UI_Card["机场管理卡片 (airport_manager.js)"]
        UI_Drawer["节点过滤抽屉 (node_filter.js / drawer_node_filter.html)"]
        UI_Table["节点清单表格 (nodes_modal.js / drawer_nodes_list.html)"]
        UI_Backup["备份导入导出 (airport_backup.js)"]
        UI_Store["状态同步层 (store.js)"]
    end

    subgraph IPC ["Wails IPC 通信桥 (app/app.go)"]
        API_Parser["ParseNodesFromURL / ParseNodesFromFile"]
        API_Storage["SaveAirportsJSON / GetAirportsJSON / SaveHistoryRecords"]
        API_Rules["SaveRuleLibraryJSON / GetRuleLibraryJSON"]
        API_Backup["ExportAirportsConfig / ReadImportAirportsFile"]
    end

    subgraph Backend ["后端引擎层 (Engine)"]
        P_Core["订阅解析器 (engine/pkg/parser/clash.go)"]
        S_Core["SQLite 仓储层 (engine/pkg/storage/storage.go)"]
        DB[(嵌入式 SQLite\nnodepilot.db WAL 模式)]
    end

    UI_Card --> API_Parser
    UI_Card --> UI_Store
    UI_Drawer --> UI_Store
    UI_Backup --> API_Backup
    UI_Store --> API_Storage
    UI_Store --> API_Rules

    API_Parser --> P_Core
    API_Storage --> S_Core
    API_Rules --> S_Core
    S_Core --> DB
```

---

## 二、订阅协议与多源解析体系 (What & How - Parser)

源码位置：[clash.go](../../engine/pkg/parser/clash.go)

### 2.1 支持的订阅格式与多协议矩阵

解析引擎统一输出规范化实体 `model.Node`（定义于 [types.go](../../engine/pkg/model/types.go)）：
```go
type Node struct {
    AirportName string                 `json:"airport_name,omitempty" yaml:"airport_name,omitempty"`
    Name        string                 `json:"name" yaml:"name"`
    Type        string                 `json:"type" yaml:"type"`
    Server      string                 `json:"server" yaml:"server"`
    Port        int                    `json:"port" yaml:"port"`
    Password    string                 `json:"password,omitempty" yaml:"password,omitempty"`
    Raw         map[string]interface{} `json:"raw,omitempty" yaml:"raw,omitempty"`
}
```

| 协议类型 (`Type`) | URI 协议头 | 典型结构与凭证来源 | 兼容字段映射 (`Raw` 归一化) |
| :--- | :--- | :--- | :--- |
| **Shadowsocks (SS)** | `ss://` | `ss://[base64(method:password)]@server:port#name` 或 Legacy `ss://[base64(method:password@host:port)]` | `cipher`, `password`, `server`, `port` |
| **VMess** | `vmess://` | `vmess://[base64(json)]`，包含 `add`, `port`, `id`, `aid`, `net` | `uuid` (`id`), `alterId` (`aid`), `network` (`net`) |
| **VLESS** | `vless://` | `vless://uuid@server:port?security=tls&sni=...#name` | `uuid`, `sni`, `tls` |
| **Trojan** | `trojan://` | `trojan://password@server:port?sni=...#name` | `password`, `sni`, `skip-cert-verify` |
| **Hysteria2 / HY2** | `hysteria2://`, `hy2://` | `hysteria2://password@server:port?sni=...#name` (归一化为 `hysteria2`) | `password` (`auth`), `sni`, `insecure` |
| **TUIC** | `tuic://` | `tuic://uuid:password@server:port?congestion_control=...#name` | `uuid`, `password`, `token` |
| **SOCKS5 / SOCKS** | `socks5://`, `socks://` | `socks5://user:password@server:port#name` (归一化为 `socks5`) | `server`, `port`, `user`, `password` |
| **HTTP / HTTPS** | `http://`, `https://` | `http://user:password@server:port#name` | `server`, `port`, `user`, `password` |

### 2.2 健壮的 Base64 容错解码与多格式探测流水线

`ParseClashFromBytes(data []byte)` 实现了一套自适应多阶段回退试探机制（Multi-Stage Probing Pipeline）：

```mermaid
flowchart TD
    A[输入字节流 data] --> B[清洗 UTF-8 BOM \xef\xbb\xbf 与首尾空白]
    B --> C{尝试 1: 直接解析为 Clash YAML}
    C -- 成功且节点 > 0 --> Out[输出 []model.Node]
    C -- 失败/为空 --> D{尝试 2: decodeBase64Safe 容错解码}
    D -- 成功解码 --> E{解码内容是否为 YAML?}
    E -- 是且节点 > 0 --> Out
    E -- 否 --> F{解码内容是否为多行 URI 清单?}
    F -- 包含合法节点 --> Out
    F -- 无合法节点 --> G{尝试 3: 直接按明文多行 URI 解析}
    D -- Base64 解码失败 --> G
    G -- 包含合法节点 --> Out
    G -- 无合法节点 --> Err[抛出复合解析错误: failed to parse valid proxy nodes]
```

#### Base64 容错解码 (`decodeBase64Safe`)
标准机场订阅下发往往存在排版换行符、无 Padding、URL-Safe 字符未转义等异构问题。系统按序测试四种解码器，并在必要时自动补齐尾部 `=`：
1. `base64.StdEncoding.DecodeString(s)`
2. `base64.RawStdEncoding.DecodeString(s)` (允许缺 Padding)
3. `base64.URLEncoding.DecodeString(s)` (兼容 `-` 与 `_`)
4. `base64.RawURLEncoding.DecodeString(s)`
5. 长度计算补全：`if m := len(s) % 4; m != 0 { s += strings.Repeat("=", 4-m) }`

### 2.3 占位节点、广告与公告过滤机制
在底层 YAML 提取器 `parseRawProxies` 与 URI 提取器中，执行了底线质量校验：
- **有效性硬性门禁**：`strings.TrimSpace(name) == ""`、`strings.TrimSpace(server) == ""` 或 `port <= 0` 的项被直接静默丢弃；
- **智能兼容键名映射**：
  - 服务器地址兼容 `server`、`address`、`host`、`ip`；
  - 认证凭证兼容 `password`、`uuid`、`auth`、`token`、`psk`；
  - 端口兼容 `int`、`int64`、`float64`、`string`、`uint`、`uint64` 跨类型提取；
- **顶层配置兼容**：支持 `proxies`、`Proxy`、`proxy` 三种大小写键名，以及根为直接列表的 YAML。

### 2.4 网络订阅抓取与防拦截客户端模拟
在 `ParseClashFromURL(subscribeURL string)` 中：
- 注入 HTTP 请求头，模拟成熟的客户端指纹，防止机场针对通用爬虫或未知 User-Agent 阻断或返回空列表：
  - `User-Agent: Clash.Meta; Clash/1.18.0; NodePilot/1.0`
  - `Accept: text/yaml, text/plain, application/json, */*`
- 超时保护：设定严谨的 `20s` HTTP 传输超时；
- 状态码检查：必须位于 `200 <= StatusCode < 300` 范围，否则显式携带 HTTP 状态报错。

---

## 三、双向正则过滤引擎 (What & How - Filtering Engine)

源码位置：[node_filter.js](../../app/frontend/src/js/node_filter.js)，[drawer_node_filter.html](../../app/frontend/src/fragments/drawer_node_filter.html)

### 3.1 核心匹配逻辑与文本拓扑
过滤引擎通过纯函数 `applyNodeFilters(rawNodes, rules)` 实现。每个节点构建包含三维信息的匹配目标文本：
$$\text{TargetText} = \text{node.name} + \text{" "} + \text{node.server} + \text{" "} + \text{node.type}$$

匹配遵循**双向约束机制**：
1. **正向包含 (Include)**：若配置了 `include` 正则，节点目标文本**必须匹配**该正则；未匹配者直接排除；
2. **反向排除 (Exclude)**：若配置了 `exclude` 正则，节点目标文本**严禁匹配**该正则；命中者直接排除；
3. **二者均未配置**：退化为直通透传，保留全部原始节点。

```mermaid
flowchart TD
    Node[待评估节点 node] --> GenText["生成匹配目标串: name + server + type"]
    GenText --> HasInc{是否配置了 Include 正则?}
    HasInc -- 是 --> TestInc{TargetText 是否匹配 Include?}
    TestInc -- 否 (未匹配) --> Reject["排除节点 (原因: 未匹配正向正则)"]
    TestInc -- 是 (匹配) --> HasExc{是否配置了 Exclude 正则?}
    HasInc -- 否 --> HasExc
    HasExc -- 是 --> TestExc{TargetText 是否匹配 Exclude?}
    TestExc -- 是 (命中排除) --> RejectExc["排除节点 (原因: 命中反向排除正则)"]
    TestExc -- 否 (未命中) --> Accept["保留节点 (放入过滤后生效列表)"]
    HasExc -- 否 --> Accept
```

### 3.2 大小写敏感控制与语法防御
- **大小写开关 (`Case-Insensitive`)**：前端抽屉提供复选框，勾选后正则标志为 `"i"`，取消后为 `""`（默认勾选）；
- **动态正则编译与沙盒容错**：在构建 `RegExp` 时包裹于 `try ... catch` 块中。若用户键入非法字符（如未闭合的括号 `(`），捕获语法异常并在抽屉内呈现红底警告提示（`#filter-error-msg`），系统降级不阻断其它操作，防止 UI 脚本崩溃。

### 3.3 预设过滤规则库设计
系统内置 10 种生产级经典规则预设（`FILTER_PRESET_LIBRARY`）：

| 规则 ID | 规则名称 | 正向包含正则 (`include`) | 反向排除正则 (`exclude`) | 设计目标与适用场景 |
| :--- | :--- | :--- | :--- | :--- |
| `builtin_clean_ads` | 🧹 剔除无效与广告 | *(不限)* | `(失效\|重新复制\|到期\|剩余\|官网\|通知\|公告\|网站\|群\|客服\|回国\|中国\|0\.1x)` | 清理机场流量提示、广告信息与不可用脏数据 |
| `builtin_ai_dedicated` | 🤖 AI/大模型专用 | `(美\|US\|United States\|日\|JP\|Japan\|新\|SG\|Singapore\|台湾\|TW\|韩\|KR\|英\|UK\|Claude\|OpenAI)` | `(香港\|HK\|Hong Kong\|0\.1x\|失效\|官网\|剩余\|到期\|公告)` | 排除绝大多数 AI 服务禁止的香港与无效节点，锁定支持地区 |
| `builtin_east_asia` | 🌏 东亚低延迟 | `(香港\|HK\|日本\|JP\|新加坡\|SG\|韩国\|KR\|台湾\|TW)` | `(失效\|官网\|剩余\|到期\|公告\|0\.1x)` | 锁定近场低延迟节点 |
| `builtin_hk_only` | 🇭🇰 仅保留香港 | `(香港\|HK\|Hong Kong\|🇭🇰)` | `(失效\|官网\|剩余\|到期\|公告\|0\.1x)` | 专门评测香港地区连通性 |
| `builtin_jp_only` | 🇯🇵 仅保留日本 | `(日本\|JP\|Japan\|东京\|大阪\|🇯🇵)` | `(失效\|官网\|剩余\|到期\|公告\|0\.1x)` | 仅评测日本机房 |
| `builtin_us_only` | 🇺🇸 仅保留美国 | `(美国\|US\|United States\|美\|洛杉矶\|硅谷\|纽约\|凤凰城\|🇺🇸)` | `(失效\|官网\|剩余\|到期\|公告\|0\.1x)` | 仅保留美国本土节点 |
| `builtin_sg_only` | 🇸🇬 仅保留新加坡 | `(新加坡\|SG\|Singapore\|狮城\|🇸🇬)` | `(失效\|官网\|剩余\|到期\|公告\|0\.1x)` | 仅评测新加坡狮城机房 |
| `builtin_streaming_unlock`| ⚡ 流媒体与解锁 | `(原生\|解锁\|流媒体\|NF\|Disney\|YouTube\|AI\|GPT\|ChatGPT)` | `(失效\|官网\|剩余\|到期\|公告)` | 筛选标注原生 IP 与具备流媒体/AI 解锁的节点 |
| `builtin_direct_iplc` | 🚀 专线与高防倍率 | `(专线\|IPLC\|IEPL\|BGP\|AIA)` | `(0\.1x\|0\.01x\|失效\|官网\|剩余\|到期)` | 仅保留高质量专线与内网互联节点 |
| `builtin_low_rate` | ⚡ 1x及以下倍率 | *(不限)* | `([2-9]x\|[1-9][0-9]x\|高倍\|2倍\|3倍\|5倍)` | 排除高倍率计费节点，避免评测跑耗过多订阅流量 |

### 3.4 规则库持久化与自定义管理机制
- **存储介质**：双层落盘，优先写入 SQLite `rule_library` 表，同时同步 `localStorage["nodepilot_filter_rule_library"]`；
- **CRUD 功能矩阵**：
  1. **检索**：支持对名称、描述、正向与反向正则的实时全字段模糊搜索；
  2. **套用 (Apply)**：点击规则库卡片，立即将正则注入主抽屉输入框，并触发即时匹配运算；
  3. **存为新规则 (Save Current)**：将右侧当前已调试完成的正则一键另存入规则库；
  4. **编辑与删除 (Edit/Delete)**：自定义规则支持就地修改或删除，内置规则支持修改，并提供“恢复出厂默认预设”按钮保障可逆性；
  5. **激活高亮状态同步**：实时对比输入框内容与库中每一项，精确高亮当前命中的规则项。

### 3.5 实时交互式匹配预览与排除归因标注
在用户键入正则的毫秒级周期内，`updateFilterPreview()` 遍历节点计算匹配分布：
- **状态统计指示**：底部与顶部实时呈现 `保留: X / 全部 Y 个 (已排除 Z)`；
- **保留项 (Kept Item)**：浅绿底色，显示 `🟢 [节点名称]`，附带 `保留` 徽章；
- **排除项 (Excluded Item)**：浅红底色、半透明并施加**中划线**，明确标注具体排除原因（如：`未匹配正向正则` 或 `命中反向排除正则`），为使用者提供直观的调试排查体验。

---

## 四、本地 SQLite 数据架构与状态同步机制 (What & How - Storage)

源码位置：[storage.go](../../engine/pkg/storage/storage.go)，[store.js](../../app/frontend/src/js/store.js)

### 4.1 嵌入式无 CGO SQLite 选型与连接池优化
- **驱动选型**：采用 `modernc.org/sqlite`，纯 Go 编写，完全摒弃 CGO。确保在 macOS、Windows、Linux 各平台交叉编译开箱即用，无外部 C 动态库链接依赖；
- **连接池与并发安全**：
  - SQLite 单文件多线程写冲突是常见故障源。仓储层配置 `SetMaxOpenConns(1)` 与 `SetMaxIdleConns(1)`，由 Go 运行时管理句柄排队；
  - 核心读写操作配合 Go `sync.RWMutex` 读写锁，保障内存态并发安全；
- **WAL 模式与性能调优 DSN**：
  ```
  _pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)
  ```
  - `journal_mode(WAL)`：写不阻塞读，读不阻塞写，大幅提升并发性能；
  - `synchronous(NORMAL)`：在 WAL 模式下兼顾掉电安全与高频 IO 吞吐；
  - `busy_timeout(5000)`：忙等待锁自动重试，避免发生 `database is locked`。

### 4.2 物理数据库路径跨平台解析
`DefaultDBPath()` 遵循各操作系统的标准规范：
1. 优先检查环境变量 `NODEPILOT_DB_PATH`；
2. 跨平台标准路径：`os.UserConfigDir()`
   - macOS: `~/Library/Application Support/NodePilot/nodepilot.db`
   - Windows: `%APPDATA%\NodePilot\nodepilot.db`
   - Linux: `~/.config/NodePilot/nodepilot.db`
3. 异常回退路径：`~/.nodepilot/nodepilot.db`。初始化时自动执行 `os.MkdirAll(dir, 0755)`。

### 4.3 核心表结构设计 (Schema)

```mermaid
erDiagram
    AIRPORTS ||--o{ BENCHMARK_HISTORY : "produces"
    AIRPORTS {
        text id PK "机场唯一标识"
        text name "机场展示名称"
        text url "订阅链接或本地文件路径"
        integer enabled "是否启用"
        text updated_at "最后更新时间 ISO-8601"
        text data_json "完整机场实体 JSON (含 rawNodes, filterRules, nodes)"
    }

    RULE_LIBRARY {
        text id PK "规则标识"
        text name "规则名称"
        text data_json "规则详情 JSON (include, exclude, desc)"
        text updated_at "更新时间"
    }

    APP_SETTINGS {
        text key PK "偏好项键"
        text value "偏好项值"
        text updated_at "更新时间"
    }

    BENCHMARK_LATEST {
        text key PK "主键固定为 'latest'"
        text data_json "控制台最新排行榜全量快照"
        text updated_at "更新时间"
    }

    BENCHMARK_HISTORY {
        integer id PK "自增主键"
        text batch_id "批次号"
        text airport_name "所属机场名称"
        text node_name "节点名称"
        text node_type "协议类型"
        text server "服务器主机"
        integer port "端口"
        text service_name "AI 测试服务名称"
        text ai_offer "业务提供商标识"
        text status "可用性状态"
        integer ping_ms "TCP 握手延迟"
        text ping_status "连通状态"
        real score "加权综合得分"
        real ttfb_ms "首包字节延迟"
        real ttft_ms "流式首 Token 延迟"
        real tps "每秒 Token 速率"
        real jitter_ms "抖动方差"
        real bandwidth_bps "上行带宽字节率"
        integer proxy_buffer_detected "是否缓冲代理"
        integer rank "本批次综合排名"
        text tested_at "测试时间 UTC ISO-8601"
        text tested_time_display "本地时间格式"
        text batch_time "批次对齐时间"
    }
```

**关键索引优化**：
- `idx_hist_tested_at`：加速按时间范围的历史聚合与图表滑动检索；
- `idx_hist_airport`：加速按机场维度的评测履历统计；
- `idx_hist_service`：加速特定 AI 模型（如 Claude / ChatGPT）的对比筛选；
- `idx_hist_batch`：加速批次级报告还原与排名分析。

### 4.4 原始节点与过滤生效节点的两层分离模型
为彻底防止“过滤后丢失原始节点数据”的严重缺陷，前端数据模型采用严格的双层存储设计：
- `airport.rawNodes`：物理存储从订阅源拉取到的**全量原始节点集合**，无论过滤规则如何变更，该集合保持不变；
- `airport.nodes`：由 `applyNodeFilters(airport.rawNodes, airport.filterRules)` 动态算出的**过滤后生效节点列表**；
- `airport.totalNodeCount`：原始节点总量（如 150）；
- `airport.nodeCount`：当前生效待测节点量（如 24）；
- 在卡片与表格中呈现为 `24/150`，点击可随时基于 `rawNodes` 重新调整过滤条件。

### 4.5 评测指标回写与时序历史批量事务写入
1. **指标回写 (`syncBenchmarkResultsToAirports`)**：
   - 每次测速完成后，前端将测速指标深度注入到对应机场节点的 `benchmarkResults[ai_offer]` 中，并选取最高得分记录为 `latestBenchmark`；
   - 包含：`status`, `ping_ms`, `score`, `ttfb_ms`, `ttft_ms`, `tps`, `jitter_ms`, `bandwidth_bps`, `tested_at`，实现离线状态下查看历史测速表现。
2. **时序历史批量入库 (`SaveRecords`)**：
   - 面对成百上千节点 × 多个 AI 服务的交叉矩阵任务，系统采用事务批处理写入：
   ```go
   tx, _ := s.db.Begin()
   stmt, _ := tx.Prepare("INSERT INTO benchmark_history (...) VALUES (...)")
   for _, r := range records { stmt.Exec(...) }
   tx.Commit()
   ```
   单次批处理可在数十毫秒内吞吐万级记录，彻底消除 IO 瓶颈。

### 4.6 前端 LocalStorage 与 SQLite 的平滑迁移与双轨同步
在应用冷启动初始化（`initSQLiteStorage()`）阶段：
1. **检查与读取**：从 SQLite 读取已有配置；
2. **首次自动无缝迁移**：若 SQLite 为空，但检测到历史版本 LocalStorage（`STORAGE_KEYS = ["nodepilot_airports_v2", "nodepilot_airports_v1", "nodepilot_airports"]`）存有老数据，自动将 LocalStorage 整体迁移入库 SQLite，随后释放 LocalStorage 空间；
3. **双轨同步备份**：日常运行时，写入优先持久化 SQLite，并在 LocalStorage 保留副本供极速同步渲染，实现桌面应用原生性能与 Web 响应式体验的兼顾。

---

## 五、配置与机场数据备份恢复体系 (Backup & Restore)

源码位置：[airport_backup.js](../../app/frontend/src/js/airport_backup.js)，[app.go](../../app/app.go)

### 5.1 JSON 备份结构设计
备份文件采用自说明的标准 JSON 格式：
```json
{
  "version": "1.0",
  "app": "NodePilot",
  "exportTime": "2026-11-18 11:30:00",
  "totalAirports": 2,
  "totalNodes": 128,
  "airports": [
    {
      "id": "1731901234567",
      "name": "主力极速机场",
      "type": "url",
      "url": "https://sub.airport.example/api/v1/client/subscribe?token=xxx",
      "filePath": "",
      "filterRules": {
        "include": "(香港|日本|美)",
        "exclude": "(0\\.1x|官网)",
        "caseInsensitive": true
      },
      "rawNodes": [ /* 全量节点原始定义与元数据 */ ],
      "nodes": [ /* 过滤生效节点 */ ],
      "totalNodeCount": 80,
      "nodeCount": 35,
      "status": "ok",
      "updatedAt": "2026-11-18 11:00:00"
    }
  ]
}
```

### 5.2 原生文件对话框与 Web Blob 双通道导出
- **优先原生通道**：调用 Wails `SaveFileDialog`，自动建议文件名 `nodepilot_airports_YYYYMMDD_HHMMSS.json`，由用户选取系统绝对路径，直接在 Go 端执行原子磁盘写入（`os.WriteFile`）；
- **容错回退通道**：若原生对话框未就绪或受阻，自动回退到浏览器标准 DOM API：创建 `Blob([jsonString], {type: "application/json"})` 并通过创建不可见 `<a>` 标签模拟触发系统下载。

### 5.3 智能导入合并与冲突处理策略
导入过程具备全自动校验与冲突消除策略：
1. **格式宽容校验**：同时兼容 `{ airports: [...] }` 复合对象与纯数组 `[...]` 根节点，防御空文件与非 JSON 文本；
2. **数据标准化与自动过滤激活**：对导入的每一个机场项，若存在 `filterRules`，重新调用 `applyNodeFilters` 重新计算 `nodes` 与 `nodeCount`；
3. **同名机场智能合并 (Smart Deduplication)**：
   - 遍历现有机场构建 `Name -> Airport` 哈希表；
   - 若导入机场与已有机场**同名**，继承其原有稳定 `id` 并全面覆盖更新节点与过滤规则；
   - 若导入机场为**新机场**，分配唯一 ID 直接追加；
4. **工作台联动激活**：导入完成后，系统自动将所有节点数大于 0 的机场纳入已选测速集合（`selectedAirportIds`），并更新侧边栏与主界面徽章。

---

## 六、测试固化验收断言 (Test Solidification & Acceptance Assertions)

为防止后续在重构、依赖升级或多平台迁移过程中产生特性漂移，以下制定强制性测试验收指标：

### 6.1 订阅解析引擎测试断言
| 测试用例目标 | 注入边界与输入特征 | 预期输出与断言要求 | 关联文件 |
| :--- | :--- | :--- | :--- |
| **标准 Clash YAML** | 包含 `proxies` 列表，含有 ss、socks5 节点，且夹杂缺失 server/port 的无效节点 | 忽略无效节点；输出的 `len(nodes) == 2`；`node[0].Port == 8388` | [clash_test.go](../../engine/pkg/parser/clash_test.go) |
| **大写 Proxy 键名** | YAML 根键为 `Proxy`，端口字段为字符串形式 `"8388"` | 成功解析；自动转换为整数 `8388`；`len(nodes) == 1` | [clash_test.go](../../engine/pkg/parser/clash_test.go) |
| **Base64 封装 YAML** | 标准 Base64 编码的完整 Clash YAML 字符串 | 成功探测出 Base64 并解出 YAML，输出节点类型与名称无误 | [clash_test.go](../../engine/pkg/parser/clash_test.go) |
| **Base64 多协议 URI** | 混合 `trojan://` 与 `vless://` 的多行链接，经 Base64 编码 | 成功解码并分流解析；提取密码、UUID、端口与 Fragment 节点名 | [clash_test.go](../../engine/pkg/parser/clash_test.go) |
| **Shadowsocks 双格式** | 包含新标准 `ss://base64(m:p)@host:port` 与旧标准 `ss://base64(m:p@host:port)` | 两种格式均能精准提取出密码与 `host:port`，`Type == "ss"` | [clash.go](../../engine/pkg/parser/clash.go) |
| **VMess JSON 解码** | `vmess://` 附带 base64 序列化 JSON（含 `ps`, `add`, `port`, `id`） | 正确映射 `Name = ps`, `Server = add`, `Password = id` | [clash.go](../../engine/pkg/parser/clash.go) |
| **BOM 与空白干扰** | 文件前置 UTF-8 BOM (`\xef\xbb\xbf`) 及大量换行回车 | 正常剥除 BOM 并成功解析，不报语法错误 | [clash.go](../../engine/pkg/parser/clash.go) |

### 6.2 正则过滤引擎测试断言
| 测试用例目标 | 规则输入特征 | 待过滤节点集合 | 预期输出与断言要求 |
| :--- | :--- | :--- | :--- |
| **无过滤规则透传** | `rules = null` 或 `include="", exclude=""` | 10 个任意节点 | 返回原数组切片，`result.length === 10` |
| **正向包含单向生效** | `include: "(香港|HK)"`, `exclude: ""` | 包含香港 3 个、日本 3 个、美国 4 个 | 仅返回 3 个香港节点，其他地区全部剔除 |
| **反向排除单向生效** | `include: ""`, `exclude: "(官网|0\\.1x)"` | 含有 2 个带“官网”节点、8 个正常节点 | 仅返回 8 个正常节点，2 个被排除 |
| **双向正则交叉碰撞** | `include: "(香港|HK)"`, `exclude: "(失效|0\\.1x)"` | 包含：`HK-01`, `HK-02-0.1x`, `US-01` | 仅保留 `HK-01`（`HK-02` 命中排除，`US-01` 未命中包含） |
| **大小写不敏感验证** | `include: "japan"`, `caseInsensitive: true` | 节点名包含 `JAPAN-Tokyo` 与 `jp-osaka` | 节点 `JAPAN-Tokyo` 必须成功匹配保留 |
| **大小写敏感开启** | `include: "japan"`, `caseInsensitive: false` | 节点名包含 `JAPAN-Tokyo` | 该节点必须被判定为未匹配并排除 |
| **非法正则语法容错** | `include: "[a-z("` (未闭合括号) | 任意节点列表 | 抛出语法警告，不触发页面死循环，UI 显示错误红字提示 |

### 6.3 SQLite 存储与状态流转测试断言
| 测试用例目标 | 操作行为 | 验收断言条件 | 关联文件 |
| :--- | :--- | :--- | :--- |
| **模式初始化** | `NewHistoryStorage(dbPath)` | 创建 5 张表与 4 个索引；检查 `GetStats().TotalRecords == 0` | [storage_test.go](../../engine/pkg/storage/storage_test.go) |
| **批量插入性能与事务**| 一次性调用 `SaveRecords` 插入多条记录 | 事务提交成功；`GetStats().TotalRecords` 严格等于插入总数 | [storage_test.go](../../engine/pkg/storage/storage_test.go) |
| **时序排序与分页** | `QueryRecords(limit=10, offset=0)` | 记录严格按 `tested_at ASC, id ASC` 顺序输出，支持分段拉取 | [storage_test.go](../../engine/pkg/storage/storage_test.go) |
| **全局偏好 Upsert** | 调用 `SetSetting` 针对同名 key 连续写入不同值 | 自动执行 `ON CONFLICT(key) DO UPDATE`，读取到最新值 | [storage_test.go](../../engine/pkg/storage/storage_test.go) |
| **机场无损全量存储** | `SaveAirportsJSON` 保存含 `rawNodes` 的 JSON 串 | `GetAirportsJSON` 读取后解析出的对象字段与原始一致，无截断 | [storage_test.go](../../engine/pkg/storage/storage_test.go) |
| **库清空与 VACUUM** | 调用 `ClearAll()` | `benchmark_history` 表行数归零，`TotalRecords == 0` | [storage_test.go](../../engine/pkg/storage/storage_test.go) |

### 6.4 备份导入导出测试断言
| 测试用例目标 | 场景与输入 | 验收断言条件 |
| :--- | :--- | :--- |
| **备份元数据完备性** | 执行 `exportAllAirports()` | 输出的 JSON 包含 `version="1.0"`, `totalAirports`, `totalNodes` 及完备的 `rawNodes` 属性 |
| **同名机场覆盖与 ID 继承** | 当前库存在 `机场A (id=1001)`，导入同名 `机场A (id=2002)` | 导入后总机场数不增加；`机场A` 的 ID 维持原有 `1001`，节点与过滤规则更新为新内容 |
| **非合法 JSON 拦截** | 导入被损坏的文件（如首行截断） | 触发警告模态框，提示 JSON 解析失败，现有数据分毫不动 |
| **全选与计数同步** | 导入包含可用节点的多个机场 | `selectedAirportIds` 自动纳管导入的机场，侧边栏与顶部节点总数徽章即时累加刷新 |

---

> **文档维护原则**：任何对订阅解析逻辑、正则过滤行为或 SQLite 表结构的变更，必须同步更新本文档与对应单元测试用例。禁止未更新规约私自修改核心接口行为。
