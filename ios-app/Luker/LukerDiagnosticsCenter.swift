// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import Foundation

/// Owns the launch-time diagnostic setup so AppDelegate and the view
/// controller do not need to remember the ordering: read the previous run's
/// crash files before installing this run's handlers.
final class LukerDiagnosticsCenter {
    static let shared = LukerDiagnosticsCenter()

    private var pendingCrash: LukerCapturedCrash?

    private init() {}

    func start() {
        let runtime = LukerRuntimeManager.shared
        let root = runtime.diagnosticsRootURL
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        } catch {
            NSLog("[LukerDiagnostics] Failed to create the diagnostics directory: %@", String(describing: error))
        }
        LukerDebugTrail.shared.attach(directory: root)
        LukerDebugTrail.shared.append(
            category: "native",
            text: "launch app=\(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")"
        )
        pendingCrash = LukerCrashReporter.shared.collectPendingReport(in: root)
        if let pendingCrash {
            LukerDebugTrail.shared.append(category: "native", text: "previous crash report detected at \(pendingCrash.timestamp)")
        }
        LukerCrashReporter.shared.install(in: root)
    }

    func takePendingCrash() -> LukerCapturedCrash? {
        defer { pendingCrash = nil }
        return pendingCrash
    }

    func recordWebViewCrash(url: String?, didCrash: Bool) -> LukerCapturedCrash {
        LukerCrashReporter.shared.recordWebViewCrash(url: url, didCrash: didCrash)
    }

    func export() throws -> URL {
        try LukerDiagnosticsExporter.shared.export(runtime: LukerRuntimeManager.shared)
    }
}
