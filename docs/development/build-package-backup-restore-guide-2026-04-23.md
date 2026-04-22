# codex-server 构建、打包、配置备份与恢复指南

本文档基于当前仓库实现，说明以下内容：

- 如何编译和打包前端
- 如何打包后端
- 如何生成带内嵌前端资源的单二进制产物
- 当前应用配置是如何持久化的
- 如何备份和恢复配置
- 把前端静态资源集成到 Go 二进制里的技术原理

相关代码入口：

- 前端构建脚本定义：`frontend/package.json`
- 内嵌打包脚本：`scripts/build-embedded-backend.ps1`、`scripts/build-embedded-backend.sh`
- 配置备份脚本：`scripts/backup-codex-server-config.ps1`
- 配置恢复脚本：`scripts/restore-codex-server-config.ps1`
- 前端嵌入实现：`backend/internal/webui/bundle_embed.go`
- 前端 stub 实现：`backend/internal/webui/bundle_stub.go`
- 静态资源处理：`backend/internal/webui/handler.go`
- Router 接入点：`backend/internal/api/router.go`
- 运行时前端 origin 调整：`backend/internal/servercmd/run.go`

## 1. 构建与产物概览

当前项目有三类主要构建产物：

1. 前端静态资源产物
   - 来源：`frontend/`
   - 输出：`frontend/dist/`
   - 用途：可单独部署到静态站点，也可继续复制到后端做内嵌发布

2. 后端普通二进制
   - 来源：`backend/cmd/server`
   - 输出：通常为 `backend/bin/codex-server` 或自定义路径
   - 用途：开发态或与独立前端分离部署

3. 后端单二进制发布产物
   - 来源：后端代码 + `frontend/dist`
   - 输出：默认为 `backend/bin/codex-server-embedded.exe` 或 `backend/bin/codex-server-embedded`
   - 用途：一个后端进程同时提供 API 和前端页面

单二进制发布链路可以概括为：

`frontend/src` -> `frontend/dist` -> `backend/internal/webui/dist` -> `go build -tags embed_frontend` -> 最终二进制

## 2. 如何编译和打包前端

### 2.1 前提条件

- 已安装 Node.js
- 已在 `frontend/` 安装依赖
- 如果使用 `npm`：

```powershell
cd E:\projects\ai\codex-server\frontend
npm install
```

- 如果使用 `pnpm`：

```powershell
cd E:\projects\ai\codex-server\frontend
pnpm install
```

### 2.2 前端构建命令

当前前端构建脚本定义在 `frontend/package.json`：

```json
"build": "tsc -b && vite build"
```

也就是说，前端“编译”和“打包”在当前项目里是同一个命令完成的：

```powershell
cd E:\projects\ai\codex-server\frontend
npm run build
```

或：

```powershell
cd E:\projects\ai\codex-server\frontend
pnpm run build
```

该命令会做两件事：

- 先执行 `tsc -b`，完成 TypeScript 构建检查
- 再执行 `vite build`，输出浏览器可部署静态资源

### 2.3 前端产物位置

构建成功后，产物位于：

```text
frontend/dist/
```

其中通常包含：

- `index.html`
- `assets/*.js`
- `assets/*.css`
- 其他 vite 输出文件

### 2.4 前端构建后的必做检查

按当前仓库约定，前端改动完成后至少应执行：

```powershell
cd E:\projects\ai\codex-server\frontend
npm run build
npm run i18n:check
```

如果团队使用 `pnpm`，命令等价替换为 `pnpm run ...` 即可。

`i18n:check` 的意义是确认新增或修改的界面文案已经接入现有国际化流程，避免把硬编码文本带进产物。

### 2.5 单独打包前端的使用场景

如果你准备把前端部署到独立静态服务，例如 Nginx、对象存储或 CDN，那么 `frontend/dist/` 就是直接可交付的前端发布包。

如果你准备发布单二进制后端，则 `frontend/dist/` 只是中间产物，后续还需要复制到 `backend/internal/webui/dist/` 并重新编译 Go 后端。

## 3. 如何打包后端

### 3.1 后端普通二进制

当前仓库没有单独的“后端 only 打包脚本”，后端普通二进制通常直接用 `go build`：

```powershell
cd E:\projects\ai\codex-server\backend
go build -o .\bin\codex-server.exe .\cmd\server
```

Linux/macOS：

```bash
cd /path/to/codex-server/backend
go build -o ./bin/codex-server ./cmd/server
```

这类产物适合：

- 本地开发
- 前后端分离部署
- 不需要把前端资源打进二进制的场景

### 3.2 使用脚本打包带内嵌前端的后端

当前仓库推荐的发布态脚本是：

- PowerShell：`scripts/build-embedded-backend.ps1`
- Shell：`scripts/build-embedded-backend.sh`

Windows：

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\build-embedded-backend.ps1
```

Linux/macOS：

```bash
./scripts/build-embedded-backend.sh
```

默认输出：

- Windows：`backend/bin/codex-server-embedded.exe`
- 其他平台：`backend/bin/codex-server-embedded`

### 3.3 PowerShell 打包脚本支持的参数

```powershell
pwsh -File .\scripts\build-embedded-backend.ps1 `
  -PackageManager auto `
  -GoBuildTags embed_frontend `
  -OutputPath .\backend\bin\my-release.exe
```

参数含义：

- `-PackageManager auto|npm|pnpm`
  - `auto` 会优先检查 `frontend/package-lock.json`
  - 当前仓库同时存在 `package-lock.json` 和 `pnpm-lock.yaml`
  - 因此默认 `auto` 实际会优先使用 `npm`
  - 如果团队明确使用 `pnpm`，建议显式传 `-PackageManager pnpm`

- `-GoBuildTags embed_frontend`
  - 默认就是 `embed_frontend`
  - 该标签控制是否启用前端资源嵌入

- `-OutputPath`
  - 控制最终二进制输出路径

### 3.4 Shell 打包脚本支持的环境变量

```bash
PACKAGE_MANAGER=pnpm \
GO_BUILD_TAGS=embed_frontend \
OUTPUT_PATH=./backend/bin/codex-server-embedded \
./scripts/build-embedded-backend.sh
```

可用变量：

- `PACKAGE_MANAGER=auto|npm|pnpm`
- `GO_BUILD_TAGS=embed_frontend`
- `OUTPUT_PATH=<path>`
- `PYTHON_BIN=python3`

### 3.5 内嵌打包脚本实际做了什么

`build-embedded-backend.ps1` 和 `build-embedded-backend.sh` 的逻辑是一致的：

1. 解析仓库根目录、前端目录、后端目录和目标输出路径
2. 选择包管理器
3. 执行前端构建命令 `run build`
4. 检查 `frontend/dist` 是否存在且非空
5. 清空并重建 `backend/internal/webui/dist`
6. 把 `frontend/dist` 的内容完整复制到 `backend/internal/webui/dist`
7. 执行：

```text
go build -tags embed_frontend -o <output> ./cmd/server
```

8. 检查目标二进制是否已生成

换句话说，这个脚本不是“只编译后端”，而是把“前端构建 + 资源复制 + Go 编译”串成了一条发布流水线。

## 4. 把前端资源集成到二进制里的技术原理

### 4.1 编译期开关：build tag

内嵌模式由 Go build tag 控制：

- 启用时：`-tags embed_frontend`
- 未启用时：使用 stub 实现

对应代码：

- `backend/internal/webui/bundle_embed.go`
- `backend/internal/webui/bundle_stub.go`

其核心设计是：

- `bundle_embed.go` 只在 `embed_frontend` 标签存在时参与编译
- `bundle_stub.go` 只在 `embed_frontend` 标签不存在时参与编译

这样可以保证：

- 开发态可以不携带前端产物
- 发布态可以把前端资源直接编进后端可执行文件

### 4.2 资源嵌入：go:embed

嵌入实现的核心代码是：

```go
//go:embed dist
var embeddedFiles embed.FS
```

这里的 `dist` 指向 `backend/internal/webui/dist/`。  
因此在执行 `go build -tags embed_frontend` 之前，必须先确保该目录里已经有前端产物。

这也是打包脚本为什么要先把 `frontend/dist` 复制到这里的原因。

### 4.3 运行时状态判定

`backend/internal/webui/webui.go` 通过 `bundleStatus()` 和 `bundleFS()` 判断当前模式：

- `ModeEmbedded`：带内嵌资源
- `ModeStub`：未内嵌资源

如果：

- 没有启用 `embed_frontend`
- 或者嵌入目录里没有 `index.html`

那么 `webui.Enabled()` 就是 `false`。

### 4.4 Router 如何接管前端页面

在 `backend/internal/api/router.go` 中，只有 `webui.Enabled()` 为 `true` 时，Router 才会把未命中的路由交给前端 handler：

```go
if webui.Enabled() {
    uiHandler := webui.Handler()
    router.NotFound(uiHandler.ServeHTTP)
}
```

这意味着：

- 内嵌模式下，访问 `http://localhost:18080/` 会由后端返回前端页面
- 非内嵌模式下，未命中的路径仍然是普通 404

这也是之前出现 `http://localhost:18080/` 返回 `404 page not found` 的根本原因：当时运行的不是带 `embed_frontend` 标签、且带有效 `dist` 的后端二进制。

### 4.5 SPA fallback 原理

`backend/internal/webui/handler.go` 的逻辑不是简单地“只返回静态文件”，而是做了 SPA 友好的 fallback：

- 访问 `/assets/...` 或带扩展名的静态资源，直接尝试读取对应文件
- 如果请求的是不带扩展名的前端路由，例如 `/threads/123`
  - 先尝试读取同名资源
  - 失败后回退到 `index.html`

因此：

- 前端 hash 资源可以正常缓存
- React Router 之类的 SPA 路由也能在浏览器刷新后继续工作

### 4.6 缓存策略

`handler.go` 对不同资源设置了不同缓存头：

- `index.html`：`no-cache`
- `assets/*`：`public, max-age=31536000, immutable`
- 其他静态资源：`public, max-age=3600`

这样设计的目标是：

- HTML 总是尽快拿到新版本
- hash 命名的 JS/CSS 可以长期缓存

### 4.7 为什么内嵌模式会调整前端 origin

在 `backend/internal/servercmd/run.go` 中，运行时会根据是否启用内嵌模式调整 `FrontendOrigin`：

- 开发态默认 `CODEX_FRONTEND_ORIGIN=http://0.0.0.0:15173`
- 内嵌模式下，如果还是默认开发 origin，则会：
  - 优先改写成 `CODEX_SERVER_PUBLIC_BASE_URL`
  - 如果没配置 `CODEX_SERVER_PUBLIC_BASE_URL`，则清空该值

这样做是为了避免：

- 后端已经切到同源部署
- 但 OAuth、回跳地址、分享地址仍然错误指向开发期 `15173`

## 5. 当前配置是如何持久化的

当前项目配置不是只保存在一个文件里，而是分散在几类位置：

### 5.1 服务主存储：metadata.json

默认存储路径来自：

```text
CODEX_SERVER_STORE_PATH
```

若未设置，则默认是：

```text
data/metadata.json
```

对应实现见 `backend/internal/config/config.go`。

这个 `metadata.json` 持久化了大量服务级状态，包括：

- workspace 列表
- 线程和线程索引
- runtime preferences
- 多种服务配置

### 5.2 sidecar 目录：thread-projections

线程投影数据不会只保存在 `metadata.json` 中。  
`backend/internal/store/memory.go` 会把线程投影的 turn 快照放到：

```text
<metadata.json 同级目录>/thread-projections/
```

因此：

- 只复制 `metadata.json` 不够
- 必须连同同级 `thread-projections/` 一起备份和恢复

### 5.3 workspace 级配置

部分配置会写到具体工作区目录，而不是服务主存储中：

- `.codex/config.toml`
  - 由受管 MCP 配置写入
  - Feishu 和 Jobs MCP 都会写到这里

- `.codex/hooks.json`
- `hooks.json`
  - hooks 配置文件
  - 当前实现会优先查 workspace，再回退到 `CODEX_HOME`

### 5.4 用户级配置：CODEX_HOME

如果设置了 `CODEX_HOME`，则以该目录为准；否则默认：

```text
~/.codex
```

这里可能包含：

- `config.toml`
- `hooks.json`

其中 `config.toml` 还可能定义：

- `model_catalog_json`

这会影响后端运行时模型目录和 shell override 行为。

### 5.5 引用文件

除了主配置文件，当前配置还可能“引用”额外文件，例如：

- 运行时模型目录 JSON
- 由 `CODEX_MODEL_CATALOG_JSON` 指向的目录文件
- 由 `~/.codex/config.toml` 中 `model_catalog_json` 指向的目录文件

这类文件虽然不一定在 `metadata.json` 里，但一旦缺失，恢复后的运行时表现可能就会变掉，因此也应该跟着备份。

## 6. 如何备份配置

### 6.1 脚本位置

```text
scripts/backup-codex-server-config.ps1
```

### 6.2 推荐命令

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\backup-codex-server-config.ps1 `
  -OutputPath E:\backups\codex-server-config `
  -Force
```

如果从 `powershell.exe` 启动也可以，脚本会自动切到 `pwsh` 处理，以避免 PowerShell 5.1 的 JSON 解析兼容问题。

### 6.3 脚本会备份什么

- store 文件
  - `data/metadata.json`
  - `backend/data/metadata.json`
  - 如果设置了 `CODEX_SERVER_STORE_PATH`，也会尝试纳入

- store sidecar 目录
  - 每个 store 同级的 `thread-projections/`

- workspace 配置
  - `.codex/config.toml`
  - `.codex/hooks.json`
  - `hooks.json`

- `CODEX_HOME` 配置
  - `config.toml`
  - `hooks.json`

- 环境变量快照
  - `environment/set-codex-env.ps1`
  - 保存当前已设置的 `CODEX_*` 变量

- 引用文件
  - 例如 `runtime-model-catalog.json`

- 元数据说明
  - `manifest.json`
  - `RESTORE-NOTES.txt`

### 6.4 备份目录结构

典型结构如下：

```text
<backup-root>/
  codex-home/
  environment/
  referenced-files/
  stores/
  workspaces/
  manifest.json
  RESTORE-NOTES.txt
```

### 6.5 备份限制

当前脚本不会备份浏览器本地状态，例如：

- 浏览器 `localStorage`

因此如果某些纯前端 UI 状态只存在浏览器本地，那么它们不属于当前 PowerShell 备份范围。

## 7. 如何恢复配置

### 7.1 脚本位置

```text
scripts/restore-codex-server-config.ps1
```

### 7.2 默认恢复命令

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -Force
```

默认行为：

- 恢复 manifest 标记为 `preferred` 的那份 store
- 恢复相关 `thread-projections`
- 恢复所有已记录的 workspace 配置文件
- 恢复 `CODEX_HOME` 配置
- 恢复引用文件
- 但不会自动把环境变量注入当前 shell

### 7.3 只恢复指定 workspace

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -WorkspaceId ws_000001 `
  -Force
```

### 7.4 恢复所有 store

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -RestoreAllStores `
  -SkipWorkspaces `
  -Force
```

### 7.5 预演恢复，不落盘

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -WhatIf
```

### 7.6 恢复环境变量

如果你确实需要把备份时的 `CODEX_*` 环境变量重新载入，可以：

```powershell
pwsh -File E:\projects\ai\codex-server\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -ApplyEnvironment `
  -Force
```

或者手工在实际启动后端的 shell 中执行：

```powershell
. E:\backups\codex-server-config\environment\set-codex-env.ps1
```

注意：

- `-ApplyEnvironment` 只对当前 PowerShell 进程有效
- 如果你是单独开了一个新 shell 执行恢复脚本，再去别的 shell 启动服务，那么环境变量仍需要在“真正启动服务的 shell”里重新加载一次

## 8. 推荐发布与迁移流程

推荐在当前项目里使用以下顺序完成发布或迁移：

1. 停掉旧的 `codex-server`
2. 备份当前配置

```powershell
pwsh -File .\scripts\backup-codex-server-config.ps1 `
  -OutputPath E:\backups\codex-server-config `
  -Force
```

3. 构建新版本单二进制

```powershell
pwsh -File .\scripts\build-embedded-backend.ps1 `
  -PackageManager npm
```

4. 部署新二进制
5. 如需迁移机器或新目录，恢复配置

```powershell
pwsh -File .\scripts\restore-codex-server-config.ps1 `
  -BackupPath E:\backups\codex-server-config `
  -Force
```

6. 如有需要，重新加载 `CODEX_*` 环境变量
7. 启动新的后端进程
8. 浏览器访问：

```text
http://localhost:18080/
```

如果你启动的是带内嵌前端的产物，那么根路径应该返回前端首页，而不是 404。

## 9. 常见问题

### 9.1 为什么 `http://localhost:18080/` 会返回 404

通常说明当前运行的不是带内嵌前端资源的后端进程。  
排查顺序如下：

1. 是否使用了 `build-embedded-backend.ps1` 或 `build-embedded-backend.sh`
2. `go build` 是否带了 `-tags embed_frontend`
3. `backend/internal/webui/dist/index.html` 是否存在
4. 当前运行的是否真的是新生成的 `codex-server-embedded(.exe)`，而不是旧进程或 `go run ./cmd/server`

### 9.2 为什么备份时要同时复制 `thread-projections`

因为线程投影的大块数据以 sidecar 文件形式保存在 `metadata.json` 同级目录，单独恢复 `metadata.json` 会造成引用不完整。

### 9.3 为什么恢复脚本默认只恢复一份 store

因为当前项目历史上可能存在多个候选 store 位置，例如：

- `data/metadata.json`
- `backend/data/metadata.json`

脚本默认恢复 manifest 里标记的 `preferredStorePath`，避免一次性覆盖多个可能已经分化的数据目录。  
如果你明确知道需要两份都恢复，再显式传 `-RestoreAllStores`。

### 9.4 为什么内嵌模式下前端 origin 会被清空或改写

这是为了防止服务已经切换到同源部署后，配置里还残留开发期 `http://0.0.0.0:15173` 或 `http://localhost:15173`，导致 OAuth、回跳地址或对外展示链接指向错误地址。

## 10. 结论

当前项目已经具备完整的单二进制发布能力，推荐的标准流程是：

- 用 `npm run build` 或 `pnpm run build` 生成前端 `dist`
- 用 `scripts/build-embedded-backend.ps1` 或 `scripts/build-embedded-backend.sh` 生成带内嵌前端的后端二进制
- 用 `scripts/backup-codex-server-config.ps1` 做迁移前备份
- 用 `scripts/restore-codex-server-config.ps1` 做迁移后恢复

从技术实现上看，这套方案的关键点在于：

- 前端资源先被复制到 `backend/internal/webui/dist`
- 通过 `//go:embed dist` 在编译期嵌入
- 通过 `embed_frontend` build tag 决定是否启用该能力
- 通过 Router 的 `NotFound` fallback 接管根路径和 SPA 路由

因此，只要构建链路和运行产物正确，`codex-server` 就可以作为一个同源、自包含、易迁移的单二进制应用发布。
