const fs = require('fs/promises');
const path = require('path');
const { minimatch } = require('minimatch');

function normalizeRunAt(value) {
  if (!value) return 'document_idle';
  return value;
}

function matchesAny(patterns, url) {
  return (patterns || []).some((pattern) => minimatch(url, pattern, { nocase: true }));
}

function resolvePath(stackDir, filePath) {
  const resolved = path.resolve(stackDir, filePath);
  if (!resolved.startsWith(stackDir)) {
    throw new Error(`Content script path escapes stack directory: ${filePath}`);
  }
  return resolved;
}

async function addInitStyle(page, css) {
  const script = `(() => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(css)};
    document.documentElement.appendChild(style);
  })();`;
  await page.addInitScript({ content: script });
}

function createContentScriptManager({ stackDir, contentScripts }) {
  const scripts = (contentScripts || []).map((entry) => ({
    matches: entry.matches || [],
    js: entry.js || [],
    css: entry.css || [],
    run_at: normalizeRunAt(entry.run_at)
  }));

  const getMatchingScripts = (url) => scripts.filter((entry) => matchesAny(entry.matches, url));

  const applyDocumentStart = async (page, url) => {
    const matching = getMatchingScripts(url).filter((entry) => entry.run_at === 'document_start');
    for (const entry of matching) {
      for (const file of entry.js) {
        await page.addInitScript({ path: resolvePath(stackDir, file) });
      }
      for (const file of entry.css) {
        const css = await fs.readFile(resolvePath(stackDir, file), 'utf8');
        await addInitStyle(page, css);
      }
    }
  };

  const injectAfterNavigation = async (page, url) => {
    const matching = getMatchingScripts(url).filter((entry) => entry.run_at !== 'document_start');
    for (const entry of matching) {
      if (entry.run_at === 'document_end') {
        await page.waitForLoadState('domcontentloaded');
      } else {
        await page.waitForLoadState('networkidle');
      }
      for (const file of entry.js) {
        await page.addScriptTag({ path: resolvePath(stackDir, file) });
      }
      for (const file of entry.css) {
        await page.addStyleTag({ path: resolvePath(stackDir, file) });
      }
    }
  };

  return {
    applyDocumentStart,
    injectAfterNavigation
  };
}

module.exports = { createContentScriptManager };
