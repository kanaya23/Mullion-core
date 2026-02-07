const fs = require('fs/promises');
const path = require('path');

function createDisabledModule(name) {
  return new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error(`${name} capability is not enabled for this stack`);
        };
      }
    }
  );
}

function resolveStackPath(stackDir, filePath) {
  const resolved = path.resolve(stackDir, filePath);
  if (!resolved.startsWith(stackDir)) {
    throw new Error(`Path escapes stack directory: ${filePath}`);
  }
  return resolved;
}

function buildMullionApi({
  context,
  page,
  stackDir,
  storage,
  interceptor,
  contentScripts,
  capabilities,
  tabLimit
}) {
  const capabilitySet = new Set(capabilities || []);
  const hasCapabilities = capabilitySet.size > 0;
  const enabled = (capability) => !hasCapabilities || capabilitySet.has(capability);

  const cookies = enabled('cookies')
    ? {
        getAll: async () => context.cookies(),
        get: async (filter = {}) => {
          const urls = [];
          if (filter.url) urls.push(filter.url);
          if (filter.domain) urls.push(`https://${filter.domain}`);
          const cookiesList = await context.cookies(urls.length ? urls : undefined);
          return cookiesList.filter((cookie) => {
            if (filter.name && cookie.name !== filter.name) return false;
            if (filter.domain && cookie.domain !== filter.domain) return false;
            if (filter.path && cookie.path !== filter.path) return false;
            return true;
          });
        },
        set: async (cookie) => {
          await context.addCookies([cookie]);
        },
        remove: async ({ name, domain, path: cookiePath = '/' }) => {
          await context.addCookies([
            {
              name,
              value: '',
              domain,
              path: cookiePath,
              expires: 0
            }
          ]);
        },
        clear: async (domain) => {
          const cookiesList = await context.cookies([`https://${domain}`]);
          await Promise.all(
            cookiesList.map((cookie) =>
              context.addCookies([
                {
                  name: cookie.name,
                  value: '',
                  domain: cookie.domain,
                  path: cookie.path,
                  expires: 0
                }
              ])
            )
          );
        }
      }
    : createDisabledModule('cookies');

  const storageModule = enabled('storage')
    ? {
        get: (...args) => storage.get(...args),
        set: (...args) => storage.set(...args),
        remove: (...args) => storage.remove(...args),
        keys: (...args) => storage.keys(...args),
        clear: (...args) => storage.clear(...args)
      }
    : createDisabledModule('storage');

  const interceptModule = enabled('webRequest')
    ? {
        onRequest: interceptor.onRequest,
        onResponse: interceptor.onResponse,
        capture: interceptor.capture,
        waitFor: interceptor.waitFor
      }
    : createDisabledModule('webRequest');

  const headersModule = enabled('webRequest')
    ? {
        set: (headers) => interceptor.setGlobalHeaders(headers),
        setFor: (pattern, headers) => interceptor.setHeadersFor(pattern, headers),
        remove: (name) => interceptor.removeHeader(name)
      }
    : createDisabledModule('webRequest');

  const inject = {
    script: async (script, options = {}) => {
      const target = options.frame || page;
      return target.evaluate((source) => (0, eval)(source), script);
    },
    file: async (filePath, options = {}) => {
      const script = await fs.readFile(resolveStackPath(stackDir, filePath), 'utf8');
      return inject.script(script, options);
    },
    style: async (css, options = {}) => {
      const target = options.frame || page;
      return target.addStyleTag({ content: css });
    },
    styleFile: async (filePath, options = {}) => {
      const target = options.frame || page;
      return target.addStyleTag({ path: resolveStackPath(stackDir, filePath) });
    }
  };

  const tabsModule = enabled('tabs')
    ? {
        create: async (url) => {
          const pages = context.pages();
          if (pages.length >= tabLimit) {
            throw new Error(`Tab limit of ${tabLimit} exceeded`);
          }
          const newPage = await context.newPage();
          if (url) {
            if (contentScripts) {
              await contentScripts.applyDocumentStart(newPage, url);
            }
            await newPage.goto(url, { waitUntil: 'domcontentloaded' });
            if (contentScripts) {
              await contentScripts.injectAfterNavigation(newPage, url);
            }
          }
          return newPage;
        },
        list: () => context.pages(),
        focus: async (targetPage) => targetPage.bringToFront(),
        close: async (targetPage) => targetPage.close(),
        evaluate: async (targetPage, fn) => targetPage.evaluate(fn),
        waitForNavigation: async (targetPage, urlPattern) =>
          targetPage.waitForURL(urlPattern)
      }
    : createDisabledModule('tabs');

  const dom = {
    getText: async (selector) => {
      await page.waitForSelector(selector);
      return page.textContent(selector);
    },
    getAttribute: async (selector, attribute) => {
      await page.waitForSelector(selector);
      return page.getAttribute(selector, attribute);
    },
    getTextAll: async (selector) =>
      page.$$eval(selector, (elements) => elements.map((el) => el.textContent)),
    exists: async (selector) => !!(await page.$(selector)),
    waitForHidden: async (selector) => page.waitForSelector(selector, { state: 'hidden' }),
    clickAndWait: async (selector, urlPattern) => {
      await Promise.all([page.waitForURL(urlPattern), page.click(selector)]);
    },
    fill: async (fields) => {
      for (const [selector, value] of Object.entries(fields)) {
        const input = await page.$(selector);
        if (!input) continue;
        if (typeof value === 'boolean') {
          const checked = await input.isChecked();
          if (value !== checked) {
            await input.click();
          }
        } else {
          await input.fill(String(value));
        }
      }
    },
    select: async (selector, value) => page.selectOption(selector, value),
    scrollTo: async (selector) => {
      const locator = page.locator(selector);
      await locator.scrollIntoViewIfNeeded();
    },
    parseTable: async (selector, options = {}) =>
      page.$$eval(selector, (tables, config) => {
        if (!tables.length) return [];
        const table = tables[0];
        const rows = Array.from(table.querySelectorAll('tr'));
        const headers =
          config.headers ||
          Array.from(rows.shift()?.querySelectorAll('th,td') || []).map((cell) =>
            cell.textContent?.trim()
          );
        return rows.map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          return headers.reduce((acc, header, index) => {
            acc[header] = cells[index]?.textContent?.trim() || '';
            return acc;
          }, {});
        });
      }, options)
  };

  const wait = {
    ms: (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    forSelector: (selector, options) => page.waitForSelector(selector, options),
    forHidden: (selector, options) =>
      page.waitForSelector(selector, { ...options, state: 'hidden' }),
    forNavigation: (options) => page.waitForNavigation(options),
    forNetworkIdle: () => page.waitForLoadState('networkidle'),
    until: async (fn, options = {}) => {
      const timeout = options.timeout ?? 5000;
      const interval = options.interval ?? 250;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const result = await fn();
        if (result) return result;
        await wait.ms(interval);
      }
      throw new Error('Wait timeout exceeded');
    },
    race: (tasks) => {
      const promises = tasks.map((task) => (typeof task === 'function' ? task() : task));
      return Promise.race(promises);
    }
  };

  const request = async (url, options = {}) => {
    const { body, ...rest } = options;
    if (body !== undefined && rest.data === undefined) {
      return context.request.fetch(url, { ...rest, data: body });
    }
    return context.request.fetch(url, rest);
  };

  return {
    page,
    context,
    request,
    cookies,
    storage: storageModule,
    intercept: interceptModule,
    inject,
    tabs: tabsModule,
    headers: headersModule,
    dom,
    wait
  };
}

module.exports = { buildMullionApi };
