/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import type { Stream } from 'node:stream';

export default function onStreamEnd (stream: Stream & { writable?: boolean; readable?: boolean }, result: unknown) {
  return new Promise(function (resolve, reject) {
    if (stream.writable) {
      stream.on('finish', function () {
        resolve(result);
      });
    }

    if (stream.readable) {
      stream.on('end', function () {
        resolve(result);
      });
    }

    stream.on('close', function () {
      resolve(result);
    });

    stream.on('error', function (error: Error) {
      reject(error);
    });
  });
}
