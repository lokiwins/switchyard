import { timeAgo, useNow } from '../lib/time';

/** "<prefix>5m ago", kept current by the page's clock; only this redraws as it ticks. */
export function LiveTime({ since, prefix = '', className, title }: { since: number | null | undefined; prefix?: string; className?: string; title?: string }) {
  const now = useNow();
  return (
    <span className={className} title={title ?? (since ? new Date(since).toLocaleString() : undefined)}>
      {`${prefix}${timeAgo(since, now)}`}
    </span>
  );
}
