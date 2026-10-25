// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * Preview-renderer tests for the Memory Graph configuration studio.
 *
 * The working document is `{ schema, settings }`. The bus's profile-edit
 * card body (`renderConfigPendingCards`) must present BOTH halves:
 * a "Schema changes" section only when the schema content moved, a
 * "Settings changes" section for registry keys whose value changed, and
 * the `(no effective change)` fallback when neither moved.
 *
 * The workspace preview pane (`renderMgConfigPreviewPane`) takes the same
 * config object: the schema block keeps the original array rendering and
 * the settings block lists the keys the pending edits touch.
 *
 * The renderers live in studio.js whose transitive import graph needs the
 * ST-context stubs, so this file mirrors the unstable-mockModule harness
 * from apply-pending-edits.test.js and dynamic-imports the module.
 */

import { describe, test, expect, jest } from '@jest/globals';

// public/lib.js is redirected to tests/util/lib-stub.js via jest config's
// moduleNameMapper — no per-test mock needed.

// popup.js drags in the entire UI shell — stub to no-op exports.
jest.unstable_mockModule('../../public/scripts/popup.js', () => ({
    Popup: class { constructor() {} show() { return Promise.resolve(); } },
    POPUP_TYPE: { DISPLAY: 0 },
}));

// Runner pulls in iter-tool-calling which needs the LLM stack — stub.
jest.unstable_mockModule('../../public/scripts/lib/iter-tool-calling.js', () => ({
    requestToolCallsWithRetry: jest.fn(),
    buildExecutionToolCalls: jest.fn(),
    buildPendingToolResults: jest.fn(),
    buildPersistentToolCallsFromRawCalls: jest.fn(),
    buildPersistentToolHistoryMessages: jest.fn(),
    createPersistentToolTurnMessage: jest.fn(),
    makeAiIterationMessageId: jest.fn(() => 'id'),
}));

jest.unstable_mockModule('../../public/scripts/lib/abort-utils.js', () => ({}));

// CEA main.js drags in macros/engine/MacroEnvBuilder.js → /scripts/utils.js
// which doesn't resolve in jest. MG studio.js imports CEA only for the
// per-character lorebook helper-tool dispatcher (used by the lorebook read
// tools). This unit test doesn't exercise reads, so a noop stub is enough.
jest.unstable_mockModule('../../public/scripts/extensions/character-editor-assistant/main.js', () => ({
    buildCharacterEditorHelperApis: jest.fn(() => []),
    runCharacterEditorHelperToolCall: jest.fn(async () => ({ ok: true, result: {} })),
}));

import { getDefaultSettingsView } from '../../public/scripts/extensions/memory-graph/config-iteration/fields.js';

let _testOnly_renderConfigPendingCards;
let _testOnly_renderMgConfigPreviewPane;

beforeAll(async () => {
    const mod = await import('../../public/scripts/extensions/memory-graph/config-iteration/studio.js');
    _testOnly_renderConfigPendingCards = mod._testOnly_renderConfigPendingCards;
    _testOnly_renderMgConfigPreviewPane = mod._testOnly_renderMgConfigPreviewPane;
});

const defaults = getDefaultSettingsView();

describe('renderConfigPendingCards — { schema, settings } diff card', () => {
    test('settings-only change renders the Settings changes section with the registry label', () => {
        const html = _testOnly_renderConfigPendingCards(
            { schema: [{ id: 'event' }], settings: { ...defaults, recallMaxIterations: 3 } },
            { schema: [{ id: 'event' }], settings: { ...defaults, recallMaxIterations: 5 } },
        );
        expect(html).toContain('Recall max iterations');
        expect(html).toContain('Settings changes');
        expect(html).not.toContain('Schema changes');
    });

    test('the settings row carries the before and after previews', () => {
        const html = _testOnly_renderConfigPendingCards(
            { schema: [], settings: { ...defaults, rpmLimit: 0 } },
            { schema: [], settings: { ...defaults, rpmLimit: 30 } },
        );
        expect(html).toContain('RPM limit');
        expect(html).toContain('0');
        expect(html).toContain('30');
    });

    test('schema-only change renders the Schema changes section', () => {
        const schemaHtml = _testOnly_renderConfigPendingCards(
            { schema: [{ id: 'event' }], settings: defaults },
            { schema: [{ id: 'event', label: 'Event 2' }], settings: defaults },
        );
        expect(schemaHtml).toContain('Schema changes');
        // A modified node type renders a per-leaf diff ("Field updated:
        // label" + the new value); the changed content must surface.
        expect(schemaHtml).toContain('Event 2');
        expect(schemaHtml).not.toContain('Settings changes');
    });

    test('an added node type surfaces its id in the Schema changes section', () => {
        const schemaHtml = _testOnly_renderConfigPendingCards(
            { schema: [], settings: defaults },
            { schema: [{ id: 'event' }], settings: defaults },
        );
        expect(schemaHtml).toContain('Schema changes');
        expect(schemaHtml).toContain('event');
        expect(schemaHtml).not.toContain('Settings changes');
    });

    test('schema + settings changes in one proposal render both sections', () => {
        const html = _testOnly_renderConfigPendingCards(
            { schema: [{ id: 'event' }], settings: { ...defaults, recallMaxIterations: 3 } },
            { schema: [{ id: 'event', label: 'Event' }], settings: { ...defaults, recallMaxIterations: 5 } },
        );
        expect(html).toContain('Schema changes');
        expect(html).toContain('Settings changes');
    });

    test('a proposal that changes nothing renders the (no effective change) fallback', () => {
        const empty = _testOnly_renderConfigPendingCards(
            { schema: [], settings: defaults },
            { schema: [], settings: defaults },
        );
        expect(empty).toContain('(no effective change)');
    });

    test('text settings render a truncated preview, not the whole prompt body', () => {
        const longText = 'x'.repeat(500);
        const html = _testOnly_renderConfigPendingCards(
            { schema: [], settings: { ...defaults, extractEdgeRules: 'short' } },
            { schema: [], settings: { ...defaults, extractEdgeRules: longText } },
        );
        expect(html).toContain('Edge Rules');
        expect(html).toContain('…');
        expect(html).not.toContain(longText);
    });

    test('null before (legacy shape tolerance) still renders the settings section', () => {
        // Old sessions can carry meta.before = null; the card must not
        // crash and must still show what the proposal writes.
        const html = _testOnly_renderConfigPendingCards(
            null,
            { schema: [{ id: 'event' }], settings: { ...defaults, recallMaxIterations: 5 } },
        );
        expect(html).toContain('Schema changes');
        expect(html).toContain('Settings changes');
    });
});

describe('renderMgConfigPreviewPane — { schema, settings } preview pane', () => {
    test('renders schema rows and the changed settings key for a settings-only edit', () => {
        const before = {
            schema: [{ id: 'event', label: 'Event' }],
            settings: { ...defaults, recallMaxIterations: 3 },
        };
        const after = {
            schema: [{ id: 'event', label: 'Event' }],
            settings: { ...defaults, recallMaxIterations: 5 },
        };
        const pane = _testOnly_renderMgConfigPreviewPane(
            before,
            [{ op: 'set', path: '', oldValue: before, newValue: after }],
            (s) => s,
        );
        expect(pane).toContain('Event');
        expect(pane).toContain('Recall max iterations');
        expect(pane).toContain('Settings');
    });

    test('an empty working schema renders the empty note instead of crashing', () => {
        const pane = _testOnly_renderMgConfigPreviewPane(
            { schema: [], settings: defaults },
            [],
            (s) => s,
        );
        expect(pane).toContain('No schema loaded.');
    });

    test('schema edits keep highlighting the changed node type', () => {
        const before = {
            schema: [{ id: 'event', label: 'Event' }, { id: 'character', label: 'Character' }],
            settings: defaults,
        };
        const after = {
            schema: [{ id: 'event', label: 'Event Renamed' }, { id: 'character', label: 'Character' }],
            settings: defaults,
        };
        const pane = _testOnly_renderMgConfigPreviewPane(
            before,
            [{ op: 'set', path: '', oldValue: before, newValue: after }],
            (s) => s,
        );
        // The pane renders the CURRENT row labels and flags changed rows
        // with the pending-change class — the next label only appears in
        // the diff card, not in the schema row.
        expect(pane).toContain('Event');
        expect(pane).toContain('Character');
        expect(pane).toContain('pending-change');
    });
});
