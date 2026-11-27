export { askQuestion }
export { askConfirmation }

import readline from 'node:readline'

/** The user's answer, or `null` upon <CTRL-C> or the end of stdin */
function askQuestion(question: string): Promise<string | null> {
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
      resolve(answer)
    })
  })
}

/** `true` upon <ENTER>, and `false` otherwise (any other answer such as `n`, <CTRL-C>, or the end of stdin) */
async function askConfirmation(question: string): Promise<boolean> {
  return (await askQuestion(question))?.trim() === ''
}
