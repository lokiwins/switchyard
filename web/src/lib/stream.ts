import { useEffect, useEffectEvent, useState } from 'react';
import { usePageVisible } from './visibility';

/*
 * A server-sent events stream, held while the tab shows: closing it while the
 * tab is hidden frees one of the few connections a browser allows per site,
 * and lets the server stop work only that page wanted. The browser reconnects
 * by itself if it drops. True while connected.
 */
export function useEventStream(
  url: string | null,
  handlers: Record<string, (data: unknown) => void>,
  /** The server refused the stream (or switchyard isn't running): the browser has given up on it. */
  { onClosed }: { onClosed?: () => void } = {},
): boolean {
  const visible = usePageVisible();
  const [open, setOpen] = useState(false);
  // The handlers in use when an event comes, so the stream isn't reopened as they change.
  const receive = useEffectEvent((name: string, data: unknown) => handlers[name]?.(data));
  const closed = useEffectEvent(() => onClosed?.());
  const events = Object.keys(handlers).sort().join(',');
  useEffect(() => {
    if (!url || !visible || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(url);
    source.onopen = () => setOpen(true);
    source.onerror = () => {
      setOpen(source.readyState === EventSource.OPEN);
      if (source.readyState === EventSource.CLOSED) closed();
    };
    for (const name of events.split(',').filter(Boolean)) {
      source.addEventListener(name, (event) => receive(name, JSON.parse((event as MessageEvent<string>).data)));
    }
    return () => {
      source.close();
      setOpen(false);
    };
  }, [url, events, visible]);
  return open && visible;
}
