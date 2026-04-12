# Plan 相关数据链路图（2026-04-11）

本文档总结当前 `codex-server` 中与 plan 相关的两条不同数据流，并说明它们在后端投影、前端 live state、时间线 UI 和 live feed 中分别如何落地。

## 1. 先分清两类 plan 语义

当前仓库里有两种名字都带 `plan` 的能力，但它们不是同一种东西：

### 1.1 Plan mode 文本计划

这是 `collaborationMode = plan` 下，模型输出 `<proposed_plan>` 时产生的计划文本流。

- 上游事件：`item/plan/delta`
- 最终 item 语义：`type = "plan"`
- 展示形式：普通 Plan 卡片，按文本拆成步骤列表
- 适用语义：展示“计划内容文本”

### 1.2 `update_plan` 步骤状态计划

这是 agent 在执行 `update_plan` 工具时产生的“待办步骤状态流”，本质更接近 todo/checklist。

- 上游事件：`turn/plan/updated`
- 当前仓库落地 item：`type = "turnPlan"`
- 展示形式：带 `pending / inProgress / completed` 状态徽标的 Plan 卡片
- 适用语义：展示“计划步骤状态机”

上游 `codex-rs/app-server` 的注释已经明确说明：`turn/plan/updated` 是 `update_plan` 工具事件，不是 plan-mode 文本计划事件。

## 2. 总体链路图

### 2.1 文本计划链路

```text
Composer Plan Mode
  -> POST /api/workspaces/{workspaceId}/threads/{threadId}/turns
  -> backend turns service 组装 collaborationMode
  -> app-server turn/start
  -> runtime 推送 item/plan/delta
  -> backend thread projection 追加 { type: "plan", text }
  -> frontend threadLiveState 追加 { type: "plan", text }
  -> TurnTimeline 渲染普通 Plan 卡片
  -> LiveFeed 渲染 Plan Draft 流
```

### 2.2 步骤状态计划链路

```text
Agent 调用 update_plan
  -> app-server 推送 turn/plan/updated
  -> backend thread projection 生成 { type: "turnPlan", steps, explanation, status }
  -> frontend threadLiveState 同步生成 { type: "turnPlan", ... }
  -> TurnTimeline 渲染带状态徽标的 Plan 卡片
  -> LiveFeed 渲染 Plan Status 流
```

## 3. 当前代码落点

### 3.1 后端

#### 3.1.1 Plan mode 入口

- REST 查询 collaboration modes：`backend/internal/api/router.go`
- 调用 runtime 的 `collaborationMode/list`：`backend/internal/catalog/service.go`
- 发起 turn 时注入 `collaborationMode`：`backend/internal/turns/service.go`

#### 3.1.2 文本计划投影

- `item/plan/delta -> type: "plan"`：`backend/internal/store/thread_projection.go`

#### 3.1.3 步骤状态计划投影

- `turn/plan/updated -> type: "turnPlan"`：`backend/internal/store/thread_projection.go`
- 生成稳定 item id：`turn-plan-{turnId}`
- 存储字段：
  - `steps`
  - `explanation`
  - `status`

#### 3.1.4 测试覆盖

- 文本/命令/Hook 等投影测试：`backend/internal/store/thread_projection_test.go`
- `turn/plan/updated` 专项测试：`TestApplyThreadEventToProjectionProjectsTurnPlanUpdates`

### 3.2 前端

#### 3.2.1 thread 页面模式入口

- 查询 workspace 是否支持 plan mode：`frontend/src/pages/thread-page/useThreadPagePlanModeSupport.ts`
- composer 发送 `collaborationMode: 'plan'`：`frontend/src/pages/thread-page/buildThreadPageThreadActions.ts`

#### 3.2.2 live state

- 文本计划流：`item/plan/delta -> type: 'plan'`
- 步骤状态流：`turn/plan/updated -> type: 'turnPlan'`
- 代码位置：`frontend/src/pages/threadLiveState.ts`

#### 3.2.3 时间线渲染

- `type: 'plan'`
  - 只展示文本步骤
  - 不带状态机语义
- `type: 'turnPlan'`
  - 展示 explanation
  - 展示 step badge
  - 展示整体运行状态 tone
- 代码位置：`frontend/src/components/workspace/renderers.tsx`

#### 3.2.4 LiveFeed

现在 live feed 已对两类事件做友好格式化：

- `item/plan/delta` -> `Plan Draft`
- `turn/plan/updated` -> `Plan Status`

代码位置：`frontend/src/components/workspace/timeline-utils.ts`

## 4. 为什么不能把两类 plan 强行并到一个 item 里

如果把 `turn/plan/updated` 直接塞进现有 `type: 'plan'` 文本卡片，会有几个问题：

1. `item/plan/delta` 的 authoritative 内容是文本。
2. `turn/plan/updated` 的 authoritative 内容是步骤状态快照。
3. 两者来源不同、payload 结构不同、更新节奏不同。
4. 把 status 写进文本卡片后，容易出现“文本计划”和“执行进度”互相覆盖的问题。

因此当前仓库选择：

- 文本计划保留 `plan`
- 步骤状态计划单独使用 `turnPlan`

这是当前最小且最稳的边界。

## 5. 当前状态总结

截至 2026-04-11，本仓库在 plan 相关能力上的状态是：

- 已支持 Plan mode 查询和发起
- 已支持 plan-mode 文本计划流展示
- 已支持 `requestUserInput` 检查点展示
- 已支持 `turn/plan/updated` 的后端投影和前端步骤状态卡片
- 已支持 live feed 中对 plan 相关事件的友好聚合

## 6. 后续可继续做的事

如果要继续增强，这几个方向最有价值：

1. 给 `turnPlan` 做更强的类型约束，减少前后端都使用 `Record<string, unknown>` 的动态访问。
2. 在 thread detail / diagnostics 里增加专门的 plan event 调试视图，而不只依赖 live feed。
3. 如果后续需要跨页复用，可把 `turnPlan` 抽成独立 renderer 组件和独立类型。
4. 如果产品需要，还可以给 plan card 增加“当前活跃步骤”强调或自动滚动定位。
