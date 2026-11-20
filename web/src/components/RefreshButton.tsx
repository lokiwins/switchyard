import { Button } from './Button';

/** Refresh in the top bar: look again now, past the server's caches; off while a look is under way. */
export function RefreshButton({ busy, onRefresh }: { busy: boolean; onRefresh: () => Promise<unknown> }) {
  return (
    <Button id="refresh" type="button"  disabled={busy} onClick={() => void onRefresh().catch(() => {})}>
      Refresh
    </Button>
  );
}
