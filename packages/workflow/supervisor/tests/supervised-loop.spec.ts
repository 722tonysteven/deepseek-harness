import { describe, expect, it } from 'vitest'
import { SupervisorError } from '@deepseek-ai/dsh-workflow/src/supervisor.ts'
import { runSupervisedLoop } from '@deepseek-ai/dsh-workflow/src/supervised-loop.ts'
import type { SupervisorDecision } from '@deepseek-ai/dsh-workflow/src/supervisor.ts'

class ScriptedSupervisor {
  readonly maxReviewCycles: number
  readonly reviews: Array<{ output: string; cycle?: number }> = []

  constructor(
    private readonly decisions: readonly SupervisorDecision[],
    maxReviewCycles = decisions.length,
  ) {
    this.maxReviewCycles = maxReviewCycles
  }

  async review(request: { executorOutput: string; cycle?: number }): Promise<SupervisorDecision> {
    this.reviews.push({ output: request.executorOutput, cycle: request.cycle })
    const decision = this.decisions[this.reviews.length - 1]
    if (decision === undefined) throw new Error('missing scripted supervisor decision')
    return decision
  }
}

class RecordingExecutor {
  readonly calls: Array<{ cycle: number; revisionInstructions?: string }> = []

  constructor(private readonly outputs: readonly string[]) {}

  async execute(request: { cycle: number; revisionInstructions?: string }): Promise<string> {
    this.calls.push({
      cycle: request.cycle,
      ...request.revisionInstructions === undefined
        ? {}
        : { revisionInstructions: request.revisionInstructions },
    })
    const output = this.outputs[request.cycle - 1]
    if (output === undefined) throw new Error('missing scripted executor output')
    return output
  }
}

describe('runSupervisedLoop', () => {
  it('automatically returns revision instructions to the executor until accepted', async () => {
    const supervisor = new ScriptedSupervisor([
      {
        kind: 'revise',
        reason: 'missing brake evidence',
        instructions: 'verify brake clearance and avoid guessing',
      },
      { kind: 'accept', reason: 'safe and supported' },
    ], 3)
    const executor = new RecordingExecutor([
      '20x10 ET20 is fine.',
      'Brake clearance is not provided, so request measurement before final ET.',
    ])

    const result = await runSupervisedLoop(supervisor as never, executor, {
      objective: 'Give a safe wheel-fitment recommendation.',
    })

    expect(result).toMatchObject({ status: 'accepted', cycles: 2 })
    expect(executor.calls).toEqual([
      { cycle: 1 },
      { cycle: 2, revisionInstructions: 'verify brake clearance and avoid guessing' },
    ])
    expect(supervisor.reviews.map(review => review.cycle)).toEqual([1, 2])
  })

  it.each([
    {
      kind: 'clarify',
      reason: 'missing vehicle data',
      question: 'What is the current offset?',
      resolvableByTools: false,
    },
    {
      kind: 'escalate',
      reason: 'refund changes company funds',
      category: 'refund',
    },
  ] satisfies SupervisorDecision[])('pauses automatic execution on $kind', async (decision) => {
    const supervisor = new ScriptedSupervisor([decision], 3)
    const executor = new RecordingExecutor(['draft'])

    const result = await runSupervisedLoop(supervisor as never, executor, {
      objective: 'Handle the task.',
    })

    expect(result).toMatchObject({ status: 'paused', cycles: 1, decision })
    expect(executor.calls).toHaveLength(1)
  })

  it('fails closed instead of looping forever when every review says revise', async () => {
    const supervisor = new ScriptedSupervisor([
      { kind: 'revise', reason: 'still weak', instructions: 'try again' },
      { kind: 'revise', reason: 'still weak', instructions: 'try once more' },
    ], 2)
    const executor = new RecordingExecutor(['draft one', 'draft two'])

    await expect(runSupervisedLoop(supervisor as never, executor, {
      objective: 'Produce acceptable work.',
    })).rejects.toBeInstanceOf(SupervisorError)
    expect(executor.calls).toHaveLength(2)
  })
})
