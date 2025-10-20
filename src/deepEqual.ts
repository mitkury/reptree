/**
 * Deep equality for JSON-serializable values used by RepTree.
 * - Fast paths: strict equality, null checks, typeof checks
 * - Arrays compared element-wise
 * - Objects: only plain objects (Object.prototype or null prototype)
 * - No support for Date/Map/Set/RegExp/TypedArrays/etc. by design
 */
export function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;

  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (ta !== 'object') return false;

  // Arrays
  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr || bIsArr) {
    if (!(aIsArr && bIsArr)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Only plain objects
  const aProto = Object.getPrototypeOf(a);
  const bProto = Object.getPrototypeOf(b);
  if ((aProto !== Object.prototype && aProto !== null) || (bProto !== Object.prototype && bProto !== null)) {
    return false;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}
