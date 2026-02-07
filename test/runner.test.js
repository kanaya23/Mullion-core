const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { shouldEnableInterceptor } = require('../lib/runner');

test('shouldEnableInterceptor respects webRequest capability', () => {
  assert.equal(shouldEnableInterceptor({ permissions: { capabilities: ['webRequest'] } }), true);
  assert.equal(shouldEnableInterceptor({ permissions: { capabilities: ['tabs', 'storage'] } }), false);
  assert.equal(shouldEnableInterceptor({}), false);
});

test('shopping-assistant stack disables interceptor', async () => {
  const configPath = path.join(__dirname, '..', 'stacks', 'shopping-assistant', 'stack.config.json');
  const raw = await fs.readFile(configPath, 'utf8');
  const config = JSON.parse(raw);
  assert.equal(shouldEnableInterceptor(config), false);
});
