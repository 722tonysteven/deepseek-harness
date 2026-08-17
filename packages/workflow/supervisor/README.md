# @deepseek-ai/dsh-supervisor

English | [中文](README.zh.md)

Provider-neutral model-backed review service for judging completed agent outputs. The supervisor uses an independently configured route on the existing `ctx.llm` seam, so an executor may use DeepSeek while the supervisor uses OpenAI without adding a second transport stack.

The package is the first foundation for a bounded executor → reviewer loop. It currently owns one auxiliary review call and returns a validated closed decision; automatic reinjection, durable supervisor events, tool lookup for clarification, and approval handoff are staged follow-up work.

## Service API

The package registers `ctx.supervisor`.

```ts
const decision = await ctx.supervisor.review({
  objective: 'Prepare a technically safe wheel-fitment recommendation.',
  executorOutput: draft,
  acceptanceCriteria: [
    'Do not invent missing brake-clearance measurements.',
    'Escalate any externally binding price or refund decision.',
  ],
  cycle: 1,
})
```

`review()` returns exactly one of:

- `accept` — the result satisfies the objective and criteria;
- `revise` — the executor can improve the result from available information and receives concrete instructions;
- `clarify` — a required fact is missing, with `resolvableByTools` indicating whether orchestration should try mounted tools before asking a human;
- `escalate` — the next externally executed action needs human authority.

Malformed model output, model failures, unexpected tool calls, max-token truncation, and review cycles beyond the configured budget throw. None of those paths are converted into acceptance.

## Config

```yaml
- id: supervisor
  name: '@deepseek-ai/dsh-supervisor'
  config:
    provider: openai
    model: gpt-5.6
    maxOutputTokens: 1200
    maxReviewCycles: 3
```

`provider` and `model` name an already-mounted LLM route. `reasoningEffort` may be supplied when the selected route exposes that effort. `maxReviewCycles` is a guard for orchestration callers: a request whose one-based `cycle` exceeds it fails with `REVIEW_BUDGET_EXHAUSTED`.

The system instruction frames the objective, executor output, criteria, and cycle as JSON and explicitly treats executor output as data rather than supervisor instructions. The model must return one JSON object matching the closed decision vocabulary.

## Model Experience

### Independent supervisor request

#### What the model sees

The configured supervisor model receives a fixed system instruction defining `accept`, `revise`, `clarify`, and `escalate`, plus one JSON-framed user message containing the objective, completed executor output, acceptance criteria, and current review cycle. Executor text cannot close a prompt delimiter because it is JSON data.

#### Token effect

One independent auxiliary model request per `review()` call. The configured output cap bounds supervisor generation; input size currently follows the caller-supplied objective, output, and criteria without a package-owned byte cap.

#### KV Cache effect

Independent from the executor request. The fixed system instruction is prefix-stable across reviews on the same route; the JSON evidence message changes per review.

## Known Limitations and Deferred Work

- **No automatic executor continuation yet** — `revise` returns instructions to its orchestration caller; a later package change will inject them into the executor and run the bounded loop without manual relay.
- **No durable supervisor audit event yet** — the auxiliary call is not currently appended to the executor session log; later integration must log every model-visible supervisor instruction before it can affect another executor request.
- **No approval handoff yet** — `escalate` identifies the need and category but does not call `ctx.approval`; the protected action must remain unexecuted until orchestration adds that handoff.
- **No built-in clarification lookup yet** — `resolvableByTools` is routing metadata only; a later orchestration layer will attempt mounted tools before creating a user question.
