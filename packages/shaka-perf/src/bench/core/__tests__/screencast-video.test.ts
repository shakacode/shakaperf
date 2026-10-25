/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { screencastRecorder } from '../screencast-recorder';
import { loadScreenshotsFromVideo } from '../timeline-comparison';

const hasVideoTools = ['ffmpeg', 'ffprobe'].every(
  (tool) => spawnSync(tool, ['-version']).status === 0,
);

(hasVideoTools ? describe : describe.skip)('screencast video round trip', () => {
  it('saves captured frames and extracts the timeline with the installed FFmpeg', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shaka-video-test-'));
    const handlers = new Map<string, (...args: unknown[]) => void>();
    try {
      const jpeg = await sharp({
        create: { width: 32, height: 24, channels: 3, background: 'red' },
      }).jpeg().toBuffer();
      screencastRecorder.record(true);
      await screencastRecorder.onNavigate({
        sendCommand: async () => {},
        on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
        off: (event: string) => handlers.delete(event),
      });
      handlers.get('Page.screencastFrame')!({
        data: jpeg.toString('base64'),
        sessionId: 1,
        metadata: { timestamp: Date.now() / 1000 },
      });
      await screencastRecorder.stop();
      expect(await screencastRecorder.save(dir, 'round-trip')).toBe(true);
      const frames = await loadScreenshotsFromVideo(
        join(dir, 'screencast.mp4'), join(dir, 'screencast_start.json'),
      );
      expect(frames!.length).toBeGreaterThan(1);
      expect(frames![0].timeMs).toBe(0);
      expect(frames![1].timeMs).toBeCloseTo(1000 / 60);
      const last = await sharp(frames!.at(-1)!.snapshot).stats();
      expect(last.channels[0].mean).toBeGreaterThan(200);
      expect(last.channels[1].mean).toBeLessThan(30);
    } finally {
      await screencastRecorder.stop();
      screencastRecorder.record(false);
      await rm(dir, { recursive: true, force: true });
    }
  }, 15000);
});
