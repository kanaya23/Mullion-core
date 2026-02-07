const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const statusDomain = document.getElementById('status-domain');
const statusLatency = document.getElementById('status-latency');
const statusLast = document.getElementById('status-last');
const vitalsMemory = document.getElementById('vitals-memory');
const vitalsUptime = document.getElementById('vitals-uptime');
const vitalsStatus = document.getElementById('vitals-status');
const stackList = document.getElementById('stack-list');

const runView = document.getElementById('view-run');
const dashboardView = document.getElementById('view-dashboard');
const resultView = document.getElementById('view-result');
const runStackName = document.getElementById('run-stack-name');
const runStackDescription = document.getElementById('run-stack-description');
const runCapabilities = document.getElementById('run-capabilities');
const paramForm = document.getElementById('param-form');
const paramJsonWrapper = document.getElementById('param-json-wrapper');
const paramJson = document.getElementById('param-json');
const paramError = document.getElementById('param-error');
const runButton = document.getElementById('run-button');

const resultStatus = document.getElementById('result-status');
const resultSpinner = document.getElementById('result-spinner');
const resultOutput = document.getElementById('result-output');
const resultError = document.getElementById('result-error');
const copyJson = document.getElementById('copy-json');

let currentStack = null;
let pollTimer = null;
let lastResult = null;

const authHeaders = () => ({
  Authorization: `Bearer ${MULLION_TOKEN}`,
  'Content-Type': 'application/json'
});

function setView(view) {
  dashboardView.classList.toggle('hidden', view !== 'dashboard');
  runView.classList.toggle('hidden', view !== 'run');
  resultView.classList.toggle('hidden', view !== 'result');
}

function updateStatusDot(state) {
  statusDot.classList.remove('status-offline', 'status-idle', 'status-busy');
  statusDot.classList.add(`status-${state}`);
}

async function fetchHealth() {
  const start = performance.now();
  statusDomain.textContent = MULLION_URL;
  try {
    const response = await fetch(`${MULLION_URL}/health`);
    const latency = Math.round(performance.now() - start);
    if (!response.ok) throw new Error('Health check failed');
    const data = await response.json();
    statusText.textContent = data.busy ? 'Connected (busy)' : 'Connected (idle)';
    updateStatusDot(data.busy ? 'busy' : 'idle');
    statusLatency.textContent = `${latency} ms`;
    statusLast.textContent = new Date().toLocaleTimeString();
    vitalsMemory.textContent = `${data.memory.used_mb} / ${data.memory.total_mb} MB`;
    vitalsUptime.textContent = `${Math.round(data.uptime_seconds / 60)} min`;
    vitalsStatus.textContent = data.busy ? `Running ${data.active_stack || ''}` : 'Idle';
  } catch (error) {
    statusText.textContent = 'Offline';
    updateStatusDot('offline');
    statusLatency.textContent = '-';
    statusLast.textContent = new Date().toLocaleTimeString();
    vitalsMemory.textContent = '-';
    vitalsUptime.textContent = '-';
    vitalsStatus.textContent = 'Unreachable';
  }
}

async function loadStacks() {
  stackList.innerHTML = '';
  try {
    const response = await fetch(`${MULLION_URL}/stacks`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to load stacks');
    const data = await response.json();
    data.stacks.forEach(renderStack);
  } catch (error) {
    const card = document.createElement('div');
    card.className = 'stack-card';
    card.textContent = 'Unable to load stacks.';
    stackList.appendChild(card);
  }
}

function renderStack(stack) {
  const card = document.createElement('div');
  card.className = 'stack-card';
  const title = document.createElement('h3');
  title.textContent = stack.name;
  const description = document.createElement('p');
  description.textContent = stack.description || 'No description provided.';
  const button = document.createElement('button');
  button.className = 'primary';
  button.textContent = 'Run';
  button.addEventListener('click', () => openRunView(stack));
  card.appendChild(title);
  card.appendChild(description);
  card.appendChild(button);
  stackList.appendChild(card);
}

function openRunView(stack) {
  currentStack = stack;
  runStackName.textContent = stack.name;
  runStackDescription.textContent = stack.description || '';
  runCapabilities.innerHTML = '';
  const capabilities = stack.permissions?.capabilities || [];
  capabilities.forEach((capability) => {
    const pill = document.createElement('span');
    pill.className = 'capability-pill';
    pill.textContent = capability;
    runCapabilities.appendChild(pill);
  });

  paramForm.innerHTML = '';
  paramError.textContent = '';
  paramJsonWrapper.classList.add('hidden');

  if (stack.params && stack.params.length) {
    stack.params.forEach((param) => {
      const label = document.createElement('label');
      label.textContent = param.label || param.name;
      label.setAttribute('for', `param-${param.name}`);
      let input;
      if (param.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 4;
      } else {
        input = document.createElement('input');
        input.type = param.type === 'checkbox' ? 'checkbox' : 'text';
      }
      input.id = `param-${param.name}`;
      input.dataset.param = param.name;
      if (param.placeholder) input.placeholder = param.placeholder;
      if (param.default !== undefined) {
        if (input.type === 'checkbox') {
          input.checked = Boolean(param.default);
        } else {
          input.value = param.default;
        }
      }
      paramForm.appendChild(label);
      paramForm.appendChild(input);
    });
  } else {
    paramJsonWrapper.classList.remove('hidden');
    paramJson.value = '{}';
  }

  setView('run');
}

function collectParams() {
  paramError.textContent = '';
  if (currentStack.params && currentStack.params.length) {
    const payload = {};
    currentStack.params.forEach((param) => {
      const input = document.querySelector(`[data-param="${param.name}"]`);
      if (!input) return;
      if (input.type === 'checkbox') {
        payload[param.name] = input.checked;
      } else if (param.type === 'number') {
        const parsed = Number(input.value);
        payload[param.name] = Number.isNaN(parsed) ? null : parsed;
      } else {
        payload[param.name] = input.value;
      }
    });
    return payload;
  }

  try {
    return JSON.parse(paramJson.value || '{}');
  } catch (error) {
    paramError.textContent = 'Parameters must be valid JSON.';
    return null;
  }
}

async function runStack() {
  if (!currentStack) return;
  const params = collectParams();
  if (params === null) return;

  const response = await fetch(`${MULLION_URL}/wake`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ stack_name: currentStack.name, task_params: params })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    paramError.textContent = errorData.error || 'Failed to start stack.';
    return;
  }

  const data = await response.json();
  openResultView(data.task_id);
}

function openResultView(taskId) {
  resultStatus.textContent = 'Starting...';
  resultSpinner.classList.remove('hidden');
  resultOutput.classList.add('hidden');
  resultError.classList.add('hidden');
  copyJson.classList.add('hidden');
  lastResult = null;

  setView('result');
  startPolling(taskId);
}

function startPolling(taskId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const response = await fetch(`${MULLION_URL}/task/${taskId}`, { headers: authHeaders() });
    if (!response.ok) {
      resultStatus.textContent = 'Failed to fetch task status.';
      return;
    }
    const data = await response.json();
    resultStatus.textContent = `Status: ${data.status}`;
    if (data.status === 'done') {
      stopPolling();
      showResult(data.result);
    } else if (data.status === 'error') {
      stopPolling();
      showError(data.error || { message: 'Task failed.' });
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  resultSpinner.classList.add('hidden');
}

function showResult(result) {
  lastResult = result;
  resultOutput.textContent = JSON.stringify(result, null, 2);
  resultOutput.classList.remove('hidden');
  resultError.classList.add('hidden');
  copyJson.classList.remove('hidden');
}

function showError(error) {
  resultError.textContent = error.message || 'Task failed.';
  resultError.classList.remove('hidden');
  resultOutput.classList.add('hidden');
  copyJson.classList.add('hidden');
}

copyJson.addEventListener('click', async () => {
  if (!lastResult) return;
  await navigator.clipboard.writeText(JSON.stringify(lastResult, null, 2));
});

runButton.addEventListener('click', runStack);

document.getElementById('back-dashboard').addEventListener('click', () => setView('dashboard'));
document.getElementById('run-again').addEventListener('click', () => setView('run'));
document
  .getElementById('back-dashboard-result')
  .addEventListener('click', () => setView('dashboard'));

fetchHealth();
loadStacks();
setInterval(fetchHealth, 15000);
