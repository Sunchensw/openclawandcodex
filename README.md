# OpenClaw Codex Bridge

`OpenClaw Codex Bridge` 是一个面向 Windows 的轻量桥接方案，用来让 OpenClaw 把用户任务转发给本地 Codex 执行，再把最终结果返回给 OpenClaw。

这个仓库包含两个部分：

- `codex-bridge-plugin`：OpenClaw 插件，负责接收消息、提供 `/codex` 命令，并在需要时把消息代理给 Codex
- `codex-sidecar`：本地 HTTP 服务，负责调用 `codex exec`，并把最终用户可见回复返回给 OpenClaw

这个项目的目标是：

- 不改动你现有的 OpenClaw 模型配置
- 让 OpenClaw 继续作为消息入口
- 让 Codex 成为实际执行任务的核心

## 项目架构

```text
OpenClaw UI / 企业微信
        |
        v
OpenClaw Gateway
        |
        v
codex-bridge-plugin
        |
        v
http://127.0.0.1:3790/run
        |
        v
codex-sidecar
        |
        v
本地 codex.exe exec
        |
        v
结果回传给 OpenClaw
```

## 目录结构

```text
.
├── README.md
├── codex-bridge-plugin
│   ├── index.js
│   ├── openclaw.plugin.json
│   ├── package.json
│   └── README.md
└── codex-sidecar
    ├── package.json
    ├── server.mjs
    ├── start-sidecar.cmd
    └── README.md
```

## 组件说明

### `codex-bridge-plugin`

这个插件主要负责：

- 注册 `/codex <任务>` 命令，用于显式把任务交给 Codex
- 注册 `/codex-bridge-status` 命令，用于查看桥接状态
- 监听 `message:received`
- 把符合条件的消息转发给 sidecar
- 把 sidecar 返回的结果重新注入 OpenClaw 消息流

当前插件支持的行为：

- `full-proxy`：尽量代理普通入站消息
- `command-only`：只通过 `/codex` 命令调用
- 对短时间内的重复消息做去重
- 对 `/help`、`/status`、`/model` 等命令做绕过，不转发给 Codex

### `codex-sidecar`

这是一个轻量的 Node.js HTTP 服务，主要负责：

- 监听 `127.0.0.1:3790`
- 接收 `POST /run` 请求
- 根据 OpenClaw 传入的消息元数据构造 Codex 提示词
- 调用本地 `codex.exe exec`
- 通过 `--output-last-message` 捕获最终回复
- 把结果以 JSON 返回给 OpenClaw

当前执行策略：

- 可执行文件：`%USERPROFILE%\\.codex\\.sandbox-bin\\codex.exe`
- Codex 登录目录：`%USERPROFILE%\\.codex`
- 沙箱模式：`workspace-write`

## 运行前提

在使用这个项目之前，建议确保：

- 你在 Windows 环境中运行
- 本机已经安装 Node.js
- 本机已经安装并可使用 OpenClaw
- 本机已经安装 Codex
- Codex 已在这台机器上完成登录

## 安装与配置

### 1. 启动 sidecar

```powershell
cd D:\openclaw\codex-sidecar
.\start-sidecar.cmd
```

你可以用下面的命令检查 sidecar 是否正常：

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:3790/health -UseBasicParsing
```

正常情况下返回的 JSON 里会包含：

- `adapter: "codex-exec"`
- 本地 Codex 可执行文件路径
- 当前使用的 Codex Home 路径

### 2. 在 OpenClaw 中注册插件

把这个插件以本地 `path` 安装方式加入 OpenClaw 配置，并启用它。

配置示例：

```json
{
  "plugins": {
    "entries": {
      "codex-bridge-plugin": {
        "enabled": true,
        "config": {
          "enabled": true,
          "mode": "full-proxy",
          "sidecarUrl": "http://127.0.0.1:3790",
          "interceptChannels": ["wecom"],
          "requestTimeoutMs": 600000
        }
      }
    },
    "installs": {
      "codex-bridge-plugin": {
        "source": "path",
        "spec": "D:\\openclaw\\codex-bridge-plugin",
        "installPath": "D:\\openclaw\\codex-bridge-plugin"
      }
    }
  }
}
```

修改完成后，重启 OpenClaw Gateway 即可。

## 使用方式

### 方式一：显式调用 Codex

这是当前最稳定、最推荐的方式：

```text
/codex 帮我整理这个项目的目录结构
```

### 方式二：自动代理普通消息

如果插件配置为 `full-proxy`，并且消息通道符合配置条件，普通入站消息也可以自动转发给 Codex。

是否能完全覆盖普通消息，还取决于 OpenClaw 当前版本对 hook 的实际执行行为。

### 查看桥接状态

```text
/codex-bridge-status
```

这个命令会从 OpenClaw 内部读取 sidecar 状态并返回结果。

## 接口说明

### `GET /health`

用于检查 sidecar 当前状态。

返回示例：

```json
{
  "ok": true,
  "adapter": "codex-exec",
  "executable": "C:\\Users\\<你自己的用户名>\\.codex\\.sandbox-bin\\codex.exe",
  "codexHome": "C:\\Users\\<你自己的用户名>\\.codex",
  "cwd": "D:\\openclaw",
  "sandbox": "workspace-write"
}
```

### `POST /run`

请求示例：

```json
{
  "source": "openclaw-command",
  "sessionKey": "wecom:user-1",
  "prompt": "只回复 TEST_OK",
  "channelId": "wecom",
  "messageId": "",
  "metadata": {}
}
```

返回示例：

```json
{
  "ok": true,
  "reply": "TEST_OK"
}
```

## 当前已验证内容

这个仓库目前已经在本机完成了这些验证：

- sidecar 的健康检查返回 `200 OK`
- `/run` 能成功返回 Codex 的执行结果
- sidecar 使用的是本机真实的 Codex 登录状态 `%USERPROFILE%\\.codex`

## 当前限制

在上传和继续迭代前，建议你知道这些限制：

- 这个项目依赖本机已经安装并登录好的 Codex
- 如果 Codex 后端网络异常，sidecar 会直接把底层错误返回出来
- `full-proxy` 是尽力而为，不保证在所有 OpenClaw 版本里都完全一致
- 某些环境下，要让 sidecar 稳定后台常驻，可能需要额外权限或服务化处理

## 开发说明

- 这个仓库故意保持得比较小，只关注“OpenClaw 到 Codex 的桥接”
- [server.mjs](D:\openclaw\codex-sidecar\server.mjs) 是核心执行边界
- [index.js](D:\openclaw\codex-bridge-plugin\index.js) 是核心路由边界
- 当前以手工测试和联调验证为主

## 后续可继续增强的方向

- 为 sidecar 增加真正的后台服务包装
- 增加结构化日志，方便排查代理链路问题
- 增加请求和响应落盘，便于调试
- 增加 `/health` 和 `/run` 的自动化冒烟测试
