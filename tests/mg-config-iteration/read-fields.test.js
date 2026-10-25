// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

// Pins the contract of the read-field dispatcher used by the Memory Graph
// configuration workbench:
//
//   - `dispatchMgConfigReadFields` — the configuration workbench's
//     `mg_config_read_fields` tool. Root is `{ schema, settings }`; `source`
//     selects the working / global / default view.
//
// The dispatcher is a thin wrapper over the shared
// `iteration-library/read-fields-helper.js`. It is tested here directly
// instead of through studio.js so its contract holds without dragging the
// popup's ST-context / jQuery import graph into jest.

import { describe, test, expect } from '@jest/globals';
import {
    dispatchMgConfigReadFields,
} from '../../public/scripts/extensions/memory-graph/config-iteration/read-fields-dispatcher.js';

const sampleSchema = Object.freeze([
    Object.freeze({
        id: 'event',
        label: 'Event',
        tableName: 'events',
        tableColumns: ['title', 'when', 'summary'],
        keywords: ['event'],
        extractionInstructions: 'One event per meaningful moment.',
    }),
    Object.freeze({
        id: 'character_sheet',
        label: 'Character sheet',
        tableName: 'characters',
        tableColumns: ['name', 'aliases', 'personality'],
        primaryKeyColumns: ['name'],
        alwaysInject: false,
    }),
]);

function cloneSchema() {
    // structuredClone works but frozen entries survive; using JSON
    // round-trip gives a plain-object copy each test can mutate.
    return JSON.parse(JSON.stringify(sampleSchema));
}

describe('dispatchMgConfigReadFields — working / global / default sources', () => {
    function sources() {
        return {
            working: {
                schema: cloneSchema(),
                settings: { recallMaxIterations: 5, extractMode: 'crawl', extractEdgeRules: 'working rules' },
            },
            global: {
                schema: [],
                settings: { recallMaxIterations: 4, extractMode: 'oneshot', extractEdgeRules: 'global rules' },
            },
            default: {
                schema: [],
                settings: { recallMaxIterations: 3, extractMode: 'oneshot', extractEdgeRules: 'default rules' },
            },
        };
    }

    test('defaults to the working source and returns a values map', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: sources(),
            args: { paths: ['settings.recallMaxIterations', 'schema[0].id', 'schema[0].label'] },
        });
        expect(out.source).toBe('working');
        expect(out.values['settings.recallMaxIterations']).toBe(5);
        expect(out.values['schema[0].id']).toBe('event');
        expect(out.values['schema[0].label']).toBe('Event');
        expect(out.missing_paths).toEqual([]);
    });

    test('reads the global source when asked', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: sources(),
            args: { source: 'global', paths: ['settings.recallMaxIterations'] },
        });
        expect(out.source).toBe('global');
        expect(out.values['settings.recallMaxIterations']).toBe(4);
    });

    test('reads the default source when asked', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: sources(),
            args: { source: 'default', paths: ['settings.extractEdgeRules'] },
        });
        expect(out.source).toBe('default');
        expect(out.values['settings.extractEdgeRules']).toBe('default rules');
    });

    test('unknown paths return null and land in missing_paths', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: sources(),
            args: { paths: ['settings.recallMaxIterations', 'settings.notAField', 'schema[99].id'] },
        });
        expect(out.values['settings.notAField']).toBeNull();
        expect(out.values['schema[99].id']).toBeNull();
        expect(out.missing_paths.sort()).toEqual(['schema[99].id', 'settings.notAField'].sort());
    });

    test('projects the schema half onto the writable surface', async () => {
        // Regression: the normalizer emits `compression.rule`,
        // `ragPerTypeK`, and `recordsFloorRange`, but the set tool's JSON
        // schema rejects them via additionalProperties:false. Surfacing them
        // here made the AI copy an illegal field back into a set_node_type
        // call and fail schema validation. The read tool must expose only the
        // writable surface.
        const src = sources();
        src.working.schema = [{
            id: 'event',
            tableColumns: ['summary'],
            columnHints: { summary: 'One line only.' },
            extractionInstructions: 'keep',
            ragPerTypeK: 3,
            recordsFloorRange: true,
            compression: { mode: 'flat', fanIn: 2, rule: 'internal' },
        }];
        const out = await dispatchMgConfigReadFields({
            sources: src,
            args: {
                paths: [
                    'schema[0]',
                    'schema[0].compression',
                    'schema[0].compression.rule',
                    'schema[0].ragPerTypeK',
                    'schema[0].recordsFloorRange',
                    'schema[0].extractionInstructions',
                ],
            },
        });
        expect(out.values['schema[0]']).not.toHaveProperty('ragPerTypeK');
        expect(out.values['schema[0]']).not.toHaveProperty('recordsFloorRange');
        expect(out.values['schema[0]'].compression).toEqual({ mode: 'flat', fanIn: 2 });
        expect(out.values['schema[0].compression.rule']).toBeNull();
        expect(out.values['schema[0].ragPerTypeK']).toBeNull();
        expect(out.values['schema[0].recordsFloorRange']).toBeNull();
        expect(out.values['schema[0].extractionInstructions']).toBe('keep');
        // Fully-writable nested objects (additionalProperties, no fixed
        // shape) pass through untouched.
        expect(out.values['schema[0]'].columnHints).toEqual({ summary: 'One line only.' });
    });

    test('returns long text verbatim (no size-based truncation)', async () => {
        const src = sources();
        src.working.settings.extractTemplate = 'x'.repeat(6000);
        src.working.schema = [{ id: 'event', extractionInstructions: 'y'.repeat(6000) }];
        const out = await dispatchMgConfigReadFields({
            sources: src,
            args: { paths: ['settings.extractTemplate', 'schema[0].extractionInstructions'] },
        });
        expect(out.values['settings.extractTemplate']).toBe('x'.repeat(6000));
        expect(out.values['schema[0].extractionInstructions']).toBe('y'.repeat(6000));
    });

    test('an empty paths array returns an empty values map', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: sources(),
            args: { paths: [] },
        });
        expect(out.values).toEqual({});
        expect(out.missing_paths).toEqual([]);
    });

    test('an unknown source is invalid_args', async () => {
        await expect(dispatchMgConfigReadFields({
            sources: sources(),
            args: { source: 'somewhere', paths: ['settings.recallMaxIterations'] },
        })).rejects.toThrow(/invalid_args/);
    });

    test('a missing source view is invalid_args', async () => {
        await expect(dispatchMgConfigReadFields({
            sources: { working: sources().working },
            args: { source: 'global', paths: ['settings.recallMaxIterations'] },
        })).rejects.toThrow(/invalid_args/);
        await expect(dispatchMgConfigReadFields({
            args: { paths: ['settings.recallMaxIterations'] },
        })).rejects.toThrow(/invalid_args/);
    });

    test('non-array paths is invalid_args', async () => {
        await expect(dispatchMgConfigReadFields({
            sources: sources(),
            args: { paths: 'settings.recallMaxIterations' },
        })).rejects.toThrow(/invalid_args/);
    });

    test('a config with missing halves still reads as empty defaults', async () => {
        const out = await dispatchMgConfigReadFields({
            sources: { working: {} },
            args: { paths: ['settings.anything', 'schema', 'schema.length'] },
        });
        expect(out.values['settings.anything']).toBeNull();
        expect(out.values.schema).toEqual([]);
        expect(out.values['schema.length']).toBe(0);
    });
});
