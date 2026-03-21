# 设计验收清单 (Design Acceptance Checklist)

本页用于设计评审和实现前验收。目标不是评价“好不好看”，而是判断当前交付是否已经达到**可施工**标准。

## 1. 使用方法

任一页面、组件或整套设计交付进入实现前，至少要过以下三层检查:

1. **结构层**: IA、页面结构、组件层级是否明确
2. **状态层**: 空态、加载态、错误态、异步态是否明确
3. **系统层**: token、无障碍、响应式、文案是否对齐系统

## 2. IA 验收

- 是否明确页面对应的路由和壳层
- 是否明确一级导航、局部导航和全局入口的边界
- 是否说明弹层与页面的边界
- 是否说明桌面和移动端的导航重排方式
- 是否与 [IA_NAVIGATION.md](./IA_NAVIGATION.md) 一致

不通过示例:

- 把 diff panel 画成独立页面，但没有说明为什么要路由化
- 让设置页与工作台混用同一导航结构

## 3. 页面蓝图验收

- 是否存在页面目标说明
- 是否给出页面区域结构图
- 是否给出主 CTA 和次 CTA
- 是否覆盖空态、loading、error、success
- 是否说明哪些区域滚动、哪些区域固定
- 是否与 [PAGE_BLUEPRINTS.md](./PAGE_BLUEPRINTS.md) 一致

不通过示例:

- 只给一张“正常态”页面稿
- 未说明 composer、terminal、diff 之间的关系

## 4. 内容模型验收

- 是否明确主对象和页面主语
- 是否标出 P0 / P1 / P2 字段
- 是否说明长文本、路径、时间和状态的展示方式
- 是否能映射回现有 API 类型或系统对象
- 是否与 [UI_CONTENT_MODEL.md](./UI_CONTENT_MODEL.md) 一致

不通过示例:

- 卡片上只写“标题/描述/状态”占位，但没定义真实字段来源

## 5. 组件验收

- 是否明确组件名称和职责
- 是否有默认态、焦点态、异步态、错误态
- 高风险组件是否有 warning / danger / approval-required 态
- 是否与 [COMPONENT_STATE_MATRIX.md](./COMPONENT_STATE_MATRIX.md) 一致
- 是否明确组件与容器的边界

不通过示例:

- 只画按钮默认态
- 只画 ThreadRow 正常态，没有重命名、归档、审批状态

## 6. Token 与视觉系统验收

- 是否使用现有 token 命名空间
- 是否能映射回 `frontend/src/styles/tokens.css`
- 是否没有随意引入 page-only 颜色值
- light / dark 是否都考虑
- 至少一种替代色主题是否验证
- reduced motion 是否说明降级策略
- 是否与 [DESIGN_TOKENS_SOURCE.md](./DESIGN_TOKENS_SOURCE.md) 和 [THEME_SYSTEM.md](./THEME_SYSTEM.md) 一致

不通过示例:

- 设计稿新增 12 个临时颜色，但没有 token 归属
- 焦点环只在默认主题可见

## 7. 交互验收

- hover、active、focus-visible 是否明确
- 异步响应是否有及时反馈
- 错误是否给出恢复路径
- 高风险动作是否有审批或确认机制
- 是否与 [UX_INTERACTION.md](./UX_INTERACTION.md) 和 [INTERACTIVE_ORCHESTRATION.md](./INTERACTIVE_ORCHESTRATION.md) 一致

## 8. 无障碍验收

- 是否支持全键盘操作
- 焦点顺序是否合理
- 焦点环是否可见
- 颜色是否不是唯一状态表达方式
- 弹层是否有焦点陷阱与返回逻辑
- 搜索、列表、表格是否有语义和状态公告
- 是否与 [ACCESSIBILITY_DETAIL.md](./ACCESSIBILITY_DETAIL.md) 一致

## 9. 响应式与移动端验收

- 是否给出窄屏重排
- Sidebar / settings nav / diff / terminal 是否有移动端方案
- hover-only 行为是否有移动端替代
- 触控目标是否足够大
- 是否与 [MOBILE_ADAPTATION.md](./MOBILE_ADAPTATION.md) 一致

## 10. 文案验收

- 页面和组件标签是否使用系统术语
- 是否避免模糊动作词
- AI 相关内容是否有透明度和可纠正路径
- 错误文案是否包含事实、原因和建议
- 是否与 [UI_WRITING.md](./UI_WRITING.md) 一致

## 11. 工作台专项验收

对 `/workspaces/:workspaceId`，额外检查:

- 是否同时覆盖空态、线程态、执行态、审批态、diff 态、terminal 态
- composer 是否始终有稳定定位
- 时间线 block 是否定义统一骨架
- 审批是否作为主线程的一部分，而不是旁路页面
- right panel 和 terminal 的收放逻辑是否明确

## 12. 设置中心专项验收

对 `/settings/*`，额外检查:

- 左侧设置导航是否稳定
- 内容区是否允许表单 / 列表 / 编辑器混排
- 返回主应用路径是否明确
- workspace scope 是否被说明

## 13. 目录页专项验收

对 `/automations`, `/skills`, `/runtime`，额外检查:

- 是否区分目录态和对象态
- 搜索、筛选、刷新、空态是否都定义
- 卡片型和行型资源项是否都有状态稿

## 14. 评分建议

可以按三档给出评审结论:

- **Ready**: 可直接进入实现
- **Needs Revision**: 主结构成立，但缺状态或内容模型
- **Not Buildable**: 仍停留在视觉概念阶段

## 15. 最低通过条件

要达到“可实现”最低标准，至少必须满足:

- 路由和壳层明确
- 页面结构明确
- 主对象与字段明确
- 组件关键状态明确
- token 归属明确
- a11y / responsive 有说明

少任何一项，都不应直接进入开发。

## 16. 关联文档

- [信息架构与导航](./IA_NAVIGATION.md)
- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [低保真线框说明](./LOW_FIDELITY_WIREFRAMES.md)
- [组件状态矩阵](./COMPONENT_STATE_MATRIX.md)
- [UI 内容模型](./UI_CONTENT_MODEL.md)
- [设计 Token 源规范](./DESIGN_TOKENS_SOURCE.md)

---
*设计评审如果没有一份统一清单，最后通常会把结构问题拖到开发阶段暴露。*
