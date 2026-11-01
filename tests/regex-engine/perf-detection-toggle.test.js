/**
 * Performance-detection toggle contract for the regex engine.
 *
 * Contract:
 *   - With detection enabled, every executed script reports its elapsed time
 *     to the slow-script reporter.
 *   - With detection disabled, the script still runs but no timing is recorded,
 *     so no script can be auto-paused.
 */

import { describe, test, expect, beforeAll, beforeEach, jest } from '@jest/globals';

const extension_settings = {
    disabledExtensions: [],
    regex: [],
    regex_presets: [],
    regex_perf_detection: true,
};

jest.unstable_mockModule('../../public/script.js', () => ({
    characters: {},
    saveSettingsDebounced: () => {},
    substituteParams: (s) => s,
    substituteParamsExtended: (s) => s,
    this_chid: null,
}));

jest.unstable_mockModule('../../public/scripts/extensions.js', () => ({
    extension_settings,
    writeExtensionField: () => {},
}));

jest.unstable_mockModule('../../public/scripts/i18n.js', () => ({ t: (s) => s }));
jest.unstable_mockModule('../../public/scripts/preset-manager.js', () => ({ getPresetManager: () => null }));
jest.unstable_mockModule('../../public/scripts/utils.js', () => ({
    regexFromString: (input) => {
        if (typeof input !== 'string') return null;
        const m = input.match(/\/(.+)\/([gimsuy]*)/s);
        return m ? new RegExp(m[1], m[2]) : new RegExp(input);
    },
}));

const recordRegexExecution = jest.fn();

jest.unstable_mockModule('../../public/scripts/extensions/regex/redos-reporter.js', () => ({
    isRegexScriptPaused: () => false,
    recordRegexExecution,
    resetRegexScriptState: () => {},
    resetAllRegexScriptState: () => {},
}));

let engine;

beforeAll(async () => {
    engine = await import('../../public/scripts/extensions/regex/engine.js');
});

const PLACEMENT = 1;

const slowScript = {
    id: 'perf-toggle',
    scriptName: 'Perf toggle',
    findRegex: '/hello/g',
    replaceString: 'world',
    placement: [PLACEMENT],
    disabled: false,
    markdownOnly: true,
    runOnEdit: false,
    substituteRegex: 0,
};

beforeEach(() => {
    recordRegexExecution.mockClear();
    extension_settings.regex = [slowScript];
    extension_settings.regex_perf_detection = true;
});

describe('regex performance-detection toggle', () => {
    test('records execution time when detection is enabled', () => {
        expect(engine.getRegexedString('hello', PLACEMENT, { isMarkdown: true })).toBe('world');
        expect(recordRegexExecution).toHaveBeenCalledTimes(1);
        expect(recordRegexExecution.mock.calls[0][0].id).toBe('perf-toggle');
        expect(typeof recordRegexExecution.mock.calls[0][1]).toBe('number');
    });

    test('runs the script without recording time when detection is disabled', () => {
        extension_settings.regex_perf_detection = false;

        expect(engine.getRegexedString('hello', PLACEMENT, { isMarkdown: true })).toBe('world');
        expect(recordRegexExecution).not.toHaveBeenCalled();
    });
});
