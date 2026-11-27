export { askConfirmation }

import readline from 'node:readline'

/** Resolves to `true` upon <ENTER>, and to `false` otherwise (any other answer such as `n`, <CTRL-C>, or the end of stdin) */
function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let answer: string | null = null
    rl.question(question, (a) => {
      answer = a
      rl.close()
    })
    rl.on('SIGINT', () => rl.close()) // https://github.com/nodejs/node/issues/4758#issuecomment-231155557
    rl.on('close', () => {
      // The prompt's line doesn't end upon <CTRL-C> or the end of stdin
      if (answer === null) console.log()
      resolve(answer?.trim() === '')
    })
  })
}
