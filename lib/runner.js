const fs = require('fs/promises');
const path = require('path');
const { launchBrowser, cleanupOrphanedChromium } = require('./browser');
const { createStackStorage } = require('./storage');
const { createInterceptor } = require('./interceptor');
const { createContentScriptManager } = require('./content-scripts');
const { buildMullionApi } = require('./mullion-api');

class StackError extends Error {
  constructor(message, phase) {
    super(message);
    this.phase = phase;
  }
}

async function loadStackConfig(stackDir, stackName) {
  const configPath = path.join(stackDir, 'stack.config.json');
  let raw;
  try {
    raw = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    throw new StackError(`Missing stack.config.json for ${stackName}`, 'config');
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new StackError(`Invalid JSON in ${configPath}`, 'config');
  }

  if (!config.name || config.name !== stackName) {
    throw new StackError(`Stack name mismatch for ${stackName}`, 'config');
  }

  if (!config.entry_url) {
    throw new StackError(`entry_url missing for ${stackName}`, 'config');
  }

  if (!config.profile) {
    config.profile = stackName;
  }

  return config;
}

function shouldEnableInterceptor(stackConfig) {
  const capabilities = stackConfig.permissions?.capabilities || [];
  return capabilities.includes('webRequest');
}

function wrapError(error, phase) {
  if (error instanceof StackError) {
    return error;
  }
  const wrapped = new StackError(error.message || 'Unknown error', phase);
  wrapped.stack = error.stack;
  return wrapped;
}

async function runStack({ baseDir, stackName, params, config }) {
  const stackDir = path.join(baseDir, 'stacks', stackName);
  const profileBaseDir = path.join(baseDir, 'profiles');
  const storageDir = path.join(baseDir, 'storage');

  const stackConfig = await loadStackConfig(stackDir, stackName);
  const profileDir = path.join(profileBaseDir, stackConfig.profile);

  await fs.mkdir(profileDir, { recursive: true });

  const storage = createStackStorage(storageDir, stackName);
  await storage.load();

  const tabLimit = Number.isFinite(stackConfig.tab_limit) ? stackConfig.tab_limit : 5;
  const requestLimit = Number.isFinite(stackConfig.request_limit) ? stackConfig.request_limit : 500;
  const maxDuration = Number.isFinite(config.max_wake_duration_seconds)
    ? config.max_wake_duration_seconds
    : 300;
  const stackTimeout = Number.isFinite(stackConfig.timeout)
    ? Math.min(stackConfig.timeout, maxDuration)
    : maxDuration;

  let context;
  let page;
  let timeoutHandle;
  let runnerError;
  let interceptReject;
  let interceptor = null;
  const enableInterceptor = shouldEnableInterceptor(stackConfig);
  const interceptErrorPromise = enableInterceptor
    ? new Promise((_, reject) => {
        interceptReject = reject;
      })
    : new Promise(() => {});

  try {
    context = await launchBrowser({ profileDir, headless: true });
    page = context.pages()[0] || (await context.newPage());

    const contentScripts = createContentScriptManager({
      stackDir,
      contentScripts: stackConfig.content_scripts
    });

    if (enableInterceptor) {
      interceptor = createInterceptor({
        context,
        allowedPatterns: stackConfig.intercept_patterns,
        requestLimit,
        onLimitExceeded: () => {
          interceptReject(new StackError('Request limit exceeded', 'request_limit'));
        },
        onError: (error) => {
          interceptReject(wrapError(error, 'intercept'));
        }
      });

      await interceptor.init();
    }
    await contentScripts.applyDocumentStart(page, stackConfig.entry_url);

    const mullion = buildMullionApi({
      context,
      page,
      stackDir,
      storage,
      interceptor,
      contentScripts,
      capabilities: stackConfig.permissions?.capabilities,
      tabLimit
    });

    await page.goto(stackConfig.entry_url, { waitUntil: 'domcontentloaded' });
    await contentScripts.injectAfterNavigation(page, stackConfig.entry_url);

    const mainPath = path.join(stackDir, 'main.js');
    let mainFn;
    try {
      delete require.cache[require.resolve(mainPath)];
      mainFn = require(mainPath);
    } catch (error) {
      throw new StackError(`Unable to load main.js for ${stackName}`, 'stack');
    }

    if (typeof mainFn !== 'function') {
      throw new StackError(`main.js must export an async function for ${stackName}`, 'stack');
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new StackError('Stack execution timed out', 'timeout'));
      }, stackTimeout * 1000);
    });

    const result = await Promise.race([
      Promise.resolve(mainFn(mullion, params || {})),
      timeoutPromise,
      interceptErrorPromise
    ]);

    return { result, stackConfig };
  } catch (error) {
    runnerError = wrapError(error, runnerError ? runnerError.phase : 'execution');
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    try {
      await storage.save();
    } catch (error) {
      if (!runnerError) {
        runnerError = wrapError(error, 'storage');
      } else {
        console.error(`Storage save failed: ${error.message}`);
      }
    }
    if (context) {
      try {
        await context.close();
      } catch (error) {
        if (!runnerError) {
          runnerError = wrapError(error, 'shutdown');
        } else {
          console.error(`Browser close failed: ${error.message}`);
        }
      }
    }
    try {
      await cleanupOrphanedChromium(profileBaseDir);
    } catch (error) {
      console.error(`Orphan cleanup failed: ${error.message}`);
    }
  }

  if (runnerError) {
    throw runnerError;
  }

  throw new StackError('Unknown runner failure', 'execution');
}

module.exports = { runStack, loadStackConfig, StackError, shouldEnableInterceptor };
