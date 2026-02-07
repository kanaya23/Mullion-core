const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const tasks = require('./lib/tasks');
const { runStack } = require('./lib/runner');
const { loadConfig } = require('./lib/config');

const BASE_DIR = __dirname;
const CONFIG_PATH = path.join(BASE_DIR, 'mullion.config.json');
const MIN_FREE_MB = 100;

const config = loadConfig(CONFIG_PATH);

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', config.allowed_origin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function memoryStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const toMb = (value) => Math.round(value / 1024 / 1024);
  return {
    total_mb: toMb(total),
    free_mb: toMb(free),
    used_mb: toMb(used),
    percent_used: total ? Math.round((used / total) * 100) : 0
  };
}

function formatError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      phase: error.phase,
      stack: error.stack
    };
  }
  return { message: String(error) };
}

async function listStacks() {
  const stacksDir = path.join(BASE_DIR, 'stacks');
  let entries = [];
  try {
    entries = await fs.readdir(stacksDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return [];
  }

  const stacks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const stackDir = path.join(stacksDir, entry.name);
    const configPath = path.join(stackDir, 'stack.config.json');
    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const stackConfig = JSON.parse(raw);
      stacks.push({
        name: stackConfig.name || entry.name,
        description: stackConfig.description || '',
        permissions: stackConfig.permissions || {},
        params: stackConfig.params || []
      });
    } catch (error) {
      continue;
    }
  }
  return stacks;
}

async function writeLog(entry) {
  const logsDir = path.join(BASE_DIR, 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  const fileName = `${Date.now()}-${entry.id}.json`;
  const filePath = path.join(logsDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(entry, null, 2));

  const files = await fs.readdir(logsDir);
  const stats = await Promise.all(
    files.map(async (file) => ({
      file,
      mtime: (await fs.stat(path.join(logsDir, file))).mtimeMs
    }))
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  const toDelete = stats.slice(config.log_retention_count);
  await Promise.all(
    toDelete.map((entryToDelete) => fs.unlink(path.join(logsDir, entryToDelete.file)))
  );
}

app.get('/health', (req, res) => {
  const memory = memoryStats();
  res.json({
    status: 'ok',
    uptime_seconds: Math.round(process.uptime()),
    memory,
    busy: tasks.isBusy(),
    active_stack: tasks.getActiveStack(),
    can_accept_wake: memory.free_mb >= MIN_FREE_MB && !tasks.isBusy()
  });
});

app.use((req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length);
  if (token !== config.auth_token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

app.get('/stacks', async (req, res) => {
  try {
    const stacks = await listStacks();
    res.json({ stacks });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read stacks' });
  }
});

app.post('/wake', async (req, res) => {
  const stackName = req.body?.stack_name || req.body?.stackName;
  const rawParams = req.body?.task_params ?? req.body?.params ?? {};
  if (rawParams !== null && (typeof rawParams !== 'object' || Array.isArray(rawParams))) {
    res.status(400).json({ error: 'task_params must be an object' });
    return;
  }
  const params = rawParams || {};

  if (!stackName) {
    res.status(400).json({ error: 'stack_name is required' });
    return;
  }

  if (tasks.isBusy()) {
    res.status(429).json({ error: 'Mullion is busy' });
    return;
  }

  const memory = memoryStats();
  if (memory.free_mb < MIN_FREE_MB) {
    res.status(503).json({ error: 'Insufficient memory to start wake' });
    return;
  }

  const stackDir = path.join(BASE_DIR, 'stacks', stackName);
  try {
    await fs.access(path.join(stackDir, 'stack.config.json'));
  } catch (error) {
    res.status(404).json({ error: 'Stack not found' });
    return;
  }

  const taskId = tasks.createTask(stackName);
  tasks.setActive(taskId, stackName);
  tasks.setRunning(taskId);

  res.status(202).json({ task_id: taskId });

  const startedAt = new Date().toISOString();
  runStack({ baseDir: BASE_DIR, stackName, params, config })
    .then(async ({ result }) => {
      tasks.setResult(taskId, result);
      await writeLog({
        id: taskId,
        stack_name: stackName,
        status: 'done',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        result
      });
    })
    .catch(async (error) => {
      const formatted = formatError(error);
      tasks.setError(taskId, formatted);
      await writeLog({
        id: taskId,
        stack_name: stackName,
        status: 'error',
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: formatted
      });
    })
    .finally(() => {
      tasks.clearActive(taskId);
    });
});

app.get('/task/:id', (req, res) => {
  const task = tasks.getTask(req.params.id);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

app.listen(config.port, () => {
  console.log(`Mullion Core listening on port ${config.port}`);
});
