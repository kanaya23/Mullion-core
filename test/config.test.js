const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { loadConfig } = require('../lib/config');

async function writeConfig(dir, payload) {
  const filePath = path.join(dir, 'mullion.config.json');
  await fs.writeFile(filePath, payload);
  return filePath;
}

test('loadConfig parses and normalizes values', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-config-'));
  try {
    const configPath = await writeConfig(
      tempDir,
      JSON.stringify({
        domain: 'example.com',
        port: '3000',
        auth_token: 'token',
        max_wake_duration_seconds: '120',
        log_retention_count: '5',
        allowed_origin: 'https://site.test'
      })
    );

    const config = loadConfig(configPath);
    assert.equal(config.port, 3000);
    assert.equal(config.max_wake_duration_seconds, 120);
    assert.equal(config.log_retention_count, 5);
    assert.equal(config.domain, 'example.com');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig rejects missing values', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-config-'));
  try {
    const configPath = await writeConfig(
      tempDir,
      JSON.stringify({
        domain: 'example.com'
      })
    );

    assert.throws(() => loadConfig(configPath), /Missing config value/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig rejects invalid json', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mullion-config-'));
  try {
    const configPath = await writeConfig(tempDir, '{ invalid json }');
    assert.throws(() => loadConfig(configPath), /Invalid JSON/);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
