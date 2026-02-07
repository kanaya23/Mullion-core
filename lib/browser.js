const { chromium } = require('playwright');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function applyStealth(context) {
  const script = `(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'mimeTypes', { get: () => [
      { type: 'application/pdf', suffixes: 'pdf' },
      { type: 'application/x-nacl', suffixes: '' },
      { type: 'application/x-pnacl', suffixes: '' }
    ] });
    window.chrome = window.chrome || { runtime: {} };

    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };

    const screenWidth = 1366;
    const screenHeight = 768;
    Object.defineProperty(window.screen, 'width', { get: () => screenWidth });
    Object.defineProperty(window.screen, 'height', { get: () => screenHeight });
    Object.defineProperty(window.screen, 'availWidth', { get: () => screenWidth });
    Object.defineProperty(window.screen, 'availHeight', { get: () => screenHeight - 40 });
  })();`;

  await context.addInitScript({ content: script });
}

async function launchBrowser({ profileDir, headless = true }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1366, height: 768 },
    userAgent: DEFAULT_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  await applyStealth(context);
  return context;
}

async function cleanupOrphanedChromium(profileBaseDir) {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,args=']);
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.includes('--user-data-dir=')) continue;
    if (!line.includes(profileBaseDir)) continue;
    if (!line.includes('chrom')) continue;
    const [pidText] = line.split(/\s+/, 1);
    const pid = Number(pidText);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        console.warn(`Failed to kill orphaned Chromium PID ${pid}: ${error.message}`);
      }
    }
  }
}

module.exports = { launchBrowser, cleanupOrphanedChromium };
