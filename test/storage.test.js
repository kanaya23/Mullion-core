const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { createStackStorage } = require('../lib/storage');

test('storage persists and clears values', async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-storage-'));
  try {
    const store = createStackStorage(baseDir, 'sample');
    await store.load();
    assert.equal(await store.get('missing', 'default'), 'default');

    await store.set('alpha', { count: 3 });
    await store.save();

    const reloaded = createStackStorage(baseDir, 'sample');
    await reloaded.load();
    assert.deepEqual(await reloaded.get('alpha'), { count: 3 });
    assert.deepEqual(await reloaded.keys(), ['alpha']);

    await reloaded.clear();
    await reloaded.save();

    const cleared = createStackStorage(baseDir, 'sample');
    await cleared.load();
    assert.deepEqual(await cleared.keys(), []);
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});
