# Git Workflow & Relative Path Rules

## 1. 绝对路径禁令
- 所有代码注释、文档、Markdown 引用、CI 脚本必须严格采用相对于当前项目根目录的**相对路径**。
- 严禁在任何可提交文件中硬编码宿主机本地绝对路径（如 `/Volumes/...` 或 `/Users/...`）。

## 2. Git 操作自治护栏
- AI 严禁自动执行 `git add`, `git commit`, `git push`, `git restore` 等可能改变 Git 状态的操作。
- 仅允许执行 `git status` 等只读探针命令。

