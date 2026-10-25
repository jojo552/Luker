// SPDX-License-Identifier: AGPL-3.0-or-later
import {
    startInspection,
    completeInspection,
    attachInspectionEndpoint,
    getBufferForHandle,
} from '../src/request-inspector.js';

// Byte sizes below assume the default 256 MB budget (jest reads the repo
// config.yaml, which does not override requestInspector.byteBudgetBytes).

let counter = 0;
function newRequest(source = 'openai', messages = [{ role: 'user', content: 'hi' }]) {
    counter++;
    return {
        user: { profile: { handle: `ri-budget-${counter}` } },
        body: {
            chat_completion_source: source,
            model: 'test-model',
            messages,
        },
    };
}

function bigMessages(charCount) {
    const big = 'x'.repeat(charCount);
    return [{ role: 'user', content: big }];
}

describe('request-inspector byte budget', () => {
    test('completed records evict oldest-first once the budget is exceeded', () => {
        const req1 = newRequest('openai', bigMessages(45 * 1000 * 1000)); // ~90 MB entry
        const req2 = newRequest('openai', bigMessages(45 * 1000 * 1000));
        const req3 = newRequest('openai', bigMessages(45 * 1000 * 1000));
        const payload = { choices: [{ message: { content: 'done' } }] };

        startInspection(req1);
        completeInspection(req1, payload);
        startInspection(req2);
        completeInspection(req2, payload);
        startInspection(req3);
        completeInspection(req3, payload);

        const h1 = req1.user.profile.handle;
        const h2 = req2.user.profile.handle;
        const h3 = req3.user.profile.handle;

        // three ~90 MB records ≈ 270 MB > 256 MB: the oldest must go
        expect(getBufferForHandle(h1)).toHaveLength(0);
        expect(getBufferForHandle(h2)).toHaveLength(1);
        expect(getBufferForHandle(h3)).toHaveLength(1);
        expect(getBufferForHandle(h3)[0].id).toBe(req3.__inspectorId);
    });

    test('running records are exempt from budget eviction', () => {
        const reqRunning = newRequest('openai', bigMessages(5 * 1000 * 1000));
        startInspection(reqRunning); // stays status:'running'

        const reqOld = newRequest('openai', bigMessages(5 * 1000 * 1000));
        startInspection(reqOld);
        completeInspection(reqOld, { choices: [{ message: { content: 'done' } }] });

        // ~270 MB estimated (2 bytes per char) — clears the 256 MiB budget
        // together with the two small records, so the oldest completed one
        // must go while the running one survives.
        const reqBig = newRequest('openai', bigMessages(135 * 1000 * 1000));
        startInspection(reqBig);
        completeInspection(reqBig, { choices: [{ message: { content: 'done' } }] });

        const hRunning = reqRunning.user.profile.handle;
        const hOld = reqOld.user.profile.handle;
        const hBig = reqBig.user.profile.handle;

        const runningEntry = getBufferForHandle(hRunning).find(e => e.id === reqRunning.__inspectorId);
        expect(runningEntry).toBeDefined();          // in-flight survives
        expect(runningEntry.status).toBe('running');

        // oldest completed records were evicted to get under the budget
        expect(getBufferForHandle(hOld)).toHaveLength(0);
        const bigBuf = getBufferForHandle(hBig);
        expect(bigBuf).toHaveLength(1);
    });

    test('a single record larger than the whole budget is still captured', () => {
        const req = newRequest('openai', bigMessages(140 * 1000 * 1000)); // ~280 MB > 256 MB
        startInspection(req);

        const handle = req.user.profile.handle;
        const buf = getBufferForHandle(handle);
        expect(buf).toHaveLength(1);                  // never drop the record we just captured
        expect(buf[0].id).toBe(req.__inspectorId);
    });

    test('wireRequest growth re-estimates the record and evicts older ones', () => {
        const reqSmall = newRequest('openai', bigMessages(5 * 1000 * 1000));
        startInspection(reqSmall);
        completeInspection(reqSmall, { choices: [{ message: { content: 'done' } }] });

        const reqBig = newRequest('openai', [{ role: 'user', content: 'hi' }]);
        startInspection(reqBig);
        // attach a ~260 MB wire payload: the record grows past what the
        // small record + this one can hold together, so the older completed
        // record must go once the big one is evictable
        attachInspectionEndpoint(reqBig, 'https://example.test/v1', 'sk-test', {
            model: 'test-model',
            messages: [{ role: 'user', content: 'w'.repeat(130 * 1000 * 1000) }],
        });
        completeInspection(reqBig, { choices: [{ message: { content: 'done' } }] });

        const hSmall = reqSmall.user.profile.handle;
        const hBig = reqBig.user.profile.handle;

        expect(getBufferForHandle(hSmall)).toHaveLength(0);
        const bigBuf = getBufferForHandle(hBig);
        expect(bigBuf).toHaveLength(1);
        expect(bigBuf[0].wireRequest).toBeDefined();
        expect(bigBuf[0].wireRequest.messages[0].content).toHaveLength(130 * 1000 * 1000);
    });
});
