// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * Memory Graph — thin dispatcher for the configuration workbench's
 * read-field tool. Pure — no ST context, no jQuery, no side effects.
 *
 * `dispatchMgConfigReadFields` backs the `mg_config_read_fields` tool. Root is
 * `{ schema, settings }`; `source` selects the working / global / default
 * view. Returns `{ source, values, missing_paths }`.
 *
 * Sanitization boundary — CALL-OUT: the schema half is normalized
 * user-authored data. The normalizer emits a superset of the editable
 * surface (e.g. `compression.rule`, `ragPerTypeK`, `recordsFloorRange`), and
 * the set tool's JSON schema rejects those via `additionalProperties: false`.
 * Surfacing them would hand the AI fields it cannot write back, so every
 * node type is projected onto the set tool's writable surface
 * (`projectNodeTypeForRead`) before reading. This keeps read ⊆ write by
 * construction; a future normalizer field is dropped automatically unless it
 * is also added to `nodeTypeSchemaParams()`.
 *
 * No size-based truncation is applied to read values. The read tool is a
 * narrow contract — the caller names the exact paths it wants — and prompt
 * fields can be long; a cap here would force an anchor-patching AI into a
 * read → preview → miss loop.
 *
 * Tested directly in tests/mg-config-iteration/read-fields.test.js so this
 * module (and its shared helper) can be pinned without dragging studio.js's
 * ST-context / jQuery import graph into jest.
 */

import { readFieldsByPaths } from '../../../iteration-library/read-fields-helper.js';
import { projectNodeTypeForRead } from './tools.js';

const VALID_SOURCES = new Set(['working', 'global', 'default']);

/**
 * Read exact values from one of the configuration workbench's three views.
 *
 * @param {object} params
 * @param {{working?: object, global?: object, default?: object}} [params.sources]
 *        — each value is a `{ schema, settings }` document. Missing /
 *        non-object views are rejected so the AI never reads a silently
 *        empty snapshot when it asked for a specific layer.
 * @param {{source?: string, paths?: any}} [params.args] — `source` defaults
 *        to `working`; `paths` must be an array of lodash-style path
 *        strings.
 * @returns {Promise<{source: string, values: object, missing_paths: string[]}>}
 *          `values` maps each requested path to its value (or `null`), and
 *          `missing_paths` lists the paths that did not resolve.
 */
export async function dispatchMgConfigReadFields({ sources, args } = {}) {
    const source = String(args?.source || 'working').trim();
    if (!VALID_SOURCES.has(source)) {
        throw new Error(`invalid_args — source must be one of working, global, default; got "${source}".`);
    }
    const config = sources?.[source];
    if (!config || typeof config !== 'object') {
        throw new Error(`invalid_args — source "${source}" is not available in this session.`);
    }
    const root = {
        schema: (Array.isArray(config.schema) ? config.schema : []).map(projectNodeTypeForRead),
        settings: config.settings && typeof config.settings === 'object' ? config.settings : {},
    };
    const raw = readFieldsByPaths(root, args?.paths);
    const { missing_paths, ...values } = raw;
    return { source, values, missing_paths };
}
