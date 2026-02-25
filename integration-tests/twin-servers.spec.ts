import { test, expect } from './base-test';
import * as fs from 'fs';
import * as path from 'path';
import {
  TEMP_CLONE_PATH,
  loud, run, startServers, stopServers, waitForPort,
} from './helpers';

const HOME_PAGE_FILE = path.join(
  TEMP_CLONE_PATH,
  'demo-ecommerce/app/javascript/components/pages/HomePage.tsx',
);

test('modify experiment, rebuild, and verify servers diverge', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  // Verify both servers initially serve the same content
  loud('Verifying experiment server has "Discover Your Style"');
  await page.goto('http://localhost:3030');
  await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });

  loud('Verifying control server has "Discover Your Style"');
  await page.goto('http://localhost:3020');
  await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });

  // Stop servers, modify experiment, sync, rebuild, restart
  stopServers();

  loud('Modifying HomePage.tsx: "Discover Your Style" -> "Discover Your New Self"');
  const homePageContent = fs.readFileSync(HOME_PAGE_FILE, 'utf-8');
  const updatedContent = homePageContent.replace(
    'Discover Your Style',
    'Discover Your New Self',
  );
  fs.writeFileSync(HOME_PAGE_FILE, updatedContent);

  run('yarn shaka-twin-servers sync-changes experiment');

  run('yarn shaka-twin-servers run-cmd-parallel -- bundle exec rake assets:precompile', {
    timeout: 5 * 60 * 1000,
  });

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([
    waitForPort(3020),
    waitForPort(3030),
  ]);

  // Verify experiment has new content
  loud('Verifying experiment (3030) has "Discover Your New Self"');
  await page.goto('http://localhost:3030');
  await expect(page.getByText('Discover Your New Self')).toBeVisible({ timeout: 30_000 });

  // Verify control still has original content
  loud('Verifying control (3020) still has "Discover Your Style"');
  await page.goto('http://localhost:3020');
  await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
});

test('run-cmd preserves single and double quotes', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);

  const HOMEPAGE_TSX = 'app/javascript/components/pages/HomePage.tsx';

  stopServers();

  // Use run-cmd with sed to replace text inside the container — tests double quotes
  loud('Using run-cmd with sed to replace "Discover Your Style" with "It\'s a \\"quoted\\" world"');
  run(`yarn shaka-twin-servers run-cmd experiment "sed -i 's/Discover Your Style/It'\\''s a \\"quoted\\" world/' ${HOMEPAGE_TSX}"`);

  run('yarn shaka-twin-servers run-cmd experiment "bundle exec rake assets:precompile"', {
    timeout: 5 * 60 * 1000,
  });

  startServers();
  loud('Waiting for ports 3020 + 3030');
  await Promise.all([waitForPort(3020), waitForPort(3030)]);

  loud('Verifying experiment (3030) has text with single and double quotes');
  await page.goto('http://localhost:3030');
  await expect(page.getByText(`It's a "quoted" world`)).toBeVisible({ timeout: 30_000 });

  loud('Verifying control (3020) still has "Discover Your Style"');
  await page.goto('http://localhost:3020');
  await expect(page.getByText('Discover Your Style')).toBeVisible({ timeout: 30_000 });
});
