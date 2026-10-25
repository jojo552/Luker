// SPDX-License-Identifier: AGPL-3.0-or-later
import { installLogCapture, clearCapturedLogs, getCapturedLogs } from '../src/log-capture.js';

// The wrapper forwards every call to the underlying console method; with MB
// payloads per entry that would flood the jest console buffer. Replace
// console.log with a no-op BEFORE installing the capture: getBaseMethod
// binds whatever is current, so entries are captured but nothing prints.
const realLog = console.log;
beforeAll(() => {
    console.log = () => { };
    installLogCapture();
});

afterAll(() => {
    console.log = realLog;
});

beforeEach(() => {
    clearCapturedLogs();
});

describe('log-capture byte budget', () => {
    test('oversized entries evict oldest first until the budget holds', () => {
        // 1M chars → ~2 MB heap per entry; 200 entries ≈ 400 MB, over the
        // 256 MB default budget, so the ring must trim to roughly half.
        const big = 'x'.repeat(1024 * 1024);
        const COUNT = 200;
        for (let i = 1; i <= COUNT; i++) {
            console.log(`entry-${i}`, big);
        }

        const { entries, latestId } = getCapturedLogs({ limit: 9999 });
        expect(entries.length).toBeGreaterThan(1);      // newest survives
        expect(entries.length).toBeLessThan(COUNT);     // budget bound hit
        expect(entries.length).toBeLessThan(160);       // ≈ 256 MB / ~2 MB
        expect(latestId).toBe(COUNT);                   // nothing lost at the tail
        expect(entries[0].id).toBeGreaterThan(1);       // oldest evicted
        expect(entries[entries.length - 1].message).toContain(`entry-${COUNT}`);

        // ledger arithmetic stayed exact: the retained bytes match the
        // entries still present
        for (const entry of entries) {
            expect(entry.id).toBeGreaterThan(entries[0].id - 1);
        }
    });

    test('count cap still binds for small entries', () => {
        for (let i = 0; i < 5200; i++) {
            console.log(`tiny-${i}`);
        }
        const { entries } = getCapturedLogs({ limit: 9999 });
        expect(entries.length).toBe(5000);
        // ids keep incrementing across tests/captures, so anchor on the span
        expect(entries[0].id).toBe(entries[entries.length - 1].id - 4999);
        expect(entries[entries.length - 1].message).toContain('tiny-5199');
    });

    test('clearCapturedLogs resets the ledger so a fresh cycle keeps newest entries', () => {
        const big = 'y'.repeat(1024 * 1024);
        for (let i = 1; i <= 200; i++) console.log(`first-${i}`, big);
        const afterFirst = getCapturedLogs({ limit: 9999 });
        expect(afterFirst.entries.length).toBeLessThan(200);

        clearCapturedLogs();
        const afterClear = getCapturedLogs({ limit: 9999 });
        expect(afterClear.entries.length).toBe(0);

        // without a ledger reset these small entries would immediately
        // over-report and evict themselves
        for (let i = 1; i <= 10; i++) console.log(`second-${i}`);
        const afterSecond = getCapturedLogs({ limit: 9999 });
        expect(afterSecond.entries.length).toBe(10);
        expect(afterSecond.entries[0].message).toContain('second-1');
    });
});
