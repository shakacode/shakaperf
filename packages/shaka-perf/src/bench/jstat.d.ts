/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

declare module "jstat" {
  const jStat: {
    normal: {
      inv(p: number, mean: number, std: number): number;
      cdf(x: number, mean: number, std: number): number;
    };
  };
  export = jStat;
}
