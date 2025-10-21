/**
 * Validate JSON-serializable value (same rules as persistent)
 * @param v - The value to validate
 * @returns True if the value is JSON-serializable, false otherwise
 */
export default function isJsonValue(v: any): boolean {
  if (v === undefined) return true; // deletion signal
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (t === 'bigint' || t === 'function' || t === 'symbol') return false;
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (t === 'object') {
    if (v instanceof Date) return false; // not allowed
    if (v instanceof Map || v instanceof Set || v instanceof RegExp) return false;
    if (ArrayBuffer.isView(v)) return false; // TypedArrays
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    for (const val of Object.values(v)) {
      if (!isJsonValue(val)) return false;
    }
    return true;
  }
  return false;
};