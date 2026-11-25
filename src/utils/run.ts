export { run }
export { run__return }

import execa from 'execa'

async function run(
  cmd: string | string[],
  {
    cwd,
    env = process.env,
    swallowError,
    timeout,
  }: { cwd?: string; env?: NodeJS.ProcessEnv; swallowError?: boolean; timeout?: number } = {},
) {
  const stdio = 'inherit'
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  try {
    await execa(command!, args, { cwd, stdio, env, timeout })
  } catch (err) {
    if (!swallowError) throw err
  }
}
async function run__return(cmd: string | string[], cwd?: string): Promise<string> {
  const [command, ...args] = Array.isArray(cmd) ? cmd : cmd.split(' ')
  const { stdout } = await execa(command!, args, { cwd })
  return stdout
}
