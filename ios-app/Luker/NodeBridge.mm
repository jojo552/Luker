// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

#import "NodeBridge.h"

#include <atomic>
#include <exception>
#include <string>
#include <thread>
#include <vector>

#include "node.h"

static std::atomic<bool> g_node_running(false);

extern "C" int luker_node_start(const char *const *argv, int argc) {
    if (g_node_running.exchange(true)) {
        return 0;
    }

    std::vector<std::string> args(argc);
    for (int i = 0; i < argc; i++) {
        args[i] = argv[i];
    }

    try {
        std::thread([args = std::move(args)]() mutable {
            std::vector<char *> node_argv(args.size());
            for (size_t i = 0; i < args.size(); i++) {
                node_argv[i] = const_cast<char *>(args[i].c_str());
            }
            int rc = node::Start(static_cast<int>(node_argv.size()), node_argv.data());
            NSLog(@"[LukerNative] Node runtime exited with code=%d", rc);
            g_node_running.store(false);
        }).detach();
    } catch (const std::exception &e) {
        NSLog(@"[LukerNative] Failed to create Node thread: %s", e.what());
        g_node_running.store(false);
        return -1;
    } catch (...) {
        NSLog(@"[LukerNative] Failed to create Node thread: unknown error");
        g_node_running.store(false);
        return -1;
    }

    return 0;
}

extern "C" bool luker_node_is_running(void) {
    return g_node_running.load();
}
