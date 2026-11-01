/**
 * Mutation-invalidation classification for an in-flight scheduled extraction
 * pass.
 *
 * The pass snapshots `frames` at launch. Once a batch is dispatched to the
 * LLM pipeline, the prompt is already built from the pre-mutation snapshot,
 * so lowering the pass's upper bound cannot salvage it. A mutation that lands
 * inside the dispatched batch must abort the whole pass instead of shrinking
 * the tail.
 *
 * The regression this pins: with the default batch size of one, every
 * uncommitted floor IS the dispatched batch. Regenerating the last turn
 * deletes the floor the pass is currently extracting, and the shrink-only
 * classifier let that batch run to completion, committing stale nodes (or
 * throwing on the now-missing floor).
 */

import { describe, test, expect } from '@jest/globals';

import { classifyExtractionMutation } from '../../public/scripts/extensions/memory-graph/extraction-schedule.js';

function scope(overrides = {}) {
    return {
        beginSeq: 1,
        latestSeq: 10,
        committedSeq: 3,
        inFlightSeqFrom: 4,
        inFlightSeqTo: 6,
        ...overrides,
    };
}

describe('classifyExtractionMutation', () => {
    test('no scope falls back to the conservative abort', () => {
        expect(classifyExtractionMutation(null, 5)).toBe('abort_no_metadata');
    });

    test('missing or non-positive seq falls back to the conservative abort', () => {
        expect(classifyExtractionMutation(scope(), null)).toBe('abort_no_metadata');
        expect(classifyExtractionMutation(scope(), 0)).toBe('abort_no_metadata');
        expect(classifyExtractionMutation(scope(), -2)).toBe('abort_no_metadata');
    });

    test('mutation at or below the committed watermark aborts a committed hit', () => {
        expect(classifyExtractionMutation(scope(), 3)).toBe('abort_committed_hit');
        expect(classifyExtractionMutation(scope(), 1)).toBe('abort_committed_hit');
    });

    test('mutation inside the dispatched batch aborts instead of shrinking', () => {
        expect(classifyExtractionMutation(scope(), 4)).toBe('abort_in_flight_batch');
        expect(classifyExtractionMutation(scope(), 5)).toBe('abort_in_flight_batch');
        expect(classifyExtractionMutation(scope(), 6)).toBe('abort_in_flight_batch');
    });

    test('mutation in a not-yet-dispatched tail batch shrinks the upper bound', () => {
        expect(classifyExtractionMutation(scope(), 7)).toBe('shrink');
        expect(classifyExtractionMutation(scope(), 10)).toBe('shrink');
    });

    test('mutation beyond the pass upper bound leaves the pass alone', () => {
        expect(classifyExtractionMutation(scope(), 11)).toBe('noop');
    });

    test('between batches there is no dispatched range to protect', () => {
        const between = scope({ inFlightSeqFrom: null, inFlightSeqTo: null });
        expect(classifyExtractionMutation(between, 4)).toBe('shrink');
    });

    test('a single-batch last-floor pass aborts when that floor is mutated', () => {
        const lastFloor = {
            beginSeq: 7,
            latestSeq: 7,
            committedSeq: 6,
            inFlightSeqFrom: 7,
            inFlightSeqTo: 7,
        };
        expect(classifyExtractionMutation(lastFloor, 7)).toBe('abort_in_flight_batch');
    });
});
