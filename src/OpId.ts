export interface OpId {
  readonly counter: number;
  readonly peerId: string;
}

export function createOpId(counter: number, peerId: string): OpId {
  return { counter, peerId };
}

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
