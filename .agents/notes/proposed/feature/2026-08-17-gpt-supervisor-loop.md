# Agent Note: GPT supervisor loop

Status: proposed

## Problem

DeepSeek Harness can already delegate work, run model-authored workflows, pause for user approval, and compose model providers, but it does not currently provide a first-class supervisor that evaluates another agent's completed work against an explicit policy and then decides whether to accept it, request a revision, ask for missing information, or escalate a sensitive decision to a human. Without that layer, a user who wants a multi-role AI company must manually relay outputs between an executor and a reviewer, which breaks the desired autonomous loop and makes approval rules difficult to audit.

The target deployment needs a supervisor that can use an OpenAI model independently from the executor model. The executor may remain DeepSeek. The supervisor must be able to reject weak work and automatically return precise feedback without requiring a human to copy messages between systems. At the same time, the supervisor must not silently authorize high-impact business actions such as payments, refunds, binding price changes, deletion of important data, or externally binding commitments.

## Proposal

Add a supervisor capability as plugins beside the existing agent loop rather than modifying `packages/core/agent-loop`. The first implementation will evaluate completed executor work with a separately configured LLM route, produce a typed decision, and feed that decision back through existing agent, session, workflow, and interaction extension points.

The supervisor decision has four terminal forms for one review pass:

- `accept`: the executor result satisfies the configured objective and can proceed.
- `revise`: the result is incomplete or incorrect; the supervisor returns actionable revision instructions and the executor receives another admitted step.
- `clarify`: required information is missing and cannot be responsibly inferred; the supervisor produces a concrete question or lookup request instead of guessing.
- `escalate`: the proposed next action matches a configured human-approval rule and must pause until an approval service resolves it.

A supervisor run is bounded by configuration. It has a maximum number of review cycles, records every decision in durable session-visible state, and fails closed on invalid supervisor output or exhausted revision budget. The supervisor must never turn a malformed response into implicit acceptance.

### Package topology

The first version is expected to use one single-purpose package under a new or existing orchestration-oriented group, tentatively `packages/workflow/supervisor`, named `@deepseek-ai/dsh-supervisor`. It owns supervisor policy and review orchestration, while model transport stays on the existing `ctx.llm` seam and human approval stays on the existing interaction capability. No OpenAI-specific API client belongs in the supervisor package.

The package will depend on the existing agent/session/LLM interfaces and, when needed, interaction approval. It will not fork or patch model adapters. An OpenAI route is provided by the existing generic `llm-pi-ai` adapter, so the supervisor selects a provider/model route by configuration while the executor can select another route.

### Review trigger

The initial trigger is a completed executor turn or an explicit workflow review call, not every model step. Reviewing every step would create unnecessary model traffic and could interfere with ordinary tool-use loops. The package will attach at a documented agent/workflow extension point and only request another executor step when the decision is `revise`.

The package must preserve the Harness invariant that model-visible information is reconstructable from durable session state. Supervisor feedback injected into the executor therefore has an explicit plugin source and is logged before it can affect a model request.

### Supervisor request

Each supervisor request contains only the evidence needed to judge the current objective:

- the objective or task statement;
- the executor's latest completed answer and relevant logged tool results;
- configured acceptance criteria and escalation rules;
- the current review-cycle number and remaining budget.

The supervisor prompt requires structured output matching the decision union. Free-form prose outside that structure is rejected. The implementation validates model output at the LLM boundary before acting on it.

### Human approval policy

Human approval remains a separate decision from quality review. The supervisor may identify an action as sensitive, but it cannot grant the approval itself. `escalate` creates an approval request through the existing interaction capability and suspends continuation until the request resolves.

The first deployment policy will treat at least the following as approval-required categories when an action would be externally executed rather than merely drafted: payments or transfers, refunds or credits, binding price changes outside configured limits, contract or legal commitments, destructive data operations, credential or permission changes, and customer-facing promises with material financial or delivery impact. Deployment configuration may add stricter categories.

### Automatic clarification

`clarify` does not automatically mean asking the human. The orchestration layer first classifies whether the missing fact can be obtained from already mounted tools or connected data sources. If a tool lookup can resolve it, the executor receives a targeted lookup instruction. Only genuinely user-owned or unavailable information becomes a user question.

### Loop limits and failure behavior

The review loop has a configurable `maxReviewCycles` with a conservative default. Reaching the limit fails closed and returns a visible status requiring human attention rather than continuing indefinitely. A supervisor provider error may be retried only through the existing LLM retry policy; the supervisor orchestration itself does not hide provider failures.

A supervisor response that fails schema validation is an error, not `accept`. A missing approval service while an `escalate` decision is required is a load-time or earliest-resolvable configuration error; it must not silently downgrade to acceptance or revision.

### Initial deployment sequence

The implementation will be staged so the repository remains easy to validate:

1. add the typed supervisor decision and policy package with unit tests for decision validation, loop budget, and fail-closed behavior;
2. add integration with existing LLM routing using a configurable supervisor provider/model;
3. add executor feedback and durable logging for `revise`;
4. add approval handoff for `escalate`;
5. add a runnable headless example and keyless snapshot coverage for the assembled review loop;
6. document a deployment profile where DeepSeek executes and OpenAI supervises.

The first release will not self-modify its own supervisor code or policy. Self-modification remains a later capability after review behavior, auditability, and rollback are proven.

## Alternatives considered

**Modify `agent-loop` directly.** Rejected because Harness explicitly treats new behavior as plugins on documented extension points. A loop fork would increase upgrade conflicts with upstream DeepSeek Harness and make the supervisor inseparable from every agent run.

**Use only DeepSeek for both execution and review.** Rejected as the only architecture because the deployment specifically needs an independent GPT reviewer and benefits from model diversity. The supervisor remains provider-neutral so DeepSeek, OpenAI, or another configured route can be selected later without another package fork.

**Implement the supervisor as a standalone external script.** Rejected for the primary path because it would duplicate session, tool, approval, and workflow plumbing and would reintroduce the manual handoff problem at a different boundary. External automation may still drive Harness through ACP or the SDK, but the review semantics belong inside the plugin composition.

**Allow the supervisor to execute sensitive actions after judging them safe.** Rejected because quality judgment and human authority are different concerns. Sensitive execution remains behind the existing approval capability even when the reviewer strongly recommends proceeding.

**Enable self-modification in V1.** Rejected because an autonomous reviewer that can rewrite its own enforcement logic before the review and approval paths are proven creates an unnecessary control risk and complicates rollback.

## Acceptance criteria

- A profile can configure an executor model route and a distinct supervisor model route without changing either model adapter.
- A completed executor result can be reviewed and produce one validated decision from `accept`, `revise`, `clarify`, or `escalate`.
- `revise` automatically returns precise logged feedback to the executor and can run another bounded review cycle without human message relay.
- `clarify` can route resolvable missing information to tool lookup and route genuinely unavailable information to a user question.
- `escalate` cannot continue the protected action without a resolved human approval request.
- Invalid supervisor output, missing required approval infrastructure, and exhausted review budget never become implicit acceptance.
- Every model-visible supervisor instruction is reconstructable from durable session state.
- A runnable headless example demonstrates a DeepSeek executor with an OpenAI supervisor, and a keyless snapshot covers the assembled control flow.
- The change does not modify the core agent-loop solely to implement supervision.

## Risks

The extra model review adds latency and token cost to tasks that are supervised. The package must therefore make review scope explicit rather than reviewing every low-value step.

A supervisor can still make a bad judgment even with structured output. Human approval rules mitigate high-impact actions, but ordinary accepted work remains probabilistic and should be governed by deployment-specific acceptance criteria.

An overly broad escalation policy can make the system feel manual, while an overly narrow one can expose business risk. The first deployment will prefer explicit, auditable policy fields and fail-closed behavior over hidden heuristics.

Independent model providers introduce separate credentials, quotas, and availability failure modes. Provider transport and retries remain owned by the existing LLM seam so the supervisor package does not create a second networking stack.
