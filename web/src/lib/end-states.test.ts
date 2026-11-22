import { describe, expect, it } from 'vitest';
import { endStateOf } from './end-states';

describe('endStateOf', () => {
  it('reads a failed last turn as Failed, amber, naming the API error', () => {
    const state = endStateOf({ endState: 'failed', endError: 'rate_limit' });
    expect(state.label).toBe('Failed');
    expect(state.tone).toBe('amber');
    expect(state.hint).toMatch(/rate limit/);
  });

  it('falls back to Ended for anything it does not know, and keeps the other hints as they are', () => {
    expect(endStateOf({ endState: 'weird' }).label).toBe('Ended');
    expect(endStateOf({ endState: 'finished', endError: 'x' }).hint).toBe('The agent completed its last turn');
  });
});
