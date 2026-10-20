/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

/**
 * The frames behind the report's side-by-side player: every trace screenshot
 * of both runs, navigation-relative, as the player needs them and nothing
 * more, plus each run's interactions so the player can flag a click as it
 * happens. No matching, no other annotations - the timeline comparison owns
 * those; the player only shows what each run looked like at a moment.
 *
 * Written as a script rather than JSON because the full report is opened from
 * disk, where a page may load a sibling `<script src>` but may not `fetch` a
 * sibling file. The script hands its payload to the page through a WeakMap
 * keyed by its own `<script>` element, so several players can load at once
 * without sharing a global slot.
 */

import type { ProfileData } from './timeline-comparison';

export const SIDE_BY_SIDE_FRAMES_FILENAME = 'side_by_side_frames.js';
export const SIDE_BY_SIDE_FRAMES_GLOBAL = '__shakaPerfFrames';

export interface SideBySideFrame {
  /** Navigation-relative capture time. */
  timeMs: number;
  /** JPEG data URI. */
  src: string;
}

export interface SideBySideInteraction {
  /** Navigation-relative start of the interaction. */
  timeMs: number;
  /** Event type as the trace names it: `click`, `keydown`, ... */
  type: string;
  /** Interaction to Next Paint duration, when the trace measured one. */
  durationMs?: number;
}

export interface SideBySideFrames {
  control: SideBySideFrame[];
  experiment: SideBySideFrame[];
  interactions: {
    control: SideBySideInteraction[];
    experiment: SideBySideInteraction[];
  };
}

export function buildSideBySideFrames(control: ProfileData, experiment: ProfileData): SideBySideFrames {
  const frames = (profile: ProfileData): SideBySideFrame[] =>
    profile.screenshots.map((s) => ({ timeMs: Math.round(s.timeMs), src: s.dataUri }));
  const interactions = (profile: ProfileData): SideBySideInteraction[] =>
    profile.events
      .filter((e) => e.category === 'interaction')
      .map((e) => ({
        timeMs: Math.round(e.timeMs),
        type: e.interactionType ?? e.label,
        ...(e.durationMs != null ? { durationMs: Math.round(e.durationMs) } : {}),
      }));
  return {
    control: frames(control),
    experiment: frames(experiment),
    interactions: { control: interactions(control), experiment: interactions(experiment) },
  };
}

export function renderSideBySideFramesScript(frames: SideBySideFrames): string {
  const registry = `window.${SIDE_BY_SIDE_FRAMES_GLOBAL}`;
  return `(${registry} || (${registry} = new WeakMap())).set(document.currentScript, ${JSON.stringify(frames)});\n`;
}
