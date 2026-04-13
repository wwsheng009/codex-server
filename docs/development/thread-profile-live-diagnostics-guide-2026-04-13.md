# Thread Profile / Live Diagnostics 开发者使用说明

更新时间：2026-04-13  
适用范围：`frontend` 线程页 `Diagnostics / Thread Profile` 面板

---

## 1. 文档目的

本文档用于说明当前线程页诊断面板的用途、使用方法、排查顺序、导出结构，以及在定位“后端实时消息到了，但前端没显示 / 显示慢 / 显示位置不对”这类问题时，应该如何阅读面板输出。

当前实现已经不再只是控制台调试，而是一个接入正式数据管道的小型前端诊断平台。

面板当前覆盖三类诊断数据：

1. **Render**
   - React Profiler 提交开销
2. **Scroll**
   - 视口滚动、自动滚动、虚拟列表布局变化
3. **Live**
   - Realtime stream、baseline filter、snapshot reconcile、renderer fallback、viewport/unread、item lifecycle、自动根因摘要

---

## 2. 面板入口与核心代码位置

### 面板入口

- 线程页右侧 Rail 区域中的 `Profile` 按钮

### 核心文件

- 面板与 store：
  - `frontend/src/components/workspace/threadConversationProfiler.tsx`
  - `frontend/src/components/workspace/threadConversationProfilerTypes.ts`
- 面板挂载：
  - `frontend/src/pages/thread-page/ThreadWorkbenchRailWorkspaceContextSection.tsx`

### 主要 Live 诊断埋点

- stream 接收 / flush：
  - `frontend/src/hooks/useWorkspaceStream.ts`
- baseline filter / replay / reconcile：
  - `frontend/src/pages/threadLiveState.ts`
- renderer placeholder / suppression：
  - `frontend/src/components/workspace/renderers.tsx`
- thread detail refresh：
  - `frontend/src/pages/thread-page/useThreadPageRefreshEffects.ts`
- viewport / unread / jump-to-latest：
  - `frontend/src/pages/thread-page/useThreadViewportAutoScroll.ts`

---

## 3. 如何使用

### 基本操作

1. 打开线程页
2. 点击 `Profile`
3. 根据问题类型开启采集：
   - `Record Render`
   - `Record Scroll`
   - `Record Live`
4. 复现问题
5. 查看面板或点击 `Export`

### 推荐采集策略

#### 场景 A：后端消息到了，但前端没显示

建议至少开启：

- `Record Live`

如果怀疑视口或滚动问题，再加：

- `Record Scroll`

#### 场景 B：消息最终显示了，但明显延迟

建议开启：

- `Record Live`
- `Record Render`

必要时加：

- `Record Scroll`

#### 场景 C：滚动抖动、跳到底部、看不到新消息

建议开启：

- `Record Scroll`
- `Record Live`

---

## 4. Live 面板当前包含哪些信息

### 4.1 Summary chips

面板顶部会显示一些聚合计数，例如：

- `events`
- `received`
- `flushes`
- `filtered`
- `replayed`
- `reconcile`
- `refresh`
- `viewport`
- `fallbacks`
- `last`

这些字段用于快速判断问题处于哪一层：

- **received / flushes**：transport 与前端批处理
- **filtered / replayed**：baseline 策略
- **reconcile / refresh**：snapshot 刷新与对齐
- **viewport**：detached / unread / jump-to-latest
- **fallbacks**：placeholder / suppression

### 4.2 当前状态摘要

Live section 顶部还会显示当前运行时状态：

- `selected thread`
- `follow mode`
- `pinned`
- `unread`
- `last live`
- `last refresh`

这部分用来判断“当前页面视图”是不是问题的一部分，而不是只看历史事件。

### 4.3 Recent live records

展示最近的 live 事件记录，适合按时间线查看：

- 事件由哪个 source 记录
- 是哪种 kind
- 关联的 method / itemType / turnId / itemId
- reason 或关键长度信息

### 4.4 Latest item lifecycle

按 `turnId:itemId` 聚合的 item 生命周期摘要，当前会显示：

- itemType
- turnId / itemId
- started / completed / 最后事件类型
- delta 次数
- filtered 次数
- replayed 次数
- final text length
- 是否 placeholder
- 是否 suppressed

这部分非常适合回答：

> “为什么这条 item 看起来开始了，但最终没显示完整内容？”

### 4.5 Suspected root causes

自动根因摘要，用于快速判断大方向。

例如可能提示：

- 视口 detached / unread 导致“消息到了但当前没看到”
- baseline filtering 主导
- snapshot refresh/reconcile 影响时序
- renderer fallback 参与
- flush / 下游 state/render 更可能是瓶颈

### 4.6 Top problem items

自动选出最值得优先排查的 item，并附带 evidence。

---

## 5. 当前支持的 Live 事件类型

### stream / ingest

- `stream-received`
- `stream-batch-flush`
- `stream-deferred-flush`

### baseline / replay

- `baseline-filtered`
- `baseline-replayed`

### snapshot / reconcile

- `snapshot-reconciled`
- `snapshot-trailing-item-preserved`

### refresh / viewport

- `thread-detail-refresh-requested`
- `unread-marked`
- `jump-to-latest`
- `viewport-detached`

### renderer

- `timeline-placeholder`
- `timeline-suppressed`

---

## 6. 推荐排查顺序

定位“后端消息到了但前端没显示”时，建议按下面顺序看：

### 第一步：先看 transport

检查：

- 是否有 `stream-received`

如果没有：

- 先排查后端是否确实发送、前端是否真正订阅到该线程

如果有：

- 继续看 flush、baseline、render

### 第二步：看 flush

检查：

- `stream-batch-flush`
- `stream-deferred-flush`

如果收到 event，但 flush 明显滞后：

- 更可能是前端调度 / 批处理时序问题

### 第三步：看 baseline

检查：

- `baseline-filtered`
- `baseline-replayed`

判断：

- 是直接被 stale 判定过滤掉
- 还是虽然旧，但因为内容更完整，又 replay 回来了

### 第四步：看 snapshot / refresh

检查：

- `snapshot-reconciled`
- `snapshot-trailing-item-preserved`
- `thread-detail-refresh-requested`

判断：

- live state 是否被 snapshot 对齐覆盖
- refresh 是否让内容“后补显示”

### 第五步：看 renderer

检查：

- `timeline-placeholder`
- `timeline-suppressed`

判断：

- 是没渲染，还是已经进入 fallback placeholder
- 是内容为空被 suppress，还是最终被卡片占位

### 第六步：看 viewport / 可见性

检查：

- `viewport-detached`
- `unread-marked`
- `jump-to-latest`
- 当前状态区的 `follow` / `pinned` / `unread`

判断：

- 不是没来，而是用户当前没在 latest 位置

### 第七步：最后看 lifecycle

定位具体 item：

- started 了没有
- delta 来了几次
- 有没有 completed
- 最终 text 长度多大
- 有没有被 filtered/replayed/suppressed

---

## 7. 如何解读常见异常模式

### 模式 A：`stream-received` 有，但没有显示

优先看：

- baseline filtered?
- timeline suppressed?
- viewport detached / unread?

### 模式 B：`stream-received` 与 delta 都有，但 item 仍是空壳

优先看：

- lifecycle 中 `deltaCount`
- `finalTextLength`
- `timeline-placeholder`
- `timeline-suppressed`

### 模式 C：旧事件后来才补回内容

通常会看到：

- `baseline-filtered`
- `baseline-replayed`
- `snapshot-reconciled`

说明：

- 不是 transport 丢了，而是 state / snapshot 策略影响了可见性

### 模式 D：用户说“看不到”，但系统链路其实完整

通常会看到：

- `stream-received`
- `viewport-detached`
- `unread-marked`
- `jump-to-latest`

说明：

- 问题更偏 UI 可见性，而非数据丢失

---

## 8. 导出 JSON 如何阅读

点击 `Export` 后，会导出一个 JSON 诊断包。

### 推荐阅读顺序

#### 第一层：`diagnosticOverview`

最适合快速了解结论：

- `currentStatus`
- `likelyRootCauses`
- `topProblemItems`
- `topSuggestions`

#### 第二层：`liveDiagnostics.summary`

适合看结构化摘要：

- 聚合计数
- `status`
- `latestItemLifecycle`
- `suspectedRootCauses`
- `topProblemItems`

#### 第三层：`liveDiagnostics.events`

适合看原始证据链，验证时间线和单条事件细节。

### 适合分享给谁

该导出包适合发给：

- 前端开发
- 负责实时消息流的开发
- 负责线程状态对齐与 snapshot 刷新的开发
- 做用户复现与回归验证的测试同学

---

## 9. 当前实现能力边界

当前已经覆盖：

- stream 收到什么
- 有没有 flush
- baseline 是否过滤 / replay
- snapshot 是否对齐或保留 live item
- renderer 是否 placeholder / suppress
- 当前线程是否 detached / unread
- 最近一次 refresh / live event
- item 生命周期聚合
- 自动根因摘要
- Top problem items
- 导出 JSON 诊断摘要层

换句话说，当前面板已经足以覆盖大部分：

> “后端回了，但前端为什么没显示 / 为什么显示慢 / 为什么用户没看到”

这类问题。

---

## 10. 建议的日常使用 SOP

### 针对单个复现问题

1. 打开线程页
2. 点击 `Profile`
3. 开启 `Record Live`
4. 如怀疑视口问题，再开 `Record Scroll`
5. 复现问题
6. 先看：
   - `diagnosticOverview`
   - `Suspected root causes`
   - `Top problem items`
7. 再看：
   - `Latest item lifecycle`
   - `recent live records`
8. 需要共享时点 `Export`

### 针对回归验证

建议在以下场景各抓一份：

- 正常 streaming
- 线程切换后立即收到消息
- detached 状态下收到消息
- snapshot refresh 后内容补齐

这样更容易建立“正常 capture 长什么样”的基线。

---

## 11. 后续建议

如果后续继续增强，建议优先做这些而不是继续扩散埋点：

1. 面板内增加一键复制诊断摘要
2. Top problem items 增加 severity / confidence
3. export 文件名可带 `threadId`
4. 对 lifecycle 增加“仅异常项”过滤
5. 将本说明链接到开发文档索引或面板帮助入口

