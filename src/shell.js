/** Quote a value for a POSIX shell when it contains anything beyond safe characters. */
export function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Single-quote a value even when it looks safe: zsh expands a bare word starting with "=" into a command path. */
export function shellQuoteAlways(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
