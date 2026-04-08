import type { ResolvedConfig } from '../types';
import { getChangedFiles, getGitRootDirectory } from '../helpers/git';
import { exec, execWithStdin } from '../helpers/shell';
import { printBanner, printSuccess, printError, printInfo, colorize } from '../helpers/ui';

export type CopyTarget = 'control' | 'experiment' | 'all';

export interface CopyChangesToSshOptions {
  verbose?: boolean;
  target?: CopyTarget;
}

export interface SshTarget {
  host: string;
  port: string;
}

/**
 * Extracts unique directories from a list of file paths.
 */
function extractDirectories(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join('/'));
    }
  }
  return Array.from(dirs).sort();
}

/**
 * Copies local git changes to a remote SSH server.
 * Used for debugging CI failures by syncing local changes to CircleCI nodes.
 *
 * Usage:
 *   shaka-perf twin-servers copy-changes-to-ssh -p <port> <host>
 */
export async function copyChangesToSsh(
  config: ResolvedConfig,
  sshTarget: SshTarget,
  options: CopyChangesToSshOptions = {}
): Promise<void> {
  const { verbose, target = 'all' } = options;
  const { host, port } = sshTarget;

  printBanner('Copying local git changes to CI (or other remote) using SSH');

  // Get git root to ensure file paths are correct
  const gitRoot = getGitRootDirectory(config.dockerBuildDir);
  const sourceDir = gitRoot || config.dockerBuildDir;

  if (verbose) {
    console.log(`Source directory: ${sourceDir}`);
    console.log(`SSH target: ${host}:${port}`);
  }

  // Get git changed files from the source repo
  const changedFiles = getChangedFiles(sourceDir);

  if (changedFiles.length === 0) {
    printInfo('No git changes to copy');
    return;
  }

  console.log(`Found ${changedFiles.length} changed files`);

  // Define targets for the remote
  const primaryTarget = 'local-changes';
  const experimentVolume = config.volumes.experiment.split('/').pop() || 'experiment_volume';
  const controlVolume = config.volumes.control.split('/').pop() || 'control_volume';

  let secondaryTargets: string[];
  if (target === 'experiment') {
    secondaryTargets = ['project', experimentVolume];
  } else if (target === 'control') {
    secondaryTargets = ['project', controlVolume];
  } else {
    secondaryTargets = ['project', experimentVolume, controlVolume];
  }
  const allTargets = [primaryTarget, ...secondaryTargets];

  // Extract directories from file list
  const dirs = extractDirectories(changedFiles);

  // Step 1: Create all directories for all targets in a single SSH command
  if (dirs.length > 0) {
    printInfo('Creating all directories in all targets...');

    const mkdirParts: string[] = [];
    for (const target of allTargets) {
      for (const dir of dirs) {
        mkdirParts.push(`${target}/${dir}`);
      }
    }

    const mkdirCmd = `mkdir -p ${mkdirParts.join(' ')}`;
    if (verbose) {
      console.log(colorize(`Running: ${mkdirCmd}`, 'yellow'));
    }

    const mkdirResult = await exec('ssh', ['-p', port, host, mkdirCmd], { silent: !verbose });
    if (mkdirResult.code !== 0) {
      throw new Error(`Failed to create directories: ${mkdirResult.stderr}`);
    }
  }

  // Step 2: Upload all files to the primary target
  printInfo(`Uploading files to ${primaryTarget}... (${port} ${host})`);

  for (const file of changedFiles) {
    const scpResult = await exec('scp', [
      '-O', '-P', port,
      file,
      `${host}:${primaryTarget}/${file}`
    ], { cwd: sourceDir, silent: !verbose });

    if (scpResult.code !== 0) {
      printError(`Failed to upload ${file}: ${scpResult.stderr}`);
    }
  }

  // Step 3: Copy files from primary target to secondary targets using SSH with stdin (like heredoc)
  if (secondaryTargets.length > 0 && changedFiles.length > 0) {
    printInfo(`Copying files from ${primaryTarget} to secondary targets...`);
    console.log(`Secondary targets: ${secondaryTargets.join(', ')}`);

    const copyCommands: string[] = ['set -e'];
    for (const file of changedFiles) {
      for (const target of secondaryTargets) {
        copyCommands.push(`cp -f ${primaryTarget}/${file} ${target}/${file}`);
      }
    }

    const copyScript = copyCommands.join('\n');
    console.log(colorize(`Running copy script:\n${copyScript}`, 'yellow'));

    const copyResult = await execWithStdin('ssh', ['-p', port, host, 'bash'], {
      stdin: copyScript,
      silent: false,
    });

    console.log(`Copy result: code=${copyResult.code}, stdout=${copyResult.stdout}, stderr=${copyResult.stderr}`);

    if (copyResult.code !== 0) {
      printError(`Failed to copy to secondary targets: ${copyResult.stderr}`);
    }
  }

  printSuccess('All files successfully uploaded to the CI host!');
}
