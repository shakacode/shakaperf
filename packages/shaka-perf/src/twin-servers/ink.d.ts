/*
 * Copyright (c) 2026 ShakaCode LLC.
 *
 * This file is part of ShakaPerf. Use is governed by The ShakaPerf
 * License in LICENSE.md.
 */

// Local ambient declaration for Ink.
//
// shaka-perf's tsconfig uses `moduleResolution: "node"` (legacy), which can't
// resolve packages that ship types only through an `exports` map — Ink v6 is
// one such package. Rather than cascade the config change across the whole
// package (node16/nodenext/bundler all force module-emit changes too), we
// declare the small surface we use here. If we ever start using more of
// Ink's API, extend this file.
declare module 'ink' {
  import * as React from 'react';

  export const Box: React.ComponentType<{
    children?: React.ReactNode;
    flexDirection?: 'row' | 'column';
    borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'doubleSingle' | 'classic';
    borderColor?: string;
    paddingX?: number;
    paddingY?: number;
    marginTop?: number;
    marginBottom?: number;
  }>;

  export const Text: React.ComponentType<{
    children?: React.ReactNode;
    color?: string;
    backgroundColor?: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dimColor?: boolean;
  }>;

  export interface StaticProps<T> {
    items: T[];
    children: (item: T, index: number) => React.ReactNode;
  }
  export function Static<T>(props: StaticProps<T>): React.ReactElement | null;

  export interface RenderInstance {
    rerender(node: React.ReactElement): void;
    unmount(): void;
    waitUntilExit(): Promise<void>;
    cleanup(): void;
    clear(): void;
  }
  export function render(node: React.ReactElement): RenderInstance;

  export interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
    meta: boolean;
  }
  export function useInput(handler: (input: string, key: Key) => void): void;
  export function useApp(): { exit: (error?: Error) => void };
}
