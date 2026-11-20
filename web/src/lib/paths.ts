/** A path under the home directory, shown as ~/…. */
export const shortPath = (path: string): string => path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, '~');

/** Quote a value for a POSIX shell when it contains anything unusual. */
export const shellQuote = (value: string): string => (/^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);

/** Where a session runs in tmux, as tmux writes it: "switchyard:my-repo-login". */
export const tmuxPlace = (host: { session?: string; windowName?: string }): string => `${host.session}:${host.windowName}`;
