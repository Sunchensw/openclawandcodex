# Release Notes

## v0.1.0

首个可用版本，包含以下能力：

- 新增 `codex-bridge-plugin`
- 新增 `codex-sidecar`
- 支持 `/codex` 显式调用 Codex
- 支持 `/codex-bridge-status` 状态检查
- 支持基于 `message:received` 的全量代理尝试
- sidecar 已切换为本机 `codex.exe exec` 执行路径
- sidecar 使用本机真实的 Codex 登录状态
- 补充中文版 README
- 补充 MIT License
- 优化 `.gitignore`

## 后续计划

- 增加 sidecar 后台服务化方案
- 增加结构化日志
- 增加自动化冒烟测试
- 优化 full-proxy 的稳定性
