# `codex-server` turn policy API 与前端使用说明

更新时间：2026-04-09

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\system-design.md`

## 1. 文档目的

这份文档只回答两个问题：

- 当前 turn policy 相关只读 API 怎么用
- 当前前端 thread rail 和 workspace 页面是怎么把这些数据接出来的

它不是架构决策文稿，但会覆盖当前 thread / workspace 两种前端接入方式。

如果要看“为什么不再起独立 sidecar 进程”，请回到 2026-04-08 的研究文档。

## 2. 当前已提供的接口

当前后端已经暴露两条 turn policy 只读接口：

- `GET /api/workspaces/{workspaceId}/turn-policy-decisions`
- `GET /api/workspaces/{workspaceId}/turn-policy-metrics`

当前项目的 HTTP 响应统一使用 envelope：

```json
{
  "data": ...
}
```

因此，下面文档中提到的 `TurnPolicyDecision[]` 与 `TurnPolicyMetricsSummary` 都是 `data` 字段里的业务载荷；前端 `apiRequest()` 会自动解包。

路由注册位置：

- `backend/internal/api/router.go`

实现入口：

- `backend/internal/api/router.go`
- `backend/internal/turnpolicies/service.go`
- `backend/internal/turnpolicies/metrics.go`

## 3. `turn-policy-decisions` 接口

### 3.1 请求路径

`GET /api/workspaces/{workspaceId}/turn-policy-decisions`

### 3.2 查询参数

- `threadId`
  - 可选
  - 不传时返回整个 workspace 的决策记录
  - 传入时只返回该 thread 的决策记录
- `limit`
  - 可选
  - 当前实现要求是非负整数
  - 其中最常见的使用方式是传入正整数
  - 传入时只截取最新的前 N 条记录

当前实现对 `limit` 的处理是：

- 先按时间倒序取出决策列表
- 再在服务层执行前 N 条截断
- 若 `limit=0`，当前实现等价于不截断

因此它不是分页接口，而是“取最近若干条”的轻量读取接口。

### 3.3 返回顺序

当前 `MemoryStore.ListTurnPolicyDecisions()` 的排序规则是：

- 先按 `completedAt` 倒序
- 若 `completedAt` 相同，则按 `id` 倒序

因此，接口返回的第 1 条就是最近完成的决策。

### 3.4 返回结构

HTTP 返回体是：

```text
{ "data": TurnPolicyDecision[] }
```

其中 `data` 的业务载荷是 `TurnPolicyDecision[]`。

核心字段如下：

- `id`
  - 决策记录 ID
- `workspaceId`
  - 所属 workspace
- `threadId`
  - 所属 thread
- `turnId`
  - 命中的 turn
- `itemId`
  - 如果来自 `item/completed`，这里通常会带 item ID
- `triggerMethod`
  - 当前触发入口，例如 `item/completed` 或 `turn/completed`
- `policyName`
  - 当前命中的策略名
- `fingerprint`
  - 用于幂等/去重的指纹
- `verdict`
  - 当前策略判定结论
- `action`
  - 本次尝试动作，例如 `steer`、`followUp`、`none`
- `actionStatus`
  - 动作结果，例如 `succeeded`、`failed`、`skipped`
- `actionTurnId`
  - 如果 follow-up 成功开启了新 turn，这里会记录对应 turn ID
- `reason`
  - 决策原因或跳过原因
- `evidenceSummary`
  - 用于 UI 与排障的证据摘要
- `source`
  - 当前 thread 来源
- `error`
  - 动作失败时的错误描述
- `evaluationStartedAt`
  - 评估开始时间
- `decisionAt`
  - 做出决策时间
- `completedAt`
  - 整个决策记录完成时间

### 3.5 示例请求

获取某个 thread 最近 5 条决策：

```text
GET /api/workspaces/ws_local/turn-policy-decisions?threadId=thread_123&limit=5
```

获取某个 workspace 下所有已持久化决策：

```text
GET /api/workspaces/ws_local/turn-policy-decisions
```

### 3.6 示例响应

```json
{
  "data": [
    {
      "id": "tpd_01",
      "workspaceId": "ws_local",
      "threadId": "thread_123",
      "turnId": "turn_456",
      "itemId": "item_789",
      "triggerMethod": "item/completed",
      "policyName": "posttooluse/failed-validation-command",
      "fingerprint": "thread_123:item_789:failed-validation",
      "verdict": "steer",
      "action": "steer",
      "actionStatus": "succeeded",
      "actionTurnId": "",
      "reason": "validation_command_failed",
      "evidenceSummary": "pytest exited with non-zero status",
      "source": "interactive",
      "error": "",
      "evaluationStartedAt": "2026-04-08T08:15:11Z",
      "decisionAt": "2026-04-08T08:15:11Z",
      "completedAt": "2026-04-08T08:15:12Z"
    }
  ]
}
```

### 3.7 当前使用建议

这个接口当前更适合以下用途：

- thread 页面展示最近若干条自动纠偏记录
- 排障时按 thread 或 workspace 回看最近动作
- 统计系统之外的轻量运营查询

它当前不适合直接承担：

- 大范围长时间窗口检索
- 游标分页
- 时间序列分析

## 4. `turn-policy-metrics` 接口

### 4.1 请求路径

`GET /api/workspaces/{workspaceId}/turn-policy-metrics`

### 4.2 查询参数

- `threadId`
  - 可选
  - 传入时返回 thread 级 summary
  - 不传时返回 workspace 级 summary

这也是为什么当前后端已经同时具备 thread 级与 workspace 级 summary 能力，而前端现在也已经把这两个视角分别接到了 thread 页面和 `WorkspacesPage`。

### 4.3 返回结构

HTTP 返回体是：

```text
{ "data": TurnPolicyMetricsSummary }
```

其中 `data` 的业务载荷是 `TurnPolicyMetricsSummary`。

结构分为三块：

- `decisions`
  - 从持久化 `TurnPolicyDecision` 聚合出来的决策计数
- `turns`
  - 从 `ThreadProjection` 分析出来的 turn 行为汇总
- `audit`
  - 当前已实现 policy 谓词上的审计覆盖率

顶层字段包括：

- `workspaceId`
- `threadId`
- `generatedAt`

其中 `generatedAt` 是服务端计算这份 summary 的时间。

### 4.4 `decisions` 字段含义

- `total`
  - 当前范围内已持久化的决策记录总数
- `actionStatusCounts`
  - 按 `succeeded` / `failed` / `skipped` / `other` 汇总
- `actionCounts`
  - 按 `steer` / `followUp` / `none` / `other` 汇总
- `policyCounts`
  - 当前首期两条策略的命中计数
- `skipReasonCounts`
  - 主要统计防重与冷却导致的跳过

### 4.5 `turns` 字段含义

- `completedWithFileChange`
  - 已完成且包含 `fileChange` 的 turn 数
- `missingSuccessfulVerification`
  - 存在文件改动但其后没有成功验证命令的 turn 数
- `missingSuccessfulVerificationRate`
  - `missingSuccessfulVerification / completedWithFileChange`
- `failedValidationCommand`
  - 命中过失败验证命令的 turn 数
- `failedValidationWithPolicyAction`
  - 上述失败验证 turn 中，至少有一次被 policy 动作实际接住的 turn 数
- `failedValidationWithPolicyActionRate`
  - `failedValidationWithPolicyAction / failedValidationCommand`

### 4.6 `audit` 字段含义

- `coveredTurns`
  - 命中当前已实现 policy 谓词且至少有一条持久化审计记录的 turn 数
- `eligibleTurns`
  - 当前按实现口径应该被 policy 覆盖的 turn 数
- `coverageRate`
  - `coveredTurns / eligibleTurns`
- `coverageDefinition`
  - 服务端对覆盖率口径的文字解释

当前 `coverageDefinition` 的核心意思是：

- 只统计当前已经真正实现的两个 policy 谓词
- 不是对“所有 turn”做覆盖率
- 也不是对未来可能新增的策略做预留覆盖率

### 4.7 示例请求

获取某个 thread 的 KPI summary：

```text
GET /api/workspaces/ws_local/turn-policy-metrics?threadId=thread_123
```

获取整个 workspace 的 KPI summary：

```text
GET /api/workspaces/ws_local/turn-policy-metrics
```

### 4.8 示例响应

```json
{
  "data": {
    "workspaceId": "ws_local",
    "threadId": "thread_123",
    "generatedAt": "2026-04-08T08:20:00Z",
    "decisions": {
      "total": 7,
      "actionStatusCounts": {
        "succeeded": 4,
        "failed": 1,
        "skipped": 2,
        "other": 0
      },
      "actionCounts": {
        "steer": 3,
        "followUp": 2,
        "none": 2,
        "other": 0
      },
      "policyCounts": {
        "failedValidationCommand": 4,
        "missingSuccessfulVerification": 3,
        "other": 0
      },
      "skipReasonCounts": {
        "total": 2,
        "duplicateFingerprint": 1,
        "followUpCooldownActive": 1,
        "other": 0
      }
    },
    "turns": {
      "completedWithFileChange": 5,
      "missingSuccessfulVerification": 2,
      "missingSuccessfulVerificationRate": 0.4,
      "failedValidationCommand": 4,
      "failedValidationWithPolicyAction": 3,
      "failedValidationWithPolicyActionRate": 0.75
    },
    "audit": {
      "coveredTurns": 4,
      "eligibleTurns": 5,
      "coverageRate": 0.8,
      "coverageDefinition": "Coverage is measured only for turns that currently match implemented policy predicates."
    }
  }
}
```

## 5. 当前前端 thread rail 与 workspace 页面的接入方式

### 5.1 数据请求层

当前前端 API 封装位于：

- `frontend/src/features/threads/api.ts`

已经存在两个调用函数：

- `listTurnPolicyDecisions(workspaceId, { threadId, limit })`
- `getTurnPolicyMetrics(workspaceId, { threadId })`

### 5.2 React Query 层

当前 thread 页面在这里发起查询：

- `frontend/src/pages/thread-page/useThreadPageQueries.ts`

当前查询策略是：

- 决策列表固定使用 `threadId + limit=5`
- KPI summary 固定使用 `threadId`
- 只有在已选中 thread 时才启用查询
- 默认 `staleTime` 为 15 秒

这意味着 thread 页面当前并不会去取整个 workspace 的 turn policy summary。

### 5.3 组件渲染层

当前 rail 的组件挂载位于：

- `frontend/src/pages/thread-page/ThreadWorkbenchRail.tsx`

其中：

- `ThreadWorkbenchRailTurnPolicyDecisionsSection.tsx`
  - 展示最近 5 条 automatic policy decisions
  - 当前时间显示优先取 `completedAt`，再回退到 `decisionAt`、`evaluationStartedAt`
- `ThreadWorkbenchRailTurnPolicyMetricsSection.tsx`
  - 展示 4 个核心 stat 卡和若干辅助计数
  - 当前展示的四个核心指标是：
    - `Decisions`
    - `Audit Coverage`
    - `Validation Rescue`
    - `Missing Verify`

### 5.4 `WorkspacesPage` 的 workspace 级接入

当前 workspace 页面已经补了两类 turn policy 视图：

- `Turn Policy Overview`
- `Workspace Recent Policy Decisions`

相关位置：

- `frontend/src/pages/WorkspacesPage.tsx`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyOverview.ts`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyRecentDecisions.ts`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyOverviewSection.tsx`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyRecentDecisionsSection.tsx`

当前接入方式是：

- 页面先按 `updatedAt` 倒序排列 workspace
- 默认选中最近活跃的 workspace
- overview 调用 `getTurnPolicyMetrics(workspaceId)`，不传 `threadId`
- recent decisions 调用 `listTurnPolicyDecisions(workspaceId, { limit: 5 })`，不传 `threadId`

### 5.5 当前实际用户体验

当前用户在 thread 页面右侧 rail 能看到：

- 最近自动决策列表
- 当前 thread 的 turn policy KPI summary

当前用户在 `WorkspacesPage` 还能看到：

- 当前 workspace 的 KPI summary
- 当前 workspace 最近 5 条跨 thread 的 policy decisions

但当前还看不到：

- 时间窗口筛选
- 更长决策列表或分页
- 决策明细 drill-down

## 6. 推荐的调用与展示边界

### 6.1 什么时候用 `turn-policy-decisions`

优先用于：

- 最近记录列表
- 排障面板
- “为什么被自动 steer / follow-up” 的解释性展示

### 6.2 什么时候用 `turn-policy-metrics`

优先用于：

- KPI summary 卡片
- thread / workspace 健康概览
- 质量趋势功能的未来数据源

## 7. 当前限制

截至 2026-04-09，当前 turn policy 读接口还有限制：

- 没有 `since`、`until` 之类的时间窗口参数
- `turn-policy-decisions` 不是分页接口
- metrics 是即时聚合，不是预计算报表
- 前端虽然已经接入 thread 级与 workspace 级视图，但还没有决策明细 drill-down
- workspace 级视图还没有时间窗口、趋势图和 thread 排行

## 8. 一句话总结

当前 `codex-server` 已经同时具备：

- 可回看的决策审计接口
- 可聚合的 KPI summary 接口
- thread 页面右侧 rail 的基础可视化接入
- `WorkspacesPage` 的 workspace 级 overview 与 recent decisions 接入

后续如果要继续扩展，不需要先改后端协议，优先补更清晰的 drill-down、时间窗口和趋势能力即可。
