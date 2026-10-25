// tests/mg-config-iteration/tool-display.test.js
import { jest } from '@jest/globals';

// public/lib.js pulls in a browser bundle that can't be resolved under jest.
// Mirror the workaround other mg-config-iteration tests use when they touch
// modules with transitive lib.js imports.
jest.unstable_mockModule('../../public/lib.js', async () => {
    const { default: lodash } = await import('lodash');
    return { lodash };
});

let MG_CONFIG_TOOL_DISPLAY;

beforeAll(async () => {
    ({ MG_CONFIG_TOOL_DISPLAY } = await import(
        '../../public/scripts/extensions/memory-graph/config-iteration/tool-display.js'
    ));
});

describe('MG config tool-display map', () => {
    it('classifies the structure and configuration write tools as edit', () => {
        for (const name of [
            'mg_schema_set_node_type',
            'mg_schema_remove_node_type',
            'mg_schema_reorder_node_types',
            'mg_config_patch_prompt',
            'mg_config_set_fields',
            'mg_schema_patch_text',
        ]) {
            expect(MG_CONFIG_TOOL_DISPLAY[name]?.type).toBe('edit');
        }
    });

    it('classifies the list and read tools as read', () => {
        for (const name of [
            'mg_config_list_fields',
            'mg_config_read_fields',
        ]) {
            expect(MG_CONFIG_TOOL_DISPLAY[name]?.type).toBe('read');
        }
    });

    it('keeps the historical mg_schema_read_fields display alias for old persisted sessions', () => {
        // The studio no longer routes or advertises the historical read
        // tool, but old persisted sessions still replay its tool_calls and
        // the chip must keep formatting them.
        const alias = MG_CONFIG_TOOL_DISPLAY.mg_schema_read_fields;
        expect(alias).toBeDefined();
        expect(alias.type).toBe('read');
        // Old persisted sessions stored `[0].id`-style paths; the chip must
        // still summarize them without knowing the new document shape.
        expect(alias.summarize({ paths: ['[0].id'] })).toBe('[0].id');
    });

    it('excludes the legacy continue and finalize control tools', () => {
        expect(MG_CONFIG_TOOL_DISPLAY.luker_mg_schema_continue_iteration).toBeUndefined();
        expect(MG_CONFIG_TOOL_DISPLAY.luker_mg_schema_finalize_iteration).toBeUndefined();
    });

    it('classifies only the two reset tools as control', () => {
        const controlNames = Object.entries(MG_CONFIG_TOOL_DISPLAY)
            .filter(([, value]) => value?.type === 'control')
            .map(([key]) => key)
            .sort();
        expect(controlNames).toEqual([
            'luker_mg_schema_reset_live_to_blank',
            'luker_mg_schema_reset_live_to_global',
        ]);
    });

    it('provides a non-empty icon + label for every entry', () => {
        for (const [name, entry] of Object.entries(MG_CONFIG_TOOL_DISPLAY)) {
            expect({ name, icon: entry.icon }).toEqual({ name, icon: expect.any(String) });
            expect(entry.icon.length).toBeGreaterThan(0);
            expect(entry.label).toMatch(/[A-Za-z]/);
        }
    });

    it('covers every tool name listed in config-iteration/tools.js', async () => {
        const tools = await import(
            '../../public/scripts/extensions/memory-graph/config-iteration/tools.js'
        );
        // tools.TOOL_DISPLAY is the authoritative tool-name → label registry
        // the studio already uses. Every key in it must have a
        // MG_CONFIG_TOOL_DISPLAY entry so the shared renderToolCallChip
        // never falls back to '(tool)' for a known tool.
        const allNames = Object.keys(tools.TOOL_DISPLAY || {});
        expect(allNames.length).toBe(10);
        for (const name of allNames) {
            expect(MG_CONFIG_TOOL_DISPLAY[name]).toBeDefined();
        }
    });

    it('summarizes configuration calls by their target', () => {
        expect(MG_CONFIG_TOOL_DISPLAY.mg_config_patch_prompt.summarize({ path: 'settings.extractTemplate' }))
            .toBe('settings.extractTemplate');
        expect(MG_CONFIG_TOOL_DISPLAY.mg_schema_patch_text.summarize({
            id: 'event',
            field: 'columnHints',
            column: 'summary',
        })).toBe('event.columnHints.summary');
        expect(MG_CONFIG_TOOL_DISPLAY.mg_config_set_fields.summarize({
            set: { 'settings.recallMaxIterations': 5 },
            unset: ['settings.extractMode'],
        })).toBe('settings.recallMaxIterations, settings.extractMode');
    });

    it('no longer exports the schema-named transition alias', async () => {
        const mod = await import(
            '../../public/scripts/extensions/memory-graph/config-iteration/tool-display.js'
        );
        expect(mod.MG_SCHEMA_TOOL_DISPLAY).toBeUndefined();
    });
});
