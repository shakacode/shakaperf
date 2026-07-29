/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * The `annotate(label)` function an engine hands to a user test body. shaka-shared
 * only defines the CONTRACT (this type) - the engines that run the tests own the
 * implementation (recording the label, surfacing it on errors); see
 * `packages/shaka-perf/src/test-annotation/`.
 */
export type TestAnnotate = (label: string) => Promise<void>;
