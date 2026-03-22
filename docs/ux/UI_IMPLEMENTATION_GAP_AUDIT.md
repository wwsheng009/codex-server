# UI 实现差距审计 (UI Implementation Gap Audit)

本页审计 `docs/ux` 当前定义的目标 UI，与 `frontend/src` 实际实现之间的差距。目标不是做代码 review，而是给设计、产品和前端一份共同可排期的 UI backlog。

## 1. 审计范围

本次比对主要覆盖:

- `../../frontend/src/app/router.tsx`
- `../../frontend/src/components/shell/AppShell.tsx`
- `../../frontend/src/components/shell/SettingsShell.tsx`
- `../../frontend/src/pages/WorkspacesPage.tsx`
- `../../frontend/src/pages/ThreadPage.tsx`
- `../../frontend/src/pages/thread-page/*.tsx`
- `../../frontend/src/pages/AutomationsPage.tsx`
- `../../frontend/src/pages/AutomationDetailPage.tsx`
- `../../frontend/src/pages/SkillsPage.tsx`
- `../../frontend/src/pages/CatalogPage.tsx`
- `../../frontend/src/pages/settings/*.tsx`
- `../../frontend/src/pages/RouteErrorPage.tsx`

审计时间: `2026-03-21`

## 2. 对齐较好的区域

以下区域已经具备较强的实现基础，设计文档与代码结构基本一致:

- **Shell 结构稳定**: `AppShell` 与 `SettingsShell` 已实现双壳层结构、移动端折叠与侧栏尺寸状态。
- **Thread Workspace 已是高复杂度工作台**: thread surface、composer、surface panel、terminal dock、mobile overlay 和 confirm dialog 都已存在。
- **Automations 流程可成立**: 目录页、创建 modal、模板 modal、详情页和 run modal 都有实现锚点。
- **恢复路径已落地**: root/app/settings/settings-panel 四级 route error 都已有实现。
- **设置中心覆盖面较高**: general、appearance、config、environment、archived threads 等页面已有明显状态稿锚点。

这意味着后续工作不应再停留在“重新发明结构”，而应集中处理缺态、统一性和高风险动作。

## 3. 最近已收敛

以下缺口已在 `2026-03-21` 收敛到代码:

- [WorkspacesPage.tsx](../../frontend/src/pages/WorkspacesPage.tsx) 已补 `empty-state`、显式加载失败提示和 `retry`。
- [SkillsPage.tsx](../../frontend/src/pages/SkillsPage.tsx) 已补 workspace/local/remote 查询失败提示。
- [AutomationDetailPage.tsx](../../frontend/src/pages/AutomationDetailPage.tsx) 已补删除确认层。
- [AppShell.tsx](../../frontend/src/components/shell/AppShell.tsx) 与 [CommandPalette.tsx](../../frontend/src/components/shell/CommandPalette.tsx) 已补全局 `Command Palette`、菜单栏入口和 `Ctrl/Cmd + K`。

## 4. P0 缺口

| Gap | Evidence | Impact | Recommended Action |
| :--- | :--- | :--- | :--- |
| 产品语言不一致 | `CatalogPage.tsx`、`ConfigSettingsPage.tsx`、`threadPageComposerShared.tsx`、`ThreadComposerDock.tsx` 同时存在中英文 UI 字符串。 | 破坏 UI 文案一致性，也阻碍本地化策略。 | 先决定 UI 主语言，再建立 string inventory 和统一文案层。 |

## 5. P1 缺口

| Gap | Evidence | Impact | Recommended Action |
| :--- | :--- | :--- | :--- |
| Header 家族未被正式制度化 | 顶层页面同时使用 `mode-strip`、`PageHeader`、`SettingsPageHeader` 三套头部结构。 | 设计稿容易各画各的，页面间节奏和 spacing 容易漂移。 | 在组件规格与 Figma 中正式定义三类 header redline。 |
| Workspaces 扩展性不足 | `WorkspacesPage.tsx` 当前只有 registry 列表，没有搜索、筛选、排序或 density 控件。 | 当 workspace 数量增长时，可扫描性下降。 | 先在设计稿里预留 toolbar 区，再决定是否进入实现。 |
| Mobile frame 与代码能力未完全对齐 | `AppShell` 与 `ThreadPageLayout` 已有移动端折叠/overlay 逻辑，但现有文档还缺完整 frame 名册。 | 移动端行为存在，但 handoff 不足。 | 以 [FIGMA_FRAME_INVENTORY.md](./FIGMA_FRAME_INVENTORY.md) 为准补齐移动态。 |
| Success state 文档不足 | Runtime、Automations、Settings 中大量使用 error/loading/empty，但成功提交后的反馈形态没有集中定义。 | 页面会用各自方式提示成功，长期容易碎片化。 | 补一份 success/confirmation 反馈稿，统一 notice 或 inline confirmation 形态。 |

## 6. P2 缺口

| Gap | Evidence | Impact | Recommended Action |
| :--- | :--- | :--- | :--- |
| Token machine-readable source 仍停留在文档级 | 当前有 [DESIGN_TOKENS_SOURCE.md](./DESIGN_TOKENS_SOURCE.md)，但尚未形成可直接对接设计工具的 token JSON。 | Figma Variables 和前端 token 的双向映射仍需手工维护。 | 增加 token JSON 草案或脚本化导出。 |
| Skills 页面仍偏目录浏览 | `SkillsPage.tsx` 重点是浏览与搜索，不承担安装、比较、详情等更丰富的交互。 | 如果后续技能操作变多，当前版式会不够。 | 暂不前置实现，先在 page blueprint 中保留扩展位。 |

## 7. 结构性结论

当前系统并不是“没有 UI”，而是已经有一套相当完整的工作台骨架。真正的差距集中在 3 类问题:

1. **模式存在、规则未制度化**: header family、success feedback、语言治理。
2. **设计资产仍需补齐**: 完整移动端 frame、token JSON、success-state 系统化。
3. **目录型页面仍有扩展压力**: workspaces 扩展性、skills 深度操作能力。

这类问题适合通过“先补设计稿，再补实现”的方式处理，而不是再扩写原则文档。

## 8. 建议排期顺序

建议按以下顺序收敛:

1. 统一 header 家族和语言策略。
2. 补完整移动端 frame 与 success feedback 规范。
3. 再处理 token JSON 与目录页扩展性。

具体分波次见 [UI 交付顺序](./UI_DELIVERY_SEQUENCE.md)。

## 9. 关联文档

- [Figma Frame 清单](./FIGMA_FRAME_INVENTORY.md)
- [设计验收清单](./DESIGN_ACCEPTANCE_CHECKLIST.md)
- [关键原型流](./PROTOTYPE_USER_FLOWS.md)

---
*这份审计的重点不是“代码好不好”，而是“设计目标和产品现状之间，哪些差距最值得先填”。*
