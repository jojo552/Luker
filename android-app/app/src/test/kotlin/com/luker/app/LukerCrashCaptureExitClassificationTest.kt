// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.app.ApplicationExitInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A process killed by SIGABRT is reported as REASON_SIGNALED, not
 * REASON_CRASH. Leaving that reason out of the actionable set made the app
 * skip the crash report and dialog entirely, so the case is pinned here.
 */
class LukerCrashCaptureExitClassificationTest {

    private companion object {
        // POSIX signal numbers. Written as literals because android.system.OsConstants
        // reads as 0 under local unit tests.
        const val SIGABRT = 6
        const val SIGSEGV = 11
        const val SIGBUS = 7
        const val SIGILL = 4
        const val SIGFPE = 8
        const val SIGKILL = 9
    }

    @Test
    fun self_terminating_signals_are_actionable() {
        for (signal in listOf(SIGABRT, SIGSEGV, SIGBUS, SIGILL, SIGFPE)) {
            assertTrue(
                "signal $signal should produce a crash report",
                LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_SIGNALED, signal),
            )
        }
    }

    @Test
    fun externally_delivered_kill_signal_is_not_actionable() {
        assertFalse(
            LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_SIGNALED, SIGKILL),
        )
    }

    @Test
    fun clean_exit_is_not_actionable() {
        assertFalse(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_EXIT_SELF, 0))
        assertFalse(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_USER_REQUESTED, 0))
        assertFalse(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_OTHER, 0))
    }

    @Test
    fun existing_crash_reasons_stay_actionable() {
        assertTrue(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_CRASH, 0))
        assertTrue(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_CRASH_NATIVE, 0))
        assertTrue(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_ANR, 0))
        assertTrue(LukerCrashCapture.isActionableExit(ApplicationExitInfo.REASON_LOW_MEMORY, 0))
    }

    @Test
    fun signal_names_cover_the_reported_termination_causes() {
        assertEquals("SIGABRT", LukerCrashCapture.signalName(SIGABRT))
        assertEquals("SIGSEGV", LukerCrashCapture.signalName(SIGSEGV))
        assertEquals("SIGKILL", LukerCrashCapture.signalName(SIGKILL))
        assertEquals("signal 34", LukerCrashCapture.signalName(34))
    }
}
