export { fail }
export { getEnv }
export { getInput }
export { setOutputs }

import * as fs from 'node:fs'

function getEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) fail(`The environment variable ${name} is missing.`)
  return value
}

/** Input of the "Run workflow" button (empty if the workflow was triggered otherwise) */
function getInput(name: string): string {
  const event = JSON.parse(fs.readFileSync(getEnv('GITHUB_EVENT_PATH'), 'utf8'))
  return event.inputs?.[name] ?? ''
}

function setOutputs(outputs: Record<string, string>) {
  const lines = Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`)
  fs.appendFileSync(getEnv('GITHUB_OUTPUT'), lines.join(''))
}

function fail(msg: string): never {
  console.log(`::error::${msg}`)
  process.exit(1)
}
