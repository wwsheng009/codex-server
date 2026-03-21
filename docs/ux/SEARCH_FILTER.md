# 搜索与过滤设计 (Search & Filter Design)

本页以可访问搜索建议和结果公告为外部基线，防抖时长与排序策略属于 Codex 的工程预算和产品约定。

## 1. 核心交互模式 (Core Interaction Patterns)

搜索是 Codex 工作台的中枢系统，必须支持极速响应与精准定位。

### 1.1 分面搜索与可移除标签 (Faceted Search with Tags)
- **多维度过滤**: 侧边栏提供分面（Facet）选择（如：状态、创建者、文件类型）。
- **活动标签 (Active Filters)**: 在搜索框下方实时展示当前激活的过滤器。
- **快速移除**: 每个标签应包含一个“移除”图标 (`--icon-close`)，点击后过滤器立即失效，列表重新计算并自动聚焦到第一个结果。

### 1.2 AI 辅助自动建议 (AI-assisted Auto-suggestions)
- **语义建议**: 搜索框应根据用户输入提供 AI 生成的建议（如：基于自然语言的语义搜索建议）。
- **历史记录**: 优先展示最近使用的搜索词条。
- **键盘集成**: 使用 `Up/Down` 箭头在建议列表中导航，`Enter` 键确认选择。

---

## 2. 实时反馈机制 (Real-time Feedback)

### 2.1 实时高亮 (Real-time Highlighting)
- **增量匹配**: 随着用户输入，搜索结果列表应实时更新，并高亮匹配的字符串。
- **高亮策略**: 使用对比色背景 (`--color-highlight-bg`) 或文本强调 (`--color-highlight-text`)。
- **延迟 (Debouncing)**: `150ms-300ms` 是常见产品预算，用于平衡输入流畅度、渲染压力与请求量；不是外部规范的固定数值。

### 2.2 搜索结果统计公告 (Count Announcements)
- **视觉统计**: 在结果列表顶部显示明确的数量（如：“共找到 1,248 个匹配项”）。
- **无障碍通报**: 使用 `aria-live="polite"` 同步通报结果数量变化，确保盲人用户感知搜索进度。

---

## 3. 高级过滤语法 (Advanced Filter Syntax)

针对高级开发者，系统支持命令行风格的过滤语法。

| 语法示例 | 说明 | 效果 |
| :--- | :--- | :--- |
| `status:failed` | 属性过滤 | 仅显示状态为失败的记录。 |
| `author:@me` | 环境变量 | 仅显示当前用户创建的记录。 |
| `created:>2024-01-01` | 比较运算符 | 仅显示 2024 年之后的记录。 |
| `"error message"` | 精确匹配 | 仅显示包含该精确字符串的记录。 |

---

## 4. 空状态与指引 (Empty States & Guidance)

- **模糊搜索改进**: 如果没有精确匹配，系统应尝试提供“你是不是想找...”的纠错建议。
- **清空操作**: 搜索框右侧必须提供“一键清空 (Clear All)”按钮，将搜索词和所有分面过滤器重置为默认值。

---
*规范依据: [APG Combobox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) / [WCAG 2.2](https://www.w3.org/TR/WCAG22/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
