export interface TwinServersConfig {
  projectDir: string;
  controlDir: string;
  dockerBuildDir: string;
  dockerBuildArgs: Record<string, string>;
  composeFile: string;
  procfile: string;
  stopSignals: Record<string, string>;
  images: {
    control: string;
    experiment: string;
  };
  volumes: {
    control: string;
    experiment: string;
  };
}

export interface ResolvedConfig {
  projectDir: string;
  controlDir: string;
  dockerBuildDir: string;
  dockerBuildArgs: Record<string, string>;
  composeFile: string;
  procfile: string;
  stopSignals: Record<string, string>;
  images: {
    control: string;
    experiment: string;
  };
  volumes: {
    control: string;
    experiment: string;
  };
}

export interface CliOptions {
  config?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export type Command = 'build' | 'start-containers' | 'start-servers';
