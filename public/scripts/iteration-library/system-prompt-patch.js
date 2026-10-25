// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups

/**
 * iteration-library — exact-anchor string patch primitive.
 *
 * Apply a Claude-Code-Edit-shaped `{oldString, newString, replaceAll}`
 * patch to a string. Returns either:
 *   - { ok: true, nextText }      — the patch was applied
 *   - { ok: false, error: <code>, ... } — fail-closed: never returns a
 *     partially-mutated string.
 *
 * Failure codes (mirrors Claude Code Edit / the project's existing
 * `apply_message_patches` contract):
 *   - 'invalid_args'      — oldString missing / not a string / empty
 *   - 'not_found'         — oldString does not occur in the current text
 *   - 'multiple_matches'  — oldString occurs more than once and replaceAll
 *                           is false (default); the caller must widen
 *                           oldString with surrounding context
 *
 * Shared by every plugin that exposes an exact-anchor prompt patch tool
 * — the orchestrator's per-agent `luker_orch_patch_*_system_prompt`
 * tools (director / loop / agenda) and the memory-graph config prompt
 * patch tool — so they all share a single semantics: incremental edits
 * instead of full rewrites, with the same drift-detection guarantees
 * the message-takeover patches already give the director.
 *
 * Moved here from `extensions/orchestrator/system-prompt-patch.js` so
 * plugins outside the orchestrator do not import one another.
 */
export function applyStringPatch(currentText, { oldString, newString, replaceAll = false } = {}) {
    if (typeof oldString !== 'string' || oldString.length === 0) {
        return { ok: false, error: 'invalid_args', detail: 'oldString must be a non-empty string' };
    }
    if (typeof newString !== 'string') {
        return { ok: false, error: 'invalid_args', detail: 'newString must be a string (use "" to delete)' };
    }
    const current = String(currentText ?? '');
    const firstIdx = current.indexOf(oldString);
    if (firstIdx === -1) {
        return { ok: false, error: 'not_found', detail: 'oldString not present in the current text' };
    }
    const secondIdx = current.indexOf(oldString, firstIdx + oldString.length);
    if (secondIdx !== -1 && !replaceAll) {
        return {
            ok: false,
            error: 'multiple_matches',
            detail: 'oldString is not unique in the current text. Widen it with surrounding context until it matches exactly once, or pass replaceAll: true.',
        };
    }
    if (replaceAll) {
        return { ok: true, nextText: current.split(oldString).join(newString) };
    }
    const nextText = current.slice(0, firstIdx) + newString + current.slice(firstIdx + oldString.length);
    return { ok: true, nextText };
}

/**
 * Tool-call schema fragment shared by every per-agent system-prompt
 * patch tool. Callers extend it with their own locator fields
 * (`id` / `agent_id` / etc.) before exporting the tool def.
 */
export const SYSTEM_PROMPT_PATCH_SCHEMA_FIELDS = Object.freeze({
    oldString: {
        type: 'string',
        description: 'Substring to find in the current system prompt. Must occur exactly once unless `replaceAll` is true.',
    },
    newString: {
        type: 'string',
        description: 'Replacement text. Use "" to delete the matched substring.',
    },
    replaceAll: {
        type: 'boolean',
        description: 'Optional. When true, replace every occurrence of `oldString`. Default false (unique-or-fail).',
    },
});
