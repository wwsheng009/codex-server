# 数据表格与列表 (Data Tables & Lists)

本页区分两类模式:

- **原生数据表**: 优先遵循 WAI 的表格语义与可访问结构。
- **高交互数据网格**: 支持锁列、批量操作和虚拟滚动，但应明确这属于产品级 grid，不等同于原生 `<table>`。

## 1. 核心设计概念 (Core Design Concepts)

在 Codex 中，表格不仅是数据的展示容器，更是执行批量任务与深度分析的**交互式仪表盘**。

### 1.1 "Bento Grid" 响应式卡片 (Bento Grid Cards)
当屏幕宽度不足以承载多列表格时，系统应自动将行数据转换为“便当盒”风格的卡片流。
- **视觉特征**: 模块化、非对称但平衡的布局，利用背景色差异区分元数据与核心内容。
- **交互**: 卡片应保持与表格行一致的批量选择状态。

### 1.2 多轴锁定 (Multi-axis Locking)
在处理超宽数据集（如：多列特征对比）时，必须支持灵活的锁定机制。
- **首列锁定 (Row Header Lock)**: 滚动时锁定标识符列（如：ID 或名称）。
- **表头锁定 (Sticky Header)**: 垂直滚动时保持上下文。
- **视觉反馈**: 锁定区域应有微弱的内阴影 (`box-shadow: inset`) 以提示物理边界。

### 1.3 搜索高亮 (Search Highlighting)
任何针对表格的过滤操作必须在结果中提供实时视觉反馈。
- **精准匹配**: 使用 `--color-highlight-bg` 背景色包裹匹配字符。
- **模糊匹配**: 匹配字符加粗处理，而非背景高亮，以减少视觉杂讯。

---

## 2. 显示密度控制 (Display Density)

系统支持动态切换密度，以适应不同的工作流程（审计型 vs. 概览型）。

| 密度模式 (Mode) | 行高 (Row Height) | 字号 (Font Size) | 典型用途 |
| :--- | :--- | :--- | :--- |
| **Compact (紧凑)** | 32px | 12px / 0.75rem | 大规模数据对比、代码审计。 |
| **Comfortable (舒适)** | 48px | 14px / 0.875rem | 日常任务管理、日志浏览（默认）。 |
| **Spacious (宽敞)** | 64px | 16px / 1rem | 高密度多媒体展示、移动端适配。 |

### 密度 Token 映射 (Token Mapping)
- `Compact`: `--table-cell-padding: 4px 8px;`
- `Comfortable`: `--table-cell-padding: 12px 16px;`

---

## 3. 交互模式 (Interactive Patterns)

### 3.1 渐进式披露 (Progressive Disclosure)
严禁在初始加载时展示所有细节。
- **钻取 (Drill-downs)**: 点击行触发侧滑窗 (Drawer) 或展开子行 (Expanded Row)，展示 JSON 详情或关联关系。
- **Hover 预览**: 对于链接字段，支持 300ms 延迟后的气泡预览。

### 3.2 虚拟滚动 (Virtual Scrolling)
当数据集足够大、渲染成本明显时，应考虑启用虚拟滚动；`100 行` 只是经验阈值，不是行业标准。
- **缓冲区 (Overscan)**: 预渲染视口外 5-10 行，避免快速滚动时的白屏。
- **动态行高**: 支持基于内容的行高计算，确保文本不被截断。

### 3.3 批量操作 (Bulk Actions)
- **多选逻辑**: 支持 `Shift + Click` 跨行选择。
- **浮动操作栏 (Floating Toolbar)**: 选中至少一项后，在屏幕底部或表头上方滑出批量操作菜单（删除、导出、标签映射）。

---

## 4. 视觉指引 (Visual Cues)

- **空状态 (Empty States)**: 必须包含明确的行动指引（如：“创建第一条记录”按钮）。
- **加载态 (Loading)**: 优先使用骨架屏 (Skeleton Screens) 替代全局 Spinner，保持布局稳定。
- **排序状态 (Sorting)**: 激活排序列时，表头背景色应有微调，并显示升序/降序图标。

---
*规范依据: [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/) / [APG Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) / [统一来源基线](./UX_AUTHORITY_BASELINE.md)*
*审校: 2026-03-21*
