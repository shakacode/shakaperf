/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/** Failed paths remain pending so another batch cannot claim an incomplete sync. */
export function syncPendingPaths(pending: Set<string>, sync: (path: string) => void): Error[] {
  const errors: Error[] = [];
  const batch = Array.from(pending);
  pending.clear();
  for (const file of batch) {
    try { sync(file); } catch (error) {
      pending.add(file);
      errors.push(error as Error);
    }
  }
  return errors;
}
