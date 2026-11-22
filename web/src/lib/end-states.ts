/* How a session's last turn ended (see src/transcripts.js), in words, for the pages that list ended sessions. */

export interface EndState { label: string; tone: string; hint: string }

export const END_STATES: Record<string, EndState> = {
  interrupted: { label: 'Interrupted', tone: 'amber', hint: 'The terminal closed while the agent was mid-turn' },
  stopped: { label: 'Stopped', tone: '', hint: 'You pressed Esc to interrupt the agent' },
  exited: { label: 'Exited', tone: '', hint: 'You ran /exit' },
  finished: { label: 'Finished', tone: '', hint: 'The agent completed its last turn' },
  failed: { label: 'Failed', tone: 'amber', hint: 'The last turn stopped on an API error' },
  unknown: { label: 'Ended', tone: '', hint: 'Could not tell how the last turn ended' },
};

/** How a session ended; a failed one's hint names the API error its hook reported, such as "rate limit". */
export function endStateOf({ endState, endError }: { endState?: string | null; endError?: string | null }): EndState {
  const state = END_STATES[endState ?? ''] ?? END_STATES.unknown!;
  return endState === 'failed' && endError ? { ...state, hint: `${state.hint}: ${endError.replaceAll('_', ' ')}` } : state;
}
