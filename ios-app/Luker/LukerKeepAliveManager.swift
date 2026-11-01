// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import BackgroundTasks
import UIKit

/// Generation-scoped background lease.
///
/// The frontend calls `LukerIOS.setGenerationActive(true)` when a generation
/// starts and `false` when the last in-flight generation ends. The lease is
/// strictly best effort: iOS may expire it at any time, and the shell does not
/// try to compensate for that.
///
/// iOS 26+ uses `BGContinuedProcessingTask`; older systems use
/// `beginBackgroundTask`. Both paths are independent of notification
/// permission.
final class LukerKeepAliveManager {
    static let shared = LukerKeepAliveManager()

    static let continuedTaskIdentifierBase = "com.luker.app.continuedProcessingTask"

    /// Chained generations (tool loops, multi-agent rounds) can land back to
    /// back. Wait out a short gap before releasing the lease so the next
    /// `true` can renew it instead of tearing it down.
    private static let completionGrace: TimeInterval = 3

    private var generationActive = false
    private var completionWorkItem: DispatchWorkItem?

    private var legacyBackgroundTask: UIBackgroundTaskIdentifier = .invalid

    private var continuedTask: Any?
    private var continuedTaskIdentifier: String?

    private init() {}

    func setGenerationActive(_ active: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.applyGenerationActive(active)
        }
    }

    private func applyGenerationActive(_ active: Bool) {
        generationActive = active
        if active {
            cancelScheduledCompletion()
            if #available(iOS 26.0, *) {
                if continuedTask == nil {
                    submitContinuedTask()
                } else if let task = continuedTask as? BGContinuedProcessingTask {
                    task.progress.completedUnitCount = 0
                    task.updateTitle(
                        NSLocalizedString("keepalive_task_title", comment: ""),
                        subtitle: NSLocalizedString("keepalive_task_subtitle", comment: "")
                    )
                }
            } else {
                beginLegacyBackgroundTask()
            }
        } else {
            scheduleCompletion()
        }
    }

    // MARK: - iOS 26 continued processing

    @available(iOS 26.0, *)
    private func submitContinuedTask() {
        let identifier = "\(Self.continuedTaskIdentifierBase).\(UUID().uuidString)"
        let request = BGContinuedProcessingTaskRequest(
            identifier: identifier,
            title: NSLocalizedString("keepalive_task_title", comment: ""),
            subtitle: NSLocalizedString("keepalive_task_subtitle", comment: "")
        )
        request.strategy = .queue

        let registered = BGTaskScheduler.shared.register(
            forTaskWithIdentifier: identifier,
            using: nil
        ) { [weak self] task in
            guard let continued = task as? BGContinuedProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            DispatchQueue.main.async {
                self?.adoptContinuedTask(continued, identifier: identifier)
            }
        }

        guard registered else {
            NSLog("[LukerKeepAlive] Continued task identifier was rejected by the scheduler")
            LukerDebugTrail.shared.append(category: "native", text: "continuedTask register failed identifier=\(identifier)")
            beginLegacyBackgroundTask()
            return
        }

        do {
            try BGTaskScheduler.shared.submit(request)
            continuedTaskIdentifier = identifier
            LukerDebugTrail.shared.append(category: "native", text: "continuedTask submitted \(identifier)")
        } catch {
            NSLog("[LukerKeepAlive] Failed to submit continued task: %@", String(describing: error))
            LukerDebugTrail.shared.append(category: "native", text: "continuedTask submit failed: \(error)")
            beginLegacyBackgroundTask()
        }
    }

    @available(iOS 26.0, *)
    private func adoptContinuedTask(_ task: BGContinuedProcessingTask, identifier: String) {
        continuedTask = task
        continuedTaskIdentifier = identifier
        task.progress.totalUnitCount = 1
        task.progress.completedUnitCount = 0
        task.expirationHandler = { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                self.continuedTask = nil
                self.continuedTaskIdentifier = nil
                self.endLegacyBackgroundTask()
                LukerDebugTrail.shared.append(category: "native", text: "continuedTask expired \(identifier)")
            }
        }

        if generationActive {
            task.updateTitle(
                NSLocalizedString("keepalive_task_title", comment: ""),
                subtitle: NSLocalizedString("keepalive_task_subtitle", comment: "")
            )
        } else {
            completeContinuedTask(success: true)
        }
    }

    @available(iOS 26.0, *)
    private func completeContinuedTask(success: Bool) {
        guard let task = continuedTask as? BGContinuedProcessingTask else { return }
        continuedTask = nil
        continuedTaskIdentifier = nil
        task.setTaskCompleted(success: success)
    }

    // MARK: - iOS 16-25

    private func beginLegacyBackgroundTask() {
        guard legacyBackgroundTask == .invalid else { return }
        legacyBackgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Luker generation") { [weak self] in
            DispatchQueue.main.async {
                guard let self else { return }
                self.endLegacyBackgroundTask()
                LukerDebugTrail.shared.append(category: "native", text: "legacy background task expired")
            }
        }
        LukerDebugTrail.shared.append(category: "native", text: "legacy background task started")
    }

    private func endLegacyBackgroundTask() {
        guard legacyBackgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(legacyBackgroundTask)
        legacyBackgroundTask = .invalid
        LukerDebugTrail.shared.append(category: "native", text: "legacy background task ended")
    }

    // MARK: - Completion

    private func scheduleCompletion() {
        cancelScheduledCompletion()
        guard hasActiveLease() else { return }
        let item = DispatchWorkItem { [weak self] in
            self?.completeNow()
        }
        completionWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.completionGrace, execute: item)
    }

    private func cancelScheduledCompletion() {
        completionWorkItem?.cancel()
        completionWorkItem = nil
    }

    private func completeNow() {
        completionWorkItem = nil
        if #available(iOS 26.0, *) {
            completeContinuedTask(success: true)
        }
        endLegacyBackgroundTask()
        LukerDebugTrail.shared.append(category: "native", text: "generation lease released")
    }

    private func hasActiveLease() -> Bool {
        if legacyBackgroundTask != .invalid {
            return true
        }
        if #available(iOS 26.0, *) {
            return continuedTask != nil
        }
        return false
    }
}
