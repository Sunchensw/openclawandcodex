# Codex Sidecar

这个服务负责接收 OpenClaw 插件转发过来的任务，并通过本地 `codex.exe exec` 执行。

## 默认配置

- Host: `127.0.0.1`
- Port: `3790`
- 工作目录：`D:\openclaw`
- Codex 可执行文件：`%USERPROFILE%\.codex\.sandbox-bin\codex.exe`
- Codex Home：`%USERPROFILE%\.codex`
- 沙箱模式：`workspace-write`

## 支持的环境变量

- `CODEX_SIDECAR_HOST`
- `CODEX_SIDECAR_PORT`
- `CODEX_BRIDGE_CODEX_EXE`
- `CODEX_BRIDGE_CODEX_HOME`
- `CODEX_BRIDGE_CWD`
- `CODEX_BRIDGE_SANDBOX`
- `CODEX_BRIDGE_TIMEOUT_MS`

## 启动方式

```powershell
cd D:\openclaw\codex-sidecar
.\start-sidecar.cmd
```

也可以直接手动启动：

```powershell
$env:CODEX_BRIDGE_CODEX_EXE="$env:USERPROFILE\.codex\.sandbox-bin\codex.exe"
$env:CODEX_BRIDGE_CODEX_HOME="$env:USERPROFILE\.codex"
$env:CODEX_BRIDGE_CWD='D:\openclaw'
$env:CODEX_BRIDGE_SANDBOX='workspace-write'
node .\server.mjs
```

## 接口

### `GET /health`

返回当前可执行文件、Codex Home、工作目录和沙箱模式。

### `POST /run`

接收来自 OpenClaw 的 JSON 请求，并返回：

```json
{
  "ok": true,
  "reply": "..."
}
```

## 说明

- sidecar 使用的是本机真实的 Codex 登录状态
- 如果 Codex 后端异常，sidecar 会把底层错误信息透传回来
- 仓库整体说明请看根目录 README
