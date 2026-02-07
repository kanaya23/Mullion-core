const { minimatch } = require('minimatch');

function matches(pattern, url) {
  return minimatch(url, pattern, { nocase: true });
}

function normalizeHeaders(headers = {}) {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[key.toLowerCase()] = value;
    return acc;
  }, {});
}

function createInterceptor({ context, allowedPatterns, requestLimit, onLimitExceeded, onError }) {
  const requestHandlers = [];
  const responseHandlers = [];
  const captureHandlers = [];
  const waiters = [];
  const globalHeaders = {};
  const patternHeaders = [];
  const patterns = (allowedPatterns && allowedPatterns.length) ? allowedPatterns : ['**/*'];
  const limit = Number.isFinite(requestLimit) ? requestLimit : 500;
  let interceptedCount = 0;
  let limitSignaled = false;
  let errorSignaled = false;

  const signalLimit = () => {
    if (!limitSignaled && onLimitExceeded) {
      limitSignaled = true;
      onLimitExceeded();
    }
  };

  const signalError = (error) => {
    if (!errorSignaled && onError) {
      errorSignaled = true;
      onError(error);
    }
  };

  const getHeadersForUrl = (url) => {
    const merged = { ...globalHeaders };
    for (const entry of patternHeaders) {
      if (matches(entry.pattern, url)) {
        Object.assign(merged, entry.headers);
      }
    }
    return merged;
  };

  const createRequestWrapper = (route) => {
    const request = route.request();
    const url = request.url();
    let handled = false;

    const continueWithHeaders = async (overrides = {}) => {
      if (handled) return;
      handled = true;
      const overrideHeaders = normalizeHeaders(overrides.headers || {});
      const headers = {
        ...request.headers(),
        ...getHeadersForUrl(url),
        ...overrideHeaders
      };
      await route.continue({ ...overrides, headers });
    };

    return {
      url: () => url,
      method: () => request.method(),
      headers: () => request.headers(),
      postData: () => request.postData(),
      continue: continueWithHeaders,
      abort: async () => {
        if (handled) return;
        handled = true;
        await route.abort();
      },
      fulfill: async (options) => {
        if (handled) return;
        handled = true;
        await route.fulfill(options);
      },
      get handled() {
        return handled;
      }
    };
  };

  const handleRoute = async (route) => {
    interceptedCount += 1;
    if (interceptedCount > limit) {
      signalLimit();
      await route.abort();
      return;
    }

    try {
      const url = route.request().url();
      const wrapper = createRequestWrapper(route);
      const handlers = requestHandlers.filter((handler) => matches(handler.pattern, url));
      for (const handler of handlers) {
        await handler.fn(wrapper);
        if (wrapper.handled) {
          break;
        }
      }
      if (!wrapper.handled) {
        await wrapper.continue();
      }
    } catch (error) {
      signalError(error);
      try {
        await route.abort();
      } catch (abortError) {
        signalError(abortError);
      }
    }
  };

  const handleResponse = async (response) => {
    try {
      const url = response.url();
      for (const handler of responseHandlers) {
        if (matches(handler.pattern, url)) {
          await handler.fn(response);
        }
      }

      for (const handler of captureHandlers) {
        if (matches(handler.pattern, url)) {
          const request = response.request();
          const body = await response.body();
          handler.fn(request, {
            url: response.url(),
            status: response.status(),
            headers: response.headers(),
            body
          });
        }
      }

      for (const waiter of [...waiters]) {
        if (matches(waiter.pattern, url)) {
          waiter.resolve(response);
          waiters.splice(waiters.indexOf(waiter), 1);
        }
      }
    } catch (error) {
      signalError(error);
    }
  };

  return {
    init: async () => {
      for (const pattern of patterns) {
        await context.route(pattern, handleRoute);
      }
      context.on('response', handleResponse);
    },
    onRequest: (pattern, fn) => {
      requestHandlers.push({ pattern, fn });
    },
    onResponse: (pattern, fn) => {
      responseHandlers.push({ pattern, fn });
    },
    capture: (pattern, fn) => {
      captureHandlers.push({ pattern, fn });
    },
    waitFor: (pattern) => new Promise((resolve, reject) => {
      waiters.push({ pattern, resolve, reject });
    }),
    setGlobalHeaders: (headers) => {
      Object.assign(globalHeaders, normalizeHeaders(headers));
    },
    setHeadersFor: (pattern, headers) => {
      const normalized = normalizeHeaders(headers);
      const existing = patternHeaders.find((entry) => entry.pattern === pattern);
      if (existing) {
        Object.assign(existing.headers, normalized);
      } else {
        patternHeaders.push({ pattern, headers: normalized });
      }
    },
    removeHeader: (name) => {
      delete globalHeaders[name.toLowerCase()];
    },
    getHeadersForUrl
  };
}

module.exports = { createInterceptor };
