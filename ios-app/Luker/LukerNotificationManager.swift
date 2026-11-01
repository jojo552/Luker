// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import UIKit
import UserNotifications

/// Completion-only local notifications.
///
/// The iOS shell has no APNs and no persistent notification, so this class
/// only ever posts a one-shot "reply ready" notification. Notification
/// permission is requested when the user turns on the matching setting; if it
/// is denied, every send is a silent no-op.
final class LukerNotificationManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = LukerNotificationManager()

    private let center = UNUserNotificationCenter.current()
    private let statusLock = NSLock()
    private var statusValue = "unknown"

    var cachedAuthorizationStatus: String {
        statusLock.lock()
        defer { statusLock.unlock() }
        return statusValue
    }

    private override init() {
        super.init()
    }

    func configure() {
        center.delegate = self
        refreshAuthorizationStatus()
    }

    func refreshAuthorizationStatus() {
        center.getNotificationSettings { [weak self] settings in
            self?.storeAuthorizationStatus(settings.authorizationStatus)
        }
    }

    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        center.getNotificationSettings { [weak self] settings in
            guard let self else {
                DispatchQueue.main.async { completion(false) }
                return
            }
            self.storeAuthorizationStatus(settings.authorizationStatus)
            switch settings.authorizationStatus {
            case .notDetermined:
                self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                    if let error {
                        NSLog("[LukerNotification] Authorization request failed: %@", String(describing: error))
                    }
                    self.refreshAuthorizationStatus()
                    DispatchQueue.main.async { completion(granted) }
                }
            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async { completion(true) }
            case .denied:
                DispatchQueue.main.async { completion(false) }
            @unknown default:
                DispatchQueue.main.async { completion(false) }
            }
        }
    }

    /// Posts a completion notification. The page already suppresses the call
    /// while its document is visible; the native app-state check is a second
    /// guard so a foreground app never shows a duplicate banner.
    func notifyReplyReady(title: String, body: String) {
        guard UIApplication.shared.applicationState != .active else {
            LukerDebugTrail.shared.append(category: "native", text: "notification skipped: app active")
            return
        }
        center.getNotificationSettings { [weak self] settings in
            guard let self else { return }
            self.storeAuthorizationStatus(settings.authorizationStatus)
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                break
            default:
                LukerDebugTrail.shared.append(
                    category: "native",
                    text: "notification skipped: authorization=\(self.cachedAuthorizationStatus)"
                )
                return
            }
            let content = UNMutableNotificationContent()
            content.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Luker" : title
            content.body = body
            content.sound = .default
            let request = UNNotificationRequest(
                identifier: "luker-reply-\(UUID().uuidString)",
                content: content,
                trigger: nil
            )
            self.center.add(request) { error in
                if let error {
                    NSLog("[LukerNotification] Failed to post a notification: %@", String(describing: error))
                    LukerDebugTrail.shared.append(category: "native", text: "notification failed: \(error)")
                } else {
                    LukerDebugTrail.shared.append(category: "native", text: "notification posted")
                }
            }
        }
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    private func storeAuthorizationStatus(_ status: UNAuthorizationStatus) {
        statusLock.lock()
        statusValue = Self.name(for: status)
        statusLock.unlock()
    }

    private static func name(for status: UNAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "unknown(\(status.rawValue))"
        }
    }
}
