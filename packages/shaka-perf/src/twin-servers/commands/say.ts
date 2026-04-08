import { spawn } from 'node:child_process';
import { printWarning } from '../helpers/ui';

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('command', ['-v', command], { shell: true, stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
  });
}

export async function say(message: string): Promise<void> {
  if (!message) return;

  const hasSay = await commandExists('say');
  if (hasSay) {
    spawn('say', [message], { stdio: 'inherit' });
    return;
  }

  const hasSpdSay = await commandExists('spd-say');
  if (hasSpdSay) {
    spawn('spd-say', [message], { stdio: 'inherit' });
    return;
  }

  printWarning("Neither 'say' nor 'spd-say' command found - skipping speech notification");
}
