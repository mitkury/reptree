import { describe, test, expect } from 'vitest';
import { RepTree, bindVertex } from '../dist/index.js';

/**
 * Verifies cross-API synchronization:
 * - Setting a property via Vertex API is reflected in bound proxies
 * - Setting via bound proxies is reflected when reading from Vertex API
 */
describe('cross-API sync between Vertex and bound proxy', () => {
  test('Vertex.setProperty -> bound proxy, and proxy -> Vertex.getProperty', () => {
    const tree = new RepTree('peer1');
    const root = tree.createRoot();

    // Create a child vertex normally (non-bound)
    const v = root.newChild();

    // Create two bound proxies pointing at the same vertex
    const refA = bindVertex(tree, v.id);
    const refB = bindVertex(tree, v.id);

    // 1) Write via Vertex API
    v.setProperty('score', 10);

    // Reads via bound proxies should reflect the value
    const scoreA = refA['score' as keyof typeof refA] as unknown as number;
    const scoreB = refB['score' as keyof typeof refB] as unknown as number;
    expect(scoreA).toBe(10);
    expect(scoreB).toBe(10);

    // 2) Write via a bound proxy
    refA['score' as keyof typeof refA] = 42 as any;

    // Vertex.getProperty should reflect the new value
    expect(v.getProperty('score')).toBe(42);

    // Other bound proxies also see the change
    const scoreBAfter = refB['score' as keyof typeof refB] as unknown as number;
    expect(scoreBAfter).toBe(42);
  });
});
