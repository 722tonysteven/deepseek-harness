/** 722 forged-wheel regression adapter for the bounded supervisor loop. */

import { runSupervisedLoop, type SupervisedExecutor, type SupervisedLoopResult } from './supervised-loop.ts'
import type { SupervisorService } from './supervisor.ts'

export interface WheelRegressionCase {
  readonly id: string
  readonly prompt: string
  readonly must_include_meaning: readonly string[]
  readonly must_not_do: readonly string[]
}

export interface WheelRegressionResult {
  readonly id: string
  readonly result: SupervisedLoopResult
}

/** Convert one human-authored wheel case into supervisor acceptance criteria. */
export function wheelAcceptanceCriteria(testCase: WheelRegressionCase): readonly string[] {
  return [
    'Answer as a concise, experienced forged-wheel technical director, not as a generic audit report.',
    'Answer the user’s actual question first. Do not expand a narrow question into a full fitment or production audit unless required.',
    'Keep production feasibility, fitment safety, target appearance, and further optimization as separate conclusions.',
    'Do not invent OEM wheel, brake, suspension, widebody, or customer-goal facts that were not provided.',
    ...testCase.must_include_meaning.map(item => `Required meaning: ${item}`),
    ...testCase.must_not_do.map(item => `Forbidden behavior: ${item}`),
  ]
}

/** Run one real wheel question through executor -> supervisor -> automatic revision. */
export function runWheelRegressionCase(
  supervisor: Pick<SupervisorService, 'review' | 'maxReviewCycles'>,
  executor: SupervisedExecutor,
  testCase: WheelRegressionCase,
): Promise<SupervisedLoopResult> {
  return runSupervisedLoop(supervisor, executor, {
    objective: testCase.prompt,
    acceptanceCriteria: wheelAcceptanceCriteria(testCase),
  })
}

/** Run the regression suite sequentially so failures remain attributable to one real case. */
export async function runWheelRegressionSuite(
  supervisor: Pick<SupervisorService, 'review' | 'maxReviewCycles'>,
  executor: SupervisedExecutor,
  cases: readonly WheelRegressionCase[],
): Promise<readonly WheelRegressionResult[]> {
  const results: WheelRegressionResult[] = []
  for (const testCase of cases) {
    results.push({
      id: testCase.id,
      result: await runWheelRegressionCase(supervisor, executor, testCase),
    })
  }
  return results
}
