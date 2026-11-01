// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import androidx.annotation.VisibleForTesting
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.atomic.AtomicLong

/**
 * Process-wide debug trail with two sinks: an in-memory ring buffer for the
 * live process, and an append-only file that survives process death.
 *
 * Holds the last 2048 lines (~128 KB typical, ~2 MB worst case). All four
 * frontend signal sources (webconsole, webheap, render, webcrash) and native
 * markers (onRenderProcessGone, process boot, logcat-tail give-up) write
 * here; crash report assembly and the diagnostics-zip exporter read via
 * dumpAll() or [readPersisted].
 *
 * The file sink matters for crashes: a process killed by a signal never runs
 * cleanup, so the memory ring of the *next* process starts empty. The file
 * keeps the tail of the run that died, capped at [FILE_CAP_BYTES] with one
 * rotated generation.
 *
 * Writes are sub-microsecond: a single synchronized slot assignment plus
 * AtomicLong increment. Persistence failures are swallowed — never let the
 * trail break the calling site.
 */
object LukerDebugTrail {
    private const val CAPACITY = 2048
    private const val MAX_LINE_CHARS = 1024
    private const val TRUNCATION_SUFFIX = "…[truncated]"
    private const val FILE_NAME = "debug-trail.log"
    private const val ROTATED_FILE_NAME = "debug-trail.old.log"
    private const val FILE_CAP_BYTES = 1024 * 1024L

    private val buffer = arrayOfNulls<String>(CAPACITY)
    private val writeIndex = AtomicLong(0L)
    private val lock = Any()

    private val fileLock = Any()
    private var trailFile: File? = null
    private var rotatedFile: File? = null
    private var stream: FileOutputStream? = null
    private var fileBytes = 0L

    /**
     * Points the file sink at [dir]. Idempotent; called once from
     * Application.onCreate. Without it the trail stays memory-only.
     */
    fun attach(dir: File) {
        synchronized(fileLock) {
            closeStreamLocked()
            trailFile = File(dir, FILE_NAME)
            rotatedFile = File(dir, ROTATED_FILE_NAME)
            fileBytes = trailFile?.length() ?: 0L
            stream = null
        }
    }

    fun append(category: String, text: String) {
        val line = try {
            val timestamp = System.currentTimeMillis()
            val safeCategory = category.ifBlank { "uncategorized" }
            buildLine(timestamp, safeCategory, text)
        } catch (_: Throwable) {
            return
        }
        try {
            synchronized(lock) {
                val index = writeIndex.getAndIncrement()
                buffer[(index % CAPACITY).toInt()] = line
            }
        } catch (_: Throwable) {
            return
        }
        persist(line)
    }

    fun dumpAll(): String {
        val sb = StringBuilder()
        synchronized(lock) {
            val total = writeIndex.get()
            if (total <= 0L) {
                return ""
            }
            val start = maxOf(0L, total - CAPACITY)
            var i = start
            while (i < total) {
                val line = buffer[(i % CAPACITY).toInt()]
                if (line != null) {
                    sb.append(line).append('\n')
                }
                i++
            }
        }
        return sb.toString()
    }

    /**
     * Contents of the on-disk trail, including the run that preceded this
     * process. Empty when [attach] was never called or nothing was written.
     */
    fun readPersisted(): String {
        val file = synchronized(fileLock) { trailFile } ?: return ""
        return runCatching { file.readText(Charsets.UTF_8) }.getOrDefault("")
    }

    fun rotatedTrailFile(): File? = synchronized(fileLock) { rotatedFile }?.takeIf { it.isFile }

    private fun persist(line: String) {
        synchronized(fileLock) {
            val file = trailFile ?: return
            try {
                val bytes = (line + "\n").toByteArray(Charsets.UTF_8)
                if (fileBytes + bytes.size > FILE_CAP_BYTES) {
                    rotateLocked(file)
                }
                val out = stream ?: FileOutputStream(file, true).also {
                    fileBytes = file.length()
                    stream = it
                }
                out.write(bytes)
                fileBytes += bytes.size
            } catch (_: Throwable) {
                closeStreamLocked()
            }
        }
    }

    private fun rotateLocked(file: File) {
        closeStreamLocked()
        val target = rotatedFile
        val renamed = if (target != null) {
            if (target.isFile) target.delete()
            file.renameTo(target)
        } else {
            false
        }
        fileBytes = if (renamed) 0L else file.length()
        stream = try {
            FileOutputStream(file, true)
        } catch (_: Throwable) {
            null
        }
    }

    private fun closeStreamLocked() {
        runCatching { stream?.close() }
        stream = null
    }

    private fun buildLine(timestamp: Long, category: String, text: String): String {
        val rawBody = "$timestamp $category $text"
        return if (rawBody.length <= MAX_LINE_CHARS) {
            rawBody
        } else {
            val keep = MAX_LINE_CHARS - TRUNCATION_SUFFIX.length
            rawBody.substring(0, keep) + TRUNCATION_SUFFIX
        }
    }

    @VisibleForTesting
    internal fun resetForTest() {
        synchronized(lock) {
            for (i in 0 until CAPACITY) {
                buffer[i] = null
            }
            writeIndex.set(0L)
        }
        synchronized(fileLock) {
            closeStreamLocked()
            trailFile = null
            rotatedFile = null
            fileBytes = 0L
        }
    }
}
