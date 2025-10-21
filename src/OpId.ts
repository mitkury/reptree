/**
 * An identifier for an operation. We use them to compare and order operations.
 * It uses a counter as a Lamport clock and a peer ID in case if ops have the same counter - in that case the ops will be compared by peer ID.
 * Lamport clock (Lamport timestamp): https://en.wikipedia.org/wiki/Lamport_timestamp
 */
export interface OpId {
  readonly counter: number;
  readonly peerId: string;
}

export function createOpId(counter: number, peerId: string): OpId {
  return { counter, peerId };
}

/**
 * Compares two operation IDs.
 * @param opIdA - The first operation ID.
 * @param opIdB - The second operation ID.
 * @returns 1 if opIdA is greater than opIdB, -1 if opIdA is less than opIdB, 0 if they are equal.
 */
export function compareOpId(opIdA: OpId | string, opIdB: OpId | string): number {
  if (typeof opIdA === 'string') {
    const parsedA = tryParseOpIdStr(opIdA);
    if (!parsedA) throw new Error(`Invalid OpId string: ${opIdA}`);
    opIdA = parsedA;
  }
  if (typeof opIdB === 'string') {
    const parsedB = tryParseOpIdStr(opIdB);
    if (!parsedB) throw new Error(`Invalid OpId string: ${opIdB}`);
    opIdB = parsedB;
  }

  const counterA = opIdA.counter;
  const counterB = opIdB.counter;

  if (counterA > counterB) {
    return 1;
  } else if (counterA < counterB) {
    return -1;
  } else {
    // If the counters are equal, compare the peer IDs.
    // So it's always possible to deterministically order the ops.
    return opIdA.peerId.localeCompare(opIdB.peerId);
  }
}

export function equalsOpId(opIdA: OpId | string | null, opIdB: OpId | string | null): boolean {
  if (opIdA === opIdB) {
    return true;
  } else if (!opIdA || !opIdB) {
    return false;
  }

  return compareOpId(opIdA, opIdB) === 0;
}

export function tryParseOpIdStr(opIdStr: string): OpId {
  const parts = opIdStr.split('@');

  if (parts.length !== 2) {
    throw new Error(`Invalid OpId string: ${opIdStr}`);
  }

  return createOpId(parseInt(parts[0], 10), parts[1]);
}

export function isOpIdGreaterThan(opIdA: OpId | string, opIdB: OpId | string): boolean {
  return compareOpId(opIdA, opIdB) === 1;
}

export function opIdToString(opId: OpId): string {
  return `${opId.counter}@${opId.peerId}`;
}
