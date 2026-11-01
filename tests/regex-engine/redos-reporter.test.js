/**
 * State machine for the regex slow-script (ReDoS) reporter.
 *
 * Contract:
 *   - A single execution at or above the hard threshold auto-pauses the script
 *     and surfaces the popup once.
 *   - A script that carries the persisted `allowSlow` flag is never auto-paused
 *     and never re-prompts, even after `resetRegexScriptState` drops the session
 *     cache.
 *   - Clicking "Allow anyway" unpauses the script and dispatches the persist
 *     event so the regex extension can store the decision on the script itself
 *     and re-render the chat.
 *
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, beforeAll, jest } from '@jest/globals';

const POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: null, CUSTOM1: 1001, CUSTOM2: 1002 };

let nextPopupResult = POPUP_RESULT.CUSTOM1;
const callGenericPopup = jest.fn(async () => nextPopupResult);

jest.unstable_mockModule('../../public/scripts/popup.js', () => ({
    callGenericPopup,
    POPUP_RESULT,
    POPUP_TYPE: { TEXT: 2 },
}));

jest.unstable_mockModule('../../public/scripts/i18n.js', () => ({
    t: (strings, ...values) => strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), ''),
}));

let reporter;

beforeAll(async () => {
    reporter = await import('../../public/scripts/extensions/regex/redos-reporter.js');
});

const HARD = 500;

async function flushAsync() {
    for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

beforeEach(() => {
    callGenericPopup.mockClear();
    nextPopupResult = POPUP_RESULT.CUSTOM1;
    reporter.resetAllRegexScriptState();
});

describe('regex slow-script reporter', () => {
    test('pauses a slow script and shows the popup once', async () => {
        const script = { id: 'slow-once', scriptName: 'Slow once', findRegex: '/a+/' };
        reporter.recordRegexExecution(script, HARD + 100);
        expect(reporter.isRegexScriptPaused('slow-once')).toBe(true);
        await flushAsync();
        expect(callGenericPopup).toHaveBeenCalledTimes(1);
    });

    test('does not pause a script that carries the persisted allowSlow flag', async () => {
        const script = { id: 'allowed-flag', scriptName: 'Allowed', findRegex: '/a+/', allowSlow: true };
        reporter.recordRegexExecution(script, HARD + 100);
        expect(reporter.isRegexScriptPaused('allowed-flag')).toBe(false);
        await flushAsync();
        expect(callGenericPopup).not.toHaveBeenCalled();
    });

    test('clicking "Allow anyway" unpauses and dispatches the persist event', async () => {
        const received = [];
        const onAllow = event => received.push(event.detail);
        window.addEventListener(reporter.REGEX_ALLOW_SLOW_SCRIPT_EVENT, onAllow);
        try {
            const script = { id: 'allow-click', scriptName: 'Allow click', findRegex: '/a+/' };
            reporter.recordRegexExecution(script, HARD + 100);
            expect(reporter.isRegexScriptPaused('allow-click')).toBe(true);
            await flushAsync();
            expect(reporter.isRegexScriptPaused('allow-click')).toBe(false);
            expect(received).toEqual([{ id: 'allow-click' }]);
        } finally {
            window.removeEventListener(reporter.REGEX_ALLOW_SLOW_SCRIPT_EVENT, onAllow);
        }
    });

    test('a script allowed in-session is not paused or re-prompted', async () => {
        const script = { id: 'allow-repeat', scriptName: 'Allow repeat', findRegex: '/a+/' };
        reporter.recordRegexExecution(script, HARD + 100);
        await flushAsync();
        expect(callGenericPopup).toHaveBeenCalledTimes(1);
        reporter.recordRegexExecution(script, HARD + 100);
        await flushAsync();
        expect(reporter.isRegexScriptPaused('allow-repeat')).toBe(false);
        expect(callGenericPopup).toHaveBeenCalledTimes(1);
    });

    test('resetRegexScriptState drops the session cache but the persisted flag still suppresses re-pause', async () => {
        const script = { id: 'reset-flag', scriptName: 'Reset flag', findRegex: '/a+/' };
        reporter.recordRegexExecution(script, HARD + 100);
        await flushAsync();
        reporter.resetRegexScriptState('reset-flag');
        const persisted = { id: 'reset-flag', scriptName: 'Reset flag', findRegex: '/a+/', allowSlow: true };
        reporter.recordRegexExecution(persisted, HARD + 100);
        expect(reporter.isRegexScriptPaused('reset-flag')).toBe(false);
        await flushAsync();
        expect(callGenericPopup).toHaveBeenCalledTimes(1);
    });

    test('resetAllRegexScriptState releases paused scripts and drops their stats', async () => {
        const script = { id: 'reset-all', scriptName: 'Reset all', findRegex: '/a+/' };
        reporter.recordRegexExecution(script, HARD + 100);
        expect(reporter.isRegexScriptPaused('reset-all')).toBe(true);
        expect(reporter.getRegexScriptStats('reset-all')).toBeTruthy();

        reporter.resetAllRegexScriptState();

        expect(reporter.isRegexScriptPaused('reset-all')).toBe(false);
        expect(reporter.getRegexScriptStats('reset-all')).toBeUndefined();
    });
});
