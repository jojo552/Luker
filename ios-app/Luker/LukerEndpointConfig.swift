// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import Foundation

enum LukerEndpointError: LocalizedError {
    case invalidURL

    var errorDescription: String? {
        NSLocalizedString("endpoint_invalid_url", comment: "")
    }
}

struct LukerEndpointSelection {
    let customBaseURL: URL?

    var usesLocalRuntime: Bool {
        customBaseURL == nil
    }

    var baseURL: URL {
        customBaseURL ?? LukerRuntimeManager.shared.localServerURL
    }
}

/// Persisted endpoint switch. No visible entry ships in this build; the model,
/// validation, bridge methods and `luker://endpoint` deep link are in place so
/// an in-app switch can be added without changing the storage or the runtime
/// boot flow again.
final class LukerEndpointConfig {
    static let shared = LukerEndpointConfig()

    private static let storageKey = "luker_custom_base_url"

    private let defaults: UserDefaults
    private let reportLock = NSLock()
    private var reportedInvalidStoredValue = false

    private init() {
        defaults = .standard
    }

    var selection: LukerEndpointSelection {
        guard let raw = defaults.string(forKey: Self.storageKey) else {
            return LukerEndpointSelection(customBaseURL: nil)
        }
        guard let url = normalize(raw) else {
            reportLock.lock()
            let shouldReport = !reportedInvalidStoredValue
            reportedInvalidStoredValue = true
            reportLock.unlock()
            if shouldReport {
                NSLog("[LukerEndpoint] Stored endpoint is invalid; using the local runtime: %@", raw)
                LukerDebugTrail.shared.append(
                    category: "native",
                    text: "stored endpoint is invalid; using the local runtime: \(raw)"
                )
            }
            return LukerEndpointSelection(customBaseURL: nil)
        }
        return LukerEndpointSelection(customBaseURL: url)
    }

    /// Accepts an absolute http(s) origin with an optional port. Rejects
    /// paths, queries, fragments, userinfo and whitespace, mirroring
    /// `normalizeCustomBaseUrl` in the HarmonyOS shell.
    func normalize(_ raw: String?) -> URL? {
        guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        guard !trimmed.contains("\\"), trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            return nil
        }
        guard let components = URLComponents(string: trimmed) else { return nil }
        guard let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return nil
        }
        guard let host = components.host, !host.isEmpty else { return nil }
        guard host.contains(where: { $0 != "." && $0 != "-" }) else { return nil }
        guard components.user == nil, components.password == nil else { return nil }
        guard components.query == nil, components.fragment == nil else { return nil }
        guard components.path.isEmpty || components.path == "/" else { return nil }
        if let port = components.port, !(1...65535).contains(port) {
            return nil
        }
        var normalized = components
        normalized.path = ""
        guard let url = normalized.url else { return nil }
        var value = url.absoluteString
        while value.hasSuffix("/") {
            value.removeLast()
        }
        return URL(string: value)
    }

    func save(_ raw: String?) throws -> URL? {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            reset()
            return nil
        }
        guard let url = normalize(trimmed) else {
            throw LukerEndpointError.invalidURL
        }
        defaults.set(url.absoluteString, forKey: Self.storageKey)
        return url
    }

    func reset() {
        defaults.removeObject(forKey: Self.storageKey)
    }
}

/// Routes the reserved `luker://` deep links. `luker://endpoint` opens the
/// endpoint editor; the editor itself is not linked from any visible surface.
final class LukerDeepLinkRouter {
    static let shared = LukerDeepLinkRouter()
    static let openEndpointSettings = Notification.Name("LukerOpenEndpointSettings")

    private(set) var pendingEndpointSettings = false

    private init() {}

    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "luker" else { return false }
        switch url.host?.lowercased() {
        case "endpoint":
            pendingEndpointSettings = true
            NotificationCenter.default.post(name: Self.openEndpointSettings, object: nil)
            return true
        default:
            return false
        }
    }

    func consumePendingEndpointSettings() -> Bool {
        defer { pendingEndpointSettings = false }
        return pendingEndpointSettings
    }
}
