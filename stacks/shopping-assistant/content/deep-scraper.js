/**
 * Shopee Deep Scraper - Product Page Intelligence
 * Adapted for Mullion stack execution.
 */

(function () {
  'use strict';

  if (!window.location.href.match(/-i\.\d+\.\d+/)) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let isReady = false;

  async function scrollUntilElementFound(selector) {
    return new Promise(async (resolve) => {
      if (document.querySelector(selector)) {
        const el = document.querySelector(selector);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return resolve(el);
      }

      let retries = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 100);
        const el = document.querySelector(selector);
        const atBottom = (window.innerHeight + window.scrollY) >= document.body.offsetHeight - 100;

        if (el) {
          clearInterval(timer);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          resolve(el);
        } else if (atBottom) {
          retries++;
          if (retries > 20) {
            clearInterval(timer);
            resolve(null);
          }
        }
      }, 50);
    });
  }

  async function jiggleScroll() {
    window.scrollBy(0, 50);
    await wait(200);
    window.scrollBy(0, -20);
  }

  async function deepScrape() {
    let finalReport = "";

    await wait(3000);

    if (!document.querySelector('.product-briefing') && !document.querySelector('.page-product')) {
      await wait(2000);
    }

    finalReport += "=== \uD83D\uDCB0 VARIATION PRICES ===\n";

    const varButtons = document.querySelectorAll('button.product-variation, button.sApkZm');
    if (varButtons.length > 0) {
      for (let b of varButtons) {
        if (b.getAttribute('aria-disabled') === 'true') continue;
        b.click();
        await jiggleScroll();
        await wait(2000);
        const price = document.querySelector('.IZPeQz')?.innerText || "N/A";
        const name = b.getAttribute('aria-label') || b.innerText;
        finalReport += `- ${name}: ${price}\n`;
      }
    } else {
      const singlePrice = document.querySelector('.IZPeQz')?.innerText;
      if (singlePrice) finalReport += `Single Price: ${singlePrice}\n`;
    }
    finalReport += "\n";

    finalReport += "=== \uD83C\uDFEA SHOP INFORMATION ===\n";

    const shopSection = document.querySelector('.page-product__shop, section.page-product__shop');
    if (shopSection) {
      const shopName = shopSection.querySelector('.fV3TIn, [class*="shop-name"]')?.innerText?.trim();
      if (shopName) finalReport += `Shop Name: ${shopName}\n`;

      const activeStatus = shopSection.querySelector('.Fsv0YO, [class*="active-time"]')?.innerText?.trim();
      if (activeStatus) finalReport += `Active Status: ${activeStatus}\n`;

      const statItems = shopSection.querySelectorAll('.YnZi6x');
      if (statItems.length > 0) {
        finalReport += "--- Shop Stats ---\n";
        statItems.forEach((item) => {
          const label = item.querySelector('.ffHYws, label')?.innerText?.trim() || '';
          const value = item.querySelector('.Cs6w3G, span:not(.ffHYws)')?.innerText?.trim() || '';
          if (label && value) {
            finalReport += `\u2022 ${label}: ${value}\n`;
          }
        });
      }
    } else {
      finalReport += "\u26A0\uFE0F Shop information section not found.\n";
    }
    finalReport += "\n";

    const descElement = await scrollUntilElementFound('.product-detail');
    finalReport += "=== \uD83D\uDCDD PRODUCT DETAILS ===\n";
    if (descElement) {
      await wait(1500);
      finalReport += descElement.innerText.replace(/\n\s*\n\s*\n/g, '\n\n');
    } else {
      finalReport += "\u26A0\uFE0F Description Not Found.";
    }
    finalReport += "\n\n";

    const navBar = await scrollUntilElementFound('.product-ratings__page-controller, .shopee-page-controller');
    await wait(2000);

    if (navBar) {
      const summary = document.querySelector('.product-rating-overview__score-wrapper')?.innerText || "Summary N/A";
      finalReport += `=== \uD83D\uDCCA RATING STATISTICS (Score: ${summary}) ===\n`;

      const filters = document.querySelectorAll('.product-rating-overview__filter');
      const starLabels = ["5 Star", "4 Star", "3 Star", "2 Star", "1 Star"];

      if (filters.length >= 6) {
        for (let i = 0; i < 5; i++) {
          const filterText = filters[i + 1].innerText;
          const count = filterText.match(/\((.*?)\)/);
          const countText = count ? count[0] : "(0)";
          finalReport += `\u2022 ${starLabels[i]} Count: ${countText}\n`;
        }
        finalReport += "\n";

        for (let i = 0; i < 5; i++) {
          filters[i + 1].click();
          await wait(2000);

          finalReport += `--- \uD83D\uDCC2 ${starLabels[i]} Comments ---\n`;

          const comments = document.querySelectorAll('.shopee-product-rating__main, .meQyXP');
          const authors = document.querySelectorAll('.shopee-product-rating__author-name, .InK5kS');

          if (comments.length > 0) {
            comments.forEach((c, index) => {
              let text = c.innerText.trim().replace(/Membantu\?|Respon Penjual:|Laporkan Penyalahgunaan/g, "");
              let author = authors[index] ? authors[index].innerText : "User";
              if (text.length > 3) finalReport += `\u2022 [${author}]: ${text}\n`;
            });
          } else {
            finalReport += "(No text reviews found)\n";
          }
          finalReport += "\n";
        }
      }
    } else {
      finalReport += "\n\u26A0\uFE0F Review Navigation Bar not found.";
    }

    return finalReport;
  }

  window.__shoppingAssistantDeepScrape = {
    run: deepScrape,
    ready: () => isReady
  };

  const initInterval = setInterval(() => {
    const pageTarget = document.querySelector('.page-product') || document.querySelector('.product-briefing');
    if (pageTarget) {
      isReady = true;
      clearInterval(initInterval);
    }
  }, 500);

  setTimeout(() => {
    if (!isReady) {
      isReady = true;
      clearInterval(initInterval);
    }
  }, 15000);
})();
