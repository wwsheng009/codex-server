# `codex-server` workspace 级 turn policy metrics 视图设计与落地对照

更新时间：2026-04-09

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-api-and-ui-usage-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\system-design.md`

## 1. 文档目标

这份文档最初创建于 2026-04-08，原意是讨论：

- 既然后端已经能返回 workspace 级 `turn-policy-metrics`
- 那前端应该如何把这个视图真正摆出来

截至 2026-04-09 复核，文中的大部分首版建议已经落地，因此这里改为：

- 保留首版设计思路
- 同时补充“当前已实现了什么”
- 明确哪些仍然只是后续建议

## 2. 当前现状

### 2.1 后端能力已经具备

当前接口：

- `GET /api/workspaces/{workspaceId}/turn-policy-metrics`

只要不传 `threadId`，返回的就是 workspace 级 summary。

因此首版 workspace 视图并不要求再新增后端协议。

### 2.2 前端现在同时展示了 thread 级与 workspace 级视图

当前 thread 页面右侧 rail 展示：

- `Recent Policy Decisions`
- `Turn Policy Metrics`

落点文件：

- `frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx`
- `frontend/src/pages/thread-page/ThreadWorkbenchRailTurnPolicyDecisionsSection.tsx`
- `frontend/src/pages/thread-page/ThreadWorkbenchRailTurnPolicyMetricsSection.tsx`

当前 `WorkspacesPage` 也已经展示：

- `Turn Policy Overview`
- `Workspace Recent Policy Decisions`

落点文件：

- `frontend/src/pages/WorkspacesPage.tsx`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyOverview.ts`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyRecentDecisions.ts`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyOverviewSection.tsx`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyRecentDecisionsSection.tsx`

### 2.3 `WorkspacesPage` 已经有自己的头部指标带

当前：

- `frontend/src/pages/WorkspacesPage.tsx`

已经有 `mode-metrics` 头部指标卡，显示：

- `Total`
- `Healthy`
- `Roots`
- `Activity`

这说明 workspace registry 页面本身已经有“概览指标”的视觉语言，但它的头部空间很有限。

## 3. 设计目标

workspace 级 turn policy 视图首版应该满足四个目标：

- 让操作者快速知道某个 workspace 的自动纠偏质量是否健康
- 不把 thread 级 rail 原样复制到 workspace 页面
- 尽量复用现有后端接口和前端样式
- 能自然跳转到具体 thread 做 drill-down

## 4. 非目标

首版不应该同时做下面这些事情：

- 复杂时间序列图
- thread 排行榜
- policy 明细表格
- 自定义时间窗口
- 跨 workspace 汇总总表

这些能力都可以留到后续阶段，否则很容易让首版页面变成半成品监控台。

## 5. 推荐落点

### 5.1 不推荐直接塞进 `mode-metrics`

不建议把 turn policy 指标直接塞进 `WorkspacesPage` 头部现有的 `mode-metrics` 带。

原因很直接：

- 头部指标位本来就承担全局 registry 概览
- turn policy 指标天然是单个 workspace 维度，不适合和全局 `Total`、`Healthy` 混在一起
- 一旦塞进去，指标会缺上下文，不知道是在说哪个 workspace

### 5.2 推荐作为 workspace registry 页的 secondary section

更合理的落点是：

- 在 `WorkspacesPage` 的 workspace registry 区域附近
- 新增一个独立的 `Turn Policy Overview` section
- 明确绑定一个当前 workspace

这里的“当前 workspace”首版建议采用最简单的交互：

- 默认取最近活跃的 workspace
- 或在 registry 列表里点击某个 workspace 行后，将其作为当前查看对象

这样做的好处是：

- 页面结构清晰
- 不需要给每一行都发一组 metrics 请求
- 能复用现有 section / stat card 视觉风格

## 6. 首版信息结构

### 6.1 原始首版建议是只展示 summary，不展示决策列表

首版建议只展示 workspace 级 summary，不在这里直接塞 `Recent Policy Decisions`。

原因：

- workspace 级 recent decisions 更容易噪声过多
- 决策列表本质上更适合 thread 排障
- summary 更适合 registry 或 overview 页面

但当前实现已经比原始首版更进一步，实际加入了 workspace 级 recent decisions。这个实现并不错误，只是意味着：

- 当前代码已经超出了原始首版范围
- 后续应重点观察 recent decisions 的噪声是否可接受
- 如果噪声过高，再回退到“overview only”也仍然合理

### 6.2 首版建议展示的 4 个核心指标

建议和现有 KPI 文档保持一致，首版卡片至少包括：

- `Decisions`
  - 对应 `decisions.total`
- `Audit Coverage`
  - 对应 `audit.coverageRate`
- `Missing Verify`
  - 对应 `turns.missingSuccessfulVerificationRate`
- `Validation Rescue`
  - 对应 `turns.failedValidationWithPolicyActionRate`

这 4 个指标已经足够回答最关键的两个问题：

- 系统是否真的在记录和覆盖该管的 turn
- 命中问题后是否真的把失败 turn 接住了

### 6.3 辅助信息建议

除了 4 个 stat 卡，再加 3 类辅助信息就够了：

- `generatedAt`
  - 告知这份 summary 是什么时候计算的
- `coverageDefinition`
  - 解释覆盖率口径，避免误读为“所有 turn 覆盖率”
- CTA
  - 例如 `Open workspace`
  - 用于跳转回该 workspace 的工作台继续排障

## 7. 数据来源与请求策略

### 7.1 直接复用现有接口

首版直接调用：

```text
GET /api/workspaces/{workspaceId}/turn-policy-metrics
```

注意：

- 不传 `threadId`
- 直接拿 workspace 级 summary

### 7.2 不建议在 registry 首屏并发拉所有 workspace 指标

如果 workspace 数量多，首屏对每个 workspace 并发发一次 metrics 请求会放大：

- 前端请求数量
- 后端即时聚合成本
- 页面抖动和空状态噪声

因此首版更推荐：

- 只对“当前查看的 workspace”发请求
- 或只在用户展开该 section 后再懒加载

### 7.3 前端查询 key 的当前实现

当前代码实际使用：

```ts
['turn-policy-metrics', workspaceId, 'workspace-overview']
['turn-policy-decisions', workspaceId, 'workspace-recent', limit]
```

这和原始设计意图一致：workspace 级 key 与 thread 级 key 已分开，缓存语义是清楚的。

## 8. 交互草案

### 8.1 当前已实现的最小交互

当前代码已经实现：

1. 用户进入 `WorkspacesPage`
2. 页面默认选中最近活跃的 workspace
3. `Turn Policy Overview` section 展示该 workspace 的 summary
4. 用户切换 workspace 选择器时，overview section 跟着切换
5. 用户点击 `Open workspace` 跳转到对应 workspace 的工作台

这种交互的优点是：

- 不需要引入复杂筛选器
- 信息层级稳定
- 适合先验证这组 workspace 指标是否真的有用

### 8.2 组件落点

当前已经新增的组件包括：

- `frontend/src/pages/workspaces/WorkspaceTurnPolicyOverviewSection.tsx`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyRecentDecisionsSection.tsx`

它们确实复用了 thread rail 的指标表达方式，但没有直接复制整个 rail 组件树。

原因：

- thread rail 组件天然绑定“已选 thread”
- workspace 页面关注的是 workspace summary，不是 thread 交互上下文

## 9. 为什么不建议首版就做更多

### 9.1 不建议首版做趋势图

当前 metrics 是即时聚合结果，不带 `since` 时间窗口。

在这种前提下做趋势图，会遇到两个问题：

- 没有清晰时间切片
- 展示出来的趋势容易被误解成历史统计

### 9.2 不建议首版做 thread 排行榜

thread 排行榜会天然引入：

- 排序口径选择
- 样本量解释
- drill-down 行为设计

这比首版 summary 的复杂度高太多。

### 9.3 原始首版不建议做 workspace 级决策列表

workspace 下可能有多个活跃 thread，直接把所有 recent decisions 混在一起，信号密度并不高。

更稳妥的做法是：

- workspace 页面只给 summary
- 具体 recent decisions 留在 thread 页面

当前实现已经选择了另一条路径：workspace 页面同时展示 summary 与 recent decisions。后续不再需要争论“该不该做”，而是应验证：

- recent decisions 的信噪比是否足够高
- 是否需要补 `threadId` 可见性和直接跳转
- 是否需要把当前列表升级成带 drill-down 的调试入口

## 10. 后续阶段建议

### 10.1 第二阶段

如果当前 workspace overview 与 recent decisions 被证明有价值，下一阶段建议依次补：

- thread drill-down 入口
- decision 到 thread 的直接跳转
- 按 `threadId` 的轻量筛选

### 10.2 第三阶段

只有在确认确实需要更强观测时，再考虑：

- `since` / `until` 时间窗口
- 趋势图
- thread 排行
- 服务端聚合缓存

## 11. 明确哪些内容尚未实现

截至 2026-04-09，下面这些已经是仓库现状：

- `WorkspacesPage` 上的 `Turn Policy Overview` section
- workspace 级 metrics 查询 hook
- workspace 级 turn policy 组件
- `Open workspace` CTA
- workspace 级 recent decisions 列表

下面这些仍然尚未实现：

- 时间窗口
- 趋势图
- thread 排行表
- decision 明细 drill-down
- 从 workspace recent decisions 直接跳转到目标 thread

## 12. 一句话总结

workspace 级 turn policy 视图的最佳首版，不是把 thread rail 复制一遍，而是：

- 复用现有 `turn-policy-metrics` 接口
- 在 `WorkspacesPage` 增加一个绑定单个 workspace 的 summary section
- 只展示少量高价值指标
- 把复杂排障继续留给 thread 页面
