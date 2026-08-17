/** Bounded executor -> supervisor -> revision orchestration. */

import {
  SupervisorError,
  type SupervisorDecision,
  type SupervisorReviewRequest,
  type SupervisorService,
} from './supervisor.ts'

/** One executor invocation inside a supervised loop. */
export interface SupervisedExecutorRequest {
  readonly objective: string
  readonly cycle: number
  /** Supervisor revision instructions from the previous pass, absent on cycle one. */
  readonly revisionInstructions?: string
  readonly signal?: AbortSignal
}

/** Minimal executor seam so DeepSeek agents, workflows, or test doubles can participate. */
export interface SupervisedExecutor {
  execute(request: SupervisedExecutorRequest): Promise<string>
}

/** Input policy for one bounded supervised task. */
export interface SupervisedLoopRequest {
  readonly objective: string
  readonly acceptanceCriteria?: readonly string[]
  readonly signal?: AbortSignal
}

/** Accepted work and audit-friendly pass count. */
export interface SupervisedAcceptedResult {
  readonly status: 'accepted'
  readonly output: string
  readonly decision: Extract<SupervisorDecision, { kind: 'accept' }>
  readonly cycles: number
}

/** A clarification or human-authority escalation intentionally stops automatic execution. */
export interface SupervisedPausedResult {
  readonly status: 'paused'
  readonly output: string
  readonly decision: Extract<SupervisorDecision, { kind: 'clarify' | 'escalate' }>
  readonly cycles: number
}

export type SupervisedLoopResult = SupervisedAcceptedResult | SupervisedPausedResult

/**
 * Run an executor until the supervisor accepts, pauses, or the bounded revision budget is exhausted.
 * `revise` is automatically returned to the executor on the next cycle, removing human message relay.
 */
export async function runSupervisedLoop(
  supervisor: Pick<SupervisorService, 'review' | 'maxReviewCycles'>,
  executor: SupervisedExecutor,
  request: SupervisedLoopRequest,
): Promise<SupervisedLoopResult> {
  let revisionInstructions: string | undefined

  for (let cycle = 1; cycle <= supervisor.maxReviewCycles; cycle += 1) {
    request.signal?.throwIfAborted()
    const output = await executor.execute({
      objective: request.objective,
      cycle,
      ...revisionInstructions === undefined ? {} : { revisionInstructions },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
    request.signal?.throwIfAborted()

    const review: SupervisorReviewRequest = {
      objective: request.objective,
      executorOutput: output,
      acceptanceCriteria: request.acceptanceCriteria,
      cycle,
      ...request.signal === undefined ? {} : { signal: request.signal },
    }
    const decision = await supervisor.review(review)

    switch (decision.kind) {
      case 'accept':
        return { status: 'accepted', output, decision, cycles: cycle }
      case 'clarify':
      case 'escalate':
        return { status: 'paused', output, decision, cycles: cycle }
      case 'revise':
        revisionInstructions = decision.instructions
        break
    }
  }

  throw new SupervisorError(
    `supervisor: executor remained in revise state after ${supervisor.maxReviewCycles} review cycles`,
    'REVIEW_BUDGET_EXHAUSTED',
  )
}
