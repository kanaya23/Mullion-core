const { createToolExecutor } = require('./lib/tools');
const { runGeminiNative } = require('./lib/gemini-native');
const { runGeminiWeb } = require('./lib/gemini-web');

const DEFAULT_SETTINGS = {
  apiMode: 'native',
  geminiModel: 'gemini-2.5-flash',
  geminiMode: 'fast',
  geminiUrl: 'https://gemini.google.com/u/0/app',
  geminiApiKey: null,
  serperApiKey: null
};

async function loadSettings(storage) {
  const saved = await storage.get('settings', {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

function mergeSettings(current, updates) {
  const next = { ...current };
  Object.entries(updates).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    next[key] = value;
  });
  return next;
}

function buildUiSettings(settings) {
  return {
    apiMode: settings.apiMode,
    geminiModel: settings.geminiModel,
    geminiMode: settings.geminiMode,
    geminiUrl: settings.geminiUrl,
    hasGeminiApiKey: Boolean(settings.geminiApiKey),
    hasSerperApiKey: Boolean(settings.serperApiKey)
  };
}

function filterDisplayMessages(messages) {
  return messages.filter((msg) => msg.content && (msg.role === 'user' || msg.role === 'assistant'));
}

module.exports = async function (mullion, params) {
  const storage = mullion.storage;
  const action = params.action || 'send_message';
  const toolExecutor = createToolExecutor(mullion);

  if (action === 'bootstrap') {
    const settings = await loadSettings(storage);
    const conversation = await storage.get('conversation', []);
    return {
      settings: buildUiSettings(settings),
      conversation: filterDisplayMessages(conversation)
    };
  }

  if (action === 'get_settings') {
    const settings = await loadSettings(storage);
    return { settings: buildUiSettings(settings) };
  }

  if (action === 'save_settings') {
    const current = await loadSettings(storage);
    const next = mergeSettings(current, {
      geminiApiKey: params.apiKey,
      serperApiKey: params.serperKey,
      geminiModel: params.model,
      apiMode: params.apiMode,
      geminiUrl: params.geminiUrl,
      geminiMode: params.geminiMode
    });
    await storage.set('settings', next);
    return { success: true, settings: buildUiSettings(next) };
  }

  if (action === 'clear_conversation') {
    await storage.set('conversation', []);
    return { success: true };
  }

  if (action === 'get_conversation') {
    const conversation = await storage.get('conversation', []);
    return { conversation: filterDisplayMessages(conversation) };
  }

  if (action === 'test_tool') {
    const toolName = params.toolAction;
    const toolParams = params.toolParams || {};
    if (!toolName) {
      throw new Error('toolAction is required for test_tool');
    }
    const result = await toolExecutor.execute(toolName, toolParams);
    return { result };
  }

  if (action !== 'send_message') {
    throw new Error(`Unknown action: ${action}`);
  }

  const messageText = (params.message || '').trim();
  if (!messageText) {
    throw new Error('message is required');
  }

  const settings = await loadSettings(storage);
  const conversation = await storage.get('conversation', []);

  const userContent = params.single_pick_mode ? `${messageText} {Single_pick_mode}` : messageText;
  conversation.push({ role: 'user', content: userContent });

  let result;
  if (settings.apiMode === 'web') {
    result = await runGeminiWeb({ mullion, messages: conversation, toolExecutor, settings });
  } else {
    result = await runGeminiNative({ messages: conversation, toolExecutor, settings });
  }

  await storage.set('conversation', conversation);

  return {
    success: true,
    response: result.text,
    toolEvents: result.toolEvents || [],
    conversation: filterDisplayMessages(conversation)
  };
};
