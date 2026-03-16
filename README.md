# OpenClaw Codex Bridge

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-blue.svg)](./README.md)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-Bridge-black.svg)](./README.md)

一个面向 Windows 的 OpenClaw 与 Codex 桥接器。
它让 OpenClaw 继续负责消息入口、会话和回传，而把真正的任务执行交给本地 Codex。

## 项目简介

这个仓库解决的是一个很实际的问题：

- 不改动现有 OpenClaw 模型配置
- 保留 OpenClaw 的接入方式，比如 Web UI 或企业微信
- 让 Codex 负责代码生成、项目整理、命令执行和复杂任务处理
- 最终结果仍然回到 OpenClaw 会话里

仓库由两个核心模块组成：

- `codex-bridge-plugin`：OpenClaw 插件，负责接收消息、注册命令、转发请求
- `codex-sidecar`：本地 HTTP 服务，负责调用 `codex.exe exec` 并返回最终回复

## 项目亮点

- 不需要改你的 OpenClaw 主模型配置
- 支持显式命令 `/codex <任务>`
- 支持基于 hook 的全量代理模式
- 使用本机真实的 Codex 登录状态
- 结构简单，适合二次开发和本地部署

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
├── LICENSE
├── RELEASE_NOTES.md
├── .gitignore
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

## 工作原理

### `codex-bridge-plugin`

插件主要负责：

- 注册 `/codex <任务>` 命令，用于显式委托 Codex
- 注册 `/codex-bridge-status` 命令，用于查看桥接状态
- 监听 `message:received`
- 把符合条件的消息转发到 sidecar
- 把 sidecar 返回的结果重新写回 OpenClaw 消息流

支持的行为包括：

- `full-proxy`：尽量代理普通入站消息
- `command-only`：只通过 `/codex` 触发
- 短时间消息去重
- 绕过 `/help`、`/status`、`/model` 等命令

### `codex-sidecar`

sidecar 是一个轻量的 Node.js HTTP 服务，负责：

- 监听 `127.0.0.1:3790`
- 接收 `POST /run`
- 根据 OpenClaw 传入的上下文构造 Codex 提示词
- 调用本地 `codex.exe exec`
- 使用 `--output-last-message` 提取最终回复
- 把结果以 JSON 返回给 OpenClaw

当前默认执行配置：

- Codex 可执行文件：`%USERPROFILE%\.codex\.sandbox-bin\codex.exe`
- Codex Home：`%USERPROFILE%\.codex`
- 工作目录：`D:\openclaw`
- 沙箱模式：`workspace-write`

## 快速开始

### 环境要求

- Windows
- Node.js
- 已安装并可运行的 OpenClaw
- 已安装并登录的 Codex

### 1. 启动 sidecar

```powershell
cd D:\openclaw\codex-sidecar
.\start-sidecar.cmd
```

检查是否启动成功：

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:3790/health -UseBasicParsing
```

### 2. 在 OpenClaw 中注册插件

把插件以本地 `path` 安装方式加入 OpenClaw 配置，并启用：

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

修改完成后，重启 OpenClaw Gateway。

## 使用方式

### 显式调用 Codex

```text
/codex 帮我整理这个项目的目录结构
```

这是当前最稳定的调用方式。

### 查看桥接状态

```text
/codex-bridge-status
```

### 自动代理普通消息

如果插件配置为 `full-proxy`，并且消息通道符合配置条件，普通入站消息也会尽量自动转发给 Codex。

## 接口说明

### `GET /health`

返回当前 sidecar 状态：

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

## 当前已验证状态

这个仓库目前已经完成以下验证：

- sidecar 健康检查返回 `200 OK`
- `/run` 能成功返回 Codex 执行结果
- sidecar 使用的是本机真实 Codex 登录状态 `%USERPROFILE%\.codex`
- 本地桥接链路已经跑通

## 当前限制

- 依赖本机已安装并登录好的 Codex
- 如果 Codex 后端网络异常，sidecar 会直接返回底层错误
- `full-proxy` 属于尽力而为，最终行为取决于 OpenClaw hook 机制
- 某些环境下要让 sidecar 稳定后台常驻，可能需要额外权限或服务化处理

## 适合的使用场景

- 希望通过 OpenClaw 统一入口来调用 Codex
- 希望保留企业微信或 Web UI 接入方式
- 希望把复杂任务转发给更强的本地执行代理
- 希望基于现有 OpenClaw 环境做二次开发

## 开发说明

- 核心执行边界在 `codex-sidecar/server.mjs`
- 核心消息路由边界在 `codex-bridge-plugin/index.js`
- 当前以手工联调和本地冒烟测试为主

## 版本说明

当前仓库附带一份发布说明，请查看 [RELEASE_NOTES.md](./RELEASE_NOTES.md)。

## License

本项目采用 [MIT License](./LICENSE)。
