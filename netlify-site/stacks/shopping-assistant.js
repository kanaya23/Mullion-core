/**
 * Mullion Shopping Assistant UI
 * Adapts the extension sidebar to Mullion stack execution.
 */

(function () {
  'use strict';

  const STACK_NAME = 'shopping-assistant';

  const chatContainer = document.getElementById('chat-container');
  const welcomeMessage = document.getElementById('welcome-message');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const stopBtn = document.getElementById('stop-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const clearBtn = document.getElementById('clear-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const modalClose = document.getElementById('modal-close');
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleKeyBtn = document.getElementById('toggle-key');
  const serperKeyInput = document.getElementById('serper-key-input');
  const toggleSerperKeyBtn = document.getElementById('toggle-serper-key');
  const saveApiKeyBtn = document.getElementById('save-api-key');
  const apiKeyBanner = document.getElementById('api-key-banner');
  const openSettingsBanner = document.getElementById('open-settings-banner');
  const toolStatus = document.getElementById('tool-status');
  const toolStatusText = document.getElementById('tool-status-text');
  const modeToggleBtn = document.getElementById('mode-toggle-btn');

  let isProcessing = false;
  let singlePickMode = false;
  let currentStreamingMessage = null;
  let latestToolEvents = [];
  let abortController = null;

  const authHeaders = () => ({
    Authorization: `Bearer ${MULLION_TOKEN}`,
    'Content-Type': 'application/json'
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function wakeStack(taskParams) {
    const response = await fetch(`${MULLION_URL}/wake`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ stack_name: STACK_NAME, task_params: taskParams })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to start stack.');
    }

    const data = await response.json();
    return data.task_id;
  }

  async function pollTask(taskId, signal) {
    while (true) {
      if (signal?.aborted) {
        throw new Error('Generation stopped by user.');
      }
      const response = await fetch(`${MULLION_URL}/task/${taskId}`, { headers: authHeaders() });
      if (!response.ok) {
        throw new Error('Failed to fetch task status.');
      }
      const data = await response.json();
      if (data.status === 'done') {
        return data.result;
      }
      if (data.status === 'error') {
        throw new Error(data.error?.message || 'Task failed.');
      }
      await delay(2000);
    }
  }

  async function runStack(taskParams) {
    const taskId = await wakeStack(taskParams);
    abortController = new AbortController();
    try {
      return await pollTask(taskId, abortController.signal);
    } finally {
      abortController = null;
    }
  }

  function showToolStatus(text) {
    toolStatusText.textContent = text;
    toolStatus.classList.add('visible');
  }

  function hideToolStatus() {
    toolStatus.classList.remove('visible');
  }

  function createMessageShell(role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = `message-avatar ${role}`;
    avatar.textContent = role === 'assistant' ? 'AI' : 'ME';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    bubble.appendChild(contentDiv);
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);

    return { messageDiv, contentDiv, bubble };
  }

  function addMessage(content, role) {
    const { messageDiv, contentDiv } = createMessageShell(role);
    contentDiv.innerHTML = formatMarkdown(content);
    chatContainer.appendChild(messageDiv);
    scrollToBottom();
    return messageDiv;
  }

  function startStreamingMessage() {
    hideWelcome();

    const { messageDiv, contentDiv } = createMessageShell('assistant');
    messageDiv.id = 'streaming-message';

    const textContent = document.createElement('div');
    textContent.className = 'text-content';
    textContent.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';

    const toolContent = document.createElement('div');
    toolContent.className = 'tool-content';

    contentDiv.appendChild(textContent);
    contentDiv.appendChild(toolContent);
    chatContainer.appendChild(messageDiv);
    scrollToBottom();

    currentStreamingMessage = {
      div: messageDiv,
      content: '',
      hasTools: false
    };
  }

  function appendToStreamingMessage(content) {
    if (!currentStreamingMessage) return;

    if (content === '__CLEAR__') {
      currentStreamingMessage.content = '';
      const textContent = currentStreamingMessage.div.querySelector('.text-content');
      if (textContent) {
        textContent.innerHTML = '';
      }
      return;
    }

    currentStreamingMessage.content += content;
    const textContent = currentStreamingMessage.div.querySelector('.text-content');
    if (textContent) {
      textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
    }
    scrollToBottom();
  }

  function finalizeStreamingMessage() {
    if (!currentStreamingMessage) return;

    const textContent = currentStreamingMessage.div.querySelector('.text-content');

    if (currentStreamingMessage.content) {
      if (textContent) textContent.innerHTML = formatMarkdown(currentStreamingMessage.content);
    } else if (!currentStreamingMessage.hasTools) {
      currentStreamingMessage.div.remove();
    } else if (textContent && textContent.querySelector('.typing-indicator')) {
      textContent.remove();
    }

    currentStreamingMessage = null;
    scrollToBottom();
  }

  function addToolBadge(target, toolName, status) {
    const badge = document.createElement('div');
    badge.className = `tool-call-badge ${status}`;
    badge.dataset.tool = toolName;
    badge.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/>
      </svg>
      <span>${formatToolName(toolName)}</span>
    `;

    const toolContent = target.querySelector('.tool-content');
    if (toolContent) {
      toolContent.appendChild(badge);
    } else {
      target.querySelector('.message-content')?.appendChild(badge);
    }
  }

  function renderToolEvents(toolEvents) {
    if (!toolEvents || toolEvents.length === 0) return;
    const messages = chatContainer.querySelectorAll('.message.assistant');
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return;

    const content = lastMessage.querySelector('.message-content');
    if (!content) return;

    let toolContent = content.querySelector('.tool-content');
    if (!toolContent) {
      toolContent = document.createElement('div');
      toolContent.className = 'tool-content';
      content.appendChild(toolContent);
    }

    toolEvents.forEach((event) => {
      addToolBadge(lastMessage, event.name, event.status === 'complete' ? 'complete' : 'executing');
    });
  }

  function addErrorMessage(error) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
      </svg>
      <span>${escapeHtml(error)}</span>
    `;
    chatContainer.appendChild(errorDiv);
    scrollToBottom();
  }

  function formatToolName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatMarkdown(content) {
    if (!content) return '';

    let html = escapeHtml(content);

    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="product-link">$1</a>');

    html = html.replace(
      /(?<!href="|">)(https?:\/\/[^\s<>"]+?)(?=[\s,)]|(\.\s)|$)/g,
      (match) => {
        if (match.includes('shopee.co.id')) {
          const productMatch = match.match(/shopee\.co\.id\/([^\?#]+)/);
          let productName = 'View Product';

          if (productMatch && productMatch[1]) {
            let slug = productMatch[1];
            slug = slug.replace(/-i\.\d+\.\d+.*$/, '');
            productName = slug.replace(/-/g, ' ').substring(0, 40) + '...';
          }

          return `<a href="${match}" target="_blank" class="product-link shopee-link">\uD83D\uDED2 ${productName}</a>`;
        }

        const displayUrl = match.length > 50 ? match.substring(0, 47) + '...' : match;
        return `<a href="${match}" target="_blank" class="external-link">\uD83D\uDD17 ${displayUrl}</a>`;
      }
    );

    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

    html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul><ul>/g, '');

    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function loadConversationHistory(messages) {
    clearChat(false);

    if (!messages || messages.length === 0) {
      showWelcome();
      return;
    }

    hideWelcome();
    messages.forEach((msg) => {
      if (msg.content) {
        addMessage(msg.content, msg.role);
      }
    });
  }

  function clearChat(showWelcomeMessage = true) {
    const messages = chatContainer.querySelectorAll('.message, .tool-call-badge, .error-message');
    messages.forEach((m) => m.remove());
    if (showWelcomeMessage) showWelcome();
  }

  function showWelcome() {
    welcomeMessage.style.display = 'block';
  }

  function hideWelcome() {
    welcomeMessage.style.display = 'none';
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function updateSendButton() {
    sendBtn.disabled = !messageInput.value.trim() || isProcessing;
  }

  function autoResizeInput() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  }

  function openSettingsModal() {
    settingsModal.classList.add('visible');
  }

  function closeSettingsModal() {
    settingsModal.classList.remove('visible');
  }

  function updateSettingsVisibility(mode) {
    const apiKeyGroup = document.getElementById('api-key-group');
    const modelGroup = document.getElementById('model-group');
    const geminiUrlGroup = document.getElementById('gemini-url-group');
    const serperKeyGroup = document.getElementById('serper-key-group');
    const geminiModeGroup = document.getElementById('gemini-mode-group');
    const isWeb = mode === 'web';

    if (apiKeyGroup) apiKeyGroup.style.display = isWeb ? 'none' : 'block';
    if (modelGroup) modelGroup.style.display = isWeb ? 'none' : 'block';
    if (serperKeyGroup) serperKeyGroup.style.display = isWeb ? 'none' : 'block';
    if (geminiUrlGroup) geminiUrlGroup.style.display = isWeb ? 'block' : 'none';
    if (geminiModeGroup) geminiModeGroup.style.display = isWeb ? 'block' : 'none';
  }

  function applySettings(settings) {
    if (!settings) return;

    const modelSelect = document.getElementById('model-select');
    if (modelSelect && settings.geminiModel) {
      modelSelect.value = settings.geminiModel;
    }

    const modeSelect = document.getElementById('api-mode-select');
    if (modeSelect && settings.apiMode) {
      modeSelect.value = settings.apiMode;
    }

    const geminiUrlInput = document.getElementById('gemini-url-input');
    if (geminiUrlInput && settings.geminiUrl) {
      geminiUrlInput.value = settings.geminiUrl;
    }

    const geminiModeSelect = document.getElementById('gemini-mode-select');
    if (geminiModeSelect && settings.geminiMode) {
      geminiModeSelect.value = settings.geminiMode;
    }

    updateSettingsVisibility(settings.apiMode || 'native');

    if (settings.apiMode !== 'web' && !settings.hasGeminiApiKey) {
      showApiKeyBanner();
    } else {
      hideApiKeyBanner();
    }
  }

  function toggleApiKeyVisibility() {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  }

  function toggleSerperKeyVisibility() {
    serperKeyInput.type = serperKeyInput.type === 'password' ? 'text' : 'password';
  }

  function showApiKeyBanner() {
    apiKeyBanner.classList.add('visible');
  }

  function hideApiKeyBanner() {
    apiKeyBanner.classList.remove('visible');
  }

  function showToast(message, isSuccess = true) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 120px; left: 50%; transform: translateX(-50%);
      background: ${isSuccess ? '#10B981' : '#EF4444'}; color: white;
      padding: 12px 20px; border-radius: 8px; font-size: 13px; z-index: 1000;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  async function saveSettings() {
    if (isProcessing) return;

    const apiKey = apiKeyInput.value.trim();
    const serperKey = serperKeyInput.value.trim();
    const modelSelect = document.getElementById('model-select');
    const model = modelSelect?.value || 'gemini-2.5-flash';
    const geminiUrlInput = document.getElementById('gemini-url-input');
    const geminiUrl = geminiUrlInput?.value.trim();
    const geminiModeSelect = document.getElementById('gemini-mode-select');
    const geminiMode = geminiModeSelect?.value || 'fast';
    const apiMode = document.getElementById('api-mode-select')?.value || 'native';

    try {
      showToolStatus('Saving settings...');
      const result = await runStack({
        action: 'save_settings',
        apiKey: apiKey || null,
        serperKey: serperKey || null,
        model,
        apiMode,
        geminiUrl: geminiUrl || null,
        geminiMode
      });
      applySettings(result.settings);
      closeSettingsModal();
      showToast('Settings saved!', true);
    } catch (error) {
      showToast(`Failed to save: ${error.message}`, false);
    } finally {
      hideToolStatus();
      apiKeyInput.value = '';
      serperKeyInput.value = '';
    }
  }

  async function sendMessage() {
    let text = messageInput.value.trim();
    if (!text || isProcessing) return;

    isProcessing = true;
    updateSendButton();

    addMessage(text, 'user');
    hideWelcome();

    startStreamingMessage();
    showToolStatus('Processing...');

    if (sendBtn) sendBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'flex';

    try {
      const result = await runStack({ action: 'send_message', message: text, single_pick_mode: singlePickMode });
      latestToolEvents = result.toolEvents || [];
      appendToStreamingMessage('__CLEAR__');
      appendToStreamingMessage(result.response || '');
      finalizeStreamingMessage();

      if (result.conversation) {
        loadConversationHistory(result.conversation);
      }

      renderToolEvents(latestToolEvents);
    } catch (error) {
      appendToStreamingMessage('__CLEAR__');
      finalizeStreamingMessage();
      addErrorMessage(error.message);
    } finally {
      isProcessing = false;
      hideToolStatus();
      if (stopBtn) stopBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'flex';
      updateSendButton();
    }

    messageInput.value = '';
  }

  async function clearConversation() {
    if (isProcessing) return;

    try {
      showToolStatus('Clearing conversation...');
      await runStack({ action: 'clear_conversation' });
      clearChat(true);
    } catch (error) {
      addErrorMessage(error.message);
    } finally {
      hideToolStatus();
    }
  }

  async function bootstrap() {
    try {
      showToolStatus('Loading assistant...');
      const result = await runStack({ action: 'bootstrap' });
      applySettings(result.settings);
      loadConversationHistory(result.conversation || []);
    } catch (error) {
      addErrorMessage(error.message);
    } finally {
      hideToolStatus();
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  messageInput.addEventListener('input', () => {
    updateSendButton();
    autoResizeInput();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (abortController) {
        abortController.abort();
      }
      isProcessing = false;
      stopBtn.style.display = 'none';
      sendBtn.style.display = 'flex';
      hideToolStatus();
      if (currentStreamingMessage) {
        const textContent = currentStreamingMessage.div.querySelector('.text-content');
        if (textContent) {
          textContent.innerHTML += '<br><em style="color: var(--warning);">\u23f9\ufe0f Generation stopped by user</em>';
        }
        finalizeStreamingMessage();
      }
    });
  }

  if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

  clearBtn.addEventListener('click', () => {
    if (confirm('Clear conversation?')) {
      clearConversation();
    }
  });

  settingsBtn.addEventListener('click', openSettingsModal);
  modalClose.addEventListener('click', closeSettingsModal);
  toggleKeyBtn.addEventListener('click', toggleApiKeyVisibility);
  if (toggleSerperKeyBtn) toggleSerperKeyBtn.addEventListener('click', toggleSerperKeyVisibility);
  saveApiKeyBtn.addEventListener('click', saveSettings);
  openSettingsBanner.addEventListener('click', openSettingsModal);

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  const apiModeSelect = document.getElementById('api-mode-select');
  if (apiModeSelect) {
    apiModeSelect.addEventListener('change', (e) => updateSettingsVisibility(e.target.value));
  }

  if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', () => {
      singlePickMode = !singlePickMode;
      modeToggleBtn.classList.toggle('active', singlePickMode);
      const label = modeToggleBtn.querySelector('.mode-label');
      if (label) {
        label.textContent = singlePickMode ? 'Single' : 'Normal';
      }
    });
  }

  const SUGGESTION_POOL = [
    { icon: '📱', label: 'Best mid-range phones 2024', message: 'Find me the best mid-range smartphones released in late 2023 or 2024 available on Shopee.' },
    { icon: '🎧', label: 'Wireless earbuds under 500k', message: 'Recommend top-rated true wireless earbuds under Rp 500.000 with good bass.' },
    { icon: '⌨️', label: 'Mechanical keyboards for work', message: 'Suggest mechanical keyboards suitable for office work, preferably silent switches.' },
    { icon: '🖱️', label: 'Ergonomic mouse cheap', message: 'Find affordable ergonomic mouse options for large hands.' },
    { icon: '🔋', label: '20000mAh power banks', message: 'Show me reliable 20.000mAh power banks with fast charging support.' },
    { icon: '🎮', label: 'Budget gaming headset', message: 'What are the best budget gaming headsets with a microphone under 300k?' },
    { icon: '🔧', label: 'Complete screwdriver set', message: 'Find a complete precision screwdriver set for repairing electronics.' },
    { icon: '💡', label: 'Smart LED bulbs', message: 'Compare affordable smart LED bulbs compatible with Google Home.' },
    { icon: '🍳', label: 'Non-stick frying pans', message: 'Recommend durable non-stick frying pans that are PFOA free.' },
    { icon: '🧹', label: 'Robot vacuum cleaners', message: 'Find good entry-level robot vacuum cleaners available on Shopee.' },
    { icon: '🪑', label: 'Ergonomic office chair', message: 'Look for high-rated ergonomic office chairs under 2 million.' },
    { icon: '🌡️', label: 'Digital thermometer', message: 'Find accurate digital thermometers for cooking.' },
    { icon: '👟', label: 'Running shoes for beginners', message: 'Suggest comfortable running shoes for beginners under 1 million.' },
    { icon: '🎒', label: 'Waterproof laptop backpack', message: 'Find a stylish waterproof backpack that fits a 15.6 inch laptop.' },
    { icon: '🕶️', label: 'Polarized sunglasses', message: 'Search for cool polarized sunglasses for driving.' },
    { icon: '🧴', label: 'Sunscreen for oily skin', message: 'Recommend popular sunscreens for oily and acne-prone skin.' },
    { icon: '🎁', label: 'Gift for tech lover', message: 'Give me 5 gift ideas for a tech enthusiast under Rp 200.000.' },
    { icon: '🎨', label: 'Watercolor starter set', message: 'Find a good quality watercolor painting set for beginners.' },
    { icon: '⛺', label: 'Camping tent for 2', message: 'Show me lightweight camping tents suitable for 2 people.' },
    { icon: '🚗', label: 'Car detailed cleaning kit', message: 'Find a complete car detailing kit with microfiber towels.' },
    { icon: '🆚', label: 'Sony vs JBL headphones', message: 'Compare Sony and JBL wireless headphones in the 1-2 million price range.' },
    { icon: '🆚', label: 'Logitech vs Razer mouse', message: 'Compare budget gaming mice from Logitech and Razer.' },
    { icon: '📊', label: 'Top rated air fryers', message: 'Find the top 3 rated air fryers on Shopee and compare their features.' }
  ];

  function getRandomSuggestions(count = 3) {
    const shuffled = [...SUGGESTION_POOL].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  }

  function renderSuggestions() {
    const container = document.querySelector('.suggestions');
    if (!container) return;

    container.innerHTML = '';
    const suggestions = getRandomSuggestions(3);

    suggestions.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'suggestion-chip';
      btn.innerHTML = `${item.icon} ${item.label}`;
      btn.addEventListener('click', () => {
        messageInput.value = item.message;
        updateSendButton();
        sendMessage();
      });
      container.appendChild(btn);
    });
  }

  const testPanel = document.getElementById('test-panel');
  const testModeBtn = document.getElementById('test-mode-btn');
  const closeTestPanelBtn = document.getElementById('close-test-panel');
  const testOutput = document.getElementById('test-output-content');
  const testSearchBtn = document.getElementById('test-search-btn');
  const testSearchKeyword = document.getElementById('test-search-keyword');
  const testScrapeBtn = document.getElementById('test-scrape-btn');
  const testDeepScrapeBtn = document.getElementById('test-deep-scrape-btn');
  const testDeepUrls = document.getElementById('test-deep-urls');
  const testPageInfoBtn = document.getElementById('test-pageinfo-btn');
  const testWaitContentBtn = document.getElementById('test-waitcontent-btn');
  const testSerperBtn = document.getElementById('test-serper-btn');
  const testSerperQuery = document.getElementById('test-serper-query');

  function toggleTestPanel() {
    if (testPanel) testPanel.classList.toggle('visible');
  }

  function setTestOutput(data) {
    if (testOutput) {
      if (typeof data === 'string') {
        testOutput.textContent = data;
      } else {
        testOutput.textContent = JSON.stringify(data, null, 2);
      }
    }
  }

  async function runTestTool(action, params = {}) {
    if (isProcessing) return;
    setTestOutput({ status: 'Running...', action });
    try {
      const result = await runStack({ action: 'test_tool', toolAction: action, toolParams: params });
      if (result && result.result && typeof result.result.data === 'string') {
        setTestOutput(result.result.data);
      } else {
        setTestOutput(result.result || result);
      }
    } catch (error) {
      setTestOutput({ error: error.message });
    }
  }

  if (testModeBtn) testModeBtn.addEventListener('click', toggleTestPanel);
  if (closeTestPanelBtn) closeTestPanelBtn.addEventListener('click', toggleTestPanel);

  if (testSearchBtn) {
    testSearchBtn.addEventListener('click', () => {
      const keyword = testSearchKeyword?.value.trim();
      if (!keyword) {
        setTestOutput({ error: 'Enter keyword' });
        return;
      }
      runTestTool('search_shopee', { keyword });
    });
  }

  if (testSerperBtn) {
    testSerperBtn.addEventListener('click', () => {
      const query = testSerperQuery?.value.trim();
      if (!query) {
        setTestOutput({ error: 'Enter query' });
        return;
      }
      runTestTool('serper_search', { query });
    });
  }

  if (testScrapeBtn) {
    testScrapeBtn.addEventListener('click', () => {
      runTestTool('scrape_listings');
    });
  }

  if (testDeepScrapeBtn) {
    testDeepScrapeBtn.addEventListener('click', () => {
      const urlsText = testDeepUrls?.value.trim();
      if (!urlsText) {
        setTestOutput({ error: 'Enter at least one product URL' });
        return;
      }

      const urls = urlsText
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url.length > 0 && url.includes('shopee'));

      if (urls.length === 0) {
        setTestOutput({ error: 'No valid Shopee URLs found. Enter URLs one per line.' });
        return;
      }

      setTestOutput({ status: `Deep scraping ${urls.length} URL(s)...`, urls });
      runTestTool('deep_scrape_urls', { urls });
    });
  }

  if (testPageInfoBtn) testPageInfoBtn.addEventListener('click', () => runTestTool('get_page_info'));
  if (testWaitContentBtn) testWaitContentBtn.addEventListener('click', () => runTestTool('wait_for_content', { timeout: 10000 }));

  renderSuggestions();
  bootstrap();
})();
