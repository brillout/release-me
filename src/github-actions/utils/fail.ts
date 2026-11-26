export { fail }

import pc from '@brillout/picocolors'

/** Fails the GitHub Action, with the message shown as an error annotation */
function fail(msg: string): never {
  // Annotations don't render colors (picocolors enables them in CI)
  console.log(`::error::${escapeData(pc.rm(msg))}`)
  process.exit(1)
}

/** Escapes a workflow command's message, so that a multi-line message is one annotation (instead of an annotation of its first line, followed by its other lines as log lines). Same as @actions/core's escapeData(). */
function escapeData(msg: string): string {
  return msg.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}
