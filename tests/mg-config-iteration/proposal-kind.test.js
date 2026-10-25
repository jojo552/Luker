// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * Proposal-kind tests for the Memory Graph configuration studio.
 *
 * The studio registers ONE `profile-edit` kind that serves BOTH targets:
 * the legacy `schema` target (array before/after — old persisted sessions
 * replay against it) and the `config` target (the { schema, settings }
 * working document). `targetType` is undefined so the bus's propose-time
 * target check accepts either; the per-entry renderers discriminate on
 * `entry.target.type` instead.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { createConfigProfileEditKind } from '../../public/scripts/extensions/memory-graph/config-iteration/proposal-kind.js';
import { createProposalBus } from '../../public/scripts/iteration-library/proposal-bus/index.js';
import { registerTarget, clearRegistry } from '../../public/scripts/iteration-library/storage/target-registry.js';

beforeEach(() => clearRegistry());

function makeKind() {
    return createConfigProfileEditKind({
        t: (s) => s,
        renderSchemaCards: jest.fn(() => 'schema-cards'),
        renderConfigCards: jest.fn(() => 'config-cards'),
    });
}

describe('createConfigProfileEditKind — handler shape', () => {
    test('targetType is undefined so both targets pass the bus propose check', () => {
        const kind = makeKind();
        expect(kind.targetType).toBeUndefined();
        expect(kind.kind).toBe('profile-edit');
    });

    test('renderDiffCard routes schema-target entries to the schema renderer', () => {
        const kind = makeKind();
        expect(kind.renderDiffCard({ target: { type: 'schema' }, meta: { before: [], after: [] } })).toBe('schema-cards');
    });

    test('renderDiffCard routes config-target entries to the config renderer', () => {
        const kind = makeKind();
        expect(kind.renderDiffCard({ target: { type: 'config' }, meta: { before: {}, after: {} } })).toBe('config-cards');
    });

    test('label / target / icon discriminate on entry.target.type', () => {
        const kind = makeKind();
        const schemaEntry = { target: { type: 'schema' } };
        const configEntry = { target: { type: 'config' } };
        expect(kind.label(schemaEntry)).toBe('Schema change');
        expect(kind.label(configEntry)).toBe('Configuration change');
        expect(kind.target(schemaEntry)).toBe('schema');
        expect(kind.target(configEntry)).toBe('configuration');
        expect(kind.icon(schemaEntry)).toBe('🧩');
    });

    test('label / target fall back to the configuration wording for unknown target types', () => {
        // New proposals always carry { type: 'config' }; legacy ones carry
        // { type: 'schema' }. Anything else (corrupt session blob) renders
        // as a configuration change rather than crashing the card row.
        const kind = makeKind();
        const odd = { target: { type: 'weird' } };
        expect(kind.label(odd)).toBe('Configuration change');
        expect(kind.target(odd)).toBe('configuration');
    });

    test('the t function threads through label and target', () => {
        const kind = createConfigProfileEditKind({
            t: (s) => `«${s}»`,
            renderSchemaCards: () => '',
            renderConfigCards: () => '',
        });
        expect(kind.label({ target: { type: 'schema' } })).toBe('«Schema change»');
        expect(kind.label({ target: { type: 'config' } })).toBe('«Configuration change»');
        expect(kind.target({ target: { type: 'config' } })).toBe('«configuration»');
    });
});

describe('createConfigProfileEditKind — bus integration', () => {
    test('the kind accepts proposals against BOTH registered targets', async () => {
        const kind = makeKind();
        const bus = createProposalBus({ i18n: (s) => s });
        registerTarget('schema', { read: async () => [], write: async () => {}, describe: () => 'schema' });
        registerTarget('config', { read: async () => ({ schema: [], settings: {} }), write: async () => {}, describe: () => 'configuration' });
        bus.registerKind('profile-edit', kind);
        await expect(bus.propose({
            kind: 'profile-edit',
            target: { type: 'schema' },
            before: [],
            after: [{ id: 'event' }],
        })).resolves.toBeTruthy();
        await expect(bus.propose({
            kind: 'profile-edit',
            target: { type: 'config' },
            before: { schema: [], settings: {} },
            after: { schema: [], settings: {} },
        })).resolves.toBeTruthy();
    });

    test('the kind rejects proposals against an UNregistered target (unknown target throws)', async () => {
        const kind = makeKind();
        const bus = createProposalBus({ i18n: (s) => s });
        bus.registerKind('profile-edit', kind);
        await expect(bus.propose({
            kind: 'profile-edit',
            target: { type: 'nope' },
            before: {},
            after: {},
        })).rejects.toThrow(/unknown target/);
    });
});
