# `codex-server` turn policy 实施现状

更新时间：2026-04-11

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\app-server-sidecar-research-adoption-analysis-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\app-server-sidecar-research-adoption-kpi-metrics-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-api-and-ui-usage-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-workspace-metrics-view-design-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-max-utilization-plan-2026-04-09.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-compatible-governance-layer-design-2026-04-10.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\hooks-governance-coverage-matrix-2026-04-10.md`

## 1. 文档目的

这份文档不是新的方案提案，而是对当前仓库里已经完成的 turn policy 实现做一次“现状盘点”。

之所以需要单独补这份文档，是因为 2026-04-08 的两份 sidecar 研究文稿仍然是有价值的架构决策快照，但其中很多内容现在已经从“建议”变成了“已实现事实”。

因此，阅读顺序建议是：

- 先看研究文档，理解为什么选择“内嵌式 sidecar 能力”
- 再看本文，确认哪些能力已经落地，哪些仍然只是后续计划

范围说明：

- 本文只描述 `turnpolicies.Service` 这条后置治理 / KPI 主链的实施现状。
- 截至 2026-04-10 新增的 hooks-compatible 治理层、`item/tool/call` 前置拦截、`mcpServer/elicitation/request` 审计和 `mcpToolCall` 审计型 `PostToolUse` 覆盖，不以本文为准。
- 涉及 MCP 当前真实覆盖边界时，应以 `hooks-governance-coverage-matrix-2026-04-10.md` 为准，避免把 turn policy 的后置补救与 hooks 的执行期治理混读。

## 2. 当前已完成的实现

### 2.1 后端已落地 `turnpolicies.Service`

当前仓库已经在 Go backend 内新增了 turn policy 服务层，而不是再起一个独立 OS 级 sidecar 进程。

实现位置：

- `backend/internal/turnpolicies/service.go`
- `backend/internal/turnpolicies/rules.go`
- `backend/internal/servercmd/run.go`

这层服务当前会：

- 订阅统一事件总线
- 在 `item/completed` 上运行快纠偏规则
- 在 `turn/completed` 上运行自动续跑规则
- 复用现有 `turns.Service` 执行动作
- 记录决策审计
- 输出 thread / workspace 级 KPI summary

### 2.2 首期规则已经落地

当前已实现两条首期高价值规则：

- 验证命令失败时自动 `turn/steer`
- 本轮存在 `fileChange` 但之后没有成功验证时自动 follow-up `turn/start`

这些规则正是研究文档里最推荐先落的两条：

- `PostToolUse` 风格的快纠偏
- `Stop` 风格的自动续跑

### 2.3 已补 `TurnPolicyDecision` 审计持久化

KPI 研究文档曾明确指出：

- 不能只靠事件总线里的瞬时事件做长期统计
- 更稳妥的首版做法是补一份最小持久化的决策事实表

当前这一点已经落地。

相关位置：

- `backend/internal/store/models.go`
- `backend/internal/store/turn_policy_decisions.go`
- `backend/internal/store/memory.go`

当前 `TurnPolicyDecision` 记录了：

- `workspaceId`
- `threadId`
- `turnId`
- `itemId`
- `triggerMethod`
- `policyName`
- `fingerprint`
- `verdict`
- `action`
- `actionStatus`
- `actionTurnId`
- `reason`
- `evidenceSummary`
- `source`
- `error`
- `evaluationStartedAt`
- `decisionAt`
- `completedAt`

### 2.4 已补只读 API

当前后端已经暴露两条与 turn policy 直接相关的只读接口：

- `GET /api/workspaces/{workspaceId}/turn-policy-decisions`
- `GET /api/workspaces/{workspaceId}/turn-policy-metrics`

其中：

- `turn-policy-decisions` 支持 `threadId` 和 `limit`
- `turn-policy-metrics` 支持可选 `threadId`

实现位置：

- `backend/internal/api/router.go`
- `backend/internal/api/router_test.go`
- `backend/internal/turnpolicies/metrics.go`
- `backend/internal/turnpolicies/metrics_test.go`

### 2.5 前端 thread rail 与 workspace 页面已接入可见性

研究文档最初建议“第一阶段可以零前端改动起步，第二阶段再考虑显式可见性”。

当前仓库已经走到第二阶段的一部分，thread 页面右侧 rail 与 `WorkspacesPage` 都已接入 turn policy 可视化。

已落地的前端可见性包括：

- 最近 5 条 automatic policy decisions 列表
- thread 级 turn policy KPI summary
- workspace 级 `Turn Policy Overview`
- workspace 级 `Workspace Recent Policy Decisions`

相关位置：

- `frontend/src/pages/thread-page/ThreadWorkbenchRailTurnPolicyDecisionsSection.tsx`
- `frontend/src/pages/thread-page/ThreadWorkbenchRailTurnPolicyMetricsSection.tsx`
- `frontend/src/pages/thread-page/useThreadPageQueries.ts`
- `frontend/src/pages/WorkspacesPage.tsx`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyOverview.ts`
- `frontend/src/pages/workspaces/useWorkspaceTurnPolicyRecentDecisions.ts`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyOverviewSection.tsx`
- `frontend/src/pages/workspaces/WorkspaceTurnPolicyRecentDecisionsSection.tsx`
- `frontend/src/features/threads/api.ts`
- `frontend/src/types/api.ts`

## 3. 当前实现与原方案的对应关系

### 3.1 已经验证正确的方案判断

下面这些研究判断，已经被当前代码实现证明是正确方向：

- 不需要再起独立 sidecar 进程
- 应该复用现有 `bridge.Client`
- 应该复用现有 `runtime.Manager`
- 应该复用现有 `turns.Service`
- 应该基于 `events.Hub` + `ThreadProjection` 做规则判定
- 应该补一份最小的决策持久化记录

### 3.2 已经从“建议”变成“事实”的内容

下列内容在研究文稿里原本是建议，现在已经是仓库现状：

- `backend/internal/turnpolicies/` 包存在
- `turnpolicies.Service` 已接入 server 启动链路
- 两条首期规则已落地
- `TurnPolicyDecision` 已持久化
- `turn-policy-decisions` API 已可用
- `turn-policy-metrics` API 已可用
- thread rail 已展示决策列表和 KPI summary
- `WorkspacesPage` 已展示 workspace 级 summary 和 recent decisions

## 4. 仍然属于后续计划的部分

虽然核心能力已经落地，但下面这些仍然属于后续工作，不应被误读为“已完成”：

- 更细粒度的配置化开关
  - 例如 `enablePostToolUsePolicies`
  - 例如 `enableStopPolicies`
- `interrupt` 类规则
  - 例如命中禁止路径或高风险 patch 时自动打断
- workspace 级更深 drill-down 能力
  - 当前虽已有 overview 与 recent decisions，但还没有从 decision 直接跳转到目标 thread
  - 也还没有 workspace 级决策明细面板
- 更轻的时间窗口过滤
  - 例如 `since`
- 更通用的策略配置化或 DSL

## 5. 当前文档状态如何理解

当前推荐把相关文档分成三类理解：

- 研究决策文档
  - 解释“为什么这样做”
  - 例如 sidecar 吸收分析、KPI 方案文档
- 系统设计文档
  - 解释系统结构和正式能力面
  - 例如 `docs/system-design.md`
- 实施现状文档
  - 解释“现在已经做到了什么”
  - 本文就属于这一类

这样做的好处是：

- 不需要把研究文稿改写成 changelog
- 也不会让系统设计文档背负过多阶段性细节
- 后续继续演进时，可以很清楚地区分“当时的架构判断”和“现在的实际落点”

补充说明：

- 如果问题指向 `PreToolUse`、`ServerRequest`、`HookRun`、`mcpServer/elicitation/request` 或 `mcpToolCall` 覆盖矩阵，请优先看 hooks 文档，不要直接引用本文来代表当前 hooks 能力面。

## 6. 当前建议

如果后续继续推进 turn policy 体系，建议按下面顺序走：

1. 先保持当前两条规则稳定运行，不要一次性继续加很多规则。
2. 优先把 workspace 级视图的文档、契约和回归测试补齐，再做 drill-down。
3. 再考虑 `interrupt` 类规则。
4. 最后再考虑策略配置化，而不是过早引入 DSL。

## 7. 一句话总结

截至 2026-04-09，`codex-server` 已经不再处于“研究 sidecar 如何落地”的阶段，而是已经完成了：

- 内嵌式 turn policy orchestrator
- 两条首期规则
- 最小审计持久化
- 决策和 KPI 只读 API
- thread rail 的基础可视化
- `WorkspacesPage` 的 workspace 级 overview 与 recent decisions

后续重点不再是证明方案是否正确，而是继续把这套能力做稳、做全、做得更易观测，并把文档与测试同步到当前实现状态。
