# Codex Bridge Plugin

这个插件负责把 OpenClaw 收到的消息转发到本地 Codex sidecar。

## 功能

- 注册 `/codex`
- 注册 `/codex-bridge-status`
- 通过 `message:received` hook 尝试做全量代理

## 消息流

1. OpenClaw 收到消息
2. `codex-bridge-plugin` 把消息发送到 `http://127.0.0.1:3790/run`
3. sidecar 调用本地 `codex.exe exec`
4. 结果重新回到 OpenClaw

## 说明

- 这个插件不会改动你的模型配置
- `full-proxy` 属于尽力而为，因为最终行为受 OpenClaw hook 机制影响
- 当前最稳定的调用方式仍然是 `/codex <任务>`
- 仓库整体说明请看根目录 README
