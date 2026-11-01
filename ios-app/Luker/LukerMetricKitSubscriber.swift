// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import Foundation
import MetricKit

/// Persists MetricKit crash payloads. This covers crashes the in-process
/// handlers cannot see (killed by the system, faults outside the app's signal
/// window, watchdog terminations) and includes Apple's symbolicated call
/// stack tree.
final class LukerMetricKitSubscriber: NSObject, MXMetricManagerSubscriber {
    static let shared = LukerMetricKitSubscriber()

    private static let archiveDirName = "crash-archive"

    private override init() {
        super.init()
    }

    func start() {
        MXMetricManager.shared.add(self)
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let root = LukerRuntimeManager.shared.diagnosticsRootURL
        let archive = root.appendingPathComponent(Self.archiveDirName, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: archive, withIntermediateDirectories: true)
        } catch {
            NSLog("[LukerMetricKit] Failed to create the crash archive: %@", String(describing: error))
            return
        }

        for payload in payloads {
            guard let crashes = payload.crashDiagnostics, !crashes.isEmpty else { continue }
            let stamp = Self.fileStamp.string(from: payload.timeStampEnd)
            let file = archive.appendingPathComponent("metrickit-crash-\(stamp)-\(UUID().uuidString.prefix(8)).json")
            do {
                try payload.jsonRepresentation().write(to: file, options: .atomic)
                LukerDebugTrail.shared.append(
                    category: "native",
                    text: "metrickit crash payload saved crashes=\(crashes.count) file=\(file.lastPathComponent)"
                )
            } catch {
                NSLog("[LukerMetricKit] Failed to save a crash payload: %@", String(describing: error))
                LukerDebugTrail.shared.append(
                    category: "native",
                    text: "metrickit crash payload write failed: \(error)"
                )
            }
        }
    }

    private static let fileStamp: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter
    }()
}
