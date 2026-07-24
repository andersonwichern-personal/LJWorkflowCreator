import { InjectionToken } from '@angular/core';
import { WorkflowBrainContextProvider } from '../../../brain/ports';
import { provideStandaloneBrainContext } from './standalone-brain-context.adapter';

/**
 * The replaceable context window of the Workflow Brain, as an Angular DI seam.
 *
 * The Brain never knows which host produced its snapshot
 * (docs/workflow-brain-context-contract.md): the standalone workspace defaults
 * to the static-vocabulary StandaloneBrainContextProvider, and the admin
 * monorepo overrides this token with the Landjourney-live adapter at its
 * composition root — never with `if (demo)` branches inside consumers. Both
 * implementations must pass runContextProviderContract
 * (core-tests/assert-brain-context-contract.ts).
 */
export const WORKFLOW_BRAIN_CONTEXT = new InjectionToken<WorkflowBrainContextProvider>(
  'WORKFLOW_BRAIN_CONTEXT',
  { providedIn: 'root', factory: provideStandaloneBrainContext }
);
