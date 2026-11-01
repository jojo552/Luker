// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

import android.net.LocalSocket
import android.net.LocalSocketAddress
import java.io.IOException

/**
 * One per detected renderer pid. Talks HTTP GET /json/list over
 * @webview_devtools_remote_<pid>, filters for a target whose URL starts with
 * http://127.0.0.1: (our local server), opens a WebSocket to its
 * webSocketDebuggerUrl, subscribes to Log/Runtime/Inspector, and forwards
 * every incoming CDP message string to the collector's writer queue.
 *
 * On any IOException the thread exits and the collector removes itself
 * from the clients map; DiscoveryThread will not re-spawn if the pid is
 * in failedPids with count >= 3.
 */
class LukerCdpClient(
    val pid: Int,
    private val collector: LukerCdpCollector,
) : Thread("luker-cdp-client-$pid") {

    @Volatile var stopping = false
    @Volatile private var socket: LocalSocket? = null

    init { isDaemon = true }

    fun requestStop() {
        stopping = true
        runCatching { socket?.close() }
    }

    override fun run() {
        try {
            val target = LukerCdpTarget.fetchTarget(pid)
            if (target == null) {
                // The devtools socket exists as soon as the renderer starts,
                // but it has no page target until the server URL loads — tens
                // of seconds after a cold start. Counting these probes as
                // failures blacklisted the pid for the rest of the process,
                // so no console events were ever recorded.
                LukerDebugTrail.append("native", "cdp-collector state=no-target pid=$pid")
                return
            }
            val wsPath = LukerCdpTarget.extractPath(target.optString("webSocketDebuggerUrl", ""))
            if (wsPath.isEmpty()) {
                LukerDebugTrail.append("native", "cdp-collector state=no-ws-path pid=$pid")
                collector.markFailedPid(pid)
                return
            }
            runWebSocket(wsPath)
        } catch (e: IOException) {
            LukerDebugTrail.append("native", "cdp-collector state=client-io pid=$pid err=${e.message ?: "io"}")
            collector.markFailedPid(pid)
        } catch (t: Throwable) {
            LukerDebugTrail.append("native", "cdp-collector state=client-err pid=$pid err=${t.message ?: t.javaClass.simpleName}")
            collector.markFailedPid(pid)
        } finally {
            collector.removeClient(pid)
        }
    }

    private fun runWebSocket(wsPath: String) {
        val sock = LocalSocket()
        sock.connect(LocalSocketAddress(LukerCdpTarget.socketName(pid), LocalSocketAddress.Namespace.ABSTRACT))
        socket = sock
        try {
            val ws = LukerWebSocketClient(sock.inputStream, sock.outputStream)
            ws.handshake(wsPath)
            collector.markHealthyPid(pid)
            LukerDebugTrail.append("native", "cdp-collector state=bind pid=$pid")
            ws.sendText("""{"id":1,"method":"Log.enable"}""")
            ws.sendText("""{"id":2,"method":"Runtime.enable"}""")
            ws.sendText("""{"id":3,"method":"Inspector.enable"}""")
            while (!stopping) {
                val msg = ws.readMessage()
                val entry = LukerCdpWriter.Entry(pid, System.currentTimeMillis(), msg)
                collector.enqueueEvent(entry)
            }
        } finally {
            socket = null
            runCatching { sock.close() }
        }
    }
}
