// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * MG configuration tool-display map — feeds renderToolCallChip's
 * `opts.toolDisplay`. Keys are the memory-graph workbench tool names
 * registered in tools.js (edit + read + control) plus the historical
 * `mg_schema_read_fields` alias, which old persisted sessions still carry.
 * Values are { icon, label, type, summarize?(args, result, i18n) }.
 *
 * Both `label` and the templates inside `summarize` are the English source
 * strings. `renderToolCallChip` threads the popup's runtime `i18n` translator
 * into both (label via a direct lookup, summarize via the third argument)
 * so this file declares the i18n keys, never the localized text.
 */

const summarizePaths = (paths) => {
    const list = Array.isArray(paths) ? paths : [];
    if (list.length === 0) return '';
    if (list.length <= 3) return list.join(', ');
    return `${list.slice(0, 3).join(', ')} +${list.length - 3}`;
};

export const MG_CONFIG_TOOL_DISPLAY = {
    mg_config_list_fields: {
        icon: '📋',
        label: 'List config fields',
        type: 'read',
        summarize: (a) => a?.group || '',
    },
    mg_config_read_fields: {
        icon: '🔍',
        label: 'Read config fields',
        type: 'read',
        summarize: (a) => summarizePaths(a?.paths),
    },
    mg_config_patch_prompt: {
        icon: '🔧',
        label: 'Patch settings text',
        type: 'edit',
        summarize: (a) => a?.path || '',
    },
    mg_config_set_fields: {
        icon: '⚙️',
        label: 'Set config fields',
        type: 'edit',
        summarize: (a) => summarizePaths([
            ...Object.keys(a?.set || {}),
            ...(Array.isArray(a?.unset) ? a.unset : []),
        ]),
    },
    mg_schema_patch_text: {
        icon: '✏️',
        label: 'Patch node type text',
        type: 'edit',
        summarize: (a) => [a?.id, a?.field, a?.column].filter(Boolean).join('.'),
    },

    mg_schema_set_node_type: { icon: '✏️', label: 'Set node type',       type: 'edit', summarize: (a) => a?.node_type?.id || '' },
    mg_schema_remove_node_type: { icon: '🗑️', label: 'Remove node type',    type: 'edit', summarize: (a) => a?.id || '' },
    mg_schema_reorder_node_types: { icon: '🔀', label: 'Reorder node types',  type: 'edit', summarize: (a) => `${(a?.ids || []).length}` },

    // Historical read tool. Old sessions replay `[N].field` paths against
    // the old schema-array root; the chip only formats the path list, so
    // the same summarizer works for both document shapes.
    mg_schema_read_fields: {
        icon: '🔍',
        label: 'Read schema fields',
        type: 'read',
        summarize: (a) => summarizePaths(a?.paths),
    },

    luker_mg_schema_reset_live_to_blank: { icon: '♻️', label: 'Reset schema to blank',     type: 'control' },
    luker_mg_schema_reset_live_to_global: { icon: '⬇️', label: 'Reset schema to global',    type: 'control' },
};
