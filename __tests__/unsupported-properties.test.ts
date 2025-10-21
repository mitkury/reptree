import { describe, test, expect } from 'vitest';
import { RepTree } from '../src';

// Helper unsupported values
class CustomClass { constructor(public x: number) {} }

describe('Unsupported property value types are rejected', () => {
  test('setProperty and setProperties reject non-JSON-serializable values', () => {
    const t = new RepTree('p');
    const root = t.createRoot();
    const v = root.newChild();

    const unsupported: Array<[string, any]> = [
      ['fn', function () {}],
      ['sym', Symbol('s') as any],
      ['big', BigInt(1) as any],
      ['map', new Map() as any],
      ['set', new Set([1]) as any],
      ['dateNonC', new Date() as any],
      ['classInst', new CustomClass(1) as any],
      ['regexp', /a/ as any],
      ['typedArray', new Uint8Array([1,2,3]) as any],
    ];

    for (const [k, val] of unsupported) {
      expect(() => v.setProperty(k, val)).toThrowError();
    }

    // setProperties: at least one invalid should throw for that key
    expect(() => v.setProperties({ a: 1, b: new Map() as any })).toThrowError();

    // Special-case: _c allows string (ISO) but not Date directly via setProperty
    expect(() => v.setProperty('_c', new Date() as any)).toThrowError();

    // Valid JSON stays fine
    expect(() => v.setProperty('ok', { n: 1, arr: [1, { x: true }] } as any)).not.toThrowError();
    expect(v.getProperty('ok')).toEqual({ n: 1, arr: [1, { x: true }] });
  });

  test('newChild/newNamedChild reject invalid values in props normalization', () => {
    const t = new RepTree('p');
    const root = t.createRoot();

    expect(() => root.newChild({ bad: function() {} } as any)).toThrowError();
    expect(() => root.newChild({ bad: new Map() as any } as any)).toThrowError();
    expect(() => root.newChild({ bad: new Set() as any } as any)).toThrowError();
    expect(() => root.newChild({ bad: /rx/ as any } as any)).toThrowError();
    expect(() => root.newChild({ bad: new Uint8Array([1]) as any } as any)).toThrowError();

    // Valid
    const c = root.newNamedChild('X', { data: { a: [1, 2, { b: false }] } } as any);
    expect(c.getProperty('data')).toEqual({ a: [1, 2, { b: false }] });
  });
});
