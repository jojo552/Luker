// #93 — Memory Graph configuration workbench: the Advanced-panel entry,
// the commit round-trip for global parameters / template text, sparse
// character overrides, and the dirty guard over unsaved Advanced edits.
//
// REAL USER-GESTURE flow (only the LLM provider is mocked):
//   1. Open the MG Advanced pane through the real drawer + tab gestures.
//      The entry button keeps its stable id (#luker_rpg_memory_open_schema_studio)
//      but its visible label is now "AI Configure Memory Graph"; the prompt
//      textarea lives at #luker_rpg_memory_advanced_config_iter_system_prompt
//      and hydrates from the migrated settings key.
//   2. Open the workbench popup (title "Memory Graph Configuration Studio",
//      composer placeholder "Describe what to change in the configuration...").
//   3. Script mg_config_* tool calls on the mock, one batch per review
//      cycle. The studio's loop parks as soon as an edit lands a proposal,
//      and the approve itself re-fires the loop (drain-outcomes → next
//      round), so queued calls must never span an Apply boundary — the
//      post-approve round would consume them and race the test's next Send:
//        - first batch: mg_config_list_fields → mg_config_read_fields →
//                       mg_config_set_fields (settings.recallMaxIterations = 5)
//        - second batch: mg_config_patch_prompt (one word inside the default
//                       settings.extractTemplate)
//   4. Apply each batch through the real proposal-bus Approve buttons, then
//      assert the global settings + the Advanced form (hydrated by the
//      post-commit refresh) + restart persistence read back through
//      mg_config_read_fields.
//   5. Character scope: a clean card + a single recentRawTurns commit must
//      store a SPARSE advancedOverride (only the touched key) and leave the
//      global value untouched, surviving a restart.
//   6. Dirty guard: an unsaved Advanced edit must survive a workbench
//      commit round-trip — the post-commit refresh skips hydration while
//      the advanced tab is dirty, so the input keeps the user's value.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer, tearDownServer } from '../_lib/server.js';
import { startMockLLM } from '../_lib/mockLLM.js';
import { bootstrapCustomBackend, appendConnectionProfile, markOnboarded } from '../_lib/fixtures.js';
import { awaitMainUI, reloadAndAwait, selectCharacterByName, openExtensionsDrawer, openInlineDrawer } from '../_lib/page.js';
import { openIterStudio, sendIterPrompt, applyIterBatch, closeIterStudio } from '../_lib/ui-iter-studio.js';
import { normalizeIterStudioSettings } from '../preset/_helpers.js';
// The plain writeCharacter fixture ships a sidecar .json the server ignores
// (card data is read from PNG chunks only), so the card would surface as the
// seed Seraphina. writeEmbeddedCharacter stamps the card into the PNG via
// the server's own parser — the canonical cross-batch helper for that.
import { writeEmbeddedCharacter } from '../character/_helpers.js';
import { read as readPngCard } from '../../../src/character-card-parser.js';

let server, mock;

const ASH_AVATAR = 'ash-the-cartographer.png';
const ASH_NAME = 'Ash the Cartographer';
const ADVANCED_TAB = '#luker_rpg_memory_tabs .luker-tabs-tab[data-luker-tab-key="advanced"]';

function readAshCard(dataRoot) {
    const buf = readFileSync(resolve(dataRoot, 'default-user', 'characters', ASH_AVATAR));
    const meta = JSON.parse(readPngCard(buf));
    return meta?.data || meta || {};
}

async function openMgAdvancedPanel(page) {
    // The entry button + prompt textarea live in the Advanced tab pane,
    // which stays hidden until its tab is clicked (real gesture, like #70).
    await openExtensionsDrawer(page);
    await openInlineDrawer(page, 'memory_graph_settings');
    await page.locator(ADVANCED_TAB).click();
}

async function openMgConfigStudio(page) {
    await openMgAdvancedPanel(page);
    await openIterStudio(page, 'mg');
    const popup = page.locator('.popup:visible').last();
    await expect(popup.locator('.mg_schema_it_title')).toHaveText('Memory Graph Configuration Studio');
    return popup;
}

async function waitForPostApproveRound(popup, baselineRequestCount) {
    // Approving a proposal re-fires the studio's loop: the bus drains the
    // commit outcome and runIterationTurn runs one more round against the
    // mock. With the mock queue empty that round ends on the plain echo
    // reply and the loop parks. Wait for that round to finish before
    // queueing the next tool call, so two in-flight rounds can never race
    // the mock's single scripted queue.
    await expect.poll(async () => mock.requests.length, { timeout: 30_000 }).toBeGreaterThan(baselineRequestCount);
    await popup.locator('.mg_schema_it_msg_loading').waitFor({ state: 'detached', timeout: 30_000 });
}

async function sendAndWaitForToolResult(page, promptText) {
    // Same real composer gestures as sendIterPrompt, but the round is
    // read-only: no proposal ever lands, so wait for the tool-result chip
    // (plus the loop settling) instead of an Approve button.
    const popup = page.locator('.popup:visible').last();
    const input = popup.locator('[data-mg-schema-it-input]').first();
    await input.waitFor({ state: 'visible', timeout: 10_000 });
    await input.fill(promptText);
    await popup.locator('[data-mg-schema-it-action="send"]').first().click();
    const chip = popup.locator('.luker_lib_toolcall_result').last();
    await chip.waitFor({ state: 'visible', timeout: 30_000 });
    // The read keeps the loop running (tool call → next round); the final
    // no-tool-call round clears the busy spinner. Expand the chip only
    // after the render settles so the open state is not clobbered.
    await popup.locator('.mg_schema_it_msg_loading').waitFor({ state: 'detached', timeout: 30_000 });
    await chip.locator('summary').click();
    return chip.locator('.luker_lib_toolcall_result_body');
}

test.beforeAll(async () => {
    mock = await startMockLLM({});
    server = await startServer({
        batchKey: 'iterstudio',
        scenarioId: '93-mg-config-workbench',
        extraConfig: { 'storage.mode': 'fs' },
    });
    markOnboarded({ dataRoot: server.dataRoot });
    bootstrapCustomBackend({ dataRoot: server.dataRoot, baseURL: mock.baseURL });
    appendConnectionProfile({ dataRoot: server.dataRoot, baseURL: mock.baseURL });
    normalizeIterStudioSettings(server.dataRoot);
    // Clean v2 card (empty extensions) for the character-scope tests.
    writeEmbeddedCharacter({ dataRoot: server.dataRoot, avatarFile: ASH_AVATAR });
});

test.afterAll(async () => {
    await tearDownServer(server);
    await mock?.stop();
});

test.describe('#93 — Memory Graph configuration workbench (real UI)', () => {
    test('global parameter and template edits commit, hydrate the Advanced form, and persist across restart', async ({ page }) => {
        await awaitMainUI(page, server.baseURL);

        // No character selected → workbench commits target global scope.
        const avatar = await page.evaluate(() => {
            const ctx = window.Luker.getContext();
            return ctx.characters?.[ctx.characterId]?.avatar || '';
        });
        expect(avatar).toBe('');

        // Advanced panel: the renamed entry + description + prompt textarea.
        await openMgAdvancedPanel(page);
        const entryBtn = page.locator('#luker_rpg_memory_open_schema_studio');
        await expect(entryBtn).toBeVisible();
        await expect(entryBtn).toHaveText('AI Configure Memory Graph');
        await expect(page.locator('#memory_graph_settings')).toContainText('Configure memory table types, prompts, and behavior parameters in a popup editor.');

        // The prompt textarea is bound to the migrated settings key.
        const promptBox = page.locator('#luker_rpg_memory_advanced_config_iter_system_prompt');
        await expect(promptBox).toBeVisible();
        const migratedPrompt = await page.evaluate(() => {
            return String(window.Luker.getContext().extensionSettings?.memory_graph?.configIterSystemPrompt || '');
        });
        expect(migratedPrompt.length).toBeGreaterThan(0);
        await expect(promptBox).toHaveValue(migratedPrompt);

        // Open the workbench: new title + new composer placeholder.
        const popup = await openMgConfigStudio(page);
        const composer = popup.locator('[data-mg-schema-it-input]').first();
        await expect(composer).toHaveAttribute('placeholder', 'Describe what to change in the configuration...');

        // First batch: discovery → read → one edit. The loop parks on the
        // set_fields proposal (3 LLM rounds).
        mock.scriptToolCall({ name: 'mg_config_list_fields', arguments: {} });
        mock.scriptToolCall({ name: 'mg_config_read_fields', arguments: { paths: ['settings.extractTemplate'] } });
        mock.scriptToolCall({ name: 'mg_config_set_fields', arguments: { set: { 'settings.recallMaxIterations': 5 } } });
        await sendIterPrompt(page, 'mg', 'Raise the recall iteration cap to 5.');
        await expect(popup).toContainText('Recall max iterations');

        const afterFirstBatchRequests = mock.requests.length;
        await applyIterBatch(page, 'mg');
        await waitForPostApproveRound(popup, afterFirstBatchRequests);

        // Second batch: the queued text patch against the (still default) template.
        mock.scriptToolCall({
            name: 'mg_config_patch_prompt',
            arguments: {
                path: 'settings.extractTemplate',
                oldString: 'Be analytical, terse, and disciplined.',
                newString: 'Be analytical, concise, and disciplined.',
            },
        });
        await sendIterPrompt(page, 'mg', 'Now make the extraction template ask for concise reasoning.');
        await expect(popup).toContainText('Extraction Template');
        await applyIterBatch(page, 'mg');
        await closeIterStudio(page);

        // Global settings carry both edits.
        await expect.poll(async () => {
            return await page.evaluate(() => {
                const s = window.Luker.getContext().extensionSettings?.memory_graph || {};
                return { recall: s.recallMaxIterations ?? null, template: String(s.extractTemplate || '') };
            });
        }, { timeout: 10_000 }).toEqual(expect.objectContaining({ recall: 5 }));
        const committed = await page.evaluate(() => String(window.Luker.getContext().extensionSettings?.memory_graph?.extractTemplate || ''));
        expect(committed).toContain('concise');
        expect(committed).toContain('{{nodes}}');
        expect(committed).toContain('{{edges}}');

        // The Advanced form is clean (not dirty), so the post-commit refresh
        // hydrates it — the recall input shows the committed value with no
        // reload and no rebind.
        await expect(page.locator('#luker_rpg_memory_advanced_recall_iterations')).toHaveValue('5');

        // Restart → reload → reopen → read both values back through the workbench read tool.
        await server.restart();
        await reloadAndAwait(page, server.baseURL);
        await openMgConfigStudio(page);
        mock.scriptToolCall({
            name: 'mg_config_read_fields',
            arguments: { paths: ['settings.recallMaxIterations', 'settings.extractTemplate'] },
        });
        const resultBody = await sendAndWaitForToolResult(page, 'Read back the recall iteration cap and the extraction template.');
        await expect(resultBody).toContainText('"settings.recallMaxIterations": 5');
        await expect(resultBody).toContainText('concise');
        await expect(resultBody).toContainText('{{nodes}}');
        await expect(resultBody).toContainText('{{edges}}');
        await closeIterStudio(page);
    });

    test('character-scope commit stores only the sparse recentRawTurns override and survives restart', async ({ page }) => {
        await awaitMainUI(page, server.baseURL);
        await selectCharacterByName(page, ASH_NAME);

        const avatar = await page.evaluate(() => {
            const ctx = window.Luker.getContext();
            return ctx.characters?.[ctx.characterId]?.avatar || '';
        });
        expect(avatar).toBe(ASH_AVATAR);

        await openMgConfigStudio(page);
        mock.scriptToolCall({ name: 'mg_config_set_fields', arguments: { set: { 'settings.recentRawTurns': 9 } } });
        await sendIterPrompt(page, 'mg', 'Keep the last 9 assistant turns as raw text for this character.');
        await applyIterBatch(page, 'mg');
        await closeIterStudio(page);

        // Card override is sparse: ONLY the touched key, none of the other
        // registered keys (in-memory view + on-disk card).
        await expect.poll(async () => {
            return await page.evaluate(() => {
                const ctx = window.Luker.getContext();
                const character = ctx?.characters?.[ctx?.characterId];
                return character?.data?.extensions?.memory_graph?.advancedOverride ?? null;
            });
        }, { timeout: 10_000 }).toEqual({ recentRawTurns: 9 });
        await expect.poll(async () => {
            return readAshCard(server.dataRoot)?.extensions?.memory_graph?.advancedOverride ?? null;
        }, { timeout: 10_000 }).toEqual({ recentRawTurns: 9 });

        // The global value is untouched.
        const globalRecentRawTurns = await page.evaluate(() => {
            return window.Luker.getContext().extensionSettings?.memory_graph?.recentRawTurns ?? null;
        });
        expect(globalRecentRawTurns).toBe(2);

        // The Advanced form shows the effective (character) value via the
        // post-commit refresh.
        await expect(page.locator('#luker_rpg_memory_advanced_recent_raw_turns')).toHaveValue('9');

        // Restart → reload → re-select → the card still carries only that key.
        await server.restart();
        await reloadAndAwait(page, server.baseURL);
        await selectCharacterByName(page, ASH_NAME);

        const afterRestart = await page.evaluate(() => {
            const ctx = window.Luker.getContext();
            const character = ctx?.characters?.[ctx?.characterId];
            return character?.data?.extensions?.memory_graph?.advancedOverride ?? null;
        });
        expect(afterRestart).toEqual({ recentRawTurns: 9 });
        expect(readAshCard(server.dataRoot)?.extensions?.memory_graph?.advancedOverride ?? null).toEqual({ recentRawTurns: 9 });
    });

    test('unsaved Advanced edits survive a workbench commit round-trip', async ({ page }) => {
        await awaitMainUI(page, server.baseURL);
        // Ash carries the sparse recentRawTurns=9 override from the previous
        // test, so the effective view genuinely differs from the value typed
        // below — an unguarded post-commit hydration would clobber the input
        // back to the override value.
        await selectCharacterByName(page, ASH_NAME);
        await openMgAdvancedPanel(page);

        const rawTurnsInput = page.locator('#luker_rpg_memory_advanced_recent_raw_turns');
        await expect(rawTurnsInput).toHaveValue('9');

        // Real input event, NO save: the change handler applies the value to
        // live settings in memory and marks the advanced tab dirty.
        await rawTurnsInput.fill('13');
        await expect(page.locator('#luker_rpg_memory_advanced_dirty_note')).toBeVisible();

        // Commit an unrelated setting through the workbench (recall
        // iterations differ from the effective 5 committed in test 1).
        await openMgConfigStudio(page);
        mock.scriptToolCall({ name: 'mg_config_set_fields', arguments: { set: { 'settings.recallMaxIterations': 4 } } });
        await sendIterPrompt(page, 'mg', 'Lower the recall iteration cap to 4 for this character.');
        await applyIterBatch(page, 'mg');
        await closeIterStudio(page);

        // The dirty guard made the post-commit refresh skip hydration, so the
        // user's unsaved value is still in the input.
        await expect(rawTurnsInput).toHaveValue('13');
        await expect(page.locator('#luker_rpg_memory_advanced_dirty_note')).toBeVisible();
    });
});
