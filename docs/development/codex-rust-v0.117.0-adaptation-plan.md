# Codex `rust-v0.117.0` Web Adaptation Plan

更新时间：2026-03-27

## 1. 背景

`openai/codex` 的 `rust-v0.117.0` 引入了多项与 `app-server` 直接相关的新能力和行为调整，包括：

- 插件工作流一等化
- `thread/shellCommand` 正式进入 `app-server` API surface
- `app-server` 客户端可发送 `!` shell 命令
- `command/exec` 输出的 backpressure / batching 改进
- `mcpServer/startupStatus/updated` 等新的状态通知

当前仓库已经通过 Go 后端桥接 `codex app-server --listen stdio://`，并在前端暴露线程、命令执行、插件、MCP 状态和配置入口。因此本次适配目标不是追 TUI 专属行为，而是补齐 Web 版实际受益的能力面。

## 2. 目标

本轮适配的目标如下：

1. 让插件在 Web 版里成为真实的 runtime inventory，而不是仅显示 marketplace 占位信息。
2. 为 composer 增加 `!` shell 快捷路径，和 `thread/shellCommand` 能力对齐。
3. 对新的 MCP / 插件状态通知做兼容和必要联动。
4. 验证 `command/exec` 在 `v0.117.0` 下的高输出稳定性。

## 3. 范围

### 3.1 P0

- 升级 `/api/workspaces/:workspaceId/plugins`
  - 后端保留真实 plugin 列表
  - 暴露安装、启用、鉴权、来源等元信息
  - 暴露 `remoteSyncError`
- 升级 Catalog 页面插件展示
  - 从 marketplace 视角切换到 plugin 视角
  - 直接展示安装态、启用态、安装策略、鉴权策略、来源和 capabilities
- 保持 `plugin/read` / `plugin/install` / `plugin/uninstall` 现有链路兼容

### 3.2 P1

- 在线程 composer 中支持 `!<command>` 直达 `thread/shellCommand`
- 对 `mcpServer/startupStatus/updated` 等状态类通知做查询刷新联动
- 回归 `command/exec` 在高输出场景下的 WebSocket / resume 行为

### 3.3 P2

- 同步 schema fixture 和开发文档
- 补充面向 `v0.117.0` 的验收说明

## 4. 非目标

本轮不优先处理以下内容：

- `tui_app_server` 专属 UI 行为
- `/title`、prompt history 等 TUI 体验项
- 远程 websocket transport 的完整接入
- filesystem watch 的独立产品化 UI

## 5. 实施顺序

### 阶段 A：插件工作流一等化

目标：先打通最有收益的一条链路。

执行项：

1. 后端 flatten `plugin/list` 的 marketplace 响应，生成真实 plugin inventory。
2. 前端改为消费新的插件列表结构。
3. Catalog 页面展示 plugin 状态、来源和能力。
4. 如果存在 `remoteSyncError`，前端显式提示，而不是静默忽略。

### 阶段 B：`!` shell 快捷路径

目标：把 `v0.117.0` 的 shell 快捷能力映射到现有 Web 交互。

执行项：

1. 在线程 composer 提交前增加命令前缀判断。
2. 将 `!cmd` 分流为 `thread/shellCommand`。
3. 保留普通自然语言消息走 `turn/start`。
4. 在 UI 上标明该路径是 unsandboxed full access。

### 阶段 C：事件与稳定性

目标：让新通知和新输出节奏在 Web 端可感知且可验证。

执行项：

1. 对 MCP 状态通知做查询刷新联动。
2. 回归 `command/exec` 批量输出和 resume。
3. 检查断线重连后终端输出是否完整。

## 6. 验收标准

- 插件列表展示真实 plugin，而不是只展示 marketplace。
- 插件项能看到至少以下字段：
  - `installed`
  - `enabled`
  - `authPolicy`
  - `installPolicy`
  - `marketplaceName`
  - `sourceType`
  - `capabilities`
- `remoteSyncError` 在前端可见。
- `plugin/read` / `plugin/install` / `plugin/uninstall` 不回退。
- 后续阶段完成后：
  - `!pwd` 之类输入走 `thread/shellCommand`
  - 普通消息仍走 `turn/start`
  - 高输出 `command/exec` 不出现明显回放缺口

## 7. 当前执行状态

- [x] 制定 `v0.117.0` 适配计划
- [x] 完成插件 inventory 升级
- [x] 完成 Catalog 页面插件状态展示与 `remoteSyncError` 告警
- [x] 完成 Catalog 页面插件行内 `read/install/uninstall` 操作
- [x] 完成 composer `!` shell 分流
- [x] 为 `!` shell 快捷路径补充 full access 提示
- [x] 完成 `mcpServer/startupStatus/updated` 的线程页查询刷新联动
- [x] 完成 `command/exec` 高输出 / resume 单元级稳定性回归
- [x] 完成插件行内操作与 `!` shell shortcut 的浏览器级执行验证
- [x] 修复标准 Playwright runner 在当前 Node 24 环境下的执行入口
- [x] 修复线程页自动加载旧消息时缺失 `older-turn-restore` 的滚动回归

## 8. 本次已落地内容

### 8.1 插件 inventory 升级

- 后端已将 `plugin/list` 的 marketplace 响应 flatten 为真实 plugin inventory。
- 前端 Runtime Catalog 已切换为 plugin 视角展示，不再只显示 marketplace 占位信息。
- 插件项已展示 `installed`、`enabled`、`authPolicy`、`installPolicy`、`sourceType`、`sourcePath`、`capabilities` 等信息。
- `remoteSyncError` 已在 Catalog 页面显式提示。
- 插件安装 / 卸载成功后，页面会主动刷新 runtime catalog 与 MCP 状态查询。
- Catalog 页的插件列表已支持行内 `Read` / `Install` / `Uninstall`，不再只能依赖底部手工填写的操作表单。

### 8.2 `!` shell 快捷路径

- 线程 composer 已支持单行 `!<command>` 分流到 `thread/shellCommand`。
- 普通自然语言消息仍沿用 `turn/start`。
- 输入命中 `!` shell 快捷路径时，composer 会显示这条路径是 unsandboxed full access。

### 8.3 MCP 状态通知联动

- 线程页已对 `mcpServer/startupStatus/updated` 和 `mcpServer/oauthLogin/completed` 做查询刷新联动。
- 线程页收到 `skills/changed`、`app/list/updated` 等 workspace 级事件时，也会标记 runtime catalog 为过期，避免后续进入 Runtime 页面时继续看到旧缓存。

### 8.4 `command/exec` 回归补强

- 前端新增 `session-store` 回归测试，覆盖以下高风险路径：
  - replay append 批量合并
  - replay replace 全量替换
  - `command/exec/stateSnapshot` 不应抹掉已缓存输出
  - `command/exec/completed` 仅补齐缺失尾部输出
- 后端已补跑并确认以下已有测试继续通过：
  - runtime manager 的 `outputDelta` batching / splitting
  - execfs 的 resume append / replace 逻辑
  - execfs 的 completed output 去重与补尾逻辑

### 8.5 浏览器级执行验证

- 已新增 Playwright 场景文件：
  - `frontend/playwright/runtime-plugin-and-shell-shortcut.spec.ts`
- 已新增可直接执行的浏览器验证脚本：
  - `frontend/playwright/runtime-plugin-and-shell-shortcut.verify.cjs`
  - `frontend/package.json` 脚本：`npm run test:e2e:runtime-verify`
- 已新增 Playwright CLI 包装脚本：
  - `frontend/playwright/run-playwright.cjs`
  - `frontend/package.json` 脚本：
    - `npm run test:e2e`
    - `npm run test:e2e:list`
    - `npm run test:e2e:runtime`
    - `npm run test:e2e:headed`
- 已修正 `frontend/playwright.config.ts` 的 `webServer.command`，改为直接调用 `npx vite --host 127.0.0.1 --port 4173`，避免原先通过 `npm run dev -- --host ... --port ...` 在当前环境下把参数错误转发给 Vite。
- 已定位当前环境中 `playwright test` 直接调用卡住的根因与 `PW_DISABLE_TS_ESM` 相关。Node `v24.14.0` 下，Playwright `1.52.0` 在配置加载阶段会默认走 TS ESM loader 注册链路；在本仓库当前环境里，这条链路会导致 runner 无输出卡住。
- 现已通过 `frontend/playwright/run-playwright.cjs` 将 `PW_DISABLE_TS_ESM=1` 固化到标准 npm 脚本入口，因此 `npm run test:e2e` 和 `npm run test:e2e:headed` 已恢复为可执行状态。
- 在 runner 入口修复前，本轮浏览器回归先使用 Playwright 浏览器库脚本直接执行；其结果如下：
  - Runtime 页面插件行内 `Read` / `Install` / `Uninstall` 全部命中预期接口
  - 插件安装与卸载均触发 runtime catalog 刷新，`plugin/list` 共被重新拉取 3 次
  - 线程页输入 `!pwd` 后，提交路径命中 `thread/shellCommand`
  - 同一场景中普通 `turn/start` 提交次数保持为 0，确认 `!` 分流没有误走普通聊天提交
- 在 runner 入口修复后，以下标准命令已可正常执行：
  - `npm run test:e2e:list`
  - `npm run test:e2e:runtime`
  - `npm run test:e2e`
- 随后已修复线程页自动加载旧消息时未捕获 preserve-position 锚点的问题。`ThreadWorkbenchSurface` 现在会在自动加载旧消息前与手动点击“Load earlier turns”一样，先捕获锚点，再发起加载，因此 `older-turn-restore` 会在旧消息拼接后恢复视口位置。
- 目前 `npm run test:e2e` 已全量通过，说明标准 runner 入口和线程滚动回归都已收口。

## 9. 已完成验证

- `backend/internal/catalog/service.go` 已执行 `gofmt`
- `backend/internal/catalog/service_test.go` 已执行 `gofmt`
- `backend` 目录已执行 `go test ./internal/catalog`
- `backend` 目录已执行 `go test ./internal/runtime ./internal/execfs`
- `frontend` 目录已执行 `npx vitest run src/pages/thread-page/threadShellShortcut.test.ts`
- `frontend` 目录已执行 `npx vitest run src/stores/session-store.test.ts src/pages/thread-page/threadShellShortcut.test.ts`
- `frontend` 目录已执行 `npm run build`
- 已通过 Playwright 浏览器库脚本执行 Runtime / Thread 两个关键回归场景
- `frontend` 目录已执行 `npm run test:e2e:runtime-verify`
- `frontend` 目录已执行 `npm run test:e2e:list`
- `frontend` 目录已执行 `npm run test:e2e:runtime`
- `frontend` 目录已执行 `npm run test:e2e`
- `frontend` 目录已执行 `npx vitest run src/pages/thread-page/ThreadWorkbenchSurface.test.tsx`
