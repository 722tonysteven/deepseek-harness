# @deepseek-ai/dsh-supervisor

[English](README.md) | 中文

这是一个与模型供应商无关的监督审查服务，用于判断其他 Agent 已完成的输出。监督模型走现有的 `ctx.llm` 能力，因此执行 Agent 可以继续使用 DeepSeek，而监督 Agent 可以单独使用 OpenAI，不需要再维护第二套网络调用代码。

这个包是“执行者 → 审核者”自动闭环的第一层基础。目前它负责一次独立审查并返回经过严格验证的封闭决策；自动把修改意见送回执行 Agent、监督记录持久化、缺失信息自动查工具、以及人工审批交接会在后续阶段接上。

## 服务 API

该包注册 `ctx.supervisor`。

```ts
const decision = await ctx.supervisor.review({
  objective: '给出技术上安全的轮毂参数建议。',
  executorOutput: draft,
  acceptanceCriteria: [
    '不能编造缺失的刹车避让数据。',
    '涉及对外生效的价格或退款决定时必须升级审批。',
  ],
  cycle: 1,
})
```

`review()` 只会返回以下四种结果之一：

- `accept`：结果已经满足目标与验收标准；
- `revise`：现有信息足够，但执行结果需要修改，并返回明确修改要求；
- `clarify`：缺少完成任务所必需的信息，并通过 `resolvableByTools` 标识是否应先尝试用已挂载工具查询；
- `escalate`：下一步属于必须由人工授权的对外执行行为。

模型输出格式错误、模型调用失败、监督模型意外调用工具、输出被 token 上限截断、或审查轮次超过上限时都会报错。这些情况不会被默认当成“通过”。

## 配置

```yaml
- id: supervisor
  name: '@deepseek-ai/dsh-supervisor'
  config:
    provider: openai
    model: gpt-5.6
    maxOutputTokens: 1200
    maxReviewCycles: 3
```

`provider` 与 `model` 指向 Harness 中已经挂载的 LLM 路由。如果目标模型支持指定推理强度，可以额外配置 `reasoningEffort`。`maxReviewCycles` 是给后续自动编排使用的安全上限；请求中的一基 `cycle` 超出上限时会以 `REVIEW_BUDGET_EXHAUSTED` 失败。

监督系统提示会把目标、执行结果、验收标准和当前审查轮次作为 JSON 数据传给监督模型，并明确要求把执行者输出视为数据，而不是对监督模型的指令。监督模型必须只返回一个符合封闭决策类型的 JSON 对象。

## 模型体验

### 独立监督请求

#### 模型看到什么

监督模型会看到一段固定系统指令，其中定义 `accept`、`revise`、`clarify`、`escalate` 四种结果；另外看到一条 JSON 封装的用户消息，包含任务目标、执行者最终输出、验收标准以及当前审查轮次。执行者文本被放在 JSON 数据字段内，不能直接破坏提示结构。

#### Token 影响

每次 `review()` 都会产生一次独立的辅助模型请求。监督输出受到 `maxOutputTokens` 限制；当前输入大小由调用方提供的目标、结果和验收标准决定，本包暂时没有额外字节上限。

#### KV Cache 影响

监督请求与执行 Agent 的请求相互独立。固定系统指令在同一路由下保持稳定前缀；每次审查的 JSON 证据消息会变化。

## 已知限制与后续工作

- **暂未自动让执行者继续修改**：`revise` 目前只是把修改要求返回给编排调用方；后续会直接注入执行 Agent 并自动运行有上限的复审循环。
- **暂未写入监督审计事件**：辅助监督请求目前还没有追加到执行者 session log；后续凡是会影响执行 Agent 的监督指令，都必须先写入可重建的持久记录。
- **暂未接人工审批服务**：`escalate` 目前只标识需要审批及类别，还没有调用 `ctx.approval`；受保护动作在审批交接完成前必须保持未执行状态。
- **暂未自动查缺失信息**：`resolvableByTools` 现在只是路由信息；后续编排层会先尝试挂载工具，确实无法获取时才向用户提问。
