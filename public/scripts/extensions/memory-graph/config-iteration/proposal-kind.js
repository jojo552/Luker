// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * ProposalBus kind for the Memory Graph configuration studio.
 *
 * The studio registers ONE `profile-edit` kind that serves BOTH targets:
 *
 *   - `config`  — the `{ schema, settings }` working document every new
 *                 proposal carries
 *   - `schema`  — the legacy array target. Old persisted sessions (and the
 *                 legacy pendingEdits migration in loadSession) replay with
 *                 array before/after; keeping them dispatchable lets a
 *                 resumed session approve / reject / roll back its
 *                 historical entries instead of dead-ending.
 *
 * `targetType` is undefined so the bus's propose-time target check accepts
 * either target; the per-entry hooks discriminate on `entry.target.type`
 * instead. Unknown target types fall back to the configuration wording so
 * a corrupt session blob still renders a card instead of throwing inside
 * the render loop.
 *
 * render-card.js invokes every hook entry-aware —
 * `renderDiffCard(entry, helpers)`, `label(entry)`, `icon(entry)`,
 * `target(entry)` — so the discrimination lives in the hooks themselves.
 */

import { profileEdit } from '../../../iteration-library/proposal-bus/kinds/profile-edit.js';

function isSchemaTargetEntry(entry) {
    return String(entry?.target?.type || '') === 'schema';
}

/**
 * @param {object} opts
 * @param {(key: string) => string} opts.t                 popup i18n translator
 * @param {(before: any, after: any) => string} opts.renderSchemaCards
 *        renders the legacy schema-array diff body
 * @param {(before: any, after: any) => string} opts.renderConfigCards
 *        renders the { schema, settings } diff body
 * @returns {object} KindHandler for `bus.registerKind('profile-edit', ...)`
 */
export function createConfigProfileEditKind({ t, renderSchemaCards, renderConfigCards } = {}) {
    const translate = typeof t === 'function' ? t : (s) => String(s ?? '');
    const schemaCards = typeof renderSchemaCards === 'function' ? renderSchemaCards : () => '';
    const configCards = typeof renderConfigCards === 'function' ? renderConfigCards : () => '';
    // profileEdit's own targetType ('profile') does not match either of the
    // studio's targets, so it is dropped rather than overridden — an
    // undefined targetType is what lets one kind serve both.
    const { targetType: _droppedTargetType, ...base } = profileEdit;
    return {
        ...base,
        targetType: undefined,
        renderDiffCard: (entry) => {
            const before = entry?.meta?.before ?? null;
            const after = entry?.meta?.after ?? null;
            return isSchemaTargetEntry(entry)
                ? schemaCards(before, after)
                : configCards(before, after);
        },
        label: (entry) => translate(isSchemaTargetEntry(entry) ? 'Schema change' : 'Configuration change'),
        icon: () => '🧩',
        target: (entry) => translate(isSchemaTargetEntry(entry) ? 'schema' : 'configuration'),
    };
}
