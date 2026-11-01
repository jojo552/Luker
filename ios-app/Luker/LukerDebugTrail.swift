// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

import Foundation

/// Process-wide debug trail with two sinks: an in-memory ring buffer for the
/// live process, and an append-only file that survives process death.
///
/// Mirrors android-app/app/src/main/java/com/luker/app/LukerDebugTrail.kt.
/// The file sink matters more on iOS than on Android: a crash never runs
/// cleanup, so the next launch's ring starts empty while the file still holds
/// the tail of the run that died.
final class LukerDebugTrail {
    static let shared = LukerDebugTrail()

    static let fileName = "debug-trail.log"
    static let rotatedFileName = "debug-trail.old.log"

    private static let capacity = 2048
    private static let maxLineCharacters = 1024
    private static let truncationSuffix = "…[truncated]"
    private static let fileCapBytes: UInt64 = 1024 * 1024

    private let lock = NSLock()
    private var buffer = [String?](repeating: nil, count: LukerDebugTrail.capacity)
    private var writeIndex = 0

    private var directory: URL?
    private var handle: FileHandle?
    private var fileBytes: UInt64 = 0

    private init() {}

    /// Points the file sink at `directory`. Idempotent; called once at launch.
    func attach(directory: URL) {
        lock.lock()
        defer { lock.unlock() }
        closeHandleLocked()
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = directory.appendingPathComponent(Self.fileName)
        fileBytes = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.uint64Value ?? 0
    }

    func append(category: String, text: String) {
        let line = Self.buildLine(category: category, text: text)
        lock.lock()
        defer { lock.unlock() }
        buffer[writeIndex % Self.capacity] = line
        writeIndex += 1
        persistLocked(line)
    }

    func dumpAll() -> String {
        lock.lock()
        defer { lock.unlock() }
        guard writeIndex > 0 else { return "" }
        let start = max(0, writeIndex - Self.capacity)
        var lines: [String] = []
        lines.reserveCapacity(writeIndex - start)
        for index in start..<writeIndex {
            if let line = buffer[index % Self.capacity] {
                lines.append(line)
            }
        }
        return lines.joined(separator: "\n") + "\n"
    }

    func readPersisted() -> String {
        guard let directory else { return "" }
        let file = directory.appendingPathComponent(Self.fileName)
        return (try? String(contentsOf: file, encoding: .utf8)) ?? ""
    }

    func rotatedFileURL() -> URL? {
        guard let directory else { return nil }
        let file = directory.appendingPathComponent(Self.rotatedFileName)
        return FileManager.default.fileExists(atPath: file.path) ? file : nil
    }

    // MARK: - Persistence

    private func persistLocked(_ line: String) {
        guard let directory else { return }
        guard let data = (line + "\n").data(using: .utf8) else { return }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if fileBytes + UInt64(data.count) > Self.fileCapBytes {
                rotateLocked(directory: directory)
            }
            if handle == nil {
                let file = directory.appendingPathComponent(Self.fileName)
                if !FileManager.default.fileExists(atPath: file.path) {
                    FileManager.default.createFile(atPath: file.path, contents: nil)
                }
                let newHandle = try FileHandle(forWritingTo: file)
                try newHandle.seekToEnd()
                handle = newHandle
                fileBytes = ((try? FileManager.default.attributesOfItem(atPath: file.path))?[.size] as? NSNumber)?.uint64Value ?? 0
            }
            try handle?.write(contentsOf: data)
            fileBytes += UInt64(data.count)
        } catch {
            NSLog("[LukerDebugTrail] Failed to persist a line: %@", String(describing: error))
            closeHandleLocked()
        }
    }

    private func rotateLocked(directory: URL) {
        closeHandleLocked()
        let file = directory.appendingPathComponent(Self.fileName)
        let rotated = directory.appendingPathComponent(Self.rotatedFileName)
        do {
            if FileManager.default.fileExists(atPath: rotated.path) {
                try FileManager.default.removeItem(at: rotated)
            }
            if FileManager.default.fileExists(atPath: file.path) {
                try FileManager.default.moveItem(at: file, to: rotated)
            }
        } catch {
            NSLog("[LukerDebugTrail] Failed to rotate the trail: %@", String(describing: error))
            try? FileManager.default.removeItem(at: file)
        }
        fileBytes = 0
    }

    private func closeHandleLocked() {
        try? handle?.close()
        handle = nil
    }

    private static func buildLine(category: String, text: String) -> String {
        let safeCategory = category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "uncategorized"
            : category
        let timestamp = Int(Date().timeIntervalSince1970 * 1000)
        let raw = "\(timestamp) \(safeCategory) \(text)"
        guard raw.count > maxLineCharacters else { return raw }
        let keep = maxLineCharacters - truncationSuffix.count
        return String(raw.prefix(keep)) + truncationSuffix
    }
}
