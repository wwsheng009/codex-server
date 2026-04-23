# codex-server

基于 `Go + React + Vite + codex app-server` 的 Web 版 Codex 应用。

## 目录

- `docs/`：架构与方案文档
- `backend/`：Go 后端网关 / BFF 骨架
- `frontend/`：React + Vite 前端骨架

## 当前状态

当前已完成：

- `docs/system-design.md`：总体架构与实施规划
- `docs/bots/bot-connection-and-provider-reference.md`：bot 连接原理、现有配置能力与 Feishu / QQ / QQ Bot 扩展参考
- `docs/bots/feishu/feishu-bot-provider-implementation-plan.md`：Feishu Bot Provider 实施文档
- `docs/bots/qqbot/qqbot-provider-implementation-plan.md`：QQ Bot Provider 实施文档
- `backend/`：Go 服务入口、模块目录、REST/WS 骨架、真实 `codex app-server` stdio runtime 桥接
- workspace 与线程元数据已落盘到 `CODEX_SERVER_STORE_PATH` 指定的 JSON 文件
- `frontend/`：React + Vite 单页应用骨架、路由、React Query、Zustand、工作区/线程/审批页面
- 账号页支持 `API Key` / `ChatGPT` 登录入口
- 审批抽屉支持基础审批和 `requestUserInput` 问题填写
- 聊天页支持独立 `command/exec` 终端面板和流式输出展示
- 线程工作台右侧工具区支持在 `command/exec` 与 `thread/shellCommand` 之间切换执行单条命令
- 后端已内嵌 `turnpolicies.Service`，支持“验证失败自动 `turn/steer`”与“改了文件但缺少成功验证时自动 follow-up `turn/start`”
- 后端已补 `turn-policy-decisions` / `turn-policy-metrics` 只读接口，thread 工作台右侧 rail 已展示最近 policy decisions 与 thread 级 KPI summary
- 线程详情支持基于 `thread/read` 的历史 turn / item 回放
- 历史回放已按 `userMessage / agentMessage / plan / reasoning / commandExecution / fileChange` 分类渲染
- `Live Events` 区也已升级为专用事件卡片，而不是原始 JSON
- `Live Events` 已合并 thread 级与 workspace 级事件，覆盖连接、审批、终端、状态更新等卡片
- `Live Events` 中的 agent/reasoning/command delta 已按 `itemId` 或 `processId` 聚合显示
- 审批抽屉支持 `mcpServer/elicitation/request` 的动态表单渲染
- 后端已补 `fs/read-directory`、`fs/metadata`、`fs/mkdir`、`fs/remove`、`fs/copy`
- 后端已补 `plugins/read`、`plugins/install`、`plugins/uninstall`
- 后端已补 `config/read`、`config/write`、`config/batch-write`、`search/files`
- 后端已补 `config/requirements`、`external-agent/detect`、`external-agent/import`
- 后端已补 `feedback/upload`
- 后端已补 `threads/loaded`、`thread metadata`、`thread compact`
- 后端已补 `skills/config/write`、`experimental-features`、`mcp-server-status`
- 后端已补 `config/mcp-server/reload`、`windows-sandbox/setup-start`
- 前端 `Catalog` / `Settings` 页面已接入 plugin actions、config、external agent detect、fuzzy file search、feedback upload
- 前端 `Settings` 页面已接入 `account/login/cancel` 和 `mcp/oauth/login`
- 前端 `Settings > Config` 页面已接入服务级 runtime shell override、turn 权限策略和 sandboxPolicy 配置，可持久化 `model_catalog_json`、`shell_type` override、默认 `turn/start` 权限与默认 `command/exec` 沙箱策略
- 审批抽屉已支持 `item/tool/call` 与 `account/chatgptAuthTokens/refresh` 的响应表单
- 线程侧栏支持搜索、状态筛选与最近更新时间展示
- 线程侧栏支持最近访问排序、归档分组与内联重命名
- 线程侧栏支持键盘导航：`/` 聚焦搜索，`↑/↓` 切换线程，`Esc` 退出重命名或搜索焦点
- 前端会恢复上次的 workspace/thread 选择、审批抽屉状态和线程侧栏筛选条件

## 开发

开发相关的完整说明见：

- [docs/development/build-package-backup-restore-guide-2026-04-23.md](docs/development/build-package-backup-restore-guide-2026-04-23.md)

推荐开发流程：

1. 启动后端

```powershell
pwsh -File .\scripts\start-backend.ps1
```

2. 启动前端

```powershell
cd .\frontend
npm install
npm run dev
```

3. 提交前执行基础校验

```powershell
cd .\backend
go test ./...

cd ..\frontend
npm run build
npm run i18n:check
```

如果需要生成单二进制发布产物：

```powershell
pwsh -File .\scripts\build-embedded-backend.ps1
```

如果需要迁移当前配置或在升级前留存快照：

```powershell
pwsh -File .\scripts\backup-codex-server-config.ps1 `
  -OutputPath E:\backups\codex-server-config `
  -Force
```

恢复配置：

```powershell
pwsh -File .\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -Force
```

## 启动方式

### 后端

```bash
cd backend
go mod tidy
go run ./cmd/server
```

或直接在 PowerShell 中运行：

```powershell
pwsh -File .\scripts\start-backend.ps1
```

如果你已经编译了 `backend/main.exe`，也可以直接使用内置命令：

```powershell
cd .\backend
.\main.exe server start
.\main.exe server stop
.\main.exe doctor
.\main.exe help
```

兼容旧命令：

```powershell
.\main.exe start
.\main.exe stop
```

不带参数执行 `.\main.exe` 或 `.\main.exe server` 时，行为都等同于 `.\main.exe server start`。

`server start` 启动前会先执行 Codex CLI 自检，确认当前环境可以运行 `codex -V`。如果未安装 `codex`，会提示执行：

```powershell
npm i -g @openai/codex
```

也可以单独运行自检命令：

```powershell
cd .\backend
go run ./cmd/server doctor
```

如果模型意外全部变成 `LocalShell`，可以清理服务级 shell override：

```powershell
pwsh -File .\scripts\reset-runtime-shell-overrides.ps1
```

默认监听：`http://localhost:18080`

可通过环境变量覆盖：

```bash
CODEX_SERVER_ADDR=:18080
CODEX_FRONTEND_ORIGIN=http://0.0.0.0:15173
CODEX_APP_SERVER_COMMAND="codex app-server --listen stdio://"
CODEX_MODEL_CATALOG_JSON=E:/path/to/full-model-catalog.json
CODEX_LOCAL_SHELL_MODELS=gpt-5.3-codex
CODEX_SERVER_STORE_PATH=data/metadata.json
```

当 `CODEX_FRONTEND_ORIGIN` 指向本机回环地址（如 `localhost` / `127.0.0.1`）时，后端会放行同协议下其他本机端口，避免 Vite 自动切到 `15174`、`15175` 时触发开发期 CORS 问题。

当 `CODEX_FRONTEND_ORIGIN=http://0.0.0.0:15173` 时，后端会放行同协议、同端口下的局域网来源，适合手机或其他局域网设备直接访问前端。

### 前端

```bash
cd frontend
npm install
npm run dev
npm test
npm run test:e2e
```

默认地址：`http://localhost:15173`

开发环境下，前端默认走同源 `/api` 与 WebSocket 路径，再由 Vite 代理到 `http://localhost:18080`。

Vite 仍然保留了 `/api` 和 WebSocket 代理能力，默认目标是 `http://localhost:18080`，可用于特殊调试场景。

如需修改代理目标，可设置：

```bash
VITE_API_PROXY_TARGET=http://localhost:18080
```

如需让前端直接请求某个后端地址、绕过 Vite 代理，可设置：

```bash
VITE_API_BASE_URL=http://localhost:18080
```

如需运行前端 Playwright E2E：

```bash
npm run test:e2e:install
npm run test:e2e
```

默认会由 Playwright 自动启动一个本地 Vite dev server。

如果你已经手动启动了前端，也可以复用现有地址：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 npm run test:e2e
```

如果未设置 `VITE_API_BASE_URL`：

- 开发环境默认请求同源 `/api`，由 Vite 代理到后端 `:18080`
- 非开发环境默认也请求当前 origin 下的 `/api`，适合和后端同域部署

### 发布态内嵌前端

当前仓库已支持把 `frontend/dist` 复制到 `backend/internal/webui/dist`，并通过 `go build -tags embed_frontend` 打进后端二进制。

PowerShell：

```powershell
pwsh -File .\scripts\build-embedded-backend.ps1
```

Shell：

```bash
./scripts/build-embedded-backend.sh
```

默认产物：

- Windows：`backend/bin/codex-server-embedded.exe`
- 其他平台：`backend/bin/codex-server-embedded`

可选参数：

- PowerShell：`-PackageManager auto|npm|pnpm`、`-GoBuildTags embed_frontend`、`-OutputPath <path>`
- Shell：`PACKAGE_MANAGER=auto|npm|pnpm`、`GO_BUILD_TAGS=embed_frontend`、`OUTPUT_PATH=<path>`、`PYTHON_BIN=python3`

发布态启用内嵌前端后：

- 浏览器默认访问后端同一个 origin，例如 `http://localhost:18080/`
- SPA 路由会由后端 fallback 到 `index.html`
- 如未显式配置 `CODEX_FRONTEND_ORIGIN`，内嵌模式会优先使用同源或 `CODEX_SERVER_PUBLIC_BASE_URL`，避免 OAuth/回跳地址继续指向开发期 `15173`

### GitHub Actions 发布

仓库已提供 GitHub Release 工作流：

- 工作流文件：`.github/workflows/release.yml`
- 触发方式 1：push `v*` tag，例如 `v0.1.0`
- 触发方式 2：在 GitHub Actions 页面手动触发 `Release`

手动触发时支持输入：

- `release_tag`：要发布的版本 tag；如果远端还不存在，workflow 会自动创建并推送该 tag
- `release_name`：GitHub Release 标题，可留空
- `targets`：要构建的平台列表，默认是 `windows-amd64,windows-arm64,linux-amd64,linux-arm64,darwin-amd64,darwin-arm64`
- `draft`：是否先创建草稿 release
- `prerelease`：是否标记为预发布；如果 tag 本身带 `-`，例如 `v0.2.0-rc1`，也会自动按预发布处理

该工作流会：

- 构建一次前端并执行 `npm run i18n:check`
- 以 `embed_frontend` 方式为目标平台交叉编译后端
- 为每个平台生成 GitHub Release 资产包
- 自动上传 `sha256` 校验清单 `checksums.txt`

## 启用 LocalShell

`codex-server` 本身不直接决定是否暴露 `local_shell`。这个能力来自 Codex 模型元数据里的 `shell_type`，也就是 `ModelInfo.shell_type = "local"`。

当前项目支持两种方式：

1. 直接指定最终模型目录：

```bash
CODEX_MODEL_CATALOG_JSON=E:/path/to/full-model-catalog.json
```

2. 让后端根据配置自动生成 shell type 覆盖目录：

```bash
CODEX_MODEL_CATALOG_JSON=E:/path/to/full-model-catalog.json
CODEX_LOCAL_SHELL_MODELS=gpt-5.3-codex,gpt-5.4
```

当设置了 `CODEX_LOCAL_SHELL_MODELS` 后，后端会：

1. 读取 `CODEX_MODEL_CATALOG_JSON` 指向的完整模型目录
2. 把匹配模型的 `shell_type` 改成 `"local"`（兼容旧环境变量）
3. 在临时目录生成一份派生 catalog
4. 自动把派生 catalog 追加到 `codex app-server` 启动命令

等价于：

```bash
codex app-server --listen stdio:// --config "model_catalog_json=E:/generated/catalog.json"
```

使用步骤：

1. 准备一份完整的模型目录 JSON。
2. 设置 `CODEX_MODEL_CATALOG_JSON` 指向该文件。
3. 设置 `CODEX_LOCAL_SHELL_MODELS`，值为逗号分隔的模型 `slug` 或 `display_name`。
4. 重启 `codex-server` 后端。

注意：

- `model_catalog_json` 是启动时生效的全局覆盖，不是某个 workspace 的局部设置。
- 如果没有设置 `CODEX_MODEL_CATALOG_JSON`，后端会尝试从 `CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`）读取 `model_catalog_json` 作为默认值。
- `CODEX_LOCAL_SHELL_MODELS` 只能基于完整模型目录做派生，不能只靠 `model/list` 响应自动重建，因为 app-server 的 `model/list` 不返回 `shell_type`。
- 如果你要使用 `CODEX_LOCAL_SHELL_MODELS`，不要再把 `model_catalog_json` 手工写进 `CODEX_APP_SERVER_COMMAND`；后端会直接报错，避免派生 catalog 被旧命令遮掉。
- 目录文件必须包含完整模型条目；如果只放一个占位模型，运行时只会看到那一个模型。

现在也可以直接在 `Settings > Config > Runtime Shell Overrides` 页面配置：

- `Model Catalog Path`
- `Default Shell Type`
- `Model Shell Type Overrides (JSON)`
- `Import Model Catalog Template` 按钮会把 `config/model-catalog.json` 复制到受管文件 `config/runtime-model-catalog.json`，自动绑定 `Model Catalog Path`
- `Reset Shell Overrides` 会保留 `Model Catalog Path`，但清空服务级 `Default Shell Type` 和模型级 override，回退到目录文件自身的 `shell_type`
- 配置页右侧的 inspection panels 已切成带图标 tabs，并会记住上次激活项
- 成功 toast 支持动作按钮，可直接打开 `Effective` / `Configured` / `Detected` 对应页签
- JSON 预览支持复制与折叠，字段帮助提示可通过键盘聚焦查看

如果该页面留空，后端会继续回退到环境变量或 Codex 自身配置中的默认值。

要区分两层职责：

- `shell_type` 负责决定模型是否暴露 `local_shell` / shell 能力
- `sandboxPolicy` 才决定 `turn/start`、`command/exec` 是否进入 Codex 自带沙箱

也就是说，把模型改成 `shell_type = "local"` 并不会自动绕过当前 turn 的沙箱；如果你要默认不进入沙箱，需要在 `Settings > Config > Runtime` 里额外配置：

- `Default Turn Approval Policy`
- `Default Turn Sandbox Policy (JSON)`，例如 `{"type":"dangerFullAccess"}`
- `Default Command Sandbox Policy (JSON)`，例如 `{"type":"dangerFullAccess"}` 或 `{"type":"externalSandbox","networkAccess":"enabled"}`
- 线程页右侧 `Workbench Tools` 现在支持在 `command/exec` 与 `thread/shellCommand` 之间切换；后者会直接以 full access 在线程里执行一条 shell 命令

排查这类问题时要区分两层：

- `backend/data/metadata.json` 持久化的是 `codex-server` 自己的 runtime preferences
- `%LOCALAPPDATA%\\Temp\\codex-server\\model-catalog-shell-overrides-*.json` 只是根据当前 preferences 派生出来的临时目录，不是根配置

详细流程见 [docs/runtime-execution-controls.md](docs/runtime-execution-controls.md)。

`shell_environment_policy` 的检查结果和前端配置说明见 [docs/shell-environment-policy.md](docs/shell-environment-policy.md)。

## 下一步建议

- 细化 `docs/` 中的 API 请求/响应 DTO 与鉴权方案
- 完善 `requestUserInput`、更复杂审批 decision 和登录流程
- 将线程索引从当前进程内缓存升级为更稳定的持久层或官方可枚举会话索引
- 将当前 Windows 下为支持流式终端而启用的 `dangerFullAccess` 收敛回审批驱动策略

## 当前验证

- 后端：`go test ./...`
- 前端：`npm test`、`npm run build`、`npm run i18n:check`
- 前端 E2E：`npm run test:e2e`
- 发布态内嵌构建：`pwsh -File .\scripts\build-embedded-backend.ps1`
- 已覆盖前端关键纯逻辑：live timeline delta 聚合、thread render helper
- 已覆盖后端关键基础链路：workspace 元数据持久化、历史线程归属判断、扩展路由请求体验证
