// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

#if DEBUG
import Darwin
import Foundation
import UniformTypeIdentifiers
import WebKit

/// Debug-only simulator checks. Launch with the `LUKER_IOS_SMOKE=1`
/// environment variable to write bridge and keep-alive observations into the
/// same debug trail shipped by the diagnostics bundle. `LUKER_IOS_CRASH_TEST=1`
/// raises SIGABRT after the page loads so the crash handler and the
/// previous-crash dialog can be exercised without a debugger.
enum LukerDebugSmoke {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.environment["LUKER_IOS_SMOKE"] == "1"
    }

    static var crashTestEnabled: Bool {
        ProcessInfo.processInfo.environment["LUKER_IOS_CRASH_TEST"] == "1"
    }

    static var earlyCrashTestEnabled: Bool {
        ProcessInfo.processInfo.environment["LUKER_IOS_CRASH_TEST_EARLY"] == "1"
    }

    static var exceptionTestEnabled: Bool {
        ProcessInfo.processInfo.environment["LUKER_IOS_EXCEPTION_TEST"] == "1"
    }

    static var notificationTestEnabled: Bool {
        ProcessInfo.processInfo.environment["LUKER_IOS_SMOKE_NOTIFICATIONS"] == "1"
    }

    private static var hasRun = false
    private static var hasCrashed = false

    static func runEarlyCrashTestIfRequested() {
        guard earlyCrashTestEnabled else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            LukerDebugTrail.shared.append(category: "smoke", text: "raising early SIGABRT")
            raise(SIGABRT)
        }
    }

    static func runExceptionTestIfRequested() {
        guard exceptionTestEnabled, !hasCrashed else { return }
        hasCrashed = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            LukerDebugTrail.shared.append(category: "smoke", text: "raising NSException")
            NSException(
                name: NSExceptionName("LukerSmokeException"),
                reason: "debug-only crash handler probe",
                userInfo: nil
            ).raise()
        }
    }

    static func runCrashTestIfRequested() {
        guard crashTestEnabled, !hasCrashed else { return }
        hasCrashed = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            LukerDebugTrail.shared.append(category: "smoke", text: "raising SIGABRT")
            raise(SIGABRT)
        }
    }

    static func runIfRequested(webView: WKWebView) {
        guard isEnabled, !hasRun else { return }
        hasRun = true
        LukerDebugTrail.shared.append(category: "smoke", text: "starting bridge checks")

        let extensions = ["charx", "byaf", "lorebook", "settings", "preset", "jsonl", "yaml"]
        let resolved = extensions.map { "\($0)=\(UTType(filenameExtension: $0)?.identifier ?? "nil")" }
        LukerDebugTrail.shared.append(category: "smoke", text: "uti \(resolved.joined(separator: ", "))")

        let script = """
        (function() {
            return {
                bridge: !!window.LukerIOS,
                setGenerationActive: !!(window.LukerIOS && window.LukerIOS.setGenerationActive),
                notifyMessageFinished: !!(window.LukerIOS && window.LukerIOS.notifyMessageFinished),
                requestNotificationPermission: !!(window.LukerIOS && window.LukerIOS.requestNotificationPermission),
                consoleHook: !!window.__lukerConsoleInstalled,
            };
        })();
        """
        webView.evaluateJavaScript(script) { result, error in
            if let error {
                LukerDebugTrail.shared.append(category: "smoke", text: "bridge probe failed: \(error)")
                return
            }
            LukerDebugTrail.shared.append(category: "smoke", text: "bridge probe \(result ?? [:])")
        }

        webView.callAsyncJavaScript(
            "return await window.LukerIOS.getEndpoint();",
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case .success(let value):
                LukerDebugTrail.shared.append(category: "smoke", text: "getEndpoint \(value)")
            case .failure(let error):
                LukerDebugTrail.shared.append(category: "smoke", text: "getEndpoint failed: \(error)")
            }
        }

        webView.callAsyncJavaScript(
            """
            const mod = await import('/scripts/luker-keep-alive.js');
            const platform = mod.initKeepAlive();
            return {
                platform,
                supported: mod.isKeepAliveSupported(),
                nativeBridge: mod.hasNativeKeepAliveBridge(),
            };
            """,
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case .success(let value):
                LukerDebugTrail.shared.append(category: "smoke", text: "keepAliveModule \(value)")
            case .failure(let error):
                LukerDebugTrail.shared.append(category: "smoke", text: "keepAliveModule failed: \(error)")
            }
        }

        webView.callAsyncJavaScript(
            """
            const results = [];
            for (const value of ['ftp://example.com', 'http://example.com/path', 'https://example.com:8443/', '']) {
                results.push(await window.LukerIOS.setEndpoint(value));
            }
            return results;
            """,
            arguments: [:],
            in: nil,
            in: .page
        ) { result in
            switch result {
            case .success(let value):
                LukerDebugTrail.shared.append(category: "smoke", text: "setEndpoint sequence \(value)")
            case .failure(let error):
                LukerDebugTrail.shared.append(category: "smoke", text: "setEndpoint sequence failed: \(error)")
            }
        }

        webView.evaluateJavaScript("window.LukerIOS.pushDebugTrail('smoke', 'bridge push works'); 'pushed'") { _, error in
            LukerDebugTrail.shared.append(
                category: "smoke",
                text: "pushDebugTrail \(error.map { "error=\($0)" } ?? "ok")"
            )
        }

        webView.evaluateJavaScript("window.LukerIOS.notifyMessageFinished('Luker', 'smoke test'); 'notified'") { _, error in
            LukerDebugTrail.shared.append(
                category: "smoke",
                text: "notifyMessageFinished \(error.map { "error=\($0)" } ?? "ok")"
            )
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            webView.evaluateJavaScript("window.LukerIOS.exportDiagnosticsBundle(); 'exported'") { _, error in
                LukerDebugTrail.shared.append(
                    category: "smoke",
                    text: "exportDiagnosticsBundle \(error.map { "error=\($0)" } ?? "ok")"
                )
            }
        }

        if notificationTestEnabled {
            webView.callAsyncJavaScript(
                "return await window.LukerIOS.requestNotificationPermission();",
                arguments: [:],
                in: nil,
                in: .page
            ) { result in
                switch result {
                case .success(let value):
                    LukerDebugTrail.shared.append(category: "smoke", text: "requestNotificationPermission \(value)")
                case .failure(let error):
                    LukerDebugTrail.shared.append(category: "smoke", text: "requestNotificationPermission failed: \(error)")
                }
            }
        }

        webView.evaluateJavaScript("window.LukerIOS.setGenerationActive(true); 'started'") { _, error in
            LukerDebugTrail.shared.append(
                category: "smoke",
                text: "setGenerationActive(true) \(error.map { "error=\($0)" } ?? "ok")"
            )
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            webView.evaluateJavaScript("window.LukerIOS.setGenerationActive(false); 'stopped'") { _, error in
                LukerDebugTrail.shared.append(
                    category: "smoke",
                    text: "setGenerationActive(false) \(error.map { "error=\($0)" } ?? "ok")"
                )
            }
        }
    }
}
#endif
