const path = require('path');
const fs = require('fs/promises');
const { launchBrowser } = require('../lib/browser');
const { loadStackConfig } = require('../lib/runner');

async function main() {
  const stackName = process.argv[2];
  if (!stackName) {
    console.error('Usage: node cli/create-profile.js <stack-name>');
    process.exit(1);
  }

  const baseDir = path.join(__dirname, '..');
  const stackDir = path.join(baseDir, 'stacks', stackName);
  const stackConfig = await loadStackConfig(stackDir, stackName);

  const profileDir = path.join(baseDir, 'profiles', stackConfig.profile || stackName);
  await fs.mkdir(profileDir, { recursive: true });

  const context = await launchBrowser({ profileDir, headless: false });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(stackConfig.entry_url, { waitUntil: 'domcontentloaded' });

  console.log('Log in, then close the browser window to save the profile.');
  await new Promise((resolve) => page.on('close', resolve));
  await context.close();
  console.log(`Profile saved at ${profileDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
