# `codex-server` turn policy 技术功能点最大化利用实施规划

更新时间：2026-04-09

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-implementation-status-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-api-and-ui-usage-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\turn-policy-workspace-metrics-view-design-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\app-server-sidecar-research-adoption-analysis-2026-04-08.md`
- `E:\projects\ai\codex-server\docs\development\turn-policy\app-server-sidecar-research-adoption-kpi-metrics-2026-04-08.md`

## 1. 文档目标

这份文档不再回答“turn policy 要不要做”，而是回答：

- 当前已经落地的技术功能点，怎样才能被最大化利用
- 下一步应优先把价值放大在哪些场景
- 怎样把能力从“存在”变成“稳定可用、可观测、可运营、可复盘”

一句话概括：

- 当前仓库已经有了 turn policy 的底座
- 接下来重点是把这套能力变成线程质量、workspace 运营和自动化可靠性的放大器

## 2. 当前已经具备的能力资产

截至 2026-04-09，仓库已经具备下面这些关键资产：

- 后端内嵌式 `turnpolicies.Service`
- 两条首期高价值规则
  - 验证命令失败时自动 `turn/steer`
  - 改了文件但没有成功验证时自动 follow-up `turn/start`
- `TurnPolicyDecision` 最小持久化审计记录
- `turn-policy-decisions` 只读接口
- `turn-policy-metrics` 只读接口
- thread rail 可视化
  - 最近 5 条决策
  - thread 级 KPI summary
- `WorkspacesPage` 可视化
  - workspace 级 overview
  - workspace recent decisions

这些资产说明当前阶段已经不是“缺功能点”，而是“缺最大化使用路径”。

## 3. 最大化利用的总体原则

### 3.1 先把闭环做完整，再扩更多规则

当前最值钱的不是继续快速加新 rule，而是把下面这条闭环做完整：

- 触发
- 动作
- 审计
- 可见
- 可复盘
- 可衡量收益

如果闭环不完整，规则越多，系统越难解释，也越难证明价值。

### 3.2 按使用场景分层利用，而不是只按技术模块分层

turn policy 的价值至少分成 4 层：

- 交互线程层
  - 减少“看起来完成，实际上没收口”的线程
- workspace 运营层
  - 快速发现某个 workspace 的纠偏质量是否退化
- automation / bot 层
  - 让无人值守线程更能自己收口
- 平台治理层
  - 让策略命中、跳过、失败、重复动作可审计

只有同时覆盖这 4 层，才算“最大化利用”。

### 3.3 优先放大已有两条规则的收益，再做高级治理

当前两条规则已经覆盖了最常见、最有体感价值的问题：

- 失败命令后直接想收尾
- 改了文件却不验证

这两条规则没有吃透之前，不应该过早把精力切到 DSL、复杂 interrupt、趋势大盘。

## 4. 能力利用图谱

### 4.1 面向交互线程

应重点利用：

- `turn-policy-decisions`
  - 解释“为什么被自动 steer / follow-up”
- `turn-policy-metrics`
  - 让用户快速看到当前 thread 是否处于高风险模式
- thread rail recent decisions
  - 缩短排障路径

对交互线程的目标不是“多一个面板”，而是：

- 降低误完成
- 降低失败后直接收尾
- 缩短排障时间

### 4.2 面向 workspace 运营

应重点利用：

- workspace 级 overview
- workspace recent decisions
- `audit.coverageRate`
- `missingSuccessfulVerificationRate`
- `failedValidationWithPolicyActionRate`

对 workspace 运营的目标是：

- 快速识别质量退化
- 快速识别某个 workspace 是否出现策略命中异常上升
- 在进入具体 thread 前先判断“是不是系统性问题”

### 4.3 面向 automation / bot

应重点利用：

- `TurnPolicyDecision.source`
- workspace / thread 级 metrics 聚合能力
- 现有 automation 与 bot thread 基础设施

对 automation / bot 的目标是：

- 提升无人值守补救率
- 降低人工追回率
- 把策略从“辅助人工”升级为“辅助自动化闭环”

### 4.4 面向平台治理

应重点利用：

- 决策持久化
- 指纹去重
- 跳过原因统计
- 路由和 UI 的可见性

对平台治理的目标是：

- 证明策略没有误触发到不可控
- 证明重复动作被有效遏制
- 证明文档、接口、UI 和测试没有继续漂移

## 5. 推荐的最大化利用路线图

### 5.1 Phase 1：先把“事实层”统一

目标：

- 文档与代码对齐
- API 合约说明与真实响应格式对齐
- 测试把现有行为锁住

具体动作：

- 修正文档中关于 workspace UI 未落地的描述
- 修正 HTTP 示例响应，统一写明 `{ "data": ... }`
- 把 hook 和 UI 的回归测试补齐
- 补充 thread rail decisions 组件测试

验收标准：

- turn policy 相关文档不再和当前实现相互矛盾
- turn policy 前端关键组件与 hook 都有自动化测试保护

### 5.2 Phase 2：把 thread 和 workspace 视角真正打通

目标：

- 从 workspace 级 overview 快速 drill-down 到 thread
- 从 recent decisions 快速定位具体 thread 和 turn

具体动作：

- 在 workspace recent decisions 中显式展示 `threadId`
- 增加 `Open thread` 或等价 drill-down CTA
- 在 thread 页面支持从 workspace 视角带参跳入
- 对 thread recent decisions 增加更清晰的 action / source / actionTurnId 表达

建议代码落点：

- `frontend/src/pages/workspaces/WorkspaceTurnPolicyRecentDecisionsSection.tsx`
- `frontend/src/pages/thread-page/ThreadWorkbenchRailTurnPolicyDecisionsSection.tsx`
- `frontend/src/features/threads/api.ts`

验收标准：

- 操作者可以从 workspace 级问题快速进入具体 thread 排障
- workspace recent decisions 不再只是“看见了”，而是“能继续操作”

### 5.3 Phase 3：把 KPI 从静态 summary 变成运营工具

目标：

- 让 KPI 真正用于判断收益，而不是停留在展示

应优先补的指标：

- `posttooluseDecisionLatencyMs`
- `stopDecisionLatencyMs`
- `自动纠偏成功率`
- `自动续跑成功率`
- `重复动作率`

当前已有的数据基础：

- `TurnPolicyDecision`
- `ThreadProjection`
- `source`
- `actionStatus`
- `reason`

建议代码落点：

- `backend/internal/turnpolicies/metrics.go`
- `backend/internal/turnpolicies/service.go`

验收标准：

- 至少能从后端 summary 看见“触发后是否有效”和“是否足够及时”
- 不再只统计命中次数和动作次数

### 5.4 Phase 4：把 turn policy 真正用于 automation / bot 增强

目标：

- 不让 turn policy 只服务人工线程

具体动作：

- 按 `source` 把 metrics 分成 `interactive` / `automation` / `bot`
- 为 automation / bot 增加专项 summary
- 复盘 policy 命中后的最终完成率
- 统计人工追回率

建议新增能力：

- workspace 级按 `source` 的分组 summary
- automation / bot 专项 overview 入口

验收标准：

- 能单独回答“这套能力是不是让无人值守线程更可靠”

### 5.5 Phase 5：最后再上配置化和 interrupt 治理

目标：

- 在已有收益被证明之后，再做更强策略面

建议顺序：

1. 简单布尔开关
2. 每 workspace 的轻量配置
3. 高风险路径 interrupt
4. 受控配置扩展
5. 最后才考虑 DSL

原因：

- 过早做 DSL 会放大复杂度
- 当前最需要的不是“更多规则表达能力”，而是“更稳定的收益闭环”

## 6. 产品化优先级建议

### 6.1 P0

- 文档与测试对齐
- workspace recent decisions 到 thread 的 drill-down
- thread / workspace 两端的核心视图稳定

### 6.2 P1

- 决策延迟指标
- 自动纠偏成功率
- automation / bot 分组指标
- 决策明细可视化

### 6.3 P2

- 时间窗口
- 趋势图
- thread 排行
- 高风险 interrupt
- 受控配置化

## 7. 最大化利用时最容易踩的坑

### 7.1 只看命中次数，不看收益

如果只看：

- policy 命中次数
- 自动续跑次数
- steer 调用次数

很容易把“噪声变多”误判成“系统变强”。

### 7.2 只做 UI，不做 drill-down

如果 workspace 页面只能展示 summary，但不能继续定位 thread，那么它更像装饰性指标，而不是运营工具。

### 7.3 只做规则，不补测试与文档

当前仓库已经出现文档漂移和测试漂移的迹象，这说明：

- turn policy 的技术点在增长
- 但配套契约没有同步增长

如果继续只加功能，不补事实层，后面维护成本会迅速升高。

## 8. 推荐的近期执行清单

建议按下面顺序推进：

1. 先修正文档事实漂移与响应示例。
2. 把 workspace recent decisions 的 hook 和 UI 测试补齐。
3. 给 workspace recent decisions 加 thread drill-down。
4. 在 metrics 中增加决策延迟和成功率指标。
5. 针对 automation / bot 增加 `source` 分组 summary。
6. 指标稳定后，再考虑 interrupt 与配置化扩展。

## 9. 一句话总结

turn policy 这套技术功能点现在最需要的不是“再证明它能做什么”，而是把它系统化地用在：

- 线程质量提升
- workspace 运营诊断
- automation / bot 收口
- 平台治理与复盘

要实现最大化利用，最佳路径不是一次性铺很多新规则，而是先把：

- 事实层
- 可视层
- drill-down
- KPI 闭环
- 自动化收益验证

这五件事按顺序做扎实。
