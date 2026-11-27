export { getGhUnavailableReason }
export { runWorkflow }

import execa from 'execa'
import pc from '@brillout/picocolors'
import { highlightCommand, logDetail } from '../../utils.ts'

/** Why the GitHub CLI `gh` can't be used (it isn't installed, or isn't logged in), otherwise `null` */
async function getGhUnavailableReason(): Promise<string | null> {
  try {
    await execa('gh', ['auth', 'status', '--hostname', 'github.com'])
    return null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return `the GitHub CLI ${pc.cyan('gh')} isn't installed ${logDetail(pc.underline('https://cli.github.com'))}`
    }
    return `the GitHub CLI ${pc.cyan('gh')} isn't logged in: run ${highlightCommand('$ gh auth login')}`
  }
}

// Right after pushing a new workflow file, GitHub may not know it yet
const RETRIES = 6
const RETRY_DELAY = 5_000

/**
 * Runs the GitHub Action `workflowFileName` (its **Run workflow** button), with the version of the workflow file of the
 * default branch.
 * @returns Whether it succeeded
 */
async function runWorkflow(repo: string, workflowFileName: string, inputs: Record<string, string>): Promise<boolean> {
  const args = ['workflow', 'run', workflowFileName, '--repo', repo]
  for (const [name, value] of Object.entries(inputs)) args.push('-f', `${name}=${value}`)
  console.log(pc.bold(pc.blue(`$ gh ${args.join(' ')}`)))
  for (let attempt = 1; ; attempt++) {
    const { failed, all: output } = await execa('gh', args, { all: true, reject: false })
    if (!failed) {
      if (output) console.log(output)
      return true
    }
    // E.g. `could not find any workflows named release-npm.yml` or `HTTP 404`
    const isUnknownWorkflow = !!output && /could not find|HTTP 404/i.test(output)
    if (!isUnknownWorkflow || attempt === RETRIES) {
      if (output) console.log(output)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
  }
}
