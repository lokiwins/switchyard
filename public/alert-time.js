/** Whether an alert set to show at `showAt` (ms) shows `now`: from that time on; never without one. */
export const isDue = (showAt, now = Date.now()) => Number(showAt) > 0 && now >= Number(showAt);
