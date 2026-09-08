import { describe, expect, test } from '@jest/globals';

import { selectInactiveUsers } from '../src/inactive-user-cleanup.js';

const NOW = Date.parse('2026-09-08T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('不活跃账号选择器', () => {
    test('只选择达到配置阈值的普通账号', () => {
        const users = [
            { handle: 'old-user', lastActivity: NOW - 46 * DAY },
            { handle: 'recent-user', lastActivity: NOW - 44 * DAY },
            { handle: 'admin-user', admin: true, lastActivity: NOW - 90 * DAY },
            { handle: 'default-user', lastActivity: NOW - 90 * DAY },
            { handle: 'missing-timestamp' },
        ];

        expect(selectInactiveUsers(users, {
            now: NOW,
            inactivityDays: 45,
            defaultHandle: 'default-user',
        }).map(user => user.handle)).toEqual(['old-user']);
    });

    test('最后活动时间刚好达到阈值时会被选择', () => {
        const users = [{ handle: 'exact-user', lastActivity: NOW - 45 * DAY }];

        expect(selectInactiveUsers(users, {
            now: NOW,
            inactivityDays: 45,
            defaultHandle: 'default-user',
        })).toHaveLength(1);
    });
});
