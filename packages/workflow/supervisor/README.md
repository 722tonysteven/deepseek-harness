# GPT supervisor foundation

English | [中文](README.zh.md)

The V1 supervisor capability is hosted inside `@deepseek-ai/dsh-workflow` at `src/supervisor.ts` so the first prototype can reuse the existing workflow package dependencies without introducing a new workspace package or lockfile churn.

It provides an independent, provider-neutral model-backed review service for judging completed agent outputs. The executor may use DeepSeek while the supervisor uses an OpenAI route already mounted on `ctx.llm`.

Current decisions are `accept`, `revise`, `clarify`, and `escalate`. Malformed output, model failures, unexpected tool calls, and review-budget exhaustion fail closed.

This directory is retained only for the V1 design note, compatibility source path, tests, and bilingual documentation. Automatic executor reinjection, durable supervisor session events, clarification lookup, and approval handoff remain staged follow-up work.
