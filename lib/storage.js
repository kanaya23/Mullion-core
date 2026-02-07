const fs = require('fs/promises');
const path = require('path');

class StackStorage {
  constructor(baseDir, stackName) {
    this.baseDir = baseDir;
    this.stackName = stackName;
    this.filePath = path.join(baseDir, `${stackName}.json`);
    this.data = {};
  }

  async load() {
    await fs.mkdir(this.baseDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      this.data = {};
    }
  }

  async save() {
    await fs.mkdir(this.baseDir, { recursive: true });
    const payload = JSON.stringify(this.data, null, 2);
    await fs.writeFile(this.filePath, payload);
  }

  async get(key, defaultValue = undefined) {
    if (Object.prototype.hasOwnProperty.call(this.data, key)) {
      return this.data[key];
    }
    return defaultValue;
  }

  async set(key, value) {
    this.data[key] = value;
  }

  async remove(key) {
    delete this.data[key];
  }

  async keys() {
    return Object.keys(this.data);
  }

  async clear() {
    this.data = {};
  }
}

function createStackStorage(baseDir, stackName) {
  return new StackStorage(baseDir, stackName);
}

module.exports = { createStackStorage };
