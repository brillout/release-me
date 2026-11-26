export { fail }

import pc from '@brillout/picocolors'

/** Fails the GitHub Action, with the message shown as an error annotation */
function fail(msg: string): never {
  // Annotations don't render colors (picocolors enables them in CI)
  console.log(`::error::${pc.rm(msg)}`)
  process.exit(1)
}
