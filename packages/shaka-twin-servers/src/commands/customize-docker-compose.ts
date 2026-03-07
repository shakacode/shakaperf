import * as fs from 'fs';
import * as path from 'path';
import type { ResolvedConfig } from '../types';
import { confirm } from '../helpers/shell';
import { colorize } from '../helpers/ui';

// At runtime __dirname is dist/commands/, so go up two levels to package root
const TEMPLATE_PATH = path.resolve(__dirname, '..', '..', 'templates', 'docker-compose.yml');

function addComposeFileToConfig(configPath: string, relativeComposePath: string): boolean {
  const content = fs.readFileSync(configPath, 'utf8');

  if (/composeFile\s*:/.test(content)) {
    return false;
  }

  // Insert after the procfile line, or after dockerfile line as fallback
  const insertAfterPattern = /^(\s*procfile\s*:.+,?)$/m;
  const fallbackPattern = /^(\s*dockerfile\s*:.+,?)$/m;

  const match = content.match(insertAfterPattern) || content.match(fallbackPattern);
  if (!match) {
    return false;
  }

  const matchedLine = match[1];
  const indent = matchedLine.match(/^\s*/)?.[0] || '  ';
  const lineWithComma = matchedLine.endsWith(',') ? matchedLine : matchedLine + ',';
  const newLine = `${indent}composeFile: '${relativeComposePath}',`;

  const updated = content.replace(matchedLine, `${lineWithComma}\n${newLine}`);
  fs.writeFileSync(configPath, updated);
  return true;
}

export async function customizeDockerCompose(config: ResolvedConfig, configPath: string): Promise<void> {
  console.log(colorize('Warning: Customizing docker-compose.yml is not recommended.', 'yellow'));
  console.log('');
  console.log('The bundled default works for most projects. Custom compose files:');
  console.log('  - Can break isolation between control and experiment (shared services)');
  console.log('  - Mix concerns that belong in the Dockerfile (env vars, setup steps)');
  console.log('  - Can cause false performance regressions that are hard to pinpoint');
  console.log('');
  console.log('See SETUP.md for details on when a custom compose file is actually needed.');
  console.log('');

  const confirmed = await confirm('Do you still want to create a custom docker-compose.yml?');
  if (!confirmed) {
    console.log('Aborted.');
    return;
  }

  const destDir = path.join(config.projectDir, 'twin-servers');
  const destPath = path.join(destDir, 'docker-compose.yml');

  if (fs.existsSync(destPath)) {
    console.error(colorize(`Error: ${destPath} already exists.`, 'red'));
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(TEMPLATE_PATH, destPath);

  console.log('');
  console.log(colorize(`Created: ${destPath}`, 'green'));

  const relativeComposePath = 'twin-servers/docker-compose.yml';
  const added = addComposeFileToConfig(configPath, relativeComposePath);

  if (added) {
    console.log(colorize(`Updated: ${configPath} (added composeFile)`, 'green'));
  } else {
    console.log('');
    console.log('Add this to your twin-servers config:');
    console.log('');
    console.log(`  composeFile: '${relativeComposePath}',`);
  }
}
