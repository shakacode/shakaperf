export interface Marker {
  start: string;
  end?: string;
  label: string;
}

export const DEFAULT_MARKERS: Marker[] = [
  { label: 'hydration', start: 'hydration-start', end: 'hydration-end' },
  { label: 'hydration-start', start: 'hydration-start' },
];

export interface LighthouseConfig {
  formFactor?: string;
  screenEmulation?: { mobile?: boolean; width?: number; height?: number; deviceScaleFactor?: number };
  throttling?: { rttMs?: number; throughputKbps?: number; requestLatencyMs?: number; downloadThroughputKbps?: number; uploadThroughputKbps?: number; cpuSlowdownMultiplier?: number } | false;
  logLevel?: string;
  output?: string;
  onlyCategories?: string[];
}

export function defineConfig(config: LighthouseConfig): LighthouseConfig {
  return config;
}

export const DEFAULT_LH_CONFIG: LighthouseConfig = {
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
  },
  throttling: {
    rttMs: 300,
    throughputKbps: 700,
    requestLatencyMs: 1125,
    downloadThroughputKbps: 700,
    uploadThroughputKbps: 700,
    cpuSlowdownMultiplier: 20,
  },
  logLevel: 'error',
  output: 'html',
  onlyCategories: ['performance'],
};

export interface LighthouseBenchmarkOptions {
  tbResultsFolder?: string;
  lhConfigPath?: string;
  markers?: Marker[];
}

export interface PhaseSample {
  phase: string;
  start: number;
  duration: number;
  sign: 1 | -1;
  unit: string;
}

export interface NavigationSample {
  duration: number;
  phases: PhaseSample[];
  metadata: Record<string, unknown>;
}
