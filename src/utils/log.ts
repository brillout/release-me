export { logDetail }
export { logTitle }

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
