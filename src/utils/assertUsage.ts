export { assertUsage }

import pc from '@brillout/picocolors'

function assertUsage(condition: unknown, message: string): asserts condition {
  if (condition) return
  throw new Error(pc.red(pc.bold('Wrong usage: ' + message)))
}
