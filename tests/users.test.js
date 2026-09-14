/* global globalThis */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import storage from 'node-persist';

import {
    getPasswordHash,
    getPasswordSalt,
    initUserStorage,
    isUserOnline,
    ONLINE_USER_WINDOW_MS,
    resolveUserFromBasicAuth,
    toKey,
} from '../src/users.js';

const TEST_DATA_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'luker-users-test-'));
const PREV_DATA_ROOT = globalThis.DATA_ROOT;

async function seedUser({ handle, password, enabled = true, admin = false }) {
    const salt = getPasswordSalt();
    const record = {
        handle,
        name: handle,
        created: Date.now(),
        password: password ? getPasswordHash(password, salt) : '',
        salt,
        enabled,
        admin,
    };
    await storage.setItem(toKey(handle), record);
    return record;
}

function basicHeader(username, password) {
    const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return `Basic ${token}`;
}

function requestWith(headers = {}, session) {
    const req = { headers };
    if (session !== undefined) req.session = session;
    return req;
}

describe('resolveUserFromBasicAuth', () => {
    beforeAll(async () => {
        globalThis.DATA_ROOT = TEST_DATA_ROOT;
        await initUserStorage(TEST_DATA_ROOT);
    });

    beforeEach(async () => {
        // Wipe between tests so getAllUserHandles() reflects only the
        // fixtures the current test seeded.
        await storage.clear();
    });

    afterAll(async () => {
        await storage.clear();
        fs.rmSync(TEST_DATA_ROOT, { recursive: true, force: true });
        globalThis.DATA_ROOT = PREV_DATA_ROOT;
    });

    test('returns null when no Authorization header is present', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({}, {}));
        expect(result).toBeNull();
    });

    test('returns null when the scheme is not Basic', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: 'Bearer some-token',
        }, {}));
        expect(result).toBeNull();
    });

    test('returns null for a handle that does not exist', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: basicHeader('nobody', 'hunter2'),
        }, {}));
        expect(result).toBeNull();
    });

    test('returns null for a known handle with the wrong password', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: basicHeader('alice', 'wrong-password'),
        }, {}));
        expect(result).toBeNull();
    });

    test('returns null for a disabled user even with the correct password', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2', enabled: false });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: basicHeader('alice', 'hunter2'),
        }, {}));
        expect(result).toBeNull();
    });

    test('returns {profile, directories} on a successful credential match', async () => {
        const seeded = await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: basicHeader('alice', 'hunter2'),
        }, {}));

        expect(result).not.toBeNull();
        expect(result.profile.handle).toBe('alice');
        expect(result.profile.password).toBe(seeded.password);
        expect(typeof result.directories.root).toBe('string');
        expect(result.directories.root.startsWith(TEST_DATA_ROOT)).toBe(true);
    });

    test('does not mutate request.session on success', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const session = { handle: 'preset-handle', version: 'preset-version' };
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: basicHeader('alice', 'hunter2'),
        }, session));

        expect(result).not.toBeNull();
        expect(session.handle).toBe('preset-handle');
        expect(session.version).toBe('preset-version');
    });

    test('does not throw when request.session is undefined', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const req = { headers: { authorization: basicHeader('alice', 'hunter2') } };
        // No `session` property at all — mirrors a route without session middleware.
        const result = await resolveUserFromBasicAuth(req);
        expect(result).not.toBeNull();
        expect(result.profile.handle).toBe('alice');
    });

    test('returns null for malformed credentials (no colon after decoding)', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        // A base64 payload that has no ':' separator decodes to "aliceonly".
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: 'Basic ' + Buffer.from('aliceonly', 'utf8').toString('base64'),
        }, {}));
        expect(result).toBeNull();
    });

    test('returns null for an empty credentials segment', async () => {
        await seedUser({ handle: 'alice', password: 'hunter2' });
        const result = await resolveUserFromBasicAuth(requestWith({
            authorization: 'Basic',
        }, {}));
        expect(result).toBeNull();
    });
});

describe('isUserOnline', () => {
    const NOW = Date.parse('2026-09-14T00:00:00Z');

    test('window 内有持久化活动时间即在线', () => {
        expect(isUserOnline('alice', NOW - 60 * 1000, NOW)).toBe(true);
    });

    test('活动时间超出 window 则离线', () => {
        expect(isUserOnline('alice', NOW - ONLINE_USER_WINDOW_MS - 1, NOW)).toBe(false);
    });

    test('活动时间恰好等于 window 边界时离线', () => {
        expect(isUserOnline('alice', NOW - ONLINE_USER_WINDOW_MS, NOW)).toBe(false);
    });

    test('没有任何活动时间记录时离线', () => {
        expect(isUserOnline('alice', undefined, NOW)).toBe(false);
    });

    test('活动时间非法时离线', () => {
        expect(isUserOnline('alice', Number.NaN, NOW)).toBe(false);
        expect(isUserOnline('alice', 0, NOW)).toBe(false);
    });
});
