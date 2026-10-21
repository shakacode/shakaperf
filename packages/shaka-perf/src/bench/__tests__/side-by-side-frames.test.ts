import {
  SIDE_BY_SIDE_FRAMES_GLOBAL,
  buildSideBySideFrames,
  renderSideBySideFramesScript,
} from '../core/side-by-side-frames';
import type { ProfileData } from '../core/timeline-comparison';

function profile(times: number[], events: ProfileData['events'] = []): ProfileData {
  return {
    screenshots: times.map((timeMs) => ({
      timeMs,
      dataUri: `data:image/jpeg;base64,${timeMs}`,
      snapshot: Buffer.alloc(0),
    })),
    events,
    maxTimeMs: Math.max(0, ...times),
    baseOrigin: 'http://localhost',
  };
}

describe('side-by-side frames', () => {
  it('keeps every frame of both runs with its rounded time and picture, and each run\'s interactions', () => {
    const control = profile([0, 120.4], [
      { timeMs: 50.2, label: 'click', category: 'interaction', interactionType: 'click', durationMs: 88.6 },
      { timeMs: 60, label: 'firstPaint', category: 'paint' },
    ]);
    const experiment = profile([33.6], [
      { timeMs: 70, label: 'keydown', category: 'interaction' },
    ]);
    expect(buildSideBySideFrames(control, experiment)).toEqual({
      control: [
        { timeMs: 0, src: 'data:image/jpeg;base64,0' },
        { timeMs: 120, src: 'data:image/jpeg;base64,120.4' },
      ],
      experiment: [{ timeMs: 34, src: 'data:image/jpeg;base64,33.6' }],
      interactions: {
        control: [{ timeMs: 50, type: 'click', durationMs: 89 }],
        experiment: [{ timeMs: 70, type: 'keydown' }],
      },
    });
  });

  it('renders a script that hands the payload to the page through its own element', () => {
    const empty = { control: [], experiment: [], interactions: { control: [], experiment: [] } };
    const script = renderSideBySideFramesScript(empty);
    expect(script).toContain(`window.${SIDE_BY_SIDE_FRAMES_GLOBAL}`);
    expect(script).toContain(`.set(document.currentScript, ${JSON.stringify(empty)})`);
  });
});
