# 关键原型流 (Prototype User Flows)

本页定义 Figma 原型和交互演示中必须覆盖的关键用户流。它不是完整产品测试用例，而是最小原型集合。

## 1. 使用目标

关键原型流用于验证:

- 信息架构是否顺
- 页面跳转是否自然
- 覆盖层与主页面关系是否清楚
- 高风险动作的交互路径是否成立

## 2. Flow 1: 进入 Workspace 并开始线程

### 起点

- `/workspaces`

### 终点

- `/workspaces/:workspaceId` 空态工作台

### 必经步骤

1. 查看 workspace registry
2. 选择或创建 workspace
3. 进入工作台空态
4. 聚焦 composer 或点击 suggestion card

### 原型检查点

- 进入工作台后主焦点是否清晰
- 空态与普通目录页是否有明显区分

## 3. Flow 2: 从空态进入线程主态

### 起点

- 工作台空态

### 终点

- 线程主态

### 必经步骤

1. 输入 prompt 或选择建议卡片
2. 进入线程时间线
3. composer 保持可见

### 原型检查点

- 时间线是否像“持续任务流”而不是普通聊天弹窗
- composer 是否稳定停靠

## 4. Flow 3: 线程执行 -> 审批 -> Diff

### 起点

- 线程主态

### 终点

- 审批完成，打开 diff panel

### 必经步骤

1. 线程中出现执行 block
2. 出现审批卡
3. 用户做 accept / decline 决策
4. 结果进入 diff review

### 原型检查点

- 审批是否被看作主线程的一部分
- diff 是否是附加面板而不是替代页面
- 高风险动作是否有足够上下文

## 5. Flow 4: 打开底部终端并返回主线程

### 起点

- 线程主态或执行态

### 终点

- 终端折叠后回到主线程

### 必经步骤

1. 打开 bottom terminal
2. 查看日志/输出
3. 调整高度或切换 tab
4. 折叠终端

### 原型检查点

- 终端打开时线程是否仍保持上下文可读
- 折叠后是否恢复主任务视线

## 6. Flow 5: 创建自动化

### 起点

- `/automations` 模板目录页

### 终点

- `/automations/:automationId`

### 必经步骤

1. 浏览模板
2. 点击 `New Automation` 或从模板进入创建 modal
3. 填写 title / prompt / workspace / schedule / model / reasoning
4. 创建成功并进入详情页

### 原型检查点

- 创建流程是否应该是 modal 而不是全页
- 从目录到详情的跳转是否自然

## 7. Flow 6: 自动化详情 -> Recent Runs

### 起点

- 自动化详情页

### 终点

- 打开某次 run 的 summary / logs / details

### 必经步骤

1. 查看右侧状态摘要
2. 在 recent runs 中选择一项
3. 切换 summary / logs / details

### 原型检查点

- 主内容和侧栏职责是否清楚
- run history 是否足够可扫描

## 8. Flow 7: 浏览技能目录

### 起点

- `/skills`

### 终点

- 同一路由下完成搜索、切换 workspace scope、浏览 installed/remote

### 必经步骤

1. 选择 workspace
2. 输入搜索词
3. 对比 installed 与 remote sections

### 原型检查点

- 左侧 rail 是否承担“scope + filters”角色
- 目录项是否足够清晰可扫读

## 9. Flow 8: 浏览 Runtime Inventory 并执行动作

### 起点

- `/runtime`

### 终点

- 完成一次 runtime action 并看到结果反馈

### 必经步骤

1. 选择 workspace
2. 查看 inventory sections
3. 执行一次 plugin / search / feedback 相关动作
4. 查看 inline feedback

### 原型检查点

- mode rail 与主区的职责是否稳定
- 动作结果是否就地反馈

## 10. Flow 9: 进入设置中心并切换 section

### 起点

- AppShell 任意主页面

### 终点

- `/settings/*`

### 必经步骤

1. 从主应用进入设置
2. 查看左侧 section nav
3. 在 `General -> Appearance -> Config` 间切换
4. 返回主应用

### 原型检查点

- 设置中心是否被感知为独立模式
- 返回主应用路径是否明确

## 11. Flow 10: 恢复与错误路径

### 起点

- 某一页面 error / empty / not found

### 终点

- 用户被引回可恢复主路径

### 必经步骤

1. 出现 inline notice 或 route error
2. 使用 retry / go back / go home
3. 恢复到可继续工作的页面

### 原型检查点

- 错误路径是否可恢复
- notice 是否只做提示，不强占主任务

## 12. 原型优先级

建议原型优先级:

- **P0**: Flow 1, 2, 3, 5, 9
- **P1**: Flow 4, 6, 7, 8
- **P2**: Flow 10

如果时间有限，至少做完 P0。

## 13. 原型交付规则

每条 flow 至少要在 Figma 中给出:

- 起点 frame
- 中间关键状态
- 终点 frame
- overlay 打开/关闭
- 桌面版主要路径

工作台核心流建议额外补:

- 一个移动端路径

## 14. 关联文档

- [Figma 交付包说明](./FIGMA_HANDOFF_PACKAGE.md)
- [页面蓝图](./PAGE_BLUEPRINTS.md)
- [低保真线框说明](./LOW_FIDELITY_WIREFRAMES.md)

---
*原型不需要模拟一切，但必须覆盖真正影响结构判断和风险判断的主流程。*
