/**
 * Shopee Shopping Assistant - Shopee Scraper Bridge
 * Provides scraping helpers for Mullion stack execution.
 */

(function () {
  'use strict';

  if (window.__shoppingAssistantScraper) return;

  function searchShopee(keyword) {
    const encodedKeyword = encodeURIComponent(keyword);
    const url = `https://shopee.co.id/search?keyword=${encodedKeyword}`;
    window.location.href = url;
    return { success: true, url };
  }

  function getCurrentPageInfo() {
    const url = window.location.href;
    let pageType = 'unknown';
    if (url.includes('/search')) pageType = 'search';
    else if (url.includes('/product/') || url.match(/-i\./)) pageType = 'product';
    else pageType = 'home';

    return { url, pageType, title: document.title };
  }

  function extractPrice(element) {
    const allText = element.innerText;
    const priceMatch = allText.match(/Rp\s*([\d.,]+)/);
    if (priceMatch) {
      const cleaned = priceMatch[1].replace(/\./g, '').replace(/,/g, '');
      const price = parseInt(cleaned, 10);
      if (!isNaN(price) && price > 0) {
        return `Rp${priceMatch[1]}`;
      }
    }
    return null;
  }

  function extractTitle(element) {
    const img = element.querySelector('img[alt]:not([alt=""])');
    if (img && img.alt && img.alt.length > 5 && !img.alt.includes('flag') && !img.alt.includes('star')) {
      return img.alt.trim();
    }

    const titleDiv = element.querySelector('.line-clamp-2, [class*="line-clamp"]');
    if (titleDiv) {
      let text = '';
      titleDiv.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += node.textContent;
        }
      });
      if (text.trim().length > 5) {
        return text.trim();
      }
      return titleDiv.textContent.trim();
    }

    return 'Unknown Product';
  }

  function extractUrl(element) {
    const link = element.querySelector('a[href*="-i."]');
    if (link) {
      let href = link.getAttribute('href');
      if (href.startsWith('/')) {
        href = 'https://shopee.co.id' + href;
      }
      try {
        const url = new URL(href);
        return url.origin + url.pathname;
      } catch (e) {
        return href.split('?')[0];
      }
    }
    return null;
  }

  function extractImage(element) {
    const img = element.querySelector('img[src*="susercontent"]');
    if (img) {
      return img.src || img.getAttribute('data-src') || null;
    }
    return null;
  }

  function extractSold(element) {
    const text = element.innerText;
    const soldMatch = text.match(/([\d.,]+)\s*(RB|rb|K|k)?\+?\s*Terjual/i);
    if (soldMatch) {
      let count = soldMatch[1];
      let suffix = soldMatch[2] || '';
      return `${count}${suffix.toUpperCase()}+ Terjual`;
    }

    const simpleMatch = text.match(/(\d[\d.,]*)\s*Terjual/i);
    if (simpleMatch) {
      return `${simpleMatch[1]} Terjual`;
    }

    return null;
  }

  function extractRating(element) {
    const text = element.innerText;
    const ratingMatch = text.match(/\b([1-5]\.\d)\b/);
    if (ratingMatch) {
      return parseFloat(ratingMatch[1]);
    }

    const ratingEls = element.querySelectorAll('[class*="rating"], [class*="star"]');
    for (const el of ratingEls) {
      const match = el.textContent.match(/([1-5]\.\d)/);
      if (match) {
        return parseFloat(match[1]);
      }
    }

    return null;
  }

  async function scrapeListings(maxItems = 100) {
    const scrapedUrls = new Set();
    const products = [];
    let isControllerFound = false;

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let lastScrollY = window.scrollY;
    let noScrollCount = 0;

    while (!isControllerFound) {
      const items = document.querySelectorAll('li.shopee-search-item-result__item, [data-sqe="item"]');

      if (items.length > 0) {
        for (const item of items) {
          const url = extractUrl(item);
          if (!url) continue;

          if (scrapedUrls.has(url)) {
            continue;
          }

          const product = {
            index: products.length + 1,
            name: extractTitle(item),
            price: extractPrice(item),
            rating: extractRating(item),
            sold: extractSold(item),
            url: url,
            image: extractImage(item)
          };

          if (product.name && product.url) {
            scrapedUrls.add(url);
            products.push(product);
          }
        }
      }

      const controller = document.querySelector('.shopee-page-controller, .shopee-page-controller-v2');
      if (controller) {
        const rect = controller.getBoundingClientRect();
        if (rect.top < window.innerHeight + 100) {
          isControllerFound = true;
          break;
        }
      }

      window.scrollBy({
        top: 400,
        behavior: 'smooth'
      });

      await delay(800);

      if (window.scrollY === lastScrollY) {
        noScrollCount++;
        if (noScrollCount > 5) {
          break;
        }
      } else {
        noScrollCount = 0;
        lastScrollY = window.scrollY;
      }

      if (products.length >= maxItems && maxItems < 100) {
        break;
      }
    }

    return products;
  }

  function checkProductsLoaded() {
    const items = document.querySelectorAll('li.shopee-search-item-result__item, [data-sqe="item"]');
    return {
      loaded: items.length > 0,
      count: items.length
    };
  }

  window.__shoppingAssistantScraper = {
    searchShopee,
    getCurrentPageInfo,
    scrapeListings,
    checkProductsLoaded
  };
})();
