// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

/// Starts the embedded Node.js runtime on a background thread.
///
/// Mirrors android-app/app/src/main/cpp/native-lib.cpp: the first call spawns a
/// detached thread that runs node::Start, duplicate calls are skipped, and the
/// returned value is 0 on success and -1 when the thread could not be created.
/// node::Start blocks until the Node event loop exits, so the thread stays
/// alive for the whole server lifetime.
int luker_node_start(const char *const *argv, int argc);

/// Whether the Node event loop thread is still running.
bool luker_node_is_running(void);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
