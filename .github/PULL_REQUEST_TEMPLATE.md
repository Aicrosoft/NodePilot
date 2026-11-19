## 变更概述 (Summary)

请在此简要概括本次 Pull Request 的核心动机与改动内容。

- 关联 Issue: 解决 / 关联 #（如 `Closes #123` 或 `Relates to #456`）

---

## 变更类型 (Type of Change)

请勾选符合本次 PR 的类型：
- [ ] 🐛 **缺陷修复 (Bugfix)**：修复现有已知问题且不引入破坏性变更
- [ ] ✨ **新特性 (Feature)**：新增功能且不破坏向下兼容性
- [ ] ⚡️ **性能优化 (Performance)**：改进运行时吞吐、时延或内存占用
- [ ] ♻️ **架构重构 (Refactoring)**：改善内部结构而不改变外部可观测行为
- [ ] 📝 **文档补充 (Documentation)**：修改 README、FEATURES、CHANGELOG 等文档
- [ ] 🧪 **测试用例 (Tests)**：新增或更新单元测试与契约断言

---

## 改动清单 (Key Changes)

- 
- 
- 

---

## 验证与测试 (Verification & Testing)

请说明你在本地如何验证这些改动：
- [ ] Go 单元测试通过 (`(cd engine && go test ./...)` 与 `(cd app && go test ./)`)
- [ ] 前端测试通过 (`(cd app/frontend && npm test)`)
- [ ] 本地桌面客户端编译构建通过 (`wails build`)
- [ ] 核心模型不可篡改黄金测试通过 (`engine/pkg/model/types_golden_test.go`)

---

## 贡献自检清单 (Checklist)

- [ ] 我的代码遵循项目的 Clean Architecture、单一职责与高内聚低耦合原则；
- [ ] 若涉及新特性或变更，已在 `changes/` 与各单元 `FEATURES.md` 中完成记录；
- [ ] 未在代码中硬编码任何 API 密钥、私有证书或敏感开发环境凭据；
- [ ] 提交历史清晰，符合标准 Git Conventional Commits 规范。
