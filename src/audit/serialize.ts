/**
 * Deterministic JSON canonicalization with sorted object keys.
 *
 * Produces identical output regardless of object key insertion order,
 * making it suitable for hashing. Arrays maintain element order.
 *
 * @param value - Any JSON-compatible value
 * @returns Canonical JSON string with sorted keys
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value)
  }

  if (typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    const elements = value.map((el) => canonicalize(el))
    return '[' + elements.join(',') + ']'
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sortedKeys = Object.keys(obj).sort()
    const pairs = sortedKeys
      .filter((k) => obj[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]))
    return '{' + pairs.join(',') + '}'
  }

  return JSON.stringify(value)
}
