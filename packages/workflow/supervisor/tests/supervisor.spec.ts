import { describe, expect, it } from 'vitest'
import {
  parseSupervisorDecision,
  SupervisorError,
} from '@deepseek-ai/dsh-supervisor'

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
