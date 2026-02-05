export interface SetupCommand {
  /** The shell command to execute in the container */
  command: string;
  /** Human-readable description shown during execution */
  description: string;
}

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
  /** Optional setup commands to run in containers after they start */
  setupCommands?: SetupCommand[];
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
  /** Setup commands to run (empty array if none provided) */
  setupCommands: SetupCommand[];
}

export interface CliOptions {
  config?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export type Command = 'build' | 'start-containers' | 'start-servers';
