// SPDX-License-Identifier: AGPL-3.0-or-later

import process from 'node:process';

import { getRequestInspectorStats } from './request-inspector.js';
import { getUserActivityStats } from './users.js';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const enabled = ENABLED_VALUES.has(String(process.env.LUKER_MEMORY_DIAGNOSTICS || '').toLowerCase());
const configuredInterval = Number(process.env.LUKER_MEMORY_DIAGNOSTICS_INTERVAL_MS);
const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 10_000
    ? Math.floor(configuredInterval)
    : 5 * 60 * 1000;

let diagnosticsTimer = null;

function reportMemoryDiagnostics() {
    try {
        console.info('[memory-diagnostics]', JSON.stringify({
            at: new Date().toISOString(),
            uptimeSec: Math.floor(process.uptime()),
            memory: process.memoryUsage(),
            requestInspector: getRequestInspectorStats(),
            userActivity: getUserActivityStats(),
        }));
    } catch (error) {
        console.warn('[memory-diagnostics] report failed:', error?.message || error);
    }
}

/**
 * 启动只输出聚合数字的内存诊断定时器，默认关闭。
 * @returns {NodeJS.Timeout|null}
 */
export function startMemoryDiagnostics() {
    if (!enabled || diagnosticsTimer) {
        return diagnosticsTimer;
    }

    reportMemoryDiagnostics();
    diagnosticsTimer = setInterval(reportMemoryDiagnostics, intervalMs);
    diagnosticsTimer.unref?.();
    console.info(`[memory-diagnostics] enabled, interval=${intervalMs}ms`);
    return diagnosticsTimer;
}
