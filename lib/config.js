const fs = require('fs');

function loadConfig(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read config file: ${configPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  const required = [
    'domain',
    'port',
    'auth_token',
    'max_wake_duration_seconds',
    'log_retention_count',
    'allowed_origin'
  ];
  for (const key of required) {
    if (parsed[key] === undefined || parsed[key] === null || parsed[key] === '') {
      throw new Error(`Missing config value: ${key}`);
    }
  }

  const normalized = {
    ...parsed,
    port: Number(parsed.port),
    max_wake_duration_seconds: Number(parsed.max_wake_duration_seconds),
    log_retention_count: Number(parsed.log_retention_count)
  };

  if (!Number.isFinite(normalized.port)) {
    throw new Error('Config port must be a number');
  }
  if (!Number.isFinite(normalized.max_wake_duration_seconds)) {
    throw new Error('Config max_wake_duration_seconds must be a number');
  }
  if (!Number.isFinite(normalized.log_retention_count)) {
    throw new Error('Config log_retention_count must be a number');
  }

  return normalized;
}

module.exports = { loadConfig };
