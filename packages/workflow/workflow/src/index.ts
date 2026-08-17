/**
 * Service Definition for the workflow capability seam. Service Providers execute orchestration scripts;
 * observe-only lifecycle events never expose run control.
 * @module @deepseek-ai/dsh-workflow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowResultInfo,
  WorkflowRunInfo,
} from './types.ts'
import type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

export { WorkflowRunId } from './types.ts'
export type {
  WorkflowAgentEndInfo,
  WorkflowAgentInfo,
  WorkflowAgentOutcome,
  WorkflowMeta,
  WorkflowPhase,
  WorkflowResult,
  WorkflowResultInfo,
  WorkflowRunInfo,
  WorkflowStopReason,
} from './types.ts'
export type { WorkflowRun, WorkflowStartRequest } from './runtime-types.ts'

// Provider-neutral supervisor + bounded automatic revision loop.
export {
  SupervisorError,
  SupervisorService,
  parseSupervisorDecision,
} from './supervisor.ts'
export type {
  SupervisorConfig,
  SupervisorDecision,
  SupervisorReviewRequest,
} from './supervisor.ts'
export { runSupervisedLoop } from './supervised-loop.ts'
export type {
  SupervisedExecutor,
  SupervisedExecutorRequest,
  SupervisedLoopRequest,
  SupervisedLoopResult,
} from './supervised-loop.ts'
export {
  runWheelRegressionCase,
  runWheelRegressionSuite,
  wheelAcceptanceCriteria,
} from './wheel-regression.ts'
export type {
  WheelRegressionCase,
  WheelRegressionResult,
} from './wheel-regression.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workflowEngine: WorkflowEngine
  }

  interface Events {
    'workflow/start'(info: WorkflowRunInfo): void
    'workflow/phase'(info: WorkflowRunInfo, title: string): void
    'workflow/log'(info: WorkflowRunInfo, message: string): void
    'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
    'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
    'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
  }
}

export type WorkflowEventName =
  | 'workflow/start'
  | 'workflow/phase'
  | 'workflow/log'
  | 'workflow/agent-start'
  | 'workflow/agent-end'
  | 'workflow/end'

export type WorkflowErrorCode =
  | 'SCRIPT_PARSE'
  | 'META_INVALID'
  | 'INVALID_ARGUMENT'
  | 'UNSUPPORTED_OPTION'
  | 'UNSUPPORTED_SCHEMA'
  | 'AGENT_CAP'
  | 'ITEM_CAP'
  | 'AGENT_START'
  | 'AGENT_RESULT'
  | 'RESULT_UNSERIALIZABLE'
  | 'CANCELLED'

export class WorkflowError extends HarnessError {
  readonly fatal: boolean

  constructor(message: string, code: WorkflowErrorCode, options?: ErrorOptions & { fatal?: boolean }) {
    super(message, code, options)
    this.name = 'WorkflowError'
    this.fatal = options?.fatal ?? true
  }
}

export function isFatalWorkflowError(error: unknown): boolean {
  return error instanceof WorkflowError && error.fatal
}

export abstract class WorkflowEngine extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workflowEngine')
  }

  abstract start(request: WorkflowStartRequest): WorkflowRun

  protected emitWorkflowEvent(name: WorkflowEventName, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...payload: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`workflow: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`workflow: ${name} listener threw: ${renderListenerError(error)}`)
      }
    }
  }
}

function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

export default WorkflowEngine
