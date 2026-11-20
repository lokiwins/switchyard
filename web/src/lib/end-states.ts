/* How a session's last turn ended (see src/transcripts.js), in words, for the pages that list ended sessions. */

export interface EndState { label: string; tone: string; hint: string }

export const END_STATES: Record<string, EndState> = {
  interrupted: { label: 'Interrupted', tone: 'amber', hint: 'The terminal closed while the agent was mid-turn' },
  stopped: { label: 'Stopped', tone: '', hint: 'You pressed Esc to interrupt the agent' },
  exited: { label: 'Exited', tone: '', hint: 'You ran /exit' },
  finished: { label: 'Finished', tone: '', hint: 'The agent completed its last turn' },
  unknown: { label: 'Ended', tone: '', hint: 'Could not tell how the last turn ended' },
};

export const endStateOf = ({ endState }: { endState?: string | null }): EndState => END_STATES[endState ?? ''] ?? END_STATES.unknown!;
