// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.app.Application
import android.os.Build
import android.os.Process
import android.util.Log
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class LukerApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        installUncaughtExceptionHandler()
        enableWebViewDebugging()
        initDebugRecording()
        warmUpWebViewProvider()
    }

    private fun installUncaughtExceptionHandler() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                persistJvmCrashReport(thread, throwable)
            } catch (t: Throwable) {
                Log.w(TAG, "Failed to persist JVM crash report", t)
            }
            if (previous != null && previous !== Thread.getDefaultUncaughtExceptionHandler()) {
                previous.uncaughtException(thread, throwable)
            } else {
                Process.killProcess(Process.myPid())
                kotlin.system.exitProcess(10)
            }
        }
    }

    /**
     * Kicks off the WebView provider load (~1-2s on first launch, mostly spent
     * linking the Chromium renderer process) before MainActivity needs it.
     *
     * `startSafeBrowsing` is the AndroidX-recommended path: it asynchronously
     * loads and initializes the provider without instantiating a WebView, so
     * it (a) runs off the main thread, (b) is safe with an Application
     * Context (raw `WebView(applicationContext)` is unsupported and crashes
     * on several OEMs), and (c) needs no destroy timer. By the time the Node
     * server is ready and MainActivity creates its real WebView, the provider
     * is already warm.
     */
    private fun warmUpWebViewProvider() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            return
        }
        try {
            WebViewCompat.startSafeBrowsing(this) { /* result ignored */ }
        } catch (t: Throwable) {
            Log.w(TAG, "WebView warmup failed", t)
        }
    }

    private fun initDebugRecording() {
        runCatching {
            LukerDebugTrail.attach(filesDir)
            LukerDebugTrail.append(
                "native",
                "process onCreate pid=${android.os.Process.myPid()} uid=${android.os.Process.myUid()}",
            )
            val enabled = LukerAndroidDebugConfig.isEnabled(this)
            if (enabled) {
                LukerLogcatTail.setEnabled(this, true)
                armWebViewCdp()
            }
        }.onFailure {
            Log.w(TAG, "Debug recording init failed", it)
        }
    }

    /**
     * Idempotent. Turns on WebView remote debugging — a process-global,
     * unreversible Chromium switch. Called unconditionally on every cold
     * start so a user can attach tooling without a debug build; the switch
     * itself carries no runtime cost, it only makes the renderer's devtools
     * socket reachable to same-uid processes.
     *
     * Only renderers created *after* this call are covered; for the WebView
     * that is already loaded the app must restart.
     *
     * @return true when the switch is on.
     */
    fun enableWebViewDebugging(): Boolean {
        val armed = runCatching {
            WebView.setWebContentsDebuggingEnabled(true)
            true
        }.getOrElse { t ->
            LukerDebugTrail.append("native", "cdp-collector state=abort-webview-debug err=${t.message ?: t.javaClass.simpleName}")
            false
        }
        if (armed) {
            LukerDebugTrail.append("native", "cdp-collector state=arm debug-enabled=true")
        }
        return armed
    }

    /**
     * Idempotent. Starts the always-on CDP collector, which streams the
     * renderer's console/runtime events into a rotating ring on disk. Gated
     * by the "Android debug recording" pref — unlike the debug switch itself,
     * the collector writes continuously and must stay opt-in.
     */
    fun armWebViewCdp() {
        if (enableWebViewDebugging()) {
            LukerCdpCollector.start(this)
        }
    }

    private fun persistJvmCrashReport(thread: Thread, throwable: Throwable) {
        val formatter = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)
        val now = System.currentTimeMillis()
        val stack = StringWriter().also { sw ->
            PrintWriter(sw).use { throwable.printStackTrace(it) }
        }.toString()
        val report = buildString {
            append("when=").append(formatter.format(Date(now))).append('\n')
            append("timestamp=").append(now).append('\n')
            append("thread=").append(thread.name).append(" (id=").append(thread.id).append(")\n")
            append("device=").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
            append("android=").append(Build.VERSION.RELEASE)
                .append(" (sdk=").append(Build.VERSION.SDK_INT).append(")\n")
            append("\nstack:\n").append(stack)
        }
        val file = File(filesDir, JVM_CRASH_FILE_NAME)
        file.writeText(report, Charsets.UTF_8)
    }

    companion object {
        private const val TAG = "LukerApplication"
        const val JVM_CRASH_FILE_NAME = "luker-last-jvm-crash.txt"
    }
}
