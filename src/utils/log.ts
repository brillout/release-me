export { logDetail }
export { logTitle }
export { highlightCommand }
export { logCommand }
export { formatHint }

import pc from '@brillout/picocolors'

function logTitle(title: string, noMargin?: true) {
  const titleLine = `==== ${title} ====`
  const titleLength = pc.rm(titleLine).length
  const borderLine = '='.repeat(titleLength)
  let lines = [borderLine, titleLine, borderLine]
  if (!noMargin) lines = ['', '', ...lines]
  console.log(lines.join('\n'))
}

function logDetail(msg: string): string {
  return `(${pc.dim(msg)})`
}

/** A command the user should run (e.g. `$ npm login`), emphasized */
function highlightCommand(cmd: string): string {
  return pc.bold(pc.yellow(cmd))
}

/** A command that release-me runs (e.g. `$ git push origin main`) */
function logCommand(cmd: string): void {
  console.log(pc.bold(pc.blue(cmd)))
}

/** What the user can do next, e.g. `👉 For more info, run $ pnpm exec release-me npm-connection` */
function formatHint(msg: string): string {
  return `${pc.bold('👉')} ${msg}`
}
