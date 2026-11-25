export { fail }
export { getEnv }

function getEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined) fail(`The environment variable ${name} is missing.`)
  return value
}

function fail(msg: string): never {
  console.log(`::error::${msg}`)
  process.exit(1)
}
