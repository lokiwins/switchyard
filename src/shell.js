/** Quote a value for a POSIX shell when it contains anything beyond safe characters. */
export function shellQuote(value) {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}
