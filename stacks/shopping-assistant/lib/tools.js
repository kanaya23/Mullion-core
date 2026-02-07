const { Instructions } = require('./instructions');

function createToolExecutor(mullion) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function ensureScraperReady(page, timeout = 10000) {
    await page.waitForFunction(
      () => window.__shoppingAssistantScraper && window.__shoppingAssistantScraper.scrapeListings,
      { timeout }
    );
  }

  async function waitForProductsToLoad(page, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = await page.evaluate(() => {
        const items = document.querySelectorAll('li.shopee-search-item-result__item, [data-sqe="item"]');
        return { loaded: items.length > 0, count: items.length };
      });
      if (result.loaded) {
        return true;
      }
      await wait(500);
    }
    return false;
  }

  async function searchShopee(keyword) {
    const url = `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}`;
    await mullion.page.goto(url, { waitUntil: 'domcontentloaded' });
    await ensureScraperReady(mullion.page, 15000);
    await waitForProductsToLoad(mullion.page, 15000);
    return {
      success: true,
      message: `Navigated to search results for "${keyword}".`,
      keyword
    };
  }

  async function scrapeListings(maxItems = 1000) {
    const current = new URL(mullion.page.url());

    current.searchParams.set('page', '0');
    await mullion.page.goto(current.toString(), { waitUntil: 'domcontentloaded' });
    await ensureScraperReady(mullion.page, 15000);
    await waitForProductsToLoad(mullion.page, 15000);
    const productsPage0 = await mullion.page.evaluate(
      (limit) => window.__shoppingAssistantScraper.scrapeListings(limit),
      maxItems
    );

    current.searchParams.set('page', '1');
    await mullion.page.goto(current.toString(), { waitUntil: 'domcontentloaded' });
    await ensureScraperReady(mullion.page, 15000);
    await waitForProductsToLoad(mullion.page, 15000);
    const productsPage1 = await mullion.page.evaluate(
      (limit) => window.__shoppingAssistantScraper.scrapeListings(limit),
      maxItems
    );

    let report = `=== SEARCH RESULTS ===\n`;
    report += `Page 1 Result =:\n`;
    if (!productsPage0.length) {
      report += `(No products found on Page 1)\n`;
    } else {
      for (const product of productsPage0) {
        report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        report += `#${product.index} ${product.name}\n`;
        report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        report += `Price: ${product.price || 'N/A'}\n`;
        report += `Rating: ${product.rating || 'N/A'}\u2b50\n`;
        report += `Sold: ${product.sold || 'N/A'}\n`;
        report += `URL: ${product.url}\n\n`;
      }
    }

    report += `Page 2 Result =:\n`;
    if (!productsPage1.length) {
      report += `(No products found on Page 2)\n`;
    } else {
      for (const product of productsPage1) {
        report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        report += `#P2-${product.index} ${product.name}\n`;
        report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
        report += `Price: ${product.price || 'N/A'}\n`;
        report += `Rating: ${product.rating || 'N/A'}\u2b50\n`;
        report += `Sold: ${product.sold || 'N/A'}\n`;
        report += `URL: ${product.url}\n\n`;
      }
    }

    report += Instructions.SCRAPE_LISTINGS_NEXT_STEP;

    const allProducts = [...productsPage0, ...productsPage1];

    return {
      success: true,
      count: allProducts.length,
      data: report,
      products: allProducts
    };
  }

  async function getPageInfo() {
    await ensureScraperReady(mullion.page, 10000);
    return mullion.page.evaluate(() => window.__shoppingAssistantScraper.getCurrentPageInfo());
  }

  async function waitForContent(timeout = 5000) {
    await ensureScraperReady(mullion.page, timeout);
    const status = await mullion.page.evaluate(() => window.__shoppingAssistantScraper.checkProductsLoaded());
    return { success: true, ...status };
  }

  async function waitForDeepScraperReady(page, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const ready = await page.evaluate(() => {
        return !!(window.__shoppingAssistantDeepScrape && window.__shoppingAssistantDeepScrape.ready());
      });
      if (ready) {
        return true;
      }
      await wait(500);
    }
    throw new Error('Deep scraper not ready after timeout');
  }

  async function deepScrapeUrls(urls, onProgress) {
    if (!urls || urls.length === 0) {
      return { error: 'No URLs provided. Please provide an array of product URLs to deep scrape.' };
    }

    const results = [];
    if (onProgress) onProgress(0, urls.length);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let tab;
      try {
        tab = await mullion.tabs.create(url);
        await tab.waitForLoadState('domcontentloaded');
        await waitForDeepScraperReady(tab, 20000);
        const report = await tab.evaluate(() => window.__shoppingAssistantDeepScrape.run());
        results.push({ url, success: true, data: report });
      } catch (error) {
        results.push({ url, success: false, error: error.message });
      } finally {
        if (tab) {
          try {
            await mullion.tabs.close(tab);
          } catch (e) {
            // ignore close errors
          }
        }
      }

      if (onProgress) onProgress(i + 1, urls.length);
    }

    let report = `=== DEEP SCRAPE RESULTS ===\n`;
    report += `URLs Processed: ${results.length}\n`;
    report += `Successful: ${results.filter((r) => r.success).length}\n\n`;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n`;
      report += `PRODUCT ${i + 1}/${results.length}\n`;
      report += `URL: ${result.url}\n`;
      report += `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\n\n`;

      if (result.success) {
        report += result.data + '\n';
      } else {
        report += `\u26a0\ufe0f SCRAPE FAILED: ${result.error}\n`;
      }
      report += '\n';
    }

    return {
      success: true,
      count: results.length,
      successful: results.filter((r) => r.success).length,
      data: report
    };
  }

  async function serperSearch(query) {
    const settings = await mullion.storage.get('settings', {});
    const apiKey = settings.serperApiKey;
    if (!apiKey) {
      return { error: 'Serper API Key is missing. Please add it in settings.' };
    }

    const queries = query
      .split(';')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (queries.length === 0) {
      return { error: 'No valid queries found.' };
    }

    const headers = {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    };

    const results = await Promise.all(
      queries.map(async (q) => {
        try {
          const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers,
            body: JSON.stringify({ q })
          });
          const result = await response.json();
          return { query: q, result, success: true };
        } catch (error) {
          return { query: q, error: error.message, success: false };
        }
      })
    );

    let report = `=== SERPER SEARCH RESULTS ===\n`;

    for (const item of results) {
      report += `\n\uD83D\uDD0E Query: "${item.query}"\n`;
      report += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;

      if (!item.success) {
        report += `Error: ${item.error}\n`;
        continue;
      }

      const result = item.result;
      let hasResults = false;

      if (result.organic && result.organic.length > 0) {
        hasResults = true;
        result.organic.slice(0, 4).forEach((org, index) => {
          report += `${index + 1}. ${org.title}\n`;
          report += `   URL: ${org.link}\n`;
          report += `   Snippet: ${org.snippet}\n\n`;
        });
      }

      if (result.knowledgeGraph) {
        hasResults = true;
        report += `[Knowledge Graph]\n`;
        report += `Title: ${result.knowledgeGraph.title}\n`;
        report += `Type: ${result.knowledgeGraph.type}\n`;
        if (result.knowledgeGraph.description) {
          report += `Description: ${result.knowledgeGraph.description}\n`;
        }
        if (result.knowledgeGraph.attributes) {
          for (const [key, value] of Object.entries(result.knowledgeGraph.attributes)) {
            report += `${key}: ${value}\n`;
          }
        }
        report += `\n`;
      }

      if (!hasResults) {
        report += 'No relevant results found.\n';
      }
    }

    report += `\n\uD83D\uDCA1 Analysis Tip: Cross-reference findings across these search results to verify product consistency.`;

    return {
      success: true,
      data: report,
      queryCount: queries.length,
      raw: results
    };
  }

  async function execute(toolName, args = {}, onProgress) {
    switch (toolName) {
      case 'search_shopee':
        return searchShopee(args.keyword);
      case 'scrape_listings':
        return scrapeListings(args.max_items || 1000);
      case 'deep_scrape_urls':
        return deepScrapeUrls(args.urls || [], onProgress);
      case 'serper_search':
        return serperSearch(args.query);
      case 'get_page_info':
        return getPageInfo();
      case 'wait_for_content':
        return waitForContent(args.timeout || 5000);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  return {
    execute,
    searchShopee,
    scrapeListings,
    deepScrapeUrls,
    serperSearch,
    getPageInfo,
    waitForContent
  };
}

module.exports = { createToolExecutor };
