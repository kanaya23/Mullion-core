const { Instructions } = require('./instructions');

const TOOL_DEFINITIONS = [
  {
    functionDeclarations: [
      {
        name: 'search_shopee',
        description: 'Search for products on Shopee Indonesia. Generate a SPECIFIC, POINTED query to find the best results.',
        parameters: {
          type: 'object',
          properties: {
            keyword: {
              type: 'string',
              description: 'The search keyword. Refine the user query to be more specific and pointed to get the best results.'
            }
          },
          required: ['keyword']
        }
      },
      {
        name: 'scrape_listings',
        description: 'Extract product listings from the current Shopee search results page. Returns BASIC INFO: name, price, rating, sold count, URL.',
        parameters: {
          type: 'object',
          properties: {
            max_items: {
              type: 'integer',
              description: 'Maximum number of products to extract (default: 20)'
            }
          }
        }
      },
      {
        name: 'deep_scrape_urls',
        description: 'Deep scrape specific product URLs to get DETAILED INFO: variation prices, product description, rating statistics, and sample reviews.',
        parameters: {
          type: 'object',
          properties: {
            urls: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of product URLs to deep scrape.'
            }
          },
          required: ['urls']
        }
      },
      {
        name: 'serper_search',
        description: 'Perform a Google search using Serper API. Use this after scraping listings to get external reviews/specs.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query (or multiple queries separated by ";").'
            }
          },
          required: ['query']
        }
      }
    ]
  }
];

const DEFAULT_MODEL = 'gemini-2.5-flash';

async function sendGeminiRequest(messages, settings) {
  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new Error('API key not configured. Please set your Gemini API key in settings.');
  }

  const model = settings.geminiModel || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : msg.role,
    parts: msg.parts || [{ text: msg.content }]
  }));

  const body = {
    contents,
    tools: TOOL_DEFINITIONS,
    systemInstruction: {
      parts: [{ text: Instructions.NATIVE_SYSTEM_PROMPT }]
    },
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  const parts = candidate?.content?.parts || [];

  let text = '';
  const toolCalls = [];

  for (const part of parts) {
    if (part.text) {
      text += part.text;
    }
    if (part.functionCall) {
      toolCalls.push(part.functionCall);
    }
  }

  return { text, toolCalls };
}

async function runGeminiNative({ messages, toolExecutor, settings }) {
  const toolUsage = {
    search_shopee: 0,
    scrape_listings: 0,
    serper_search: 0
  };

  const TOOL_LIMITS = {
    search_shopee: 2,
    scrape_listings: 2,
    deep_scrape_urls: 2,
    serper_search: 5
  };

  let scrapedData = null;
  let loopCount = 0;
  const MAX_LOOPS = 5;
  const toolEvents = [];

  let response = await sendGeminiRequest(messages, settings);

  while (response.toolCalls && response.toolCalls.length > 0 && loopCount < MAX_LOOPS) {
    loopCount++;

    const toolCall = response.toolCalls[0];
    const toolName = toolCall.name;

    messages.push({
      role: 'model',
      parts: [{ functionCall: toolCall }]
    });

    toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
    const limit = TOOL_LIMITS[toolName] || 1;
    let result;

    if (toolUsage[toolName] > limit) {
      result = {
        error: 'LIMIT_REACHED',
        message: `You have already used the ${toolName} tool in this turn. Do NOT call it again.`,
        existingData: scrapedData
      };
      toolEvents.push({ name: toolName, status: 'limited' });
    } else {
      result = await toolExecutor.execute(toolName, toolCall.args || {});
      if (toolName === 'scrape_listings' && result.data) {
        scrapedData = result.data;
      }
      toolEvents.push({ name: toolName, status: result.error ? 'error' : 'complete' });
    }

    messages.push({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: result
          }
        }
      ]
    });

    response = await sendGeminiRequest(messages, settings);
  }

  if (loopCount >= MAX_LOOPS) {
    toolEvents.push({ name: 'tool_loop', status: 'limited' });
  }

  if (response.text) {
    messages.push({ role: 'assistant', content: response.text });
  }

  return { text: response.text || '', toolEvents };
}

module.exports = { runGeminiNative };
