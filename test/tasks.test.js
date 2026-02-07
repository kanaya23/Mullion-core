const test = require('node:test');
const assert = require('node:assert/strict');

const tasks = require('../lib/tasks');

test('tasks lifecycle transitions', () => {
  const taskId = tasks.createTask('example-stack');
  assert.ok(taskId);

  tasks.setActive(taskId, 'example-stack');
  assert.equal(tasks.isBusy(), true);
  assert.equal(tasks.getActiveStack(), 'example-stack');

  tasks.setRunning(taskId);
  const running = tasks.getTask(taskId);
  assert.equal(running.status, 'running');
  assert.ok(running.started_at);

  tasks.setResult(taskId, { ok: true });
  const finished = tasks.getTask(taskId);
  assert.equal(finished.status, 'done');
  assert.deepEqual(finished.result, { ok: true });
  assert.ok(finished.finished_at);

  tasks.clearActive(taskId);
  assert.equal(tasks.isBusy(), false);
});

test('tasks store errors', () => {
  const taskId = tasks.createTask('error-stack');
  tasks.setRunning(taskId);
  const error = { message: 'Boom', phase: 'test' };
  tasks.setError(taskId, error);

  const task = tasks.getTask(taskId);
  assert.equal(task.status, 'error');
  assert.deepEqual(task.error, error);
});
