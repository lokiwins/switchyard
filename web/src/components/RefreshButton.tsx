/** Refresh in the top bar: look again now, past the server's caches; off while a look is under way. */
export function RefreshButton({ busy, onRefresh }: { busy: boolean; onRefresh: () => Promise<unknown> }) {
  return (
    <button id="refresh" type="button" className="btn" disabled={busy} onClick={() => void onRefresh().catch(() => {})}>
      Refresh
    </button>
  );
}
