# `codex-server` 吸收 `app-server sidecar` 研究后的可量化指标清单

更新时间：2026-04-08

适用项目：

- `E:\projects\ai\codex-server`

关联文档：

- `E:\projects\ai\codex-server\docs\development\turn-policy\app-server-sidecar-research-adoption-analysis-2026-04-08.md`

## 1. 先说结论

如果 `codex-server` 按前一份分析报告的建议落地“内嵌式 sidecar 能力”，最值得追踪的不是“触发了多少条 policy”，而是下面 4 类结果是否真的改善：

- 线程是否更少“过早结束”
- 失败后是否更快被自动纠偏
- 自动化 / bot 线程是否更少需要人工追回
- 在带来质量提升的同时，额外成本是否保持可控

换句话说，这一层架构的价值不应该用“技术上多了一层 orchestrator”来证明，而应该用“完成质量、可靠性、治理能力、无人值守成功率是否提升”来证明。

因此，建议把指标体系分成 4 层：

- 结果指标：最终是否减少假完成、漏验证、失败即收尾
- 控制面健康指标：策略层是否稳定、及时、可去重、可审计
- 成本指标：质量提升是否是以可接受的附加 turn / token / 命令成本换来的
- 自动化指标：在 bot 和 automation 场景下，系统是否更能自己把事情收完

## 2. 最值得先看的 10 个 KPI

下面这 10 个指标足以覆盖第一阶段是否“做对了方向”。

| 指标 | 主要回答的问题 | 建议计算方式 | 首期建议目标 |
| --- | --- | --- | --- |
| `无验证结束率` | 改了文件后，系统是否仍经常在没验证的情况下结束 | 含 `fileChange` 的 `turn/completed` 中，结束前没有“成功验证信号”的 turn 数 / 含 `fileChange` 的 completed turn 总数 | 相对基线下降 30% 以上 |
| `失败后直接结束率` | 测试或校验失败后，系统是否还会直接收尾 | 含验证命令且至少一次失败的 turn 中，完成后 60 秒内没有 `steer` / follow-up 的 turn 数 / 此类 turn 总数 | 相对基线下降 50% 以上 |
| `自动纠偏成功率` | policy 介入后，是否真的把线程带回正轨 | 触发动作的 policy execution 中，后续 1 个补轮内完成且不再命中同类 policy 的次数 / 触发动作总数 | 60% 以上 |
| `自动续跑成功率` | `Stop` 类规则补轮是否能完成收口 | 因 `turn/completed` 触发 follow-up 的线程中，后续 turn 最终完成且没有再次 follow-up 的次数 / follow-up 总数 | 70% 以上 |
| `策略动作成功率` | `turn/steer`、`turn/interrupt`、`turn/start` 调用是否稳定 | 策略层发起动作后收到成功结果的次数 / 动作总次数 | 99% 以上 |
| `策略决策延迟 P95` | 从事件到动作发出是否足够快 | `item/completed` 或 `turn/completed` 的事件时间到策略动作提交时间的 P95 | `PostToolUse` < 2s，`Stop` < 5s |
| `重复动作率` | 去重是否有效，是否会因重复事件导致重复续跑 | 同一 `threadId + turnId + policyName + fingerprint` 产生 2 次及以上动作的次数 / 唯一 fingerprint 总数 | < 0.5% |
| `审计覆盖率` | 每次 policy 决策是否都有可追溯记录 | 有完整决策记录的 policy evaluation 数 / policy evaluation 总数 | 100% |
| `无人值守补救率` | automation / bot 场景下，系统是否更能自己修正问题 | 自动化来源线程中，命中 policy 后无需人工介入且最终完成的次数 / 自动化来源命中次数 | 60% 以上 |
| `单位收益附加成本` | 每挽救一次假完成，需要付出多少额外代价 | 新增 turn、命令、token 成本 / 被 policy 成功挽救的线程数 | 持续下降，首期只做观测 |

## 3. 结果指标定义

### 3.1 `无验证结束率`

这是第一优先级指标。

它直接衡量：

- 模型是否在“已经改动文件但尚未验证”的状态下结束
- `Stop` policy 是否真的把“该继续跑的线程”续上了

建议口径：

- 分母：所有包含 `fileChange` item 的 `turn/completed`
- 分子：这些 turn 在完成前没有出现“成功验证信号”

第一阶段可接受的“成功验证信号”建议用启发式识别：

- `commandExecution.command` 命中测试 / 校验命令模式
- 且该命令最终 `status == "completed"`
- 且如果有 `exitCode`，则 `exitCode == 0`

第一版命令模式可以先做保守白名单：

- `go test`
- `cargo test`
- `cargo clippy`
- `pytest`
- `npm test`
- `pnpm test`
- `yarn test`
- `vitest`
- `jest`
- `just test`
- `bazel test`
- `ruff check`
- `eslint`
- `tsc`

注意：

- 这个指标比“policy 命中次数”更接近用户真实感知
- 它能直接证明“完成质量有没有提高”

### 3.2 `失败后直接结束率`

这个指标主要衡量 `PostToolUse` 风格快纠偏是否生效。

建议口径：

- 分母：所有包含验证命令失败的 turn
- 分子：这些 turn 在失败后仍然直接 `turn/completed`，并且 60 秒内没有后续 `steer`、`interrupt` 或 follow-up turn

它对应用户最常见的不满场景：

- 测试失败了，但模型还是想收尾
- lint 报错了，但模型只做解释，没有继续修

如果这项指标没有明显下降，通常说明至少有一个问题：

- 失败命令识别不准
- `item/completed` 触发过晚
- `turns.Service.Steer` 的调用没有稳定成功
- 去重过严，误把应该补救的动作丢掉了

### 3.3 `自动纠偏成功率`

这个指标回答的是：

- policy 不是只会“多插一句提醒”
- 而是真的把线程带到了更好的结果

建议口径：

- 分母：所有触发了 `steer` / `interrupt` / follow-up 的 policy action
- 分子：这些 action 触发后，在后续 1 个补轮内，线程满足下面两个条件：
  - 已完成
  - 没有再次命中同一类 policy

第一阶段不要把“用户显式满意”纳入公式，因为当前项目里这类信号不稳定，也不一定标准化。

先把“是否补救成功”和“是否还在反复触发同类问题”统计清楚，更容易落地。

### 3.4 `自动续跑成功率`

这是 `Stop` policy 的专项指标。

建议口径：

- 分母：所有由 `turn/completed` 触发 follow-up 的线程
- 分子：补轮后在 1 个新增 turn 内完成，且没有再次被同类 `Stop` 规则续跑的线程

这项指标主要验证：

- “本轮改了文件但没验证 -> follow-up turn” 这条规则是否真正有效

如果命中率很高但成功率很低，通常不是“规则无效”，而是 continuation prompt 不够好，或者补轮证据不足。

## 4. 控制面健康指标定义

### 4.1 `策略动作成功率`

该指标验证新架构有没有把系统稳定性拖差。

建议分别统计：

- `steer` 成功率
- `interrupt` 成功率
- `followUpStart` 成功率

建议口径：

- 动作发起成功，以 `turns.Service` 返回成功为准
- 不要只统计“进入了 action 分支”

如果 `steer` 成功率低于 `followUpStart`，往往意味着：

- 触发时 active turn 已结束
- 或 `runtime.Manager.ActiveTurnID` 与实际状态不同步

### 4.2 `策略决策延迟 P95`

新增策略层后，最怕的是“理论上能纠偏，实际上已经来不及”。

建议拆成两项：

- `posttooluseDecisionLatencyMs`
  - 从 `item/completed` 事件时间到 `steer` / `interrupt` / fallback `start` 发出时间
- `stopDecisionLatencyMs`
  - 从 `turn/completed` 事件时间到 follow-up `turn/start` 发出时间

建议阈值：

- `PostToolUse` P95 小于 2 秒
- `Stop` P95 小于 5 秒

如果超出这个范围，用户体感上就会开始出现：

- “先看到一条完成消息，然后系统过几秒又自己续跑”
- “失败输出已经刷完了，纠偏提示却迟迟不来”

### 4.3 `重复动作率`

该指标是幂等与去重是否做对的直接证明。

建议 fingerprint：

- `threadId + turnId + itemId? + policyName + evidenceHash`

建议口径：

- 分母：唯一 fingerprint 总数
- 分子：同一 fingerprint 产生 2 次及以上动作的次数

这里一定不要只统计“dedup 命中次数”，因为 dedup 命中高并不等于系统正确。

真正该看的，是：

- 有没有重复动作漏出来
- 有没有错误去重导致本该动作却没动作

### 4.4 `审计覆盖率`

这个指标回答的是：

- 每次 policy 判定后，能不能复盘“为什么触发、为什么没触发、为什么动作失败”

建议一条 policy evaluation 至少记录：

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
- `reason`
- `evaluationStartedAt`
- `decisionAt`
- `completedAt`

只要缺一条完整记录，后面都会出现很难排查的问题：

- 为什么这个 turn 没续跑
- 为什么这里重复 steer 了
- 为什么 automation 线程自己停掉了

## 5. 成本指标定义

### 5.1 `单位收益附加成本`

这个指标用来防止系统进入“质量是提高了，但成本不可控”的状态。

建议同时统计：

- 每命中 100 次 policy，多出来多少个 turn
- 每命中 100 次 policy，多出来多少条命令执行
- 每挽救 1 次“无验证结束”，平均多消耗多少 token

第一阶段不建议给它设过死的阈值，更合理的做法是：

- 先观测
- 和 `无验证结束率`、`自动纠偏成功率` 一起看

如果质量明显提升，而附加 turn 只增加 5% 到 15%，通常是可接受的。

如果附加成本很高但质量没有提升，就要回头查：

- 规则过宽
- continuation prompt 不够聚焦
- 命令分类把非验证命令误算成验证命令

### 5.2 `无效补轮率`

建议补一个反向成本指标：

- 因 policy 补出来的 turn 中，没有新增有效命令、没有新增有效 file change、也没有改变最终结论的次数 / follow-up 总数

它可以帮助判断：

- 当前 follow-up 规则是在真正补救
- 还是只是在制造噪声

## 6. 自动化 / Bot 专项指标

`codex-server` 已经有 `automations.Service` 和 bot 相关机制，所以这套策略层的收益不能只在“手工聊天线程”上评估。

建议专项看 3 个指标。

### 6.1 `无人值守补救率`

建议口径：

- 分母：automation / bot 来源线程中命中 policy 的次数
- 分子：这些线程在没有人工介入的情况下最终完成的次数

这项指标高，才能证明：

- 新架构不仅让人工协作更省心
- 也让自动化流程更可靠

### 6.2 `自动化最终成功率`

建议在上线前后对比：

- automation 线程最终状态为成功完成的比例

如果前后对比中：

- `policy 命中次数` 上升
- `最终成功率` 也上升

这通常是好信号，说明策略层在“兜底”，而不是纯粹增加复杂度。

### 6.3 `人工追回率`

建议定义为：

- automation / bot 线程完成后，在短时间窗口内仍需要人工再次 `turn/start` / `turn/steer` 的次数 / automation / bot 完成次数

这个指标下降，说明系统真正减少了“看似自动化，最后还是要人补刀”的情况。

## 7. 事件口径与现有实现的映射

### 7.1 现有项目里已经能直接复用的信号

从当前实现看，下面这些已经可以直接作为第一版指标数据源：

- `EventEnvelope`
  - 位置：`backend/internal/store/models.go`
- `events.Hub.SubscribeAll()`
  - 位置：`backend/internal/events/hub.go`
- `ThreadProjection`
  - 位置：`backend/internal/store/thread_projection.go`
- `automations.Service` 的幂等模式
  - 位置：`backend/internal/automations/service.go`

当前现成可用的关键事件：

- `item/completed`
- `turn/completed`
- `item/commandExecution/outputDelta`
- `server/request/resolved`
- `server/request/expired`

这些已经足以支持：

- turn 级结果判断
- item 级失败检测
- `PostToolUse` 与 `Stop` 的大部分首期 KPI

### 7.2 一个需要明确说清的实现事实

当前 `codex-server` 的 store 侧并不是“持久化全部原始事件流”，而是“基于事件更新 thread projection”。

这意味着：

- 如果只是把 `turnpolicy/evaluated` 之类的自定义事件发布到 `events.Hub`
- 但没有新增专门持久化路径

那么这些事件不会天然变成可追溯的历史指标数据。

原因是：

- `events.Hub.Publish()` 会把事件送给订阅者和 store
- 但 `store.ApplyThreadEvent()` 只会在事件能改变 projection 时持久化
- 对未知的 `turnpolicy/*` method，projection 通常会忽略

因此，第一版若想做可靠 KPI，不能只依赖“发一个自定义事件”。

更稳妥的做法有两个：

- 新增一份专用的 `turn policy decision` 持久化记录
- 或把指标直接打到独立 metrics sink / tracing sink

如果只允许做最小改动，优先建议第一种。

## 8. 推荐新增的最小审计记录

建议新增一类轻量记录，例如：

```text
TurnPolicyDecision
  id
  workspaceId
  threadId
  turnId
  itemId
  triggerMethod
  policyName
  fingerprint
  verdict
  action
  actionStatus
  reason
  evidenceSummary
  evaluationStartedAt
  decisionAt
  completedAt
  source            // user / automation / bot
```

有了这张“决策事实表”，第一阶段大多数 KPI 就都能稳定落地：

- 结果指标可以和 `ThreadProjection` 对账
- 健康指标可以直接从决策记录聚合
- 成本指标可以补充 token / turn / command 数
- 自动化指标可以用 `source` 或 automation 关联字段筛分

## 9. 推荐的阶段性验收方式

### 9.1 Phase 0：先打基线

在真正上线 policy 之前，先用现有 thread projection 跑一版离线基线：

- 含 file change 的 completed turn 总量
- 其中缺少验证信号的比例
- 含失败验证命令的 completed turn 比例
- automation / bot 线程完成后被人工追回的比例

没有基线，后面就只能靠主观感受判断“是不是变好了”。

### 9.2 Phase 1：只上两条高价值规则

建议第一阶段只做：

- 测试命令失败 -> `turn/steer`
- 改了文件但没验证 -> follow-up `turn/start`

并只验收下面 5 个指标：

- `无验证结束率`
- `失败后直接结束率`
- `自动纠偏成功率`
- `策略决策延迟 P95`
- `重复动作率`

只要这 5 个指标同时健康，说明这层架构方向基本成立。

### 9.3 Phase 2：再扩展治理与自动化指标

第二阶段再补：

- 高风险路径自动 interrupt
- bot / automation 专项补救
- 策略命中原因在前端可视化

这时再把下面指标拉上来：

- `无人值守补救率`
- `人工追回率`
- `审计覆盖率`
- `单位收益附加成本`

## 10. 不建议拿来当北极星的伪指标

下面这些数字很容易看起来“很热闹”，但不能单独证明价值：

- `policy 命中次数`
  - 命中多不代表命中对
- `自动续跑总次数`
  - 续跑多也可能只是噪声多
- `steer 调用次数`
  - 有可能是重复动作
- `新增 turn 总数`
  - 增加的 turn 可能是收益，也可能是浪费

真正要看的始终是：

- 完成质量有没有提升
- 失败是否更少被放过
- 无人值守成功率有没有提升
- 附加成本是否可接受

## 11. 最小实施顺序建议

建议实施顺序如下：

1. 先离线计算一版基线，确认当前“无验证结束率”和“失败后直接结束率”。
2. 在 `turnpolicies.Service` 落地时，同时补一份最小 `TurnPolicyDecision` 持久化记录。
3. 第一阶段只上线两条规则，不要一开始就把所有治理规则一起打开。
4. 每周抽样复盘命中的 20 到 50 个线程，校验指标定义是否和人工判断一致。
5. 等指标稳定后，再考虑前端展示“为什么被自动续跑 / interrupt”。

## 12. 一句话总结

这套新架构最大的效益，本质上应该体现在：

- 更少“看起来完成，其实没收口”的线程
- 更少失败后直接收尾的 turn
- 更高的无人值守完成率
- 更强的可审计与可排障能力

而要证明这些效益，第一阶段最关键的不是做很多规则，而是把：

- `无验证结束率`
- `失败后直接结束率`
- `自动纠偏成功率`
- `策略决策延迟`
- `重复动作率`

这 5 个指标先做准。
