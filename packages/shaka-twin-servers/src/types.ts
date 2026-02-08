import { z } from 'zod';

export const SetupCommandSchema = z.object({
  /** The shell command to execute in the container */
  command: z.string().min(1, 'command is required'),
  /** Human-readable description shown during execution */
  description: z.string().min(1, 'description is required'),
});

export const TwinServersConfigSchema = z.object({
  projectDir: z.string().min(1, 'projectDir is required'),
  controlDir: z.string().min(1, 'controlDir is required'),
  dockerBuildDir: z.string().min(1, 'dockerBuildDir is required'),
  dockerBuildArgs: z.record(z.string(), z.string()),
  composeFile: z.string().min(1, 'composeFile is required'),
  procfile: z.string().min(1, 'procfile is required'),
  stopSignals: z.record(z.string(), z.string()).refine(
    (obj: Record<string, string>) => Object.keys(obj).length > 0,
    { message: 'stopSignals must have at least one entry' }
  ),
  images: z.object({
    control: z.string().min(1, 'images.control is required'),
    experiment: z.string().min(1, 'images.experiment is required'),
  }),
  volumes: z.object({
    control: z.string().min(1, 'volumes.control is required'),
    experiment: z.string().min(1, 'volumes.experiment is required'),
  }),
  /** Optional setup commands to run in containers after they start */
  setupCommands: z.array(SetupCommandSchema).optional(),
});

// Derive types from schemas
export type SetupCommand = z.infer<typeof SetupCommandSchema>;
export type TwinServersConfig = z.infer<typeof TwinServersConfigSchema>;

// ResolvedConfig has setupCommands as required (non-optional)
export type ResolvedConfig = Omit<TwinServersConfig, 'setupCommands'> & {
  /** Setup commands to run (empty array if none provided) */
  setupCommands: SetupCommand[];
};

export interface CliOptions {
  config?: string;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export type Command = 'build' | 'start-containers' | 'start-servers' | 'run-overmind-command' | 'run-cmd' | 'sync-changes';
