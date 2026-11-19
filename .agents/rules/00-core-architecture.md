# Core Architecture & Design Guardrails

## 1. 架构组织与边界
- 遵循第一性原理，核心网络评测引擎位于 `engine/`，与上层 UI/CLI/文档彻底解耦。
- 坚持高内聚、低耦合，模块按功能领域划分（`model`, `parser`, `probe`, `runner`, `scorer`, `exporter`）。
- 控制代码圈复杂度，函数内逻辑嵌套深度禁止超过 3 层。

## 2. 状态与接口隔离
- 严格将网络底层连通性与 HTTP 401/403 鉴权状态解耦，禁止将鉴权异常粗暴判定为网络故障。
- 采用多态状态机（Available, Authentication Required, Restricted, Timeout, Unavailable）。
- 接口保持 Role Interface 细粒度定义（如 `ContextDialer`）。

## 3. 前端交互与弹窗分流规范
- **右侧滑出抽屉 (Slide-over Drawer)**：凡包含列表、表格、多字段表单、代码/长文本编辑器、多维度配置等高信息密度内容，统一从右侧滑出并占满垂直高度，右上角提供关闭按钮，左侧蒙层点击可关闭。
- **居中紧凑对话框 (Compact Modal Dialog)**：凡消息操作（如删除确认、清空确认等仅含简短提示文字与确认/取消按钮、无列表、无表单的操作），严禁从右侧弹出，必须采用屏幕居中的紧凑弹出式对话框。
- **弹出式提示 UI (Toast / Notification UI)**：系统状态反馈、操作成功/失败、警告等纯消息提示，统一使用浮动弹出式提示条（Toast），自动淡出或可手动关闭，绝不阻断界面上下文。

