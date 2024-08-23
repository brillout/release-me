export { runCommand }

import { exec } from 'child_process'
import assert from 'assert'

function runCommand(
  cmd: string,
  { swallowError, timeout = 15 * 1000, cwd }: { swallowError?: true; timeout?: number; cwd?: string } = {},
): Promise<string> {
  const { promise, resolvePromise, rejectPromise } = genPromise<string>()

  const t = setTimeout(() => {
    rejectPromise(new Error(`Command \`${cmd}\` (${cwd}) timeout [${timeout / 1000} seconds].`))
  }, timeout)

  const options = { cwd }
  exec(cmd, options, (err, stdout, stderr) => {
    clearTimeout(t)
    if (err || stderr) {
      if (swallowError) {
        resolvePromise('SWALLOWED_ERROR')
      } else {
        // Useless generic message
        assert(err === null || err.message.startsWith(`Command failed: ${cmd}`))
        const errMsg = stderr || stdout || err?.message || err
        assert(errMsg)
        rejectPromise(
          new Error(
            [
              ``,
              ``,
              `===================================`,
              `Command \`${cmd}\` (${cwd}) failed.`,
              `===================================`,
              ``,
              `============== ERROR ==============`,
              errMsg,
              ``,
              `===================================`,
            ].join('\n'),
          ),
        )
      }
    } else {
      resolvePromise(stdout)
    }
  })

  return promise
}

function genPromise<T>() {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (err: Error) => void
  const promise: Promise<T> = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolvePromise, rejectPromise }
}
