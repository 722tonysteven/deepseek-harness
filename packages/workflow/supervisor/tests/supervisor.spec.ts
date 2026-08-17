import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SupervisorService, {
  parseSupervisorDecision,
  SupervisorError,
} from '@deepseek-ai/dsh-supervisor'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: readonly StreamChunk[]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield * this.script
  }
}

function textScript(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('parseSupervisorDecision', () => {
  it('accepts each closed decision form', () => {
    expect(parseSupervisorDecision('{"decision":"accept","reason":"complete"}')).toEqual({
      kind: 'accept',
      reason: 'complete',
    })
    expect(parseSupervisorDecision('{"decision":"revise","reason":"missing evidence","instructions":"verify the measurement"}')).toEqual({
      kind: 'revise',
      reason: 'missing evidence',
      instructions: 'verify the measurement',
    })
    expect(parseSupervisorDecision('{"decision":"clarify","reason":"vehicle data missing","question":"What is the current offset?","resolvableByTools":false}')).toEqual({
      kind: 'clarify',
      reason: 'vehicle data missing',
      question: 'What is the current offset?',
      resolvableByTools: false,
    })
    expect(parseSupervisorDecision('{"decision":"escalate","reason":"refund changes company funds","category":"refund"}')).toEqual({
      kind: 'escalate',
      reason: 'refund changes company funds',
      category: 'refund',
    })
  })

  it('fails closed on prose, unknown decisions, and incomplete fields', () => {
    const invalid = [
      'Looks good.',
      '{"decision":"approve","reason":"fine"}',
      '{"decision":"accept","reason":""}',
      '{"decision":"revise","reason":"wrong"}',
      '{"decision":"clarify","reason":"missing","question":"Which VIN?","resolvableByTools":"no"}',
      '{"decision":"escalate","reason":"sensitive"}',
    ]
    for (const text of invalid) {
      expect(() => parseSupervisorDecision(text)).toThrow(SupervisorError)
    }
  })

  it('does not accept a valid JSON object wrapped in Markdown fences', () => {
    expect(() => parseSupervisorDecision('```json\n{"decision":"accept","reason":"complete"}\n```'))
      .toThrow('model output is not valid JSON')
  })
})

describe('SupervisorService.review', () => {
  it('dispatches an independent provider route and returns a validated decision', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new ScriptedAdapter(textScript(
      '{"decision":"revise","reason":"missing fitment evidence","instructions":"verify brake clearance before recommending ET"}',
    ))
    ctx.llm.registerAdapter(['openai-review'], adapter)
    await ctx.plugin(SupervisorService, {
      provider: 'openai-review',
      model: 'gpt-review',
      maxOutputTokens: 256,
      maxReviewCycles: 3,
    })

    const decision = await ctx.supervisor.review({
      objective: 'Give a safe wheel-fitment recommendation.',
      executorOutput: '20x10 ET20 should be fine.',
      acceptanceCriteria: ['Do not invent missing brake-clearance data.'],
      cycle: 1,
    })

    expect(decision).toEqual({
      kind: 'revise',
      reason: 'missing fitment evidence',
      instructions: 'verify brake clearance before recommending ET',
    })
    expect(adapter.requests).toHaveLength(1)
    const [request] = adapter.requests
    expect(request).toMatchObject({
      provider: 'openai-review',
      model: 'gpt-review',
      maxTokens: 256,
    })
    expect(request?.tools).toBeUndefined()
    expect(request?.system).toContain('independent supervisor')
    const evidence = request?.messages[0]?.content[0]
    expect(evidence?.type === 'text' && evidence.text).toContain('20x10 ET20 should be fine.')
  })

  it('fails closed when the review budget is exhausted before model dispatch', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const adapter = new ScriptedAdapter(textScript('{"decision":"accept","reason":"complete"}'))
    ctx.llm.registerAdapter(['openai-review'], adapter)
    await ctx.plugin(SupervisorService, {
      provider: 'openai-review',
      model: 'gpt-review',
      maxReviewCycles: 2,
    })

    await expect(ctx.supervisor.review({
      objective: 'Check the work.',
      executorOutput: 'draft',
      cycle: 3,
    })).rejects.toMatchObject({ code: 'REVIEW_BUDGET_EXHAUSTED' })
    expect(adapter.requests).toHaveLength(0)
  })
})
