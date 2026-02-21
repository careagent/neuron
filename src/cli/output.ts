/**
 * Consistent CLI output helpers.
 *
 * All output uses process.stdout/stderr.write for testability.
 * No colors, no emojis -- clean text output only.
 */
export const output = {
  /** Write an informational message to stdout. */
  info(message: string): void {
    process.stdout.write(message + '\n')
  },

  /** Write a success message to stdout, prefixed with "OK:". */
  success(message: string): void {
    process.stdout.write('OK: ' + message + '\n')
  },

  /** Write an error message to stderr, prefixed with "Error:". */
  error(message: string): void {
    process.stderr.write('Error: ' + message + '\n')
  },

  /** Write a warning message to stderr, prefixed with "Warning:". */
  warn(message: string): void {
    process.stderr.write('Warning: ' + message + '\n')
  },

  /** Write a simple key-value table to stdout. */
  table(data: Record<string, string>[]): void {
    if (data.length === 0) return
    const keys = Object.keys(data[0])
    const widths = keys.map((k) =>
      Math.max(k.length, ...data.map((row) => (row[k] ?? '').length)),
    )
    // Header
    const header = keys.map((k, i) => k.padEnd(widths[i])).join('  ')
    process.stdout.write(header + '\n')
    process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n')
    // Rows
    for (const row of data) {
      const line = keys.map((k, i) => (row[k] ?? '').padEnd(widths[i])).join('  ')
      process.stdout.write(line + '\n')
    }
  },
}
