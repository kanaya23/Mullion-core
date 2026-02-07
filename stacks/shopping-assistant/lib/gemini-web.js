const { Instructions } = require('./instructions');

const SELECTORS = {
  editableDiv: 'div.ql-editor.textarea',
  sendButton: 'button:has(mat-icon[fonticon="send"])',
  responseBlock: '.presented-response-container',
  textData: '.markdown-main-panel'
};

const MODE_SELECTORS = {
  modePillButton: 'button:has(.logo-pill-label-container)',
  modePillLabel: '.logo-pill-label-container span',
  modeMenu: 'mat-bottom-sheet-container .bard-mode-bottom-sheet',
  fastOption: '[data-test-id="bard-mode-option-fast"]',
  thinkingOption: '[data-test-id="bard-mode-option-thinking"]',
  proOption: '[data-test-id="bard-mode-option-pro"]'
};

const DEFAULT_URL = 'https://gemini.google.com/u/0/app';

function cleanResponseText(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/^[\s.\u2026]+/g, '');
  cleaned = cleaned.replace(/^(JSON|json)\s*/i, '');
  cleaned = cleaned.replace(/^(Here'?s?|Output|Response|Result)[\s:]+/i, '');
  cleaned = cleaned.replace(/Shopping-Gem/gi, '');
  cleaned = cleaned.replace(/Custom Gem/gi, '');
  cleaned = cleaned.replace(/You stopped this response/gi, '');
  cleaned = cleaned.replace(/[^\S\n]+/g, ' ');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

function extractToolCall(text) {
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      if (json.tool && json.args !== undefined) return json;
    } catch (e) {
      // ignore
    }
  }

  let startIndex = text.indexOf('{');
  while (startIndex !== -1) {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let endIndex = -1;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIndex = i;
            break;
          }
        }
      }
    }

    if (endIndex !== -1) {
      const candidate = text.substring(startIndex, endIndex + 1);
      try {
        const json = JSON.parse(candidate);
        if (json.tool && json.args !== undefined) {
          return json;
        }
      } catch (e) {
        // ignore
      }
    }

    startIndex = text.indexOf('{', startIndex + 1);
  }

  return null;
}

async function getCurrentMode(page) {
  return page.evaluate((selector) => {
    const label = document.querySelector(selector);
    if (!label) return null;
    const text = label.textContent.trim().toLowerCase();
    if (text.includes('fast')) return 'fast';
    if (text.includes('thinking')) return 'thinking';
    if (text.includes('pro')) return 'pro';
    return null;
  }, MODE_SELECTORS.modePillLabel);
}

async function ensureMode(page, targetMode) {
  if (!targetMode) return;
  const currentMode = await getCurrentMode(page);
  if (currentMode === targetMode) return;

  await page.click(MODE_SELECTORS.modePillButton).catch(() => null);
  await page.waitForTimeout(500);

  let optionSelector = MODE_SELECTORS.fastOption;
  if (targetMode === 'thinking') optionSelector = MODE_SELECTORS.thinkingOption;
  if (targetMode === 'pro') optionSelector = MODE_SELECTORS.proOption;

  await page.click(optionSelector).catch(() => null);
  await page.waitForTimeout(800);
}

async function sendPrompt(page, promptText) {
  const startCount = await page.$$eval(SELECTORS.responseBlock, (nodes) => nodes.length);

  await page.waitForSelector(SELECTORS.editableDiv, { timeout: 30000 });
  await page.evaluate(
    ({ selector, text }) => {
      const editor = document.querySelector(selector);
      if (!editor) throw new Error('Gemini Editor not found on page');
      editor.focus();
      editor.innerHTML = '';
      editor.innerText = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { selector: SELECTORS.editableDiv, text: promptText }
  );

  await page.click(SELECTORS.sendButton, { timeout: 15000 });

  await page.waitForFunction(
    ({ selector, count }) => document.querySelectorAll(selector).length > count,
    { timeout: 180000 },
    { selector: SELECTORS.responseBlock, count: startCount }
  );

  await page.waitForFunction(() => {
    const stopButton = document.querySelector('button.send-button.stop mat-icon[fonticon="stop"]');
    return !stopButton;
  }, { timeout: 180000 });

  const responseText = await page.evaluate((selectors) => {
    const responses = document.querySelectorAll(selectors.responseBlock);
    if (!responses.length) return '';
    const latest = responses[responses.length - 1];
    const textElement = latest.querySelector(selectors.textData);
    if (!textElement) return latest.innerText.trim();

    const clone = textElement.cloneNode(true);
    const links = clone.querySelectorAll('a[href]');
    links.forEach((link) => {
      const fullUrl = link.getAttribute('href');
      if (fullUrl && fullUrl.startsWith('http')) {
        link.textContent = fullUrl;
      }
    });

    const linkBlocks = clone.querySelectorAll('link-block a[href]');
    linkBlocks.forEach((link) => {
      const fullUrl = link.getAttribute('href');
      if (fullUrl && fullUrl.startsWith('http')) {
        link.textContent = fullUrl;
      }
    });

    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-9999px';
    wrapper.style.top = '-9999px';
    wrapper.style.opacity = '0';
    wrapper.style.pointerEvents = 'none';
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    let text = clone.innerText.trim();
    if (!text) {
      text = clone.textContent.trim();
    }

    document.body.removeChild(wrapper);
    return text || textElement.textContent.trim();
  }, SELECTORS);

  return responseText;
}

async function runGeminiWeb({ mullion, messages, toolExecutor, settings }) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    throw new Error('No user message found to send.');
  }

  const targetUrl = settings.geminiUrl || DEFAULT_URL;
  const page = await mullion.tabs.create(targetUrl);
  const toolEvents = [];
  let finalResponse = '';

  try {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    await ensureMode(page, settings.geminiMode || 'fast');

    let currentPrompt = Instructions.WEB_TOOL_PROTOCOL + (lastMessage.content || '');
    let turnCount = 0;
    const MAX_TURNS = 15;
    const executedTools = new Map();

    while (turnCount < MAX_TURNS) {
      turnCount++;
      let responseText = await sendPrompt(page, currentPrompt);
      responseText = cleanResponseText(responseText);

      const toolCallBlock = extractToolCall(responseText);
      if (!toolCallBlock) {
        finalResponse = responseText;
        break;
      }

      const toolKey = `${toolCallBlock.tool}:${JSON.stringify(toolCallBlock.args)}`;
      if (executedTools.has(toolKey)) {
        currentPrompt = 'Continue with the next step. Do NOT repeat the previous tool call.';
        continue;
      }

      let toolResult;
      if (toolCallBlock.tool === 'serper_search') {
        toolResult = {
          skipped: true,
          message: 'serper_search is not needed in Web API mode. Please use your native Google Search capability instead.'
        };
      } else {
        toolResult = await toolExecutor.execute(toolCallBlock.tool, toolCallBlock.args || {});
      }

      executedTools.set(toolKey, toolResult);
      toolEvents.push({ name: toolCallBlock.tool, status: toolResult.error ? 'error' : 'complete' });

      currentPrompt = `Tool '${toolCallBlock.tool}' completed successfully.\n\nResult: ${JSON.stringify(toolResult)}\n\nPlease continue with the NEXT step in the workflow.`;
    }

    if (!finalResponse && turnCount >= MAX_TURNS) {
      finalResponse = '⚠️ Maximum tool iterations reached. Please try a simpler query.';
    }
  } finally {
    try {
      await mullion.tabs.close(page);
    } catch (e) {
      // ignore close errors
    }
  }

  if (finalResponse) {
    messages.push({ role: 'assistant', content: finalResponse });
  }

  return { text: finalResponse || '', toolEvents };
}

module.exports = { runGeminiWeb };
