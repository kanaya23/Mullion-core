const crypto = require('crypto');

const tasks = new Map();
let activeTaskId = null;
let activeStack = null;

function nowIso() {
  return new Date().toISOString();
}

function createTask(stackName) {
  const id = crypto.randomUUID();
  tasks.set(id, {
    id,
    stack_name: stackName,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso()
  });
  return id;
}

function setRunning(id) {
  const task = tasks.get(id);
  if (!task) return;
  task.status = 'running';
  task.started_at = nowIso();
  task.updated_at = nowIso();
}

function setResult(id, result) {
  const task = tasks.get(id);
  if (!task) return;
  task.status = 'done';
  task.result = result;
  task.finished_at = nowIso();
  task.duration_ms = task.started_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : undefined;
  task.updated_at = nowIso();
}

function setError(id, error) {
  const task = tasks.get(id);
  if (!task) return;
  task.status = 'error';
  task.error = error;
  task.finished_at = nowIso();
  task.duration_ms = task.started_at
    ? new Date(task.finished_at).getTime() - new Date(task.started_at).getTime()
    : undefined;
  task.updated_at = nowIso();
}

function getTask(id) {
  return tasks.get(id);
}

function isBusy() {
  return activeTaskId !== null;
}

function setActive(id, stackName) {
  activeTaskId = id;
  activeStack = stackName;
}

function clearActive(id) {
  if (activeTaskId === id) {
    activeTaskId = null;
    activeStack = null;
  }
}

function getActiveStack() {
  return activeStack;
}

module.exports = {
  createTask,
  setRunning,
  setResult,
  setError,
  getTask,
  isBusy,
  setActive,
  clearActive,
  getActiveStack
};
