// SPDX-License-Identifier: AGPL-3.0-or-later
import { estimateHeapBytes, ByteBudgetLedger } from '../src/util/byte-budget.js';

describe('estimateHeapBytes', () => {
    test('primitives carry a bounded flat cost', () => {
        expect(estimateHeapBytes(null)).toBeLessThan(16);
        expect(estimateHeapBytes(undefined)).toBeLessThan(16);
        expect(estimateHeapBytes(42)).toBeLessThan(16);
        expect(estimateHeapBytes(true)).toBeLessThan(16);
    });

    test('strings count two bytes per char plus header', () => {
        expect(estimateHeapBytes('')).toBe(16);
        expect(estimateHeapBytes('abc')).toBe(16 + 3 * 2);
        // CJK content is exactly the two-byte worst case the estimate assumes.
        expect(estimateHeapBytes('中文')).toBe(16 + 2 * 2);
    });

    test('arrays and objects walk their elements', () => {
        expect(estimateHeapBytes(['ab'])).toBe(32 + (16 + 2 * 2));
        expect(estimateHeapBytes({ a: 'abcd' })).toBe(64 + (16 + 4 * 2));
        const nested = { list: [{ s: 'x' }] };
        const flat = estimateHeapBytes(nested);
        expect(flat).toBeGreaterThan(64 + 32 + 16 + 2);
    });

    test('shared references and cycles are counted once and terminate', () => {
        const shared = { v: 'shared-value' };
        // outer object header + the shared target counted exactly once
        expect(estimateHeapBytes({ a: shared, b: shared })).toBe(64 + estimateHeapBytes(shared));
        const cyclic = { name: 'c' };
        cyclic.self = cyclic;
        expect(Number.isFinite(estimateHeapBytes(cyclic))).toBe(true);
    });

    test('typed arrays count their byte length', () => {
        expect(estimateHeapBytes(new Uint8Array(1000))).toBe(64 + 1000);
    });

    test('Maps and Sets walk their contents', () => {
        const m = new Map([['k', 'value-value']]);
        expect(estimateHeapBytes(m)).toBeGreaterThan(64 + 16 + 2 * 2);
        const s = new Set(['elem']);
        expect(estimateHeapBytes(s)).toBeGreaterThan(64);
    });
});

describe('ByteBudgetLedger', () => {
    test('track / untrack keep the running total exact', () => {
        const ledger = new ByteBudgetLedger(1000);
        const a = { data: 'a'.repeat(100) }; // 64 + 16 + 200 = 280
        const b = { data: 'b'.repeat(200) }; // 64 + 16 + 400 = 480

        ledger.track(a);
        ledger.track(b);
        expect(ledger.bytes).toBe(estimateHeapBytes(a) + estimateHeapBytes(b));
        expect(ledger.isOver()).toBe(false);

        ledger.untrack(a);
        expect(ledger.bytes).toBe(estimateHeapBytes(b));
        expect(ledger.untrack(a)).toBe(0); // already untracked

        const c = { data: 'c'.repeat(400) };
        ledger.track(c);
        expect(ledger.isOver()).toBe(true);
    });

    test('retouch adjusts the delta after a mutation', () => {
        const ledger = new ByteBudgetLedger(1000);
        const entry = { data: 'x'.repeat(10) };
        const before = ledger.track(entry);

        entry.data = 'x'.repeat(100);
        const after = ledger.retouch(entry);
        expect(after).toBeGreaterThan(before);
        expect(ledger.bytes).toBe(after);

        // retouch on an untracked object behaves like track
        const fresh = { data: 'y'.repeat(5) };
        expect(ledger.retouch(fresh)).toBe(estimateHeapBytes(fresh));
        expect(ledger.bytes).toBe(after + estimateHeapBytes(fresh));
    });

    test('track is idempotent per object', () => {
        const ledger = new ByteBudgetLedger(10);
        const entry = { data: 'zz' };
        const first = ledger.track(entry);
        expect(ledger.track(entry)).toBe(first);
        expect(ledger.bytes).toBe(first);
    });

    test('reset forgets everything', () => {
        const ledger = new ByteBudgetLedger(10);
        ledger.track({ data: 'abc' });
        ledger.reset();
        expect(ledger.bytes).toBe(0);
        // previously tracked objects are gone from the WeakMap
        const old = { data: 'abc' };
        expect(ledger.track(old)).toBe(estimateHeapBytes(old));
    });
});
