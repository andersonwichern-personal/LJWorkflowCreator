export type SweetSpiralState =
  | 'idle'
  | 'focused'
  | 'typing'
  | 'submitted'
  | 'parsing'
  | 'clarification'
  | 'understood'
  | 'partial'
  | 'parser-error'
  | 'network-error';

export interface SweetSpiralContext {
  phase: 'idle' | 'submitted' | 'parsing' | 'parser-error' | 'network-error';
  focused: boolean;
  hasText: boolean;
  hasRule: boolean;
  hasGaps: boolean;
  hasQuestions: boolean;
}

/**
 * One deterministic state reducer for the visual parser. Motion never decides
 * product state; it only reflects state already established by the composer.
 */
export function deriveSweetSpiralState(context: SweetSpiralContext): SweetSpiralState {
  if (context.phase === 'network-error') return 'network-error';
  if (context.phase === 'parser-error') return 'parser-error';
  if (context.phase === 'parsing') return 'parsing';
  if (context.phase === 'submitted') return 'submitted';
  if (context.hasRule && context.hasGaps && context.hasQuestions) return 'clarification';
  if (context.hasRule && context.hasGaps) return 'partial';
  if (context.hasRule) return 'understood';
  if (context.hasText) return 'typing';
  return context.focused ? 'focused' : 'idle';
}

export const SWEET_SPIRAL_STATUS: Record<SweetSpiralState, string> = {
  idle: 'Your AI workflow assistant is ready',
  focused: 'Listening for your instruction',
  typing: 'Predicting your workflow as you type',
  submitted: 'Instruction received',
  parsing: 'Composing your workflow',
  clarification: 'A few details need clarification',
  understood: 'Workflow composed and ready to review',
  partial: 'Part of the workflow needs attention',
  'parser-error': 'The instruction could not be understood yet',
  'network-error': 'The connection was interrupted',
};
