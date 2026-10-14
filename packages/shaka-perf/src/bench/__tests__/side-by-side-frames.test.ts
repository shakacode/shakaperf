import {
  SIDE_BY_SIDE_FRAMES_GLOBAL,
  buildSideBySideFrames,
  renderSideBySideFramesScript,
} from '../core/side-by-side-frames';
import type { ProfileData } from '../core/timeline-comparison';

function profile(times: number[]): ProfileData {
  return {
    screenshots: times.map((timeMs) => ({
      timeMs,
      dataUri: `data:image/jpeg;base64,${timeMs}`,
      snapshot: Buffer.alloc(0),
    })),
    events: [],
    maxTimeMs: Math.max(0, ...times),
    baseOrigin: 'http://localhost',
  };
}

describe('side-by-side frames', () => {
  it('keeps every frame of both runs with its rounded time and picture', () => {
    const frames = buildSideBySideFrames(profile([0, 120.4]), profile([33.6]));
    expect(frames).toEqual({
      control: [
        { timeMs: 0, src: 'data:image/jpeg;base64,0' },
        { timeMs: 120, src: 'data:image/jpeg;base64,120.4' },
      ],
      experiment: [{ timeMs: 34, src: 'data:image/jpeg;base64,33.6' }],
    });
  });

  it('renders a script that hands the payload to the page through its own element', () => {
    const script = renderSideBySideFramesScript({ control: [], experiment: [] });
    expect(script).toContain(`window.${SIDE_BY_SIDE_FRAMES_GLOBAL}`);
    expect(script).toContain('.set(document.currentScript, {"control":[],"experiment":[]})');
  });
});
