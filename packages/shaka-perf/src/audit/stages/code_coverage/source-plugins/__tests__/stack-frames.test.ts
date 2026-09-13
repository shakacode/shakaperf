/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

import { parseStackFrame } from '../stack-frames';

describe('parseStackFrame', () => {
  it('reads a named V8 frame', () => {
    expect(parseStackFrame('    at Card (http://localhost:3000/packs/js/app.js:1234:56)'))
      .toEqual({ url: 'http://localhost:3000/packs/js/app.js', line: 1234, column: 56 });
  });

  it('reads an anonymous frame, whose URL is bare', () => {
    expect(parseStackFrame('    at http://localhost:3000/packs/js/app.js:7:8'))
      .toEqual({ url: 'http://localhost:3000/packs/js/app.js', line: 7, column: 8 });
  });

  it('reads an async frame and a method frame', () => {
    expect(parseStackFrame('    at async Object.render (http://h/a.js:1:2)'))
      .toEqual({ url: 'http://h/a.js', line: 1, column: 2 });
    expect(parseStackFrame('    at new Foo (http://h/a.js:3:4)'))
      .toEqual({ url: 'http://h/a.js', line: 3, column: 4 });
  });

  it('keeps the port out of the line number', () => {
    // A lazy URL match must not stop at `localhost` and read `3000` as the line.
    expect(parseStackFrame('at http://localhost:3000/a.js:5:6')?.line).toBe(5);
  });

  it('yields null for lines that carry no position', () => {
    expect(parseStackFrame('Error: react-stack-top-frame')).toBeNull();
    expect(parseStackFrame('    at <anonymous>')).toBeNull();
    expect(parseStackFrame('')).toBeNull();
  });
});
