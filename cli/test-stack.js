const path = require('path');
const { runStack } = require('../lib/runner');
const { loadConfig } = require('../lib/config');

async function main() {
  const stackName = process.argv[2];
  if (!stackName) {
    console.error('Usage: node cli/test-stack.js <stack-name> \"{\\\"key\\\":\\\"value\\\"}\"');
    process.exit(1);
  }

  const paramsRaw = process.argv[3] || '{}';
  let params;
  try {
    params = JSON.parse(paramsRaw);
  } catch (error) {
    console.error('Params must be valid JSON.');
    process.exit(1);
  }

  const baseDir = path.join(__dirname, '..');
  const configPath = path.join(baseDir, 'mullion.config.json');
  const config = loadConfig(configPath);
  const { result } = await runStack({ baseDir, stackName, params, config });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`Stack failed: ${error.message}`);
  if (error.phase) {
    console.error(`Phase: ${error.phase}`);
  }
  process.exit(1);
});
