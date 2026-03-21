# 无障碍设计详情 (Accessibility Details)

本页以 **WCAG 2.2 AA** 与 **WAI-ARIA Authoring Practices Guide (APG)** 为最低基线。以下规则分为两类:

- **规范性要求**: 直接来自 W3C/WAI。
- **产品实现要求**: Codex 在这些规范之上的默认做法。

## 1. WAI-ARIA / APG 对齐实践

### 1.1 动态状态声明 (aria-live)

- **最小暴露原则**: 仅对用户无法从视觉上稳定感知、但又需要及时知道的状态变化使用 `aria-live`。
- **`polite` 用于状态消息**: 如“保存成功”“搜索结果已更新”“后台任务已完成”。
- **`assertive` 仅用于阻塞性错误**: 例如必须立即中断当前流程的失败、权限拒绝或不可恢复故障。
- **结果数量公告**: 搜索或过滤时，优先维护一个专门的状态区域来播报数量变化，而不是反复朗读整个结果列表。

### 1.2 语义化表格结构 (Semantic Tables)

- **优先原生 HTML**: 真正的数据表优先使用 `<table>`、`<th>`、`<td>`；只有在交互复杂到超出原生表格能力时，才考虑 `grid` / 自定义复合组件。
- **表头关系必须可计算**: 简单表格使用 `scope="col"` / `scope="row"`；复杂表格可补充 `id` / `headers`。
- **排序状态可编程暴露**: 激活排序列必须更新 `aria-sort`，不能只靠箭头图标或颜色区分。

## 2. 焦点管理 (Focus Management)

全键盘操作是 Codex 的核心能力，因此焦点流必须稳定、可见、可恢复。

### 2.1 模态框焦点陷阱 (Focus Traps)

- **打开即入场**: 对话框打开后，焦点必须进入弹层内部。
- **循环导航**: `Tab` 和 `Shift+Tab` 必须在弹层内形成闭环，防止焦点落到底层页面。
- **关闭即返回**: 弹层关闭后，焦点应回到触发它的元素；若触发元素已不存在，则回到最符合工作流的下一个元素。

### 2.2 快速跳过链接 (Skip Links)

- **必须存在主内容跳转**: 页面顶部提供 `Skip to main content` 类链接，指向主内容容器 ID。
- **仅在键盘进入时显现**: 默认可视觉隐藏，但在首次 `Tab` 时必须可见且可操作。

### 2.3 视觉焦点环 (Focus Ring)

- **不得无替代地移除轮廓**: 禁止使用 `outline: none` 后不补焦点指示。
- **焦点必须可见且独立于选中态**: 焦点指示和“选中/激活”视觉状态不能混为一体。
- **保持外扩空间**: 使用 `outline-offset` 或外圈 ring，避免焦点被边框、阴影或裁剪遮挡。

## 3. 对比度与重排基线 (Contrast and Reflow)

### 3.1 核心对比度指标

| 元素类型 | 最低要求 | 说明 |
| :--- | :--- | :--- |
| **普通文本** | **4.5:1** | 正文、描述、辅助文字。 |
| **大号文本** | **3.0:1** | 大标题或粗体大字号文本。 |
| **非文本 UI / 焦点指示** | **3.0:1** | 边框、图标、焦点环、图形控件。 |

### 3.2 文本缩放与重排

- **文本缩放**: 文本在 200% 缩放下仍应可读且功能完整。
- **重排优先**: 主要内容不应因为缩放而强迫用户进行横向阅读。
- **行高建议**: 正文 `line-height` 建议约为 `1.5`；这是可读性工程建议，不是替代 WCAG 判定的标准。

## 4. 运动与减弱动画 (Reduced Motion)

- **尊重系统偏好**: 必须响应 `prefers-reduced-motion: reduce`。
- **优先移除非必要运动**: 大位移、缩放、视差和连续脉冲动画在减弱模式下应禁用或替换为更稳定的 `opacity` / `color` 变化。
- **状态不依赖动效**: 即使完全关掉动画，用户也必须能理解“已展开”“正在加载”“保存完成”等状态。

## 5. 规范依据 (Authority)

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
- [APG: Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [APG: Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [WCAG Technique C39: Using prefers-reduced-motion](https://www.w3.org/WAI/WCAG21/Techniques/css/C39)
- [统一来源基线](./UX_AUTHORITY_BASELINE.md)

---
*审校: 2026-03-21*
