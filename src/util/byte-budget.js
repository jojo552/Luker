// SPDX-License-Identifier: AGPL-3.0-or-later
// Heap-byte accounting for diagnostic ring buffers (log capture, backend log
// buffer, request inspector). Count-only caps cannot bound memory when a
// single entry can carry a full provider request body — real-world DEBUG
// entries run ~0.5 MB and image-bearing inspector entries clone those bytes
// twice — so these buffers also enforce a byte budget and evict oldest-first
// once it is exceeded.

/**
 * Recursively estimate the heap bytes retained by `value`.
 *
 * A deliberately coarse upper bound, not an exact accounting: strings count
 * as two bytes per char (V8's worst case for non-Latin1 content), objects and
 * arrays carry a fixed header allowance, and shared references are counted
 * once. Good enough to decide "is this buffer above its budget" — the
 * decision only needs to land within a small factor, and overestimating is
 * the safe direction.
 *
 * @param {*} value
 * @param {WeakSet<object>} [seen] cycle / shared-reference guard
 * @returns {number} approximate bytes
 */
export function estimateHeapBytes(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return 8;
    switch (typeof value) {
        case 'string': return 16 + value.length * 2;
        case 'number': return 8;
        case 'bigint': return 32;
        case 'boolean': return 8;
        case 'symbol': return 32;
        case 'function': return 32;
        case 'object': break;
        default: return 16;
    }

    if (seen.has(value)) return 0;
    seen.add(value);

    if (Array.isArray(value)) {
        let total = 32;
        for (let i = 0; i < value.length; i++) {
            total += estimateHeapBytes(value[i], seen);
        }
        return total;
    }
    if (value instanceof Map) {
        let total = 64;
        for (const [key, entry] of value) {
            total += estimateHeapBytes(key, seen) + estimateHeapBytes(entry, seen);
        }
        return total;
    }
    if (value instanceof Set) {
        let total = 64;
        for (const entry of value) {
            total += estimateHeapBytes(entry, seen);
        }
        return total;
    }
    if (ArrayBuffer.isView(value)) return 64 + value.byteLength;

    let total = 64;
    for (const key of Object.keys(value)) {
        total += estimateHeapBytes(value[key], seen);
    }
    return total;
}

/**
 * Running byte total over a set of tracked objects. The owning buffer drives
 * eviction (it knows its own ordering policy); the ledger only tracks sizes
 * and answers "are we over budget".
 */
export class ByteBudgetLedger {
    /** @type {number} */
    #bytes = 0;
    /** @type {number} */
    #budgetBytes;
    /** @type {WeakMap<object, number>} */
    #tracked = new WeakMap();

    /**
     * @param {number} budgetBytes maximum tracked bytes before the owner must evict
     */
    constructor(budgetBytes) {
        this.#budgetBytes = Math.max(1, Math.floor(Number(budgetBytes) || 1));
    }

    get bytes() { return this.#bytes; }
    get budgetBytes() { return this.#budgetBytes; }
    isOver() { return this.#bytes > this.#budgetBytes; }

    /**
     * Start tracking an object. If the object is already tracked this is a
     * no-op — use `retouch` to re-estimate after a mutation.
     * @param {object} obj
     * @returns {number} the estimated size
     */
    track(obj) {
        if (this.#tracked.has(obj)) return this.#tracked.get(obj);
        const size = estimateHeapBytes(obj);
        this.#tracked.set(obj, size);
        this.#bytes += size;
        return size;
    }

    /**
     * Re-estimate an already-tracked object after its contents changed
     * (e.g. an inspector record gaining its wireRequest / responseParts).
     * @param {object} obj
     * @returns {number} the new estimated size
     */
    retouch(obj) {
        const previous = this.#tracked.get(obj) ?? 0;
        const size = estimateHeapBytes(obj);
        this.#tracked.set(obj, size);
        this.#bytes += size - previous;
        return size;
    }

    /**
     * Stop tracking an object (call when it leaves the owning buffer).
     * @param {object} obj
     * @returns {number} the bytes released
     */
    untrack(obj) {
        const previous = this.#tracked.get(obj);
        if (previous === undefined) return 0;
        this.#tracked.delete(obj);
        this.#bytes -= previous;
        return previous;
    }

    /**
     * Forget everything. Used when the owning buffer is cleared wholesale.
     */
    reset() {
        this.#tracked = new WeakMap();
        this.#bytes = 0;
    }
}
