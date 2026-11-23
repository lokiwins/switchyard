import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveSession } from '../../../lib/types';
import { JumpButton } from './session';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const SESSION: LiveSession = { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', pid: 42, cwd: '/w/app', status: 'idle', statusUpdatedAt: 0, kind: 'interactive', host: null };

function button(session: LiveSession) {
  return render(<QueryClientProvider client={new QueryClient()}><JumpButton session={session} /></QueryClientProvider>);
}

describe('JumpButton', () => {
  it('offers Resume for a running session it has no tab or window for, and resumes it through the server', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { opened: true, tookOver: true, host: 'tmux', window: 'switchyard:app' } })));
    vi.stubGlobal('fetch', fetchMock);
    button(SESSION);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/terminal/resume');
    expect(JSON.parse(String(init.body))).toEqual({ sessionId: SESSION.sessionId });
  });

  it('leaves a session running in the background alone', () => {
    button({ ...SESSION, kind: 'background' });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still jumps to a session whose tab it knows', () => {
    button({ ...SESSION, host: { kind: 'terminal', label: 'iTerm', app: 'iTerm', appName: 'iTerm' } as LiveSession['host'] });
    expect(screen.getByRole('button', { name: 'Jump' })).toBeTruthy();
  });
});
