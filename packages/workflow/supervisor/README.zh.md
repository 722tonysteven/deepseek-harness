# GPT Supervisor 基础能力

[English](README.md) | 中文

V1 的 Supervisor 能力目前放在 `@deepseek-ai/dsh-workflow` 的 `src/supervisor.ts` 中。这样第一版可以直接复用现有 workflow 包的依赖，不需要新增一个 workspace 包，也就不会为了原型阶段额外改动 pnpm lockfile。

它提供一个与模型供应商无关的独立审查服务：执行 Agent 可以继续使用 DeepSeek，而 Supervisor 可以使用已经挂载在 `ctx.llm` 上的 OpenAI 路由。

目前支持四种判断：`accept`、`revise`、`clarify`、`escalate`。模型输出格式错误、模型调用失败、意外工具调用、以及超过复审次数都会失败关闭，不会默认当成通过。

这个目录暂时保留 V1 的设计说明、兼容源码路径、测试以及中英文文档。自动把修改意见重新交给执行 Agent、监督审计记录持久化、缺失信息自动查询、以及人工审批交接会在后续阶段继续接入。
