const { spawnSync } = require('node:child_process')
const path = require('node:path')

const cliPath = require.resolve('@playwright/test/cli')
const args = process.argv.slice(2)

const result = spawnSync(process.execPath, [cliPath, ...args], {
  cwd: path.resolve(__dirname, '..'),
  env: {
    ...process.env,
    PW_DISABLE_TS_ESM: process.env.PW_DISABLE_TS_ESM || '1',
  },
  stdio: 'inherit',
})

if (result.error) {
  throw result.error
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
