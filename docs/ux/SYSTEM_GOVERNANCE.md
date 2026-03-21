# 系统治理规范 (System Governance)

## 1. 语义命名结构 (4-Layer Semantic Structure)

| 层级 (Layer) | 定义 (Definition) | 示例 (Example) |
| :--- | :--- | :--- |
| **Foundations** | 全局核心属性 (Brand & Core) | `colors.brand.primary`, `typography.base` |
| **Tokens** | 语义化设计变量 (Semantics) | `color.background.surface`, `spacing.stack.md` |
| **Components** | 单一职能 UI 单元 (Units) | `Button`, `TextField`, `Avatar` |
| **Patterns** | 跨场景业务逻辑组合 (Logic) | `FilterBar`, `CommandPalette`, `ChatInterface` |

### 1.1 命名约定
- **Tokens**: `[Category]-[Type]-[Subtype]-[State]` (e.g., `button-bg-primary-hover`).
- **Components**: PascalCase (e.g., `CodeEditor`).

---

## 2. 版本管理与生命周期 (Versioning & Lifecycle)

### 2.1 SemVer 规范
设计系统遵循语义化版本控制 (Semantic Versioning)。
- **Major (1.0.0)**: 包含不兼容的 API 更改（如：删除了某个 Token，彻底重构了组件库）。
- **Minor (0.1.0)**: 向后兼容的功能性新增（如：新增了一个组件，或在现有组件中添加了可选 Props）。
- **Patch (0.0.1)**: 向后兼容的 Bug 修复或微小的样式调整。

### 2.2 组件下线计划 (Sunsetting Plan)
对于过时或冗余的组件，必须遵循“三阶段下线”原则：
1. **Deprecated (Stage 1)**: 组件在文档中被标记为废弃，并在开发环境下发出控制台警告。停止新功能的开发。
2. **Maintenance-Only (Stage 2)**: 仅接受关键安全补丁。开发者应在此阶段完成迁移。
3. **Removed (Stage 3)**: 组件正式从主包中移除。

---

## 3. 文档对齐规则 (Documentation Parity)

### 3.1 源代码与文档的一致性
- **零差异原则 (Zero Parity Gap)**: 组件的代码变更（Props 修改、插槽调整）必须在合并到 `main` 分支的同时，同步更新对应的 `docs/*.md` 文件。
- **示例驱动 (Example-Driven)**: 每一个组件文档必须包含至少一个可运行/可演示的代码片段。

---

## 4. 治理流程 (Governance Workflow)
1. **提议 (RFC)**: 通过 GitHub Issue 发起新的组件或 Token 提议。
2. **审核 (Review)**: 由设计、前端及 UX 团队共同审核一致性与必要性。
3. **实现 (Impl)**: 进入开发与测试环境。
4. **发布 (Release)**: 更新变更日志，并同步升级设计工具（如 Figma）中的组件库。

---
*规范依据: [Semantic Versioning 2.0.0](https://semver.org/) / [Design Tokens Format Module 2025.10](https://www.designtokens.org/tr/drafts/format/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
