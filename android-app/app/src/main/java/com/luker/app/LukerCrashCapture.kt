// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs

object LukerCrashCapture {
    private const val TAG = "LukerCrashCapture"
    private const val PREF_NAME = "luker_crash_capture"
    private const val PREF_KEY_LAST_TIMESTAMP = "last_handled_exit_timestamp"
    private const val PREF_KEY_LAST_JVM_TIMESTAMP = "last_handled_jvm_timestamp"
    private const val REPORT_FILE_NAME = "luker-last-crash-report.txt"
    private const val NATIVE_TOMBSTONE_FILE_NAME = "luker-last-native-tombstone.pb"
    private const val WEBVIEW_REPORT_FILE_NAME = "luker-last-webview-crash-report.txt"
    private const val MAX_HISTORY_LOOKUP = 16

    /**
     * POSIX signal numbers, identical on every Android ABI. Spelled out
     * instead of using android.system.OsConstants because those are not
     * compile-time constants: they read as 0 in local unit tests, which made
     * the classification untestable.
     */
    private const val SIGNAL_SIGABRT = 6
    private const val SIGNAL_SIGBUS = 7
    private const val SIGNAL_SIGFPE = 8
    private const val SIGNAL_SIGILL = 4
    private const val SIGNAL_SIGKILL = 9
    private const val SIGNAL_SIGSEGV = 11
    private const val SIGNAL_SIGTERM = 15

    /**
     * Signals that mean the process chose to die after detecting a fatal
     * condition. Kept out in [isActionableExit] because the numeric value of
     * [ApplicationExitInfo.status] is the signal for REASON_SIGNALED.
     */
    private val FATAL_SIGNALS = setOf(
        SIGNAL_SIGABRT,
        SIGNAL_SIGBUS,
        SIGNAL_SIGFPE,
        SIGNAL_SIGILL,
        SIGNAL_SIGSEGV,
    )

    data class CapturedCrash(
        val report: String,
        val reportFile: File?,
        val timestamp: Long,
    )

    fun pollUnhandledCrash(context: Context): CapturedCrash? {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val jvmCrash = runCatching { readJvmCrashReport(context, prefs) }
            .onFailure { Log.w(TAG, "Failed to read JVM crash report", it) }
            .getOrNull()
        val platformCrash = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching { collectAbnormalExit(context, prefs) }
                .onFailure { Log.w(TAG, "Failed to read ApplicationExitInfo history", it) }
                .getOrNull()
        } else {
            null
        }

        val captured = mergeCrashes(context, jvmCrash, platformCrash) ?: return null
        // If a CDP snapshot happens to sit on disk from a prior render-process
        // crash (or from a still-unread jvm-crash-with-webview-alive path),
        // surface its path in the enriched jvm-crash report too so both crash
        // paths get the same treatment. onRenderProcessGone freshly harvests
        // and calls enrichCrashReport directly with its returned path.
        val cdpSnapshot = File(context.filesDir, LukerCdpCollector.CRASH_SNAPSHOT_FILE_NAME)
        val cdpSnapshotPath = if (cdpSnapshot.isFile) cdpSnapshot.absolutePath else null
        return enrichCrashReport(context, captured, cdpSnapshotPath)
    }

    /**
     * Appends debug-trail, logcat tail, and (if a snapshot exists) the CDP
     * snapshot path to the crash report body, and persists the result back
     * to the report file. Public so MainActivity.onRenderProcessGone can
     * share the same enrichment shape as the jvm-crash path — the two used
     * to have parallel implementations that drifted.
     */
    fun enrichCrashReport(
        context: Context,
        captured: CapturedCrash,
        cdpSnapshotPath: String? = null,
    ): CapturedCrash {
        val enrichedReport = buildString {
            append(captured.report)
            append("\n\n--- debug-trail ---\n")
            val trail = runCatching { LukerDebugTrail.readPersisted() }.getOrDefault("")
                .ifEmpty { runCatching { LukerDebugTrail.dumpAll() }.getOrDefault("") }
            append(trail.ifEmpty { "<empty>" })
            appendLogcatTailsForCrash(this, context)
            if (cdpSnapshotPath != null) {
                append("\n\n--- cdp snapshot ---\n")
                append(cdpSnapshotPath).append('\n')
                append("(complete event stream in diagnostics zip crashes/luker-last-crash-cdp.jsonl)")
            }
        }
        val reportFile = runCatching {
            captured.reportFile?.also { it.writeText(enrichedReport, Charsets.UTF_8) }
        }.getOrNull() ?: captured.reportFile
        return CapturedCrash(report = enrichedReport, reportFile = reportFile, timestamp = captured.timestamp)
    }

    private fun appendLogcatTailsForCrash(sb: StringBuilder, context: Context) {
        sb.append("\n\n--- logcat tail ---\n")
        val current = LukerLogcatTail.currentLogFile(context)
        val last = LukerLogcatTail.lastLogFile(context)
        if (!current.isFile && !last.isFile) {
            sb.append("<not recorded>")
            return
        }
        val tailLimit = 64 * 1024L
        if (last.isFile) {
            sb.append("--- last ---\n").append(readTailForCrash(last, tailLimit)).append('\n')
        }
        if (current.isFile) {
            sb.append("--- current ---\n").append(readTailForCrash(current, tailLimit))
        }
    }

    private fun readTailForCrash(file: File, maxBytes: Long): String {
        if (!file.isFile) return ""
        val length = file.length()
        if (length <= maxBytes) return file.readText(Charsets.UTF_8)
        return file.inputStream().use { input ->
            val skip = length - maxBytes
            var remaining = skip
            val buf = ByteArray(8192)
            while (remaining > 0) {
                val toSkip = minOf(remaining, buf.size.toLong())
                val skipped = input.read(buf, 0, toSkip.toInt())
                if (skipped <= 0) break
                remaining -= skipped
            }
            input.readBytes().toString(Charsets.UTF_8)
        }
    }

    private fun mergeCrashes(
        context: Context,
        jvmCrash: JvmCrashReport?,
        platformCrash: PlatformCrashReport?,
    ): CapturedCrash? {
        if (jvmCrash == null && platformCrash == null) {
            return null
        }
        if (jvmCrash != null && platformCrash != null && jvmCrashMatchesPlatform(jvmCrash, platformCrash)) {
            val combined = buildString {
                append(platformCrash.headerWithoutTrace)
                append("\njvm trace:\n").append(jvmCrash.body)
            }
            val file = runCatching { persistReport(context, REPORT_FILE_NAME, combined) }.getOrNull()
            return CapturedCrash(combined, file, platformCrash.timestamp)
        }

        return when {
            jvmCrash != null -> {
                val report = buildString {
                    append("source=jvm-uncaught-exception\n")
                    append(jvmCrash.body)
                }
                val file = runCatching { persistReport(context, REPORT_FILE_NAME, report) }.getOrNull()
                CapturedCrash(report, file, jvmCrash.timestamp)
            }
            platformCrash != null -> {
                val report = buildString {
                    append(platformCrash.headerWithoutTrace)
                    append('\n').append(platformCrash.traceSection)
                }
                val file = runCatching { persistReport(context, REPORT_FILE_NAME, report) }.getOrNull()
                CapturedCrash(report, file, platformCrash.timestamp)
            }
            else -> null
        }
    }

    private fun jvmCrashMatchesPlatform(jvm: JvmCrashReport, platform: PlatformCrashReport): Boolean {
        if (platform.reason != ApplicationExitInfo.REASON_CRASH) {
            return false
        }
        val delta = abs(jvm.timestamp - platform.timestamp)
        return delta <= 60_000L
    }

    fun captureWebViewCrash(
        context: Context,
        webViewUrl: String?,
        didCrash: Boolean,
        rendererPriorityAtExit: Int?,
    ): CapturedCrash {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
        val now = System.currentTimeMillis()
        val report = buildString {
            append("source=webview-render-process-gone\n")
            append("when=").append(formatter.format(Date(now))).append('\n')
            append("didCrash=").append(didCrash).append('\n')
            append("rendererPriorityAtExit=").append(rendererPriorityAtExit ?: "<unknown>").append('\n')
            append("url=").append(webViewUrl ?: "<unknown>").append('\n')
            append("device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
            append("android=").append(Build.VERSION.RELEASE)
                .append(" (sdk=").append(Build.VERSION.SDK_INT).append(")\n")
            append('\n')
            append(
                if (didCrash) {
                    "The WebView renderer process crashed. Android does not include a native stack here; if it was a native crash, a tombstone may be available via the system's previous-crash report on next launch."
                } else {
                    "The WebView renderer process was reclaimed by the system (typically due to memory pressure or being backgrounded). No stack is produced for this case."
                }
            )
        }
        val file = runCatching { persistReport(context, WEBVIEW_REPORT_FILE_NAME, report) }.getOrNull()
        return CapturedCrash(report = report, reportFile = file, timestamp = now)
    }

    private fun readJvmCrashReport(context: Context, prefs: SharedPreferences): JvmCrashReport? {
        val file = File(context.filesDir, LukerApplication.JVM_CRASH_FILE_NAME)
        if (!file.isFile) {
            return null
        }
        val body = file.readText(Charsets.UTF_8)
        val timestamp = parseTimestampFromBody(body) ?: file.lastModified()
        val lastHandled = prefs.getLong(PREF_KEY_LAST_JVM_TIMESTAMP, 0L)
        if (timestamp <= lastHandled) {
            file.delete()
            return null
        }
        prefs.edit().putLong(PREF_KEY_LAST_JVM_TIMESTAMP, timestamp).apply()
        file.delete()
        return JvmCrashReport(body = body, timestamp = timestamp)
    }

    private fun parseTimestampFromBody(body: String): Long? {
        val match = Regex("(?m)^timestamp=(\\d+)").find(body) ?: return null
        return match.groupValues[1].toLongOrNull()
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun collectAbnormalExit(
        context: Context,
        prefs: SharedPreferences,
    ): PlatformCrashReport? {
        val activityManager = context.getSystemService(ActivityManager::class.java) ?: return null
        val history = activityManager.getHistoricalProcessExitReasons(
            context.packageName,
            0,
            MAX_HISTORY_LOOKUP,
        )
        if (history.isEmpty()) {
            return null
        }

        val lastHandled = prefs.getLong(PREF_KEY_LAST_TIMESTAMP, 0L)
        val candidate = history.firstOrNull { isAbnormalExit(it) } ?: return null
        if (candidate.timestamp <= lastHandled) {
            return null
        }
        val (headerWithoutTrace, traceSection) = formatExitInfo(context, candidate)
        prefs.edit().putLong(PREF_KEY_LAST_TIMESTAMP, candidate.timestamp).apply()
        return PlatformCrashReport(
            headerWithoutTrace = headerWithoutTrace,
            traceSection = traceSection,
            reason = candidate.reason,
            timestamp = candidate.timestamp,
        )
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun isAbnormalExit(info: ApplicationExitInfo): Boolean =
        isActionableExit(info.reason, info.status)

    /**
     * Whether an exit record should produce a crash report. Signals are split
     * by cause: SIGABRT and friends mean the process terminated itself after
     * detecting a fatal condition (failed allocation, assertion, debugger
     * abort), while SIGKILL usually comes from outside the process and would
     * turn routine task-killer behavior into a false crash report.
     */
    internal fun isActionableExit(reason: Int, status: Int): Boolean = when (reason) {
        ApplicationExitInfo.REASON_CRASH,
        ApplicationExitInfo.REASON_CRASH_NATIVE,
        ApplicationExitInfo.REASON_ANR,
        ApplicationExitInfo.REASON_LOW_MEMORY,
        ApplicationExitInfo.REASON_DEPENDENCY_DIED,
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE,
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> true
        ApplicationExitInfo.REASON_SIGNALED -> status in FATAL_SIGNALS
        else -> false
    }

    internal fun signalName(signal: Int): String = when (signal) {
        SIGNAL_SIGABRT -> "SIGABRT"
        SIGNAL_SIGBUS -> "SIGBUS"
        SIGNAL_SIGFPE -> "SIGFPE"
        SIGNAL_SIGILL -> "SIGILL"
        SIGNAL_SIGSEGV -> "SIGSEGV"
        SIGNAL_SIGKILL -> "SIGKILL"
        SIGNAL_SIGTERM -> "SIGTERM"
        else -> "signal $signal"
    }

    /**
     * Every exit record the system still holds, abnormal or not. Exported with
     * diagnostics so an exit reason outside [isActionableExit] is still
     * visible instead of silently disappearing.
     */
    @RequiresApi(Build.VERSION_CODES.R)
    fun collectExitHistory(context: Context): String {
        val activityManager = context.getSystemService(ActivityManager::class.java)
            ?: return "exit-history: <ActivityManager unavailable>"
        val history = runCatching {
            activityManager.getHistoricalProcessExitReasons(context.packageName, 0, 0)
        }.getOrElse {
            return "exit-history: <unavailable: ${it.message ?: it.javaClass.simpleName}>"
        }
        if (history.isEmpty()) {
            return "exit-history: <empty>"
        }
        return buildString {
            append("exit-history: ").append(history.size).append(" records, newest first\n")
            history.forEachIndexed { index, info ->
                append('\n').append('[').append(index).append(']').append('\n')
                append(formatExitInfoHeader(info))
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun formatExitInfo(context: Context, info: ApplicationExitInfo): Pair<String, String> {
        return formatExitInfoHeader(info) to buildTraceSection(context, info)
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun formatExitInfoHeader(info: ApplicationExitInfo): String {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
        return buildString {
            append("when=").append(formatter.format(Date(info.timestamp))).append('\n')
            append("reason=").append(reasonName(info.reason))
                .append(" (").append(info.reason).append(")\n")
            append("description=").append(info.description?.ifBlank { "<none>" } ?: "<none>").append('\n')
            append("importance=").append(importanceName(info.importance))
                .append(" (").append(info.importance).append(")\n")
            append("status=").append(info.status)
            if (info.reason == ApplicationExitInfo.REASON_SIGNALED) {
                append(" (").append(signalName(info.status)).append(')')
            }
            append('\n')
            append("pss=").append(info.pss).append(" KB\n")
            append("rss=").append(info.rss).append(" KB\n")
            append("pid=").append(info.pid).append('\n')
            append("processName=").append(info.processName ?: "<unknown>").append('\n')
            append("device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
            append("android=").append(Build.VERSION.RELEASE)
                .append(" (sdk=").append(Build.VERSION.SDK_INT).append(")\n")
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun buildTraceSection(context: Context, info: ApplicationExitInfo): String {
        return when (info.reason) {
            ApplicationExitInfo.REASON_ANR -> {
                val trace = readTraceAsText(info)
                if (!trace.isNullOrBlank()) "trace (ANR):\n$trace"
                else "trace: <ANR trace was not retained by the system>"
            }
            ApplicationExitInfo.REASON_CRASH_NATIVE -> {
                val savedPath = persistNativeTombstone(context, info)
                if (savedPath != null) {
                    "trace (native tombstone): saved as protobuf to $savedPath — share this file with the developer; it is not human-readable as text."
                } else {
                    "trace: <native tombstone was not retained by the system (debuggerd circular buffer may have rotated it out)>"
                }
            }
            ApplicationExitInfo.REASON_SIGNALED -> {
                val savedPath = persistNativeTombstone(context, info)
                if (savedPath != null) {
                    "trace (native tombstone): saved as protobuf to $savedPath — share this file with the developer; it is not human-readable as text."
                } else {
                    "trace: <the system retained no tombstone for this signal; an aborting process usually leaves its reason in the logcat tail>"
                }
            }
            ApplicationExitInfo.REASON_CRASH -> {
                "trace: <no JVM stack was attached to this exit record; Luker's in-process handler should normally capture one — its absence here suggests the crash happened before the handler was installed>"
            }
            ApplicationExitInfo.REASON_LOW_MEMORY -> {
                "trace: <Android killed the process because the device was low on memory; no stack trace is produced for this reason>"
            }
            ApplicationExitInfo.REASON_DEPENDENCY_DIED -> {
                "trace: <a bound service dependency died; no stack trace is produced for this reason>"
            }
            ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> {
                "trace: <process was killed for excessive resource usage (CPU/wakelocks); no stack trace is produced for this reason>"
            }
            ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> {
                "trace: <runtime initialization failed; no stack trace is produced for this reason>"
            }
            else -> "trace: <no trace available for this exit reason>"
        }
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun readTraceAsText(info: ApplicationExitInfo): String? {
        return runCatching {
            info.traceInputStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        }.getOrNull()
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun persistNativeTombstone(context: Context, info: ApplicationExitInfo): String? {
        return runCatching {
            val input = info.traceInputStream ?: return@runCatching null
            val file = File(context.filesDir, NATIVE_TOMBSTONE_FILE_NAME)
            input.use { source ->
                FileOutputStream(file).use { sink ->
                    source.copyTo(sink)
                }
            }
            if (file.length() == 0L) {
                file.delete()
                null
            } else {
                file.absolutePath
            }
        }.getOrNull()
    }

    @RequiresApi(Build.VERSION_CODES.R)
    private fun reasonName(reason: Int): String = when (reason) {
        ApplicationExitInfo.REASON_UNKNOWN -> "UNKNOWN"
        ApplicationExitInfo.REASON_EXIT_SELF -> "EXIT_SELF"
        ApplicationExitInfo.REASON_SIGNALED -> "SIGNALED"
        ApplicationExitInfo.REASON_LOW_MEMORY -> "LOW_MEMORY"
        ApplicationExitInfo.REASON_CRASH -> "CRASH"
        ApplicationExitInfo.REASON_CRASH_NATIVE -> "CRASH_NATIVE"
        ApplicationExitInfo.REASON_ANR -> "ANR"
        ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "INITIALIZATION_FAILURE"
        ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "PERMISSION_CHANGE"
        ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "EXCESSIVE_RESOURCE_USAGE"
        ApplicationExitInfo.REASON_USER_REQUESTED -> "USER_REQUESTED"
        ApplicationExitInfo.REASON_USER_STOPPED -> "USER_STOPPED"
        ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "DEPENDENCY_DIED"
        ApplicationExitInfo.REASON_FREEZER -> "FREEZER"
        ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "PACKAGE_STATE_CHANGE"
        ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "PACKAGE_UPDATED"
        ApplicationExitInfo.REASON_OTHER -> "OTHER"
        else -> "REASON_$reason"
    }

    private fun importanceName(importance: Int): String = when (importance) {
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND -> "FOREGROUND"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE -> "FOREGROUND_SERVICE"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE -> "VISIBLE"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE -> "PERCEPTIBLE"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE -> "SERVICE"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED -> "CACHED"
        ActivityManager.RunningAppProcessInfo.IMPORTANCE_GONE -> "GONE"
        else -> "OTHER_$importance"
    }

    private fun persistReport(context: Context, fileName: String, report: String): File {
        val file = File(context.filesDir, fileName)
        file.writeText(report, Charsets.UTF_8)
        return file
    }

    private data class JvmCrashReport(val body: String, val timestamp: Long)

    private data class PlatformCrashReport(
        val headerWithoutTrace: String,
        val traceSection: String,
        val reason: Int,
        val timestamp: Long,
    )
}
