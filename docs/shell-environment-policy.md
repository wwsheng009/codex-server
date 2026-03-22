# Shell Environment Policy

## Current State In `codex-server`

结论：

- 当前仓库没有任何代码在启动 `codex app-server` 时主动改写 `shell_environment_policy`
- `codex-server` 启动阶段当前只会动态处理 `model_catalog_json` / `shell_type` 派生 catalog
- `shell_environment_policy` 的真实来源仍然是 Codex 自身配置层，例如 `$CODEX_HOME/config.toml`

也就是说，`shell_environment_policy` 不是本项目运行时拼装 app-server 命令时注入的 override。

## Where We Checked

已检查以下路径：

- [backend/internal/config/config.go](/E:/projects/ai/codex-server/backend/internal/config/config.go)
- [backend/cmd/server/main.go](/E:/projects/ai/codex-server/backend/cmd/server/main.go)
- [backend/internal/configfs/service.go](/E:/projects/ai/codex-server/backend/internal/configfs/service.go)

检查结果：

- `config.go` 只处理 `model_catalog_json` 和 shell catalog 派生
- `main.go` 只把解析后的 app-server command 交给 runtime manager
- `configfs/service.go` 提供通用 `config/read` / `config/value/write` / `config/batchWrite`，但不会在调用 app-server 前临时改写 `shell_environment_policy`

## Effective Impact

`shell_environment_policy` 会影响：

- `shell`
- `local_shell`
- `shell_command`
- `unified_exec`
- app-server `command/exec`
- app-server `thread/shellCommand`

但它影响的是“子进程环境变量构造”，不是 sandbox 权限。

## Frontend Support

前端现在已提供显式配置入口：

- 页面位置：`Settings > Config > Runtime`
- 区块名称：`Shell Environment Policy`

前端也提供运行时检查入口：

- 页面位置：`Settings > Environment`
- 区块名称：`Runtime Inspection`
- 可查看：
  - `effectiveCommand`
  - 当前 workspace 的 `shell_environment_policy`
  - `shell_environment_policy` 相关 `origins`
  - 当前合并 `layers`
  - `Restart Runtime` 按钮
  - `Apply inherit=all + Restart`
  - `Apply core+Windows + Restart`

这部分不是 runtime-only 的内存配置，而是通过 `config/value/write` 直接把：

```toml
[shell_environment_policy]
```

对应的对象写入 Codex 配置层。

## Recommended Presets

页面内置了三个快捷预设：

### 1. `inherit = "all"`

适合优先保证兼容性。

```json
{
  "inherit": "all"
}
```

### 2. `inherit = "core"` + Windows essentials

适合 Windows 下想减少继承变量，但避免命令解析失效。

```json
{
  "inherit": "core",
  "set": {
    "PATHEXT": ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
    "SystemRoot": "C:\\Windows",
    "ComSpec": "C:\\Windows\\System32\\cmd.exe"
  }
}
```

### 3. Clear

清空前端输入，不再主动写入该对象。

## Important Note

因为 `shell_environment_policy` 对所有 shell/exec 路径影响都很大，所以这里建议：

- 默认优先用 `inherit = "all"`
- 如果切到 `inherit = "core"`，至少在 Windows 上显式补回 `PATHEXT`、`SystemRoot`、`ComSpec`
- 如果要继续最小化泄漏，优先在 `all` 基础上做 `exclude`，而不是直接砍到 `core`
