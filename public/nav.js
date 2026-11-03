// Each page's own responses carry fresh counts; this slower poll only catches up the other pages' badges.
const POLL_MS = 60_000;

const BADGE_TITLES = {
  agents: (c) => `${c.waiting} waiting on you · ${c.interrupted} interrupted · ${c.working} working`,
  prs: (c) => `${c.needFixes} need fixes · ${c.reviewRequests} review requests`,
};

/** Show badge counts, e.g. the `nav` that comes with every page's data. */
export function applyNav(counts) {
  if (!counts) return;
  for (const [key, c] of Object.entries(counts)) {
    const el = document.querySelector(`[data-badge="${key}"]`);
    if (!el) continue;
    el.hidden = c.count === 0;
    el.textContent = String(c.count);
    el.className = ['nav-badge', c.tone].filter(Boolean).join(' ');
    el.parentElement.title = BADGE_TITLES[key]?.(c) ?? '';
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/nav');
    const body = await res.json();
    if (body.success) applyNav(body.data);
  } catch {
    // Badges are a convenience; the page's own error banner reports real failures.
  }
}

/** Keep the header's per-page "needs you" badges current while the page's own data isn't changing. */
export function startNavBadges() {
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}
