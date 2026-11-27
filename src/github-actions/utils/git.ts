export { getDefaultBranch }
export { getCurrentBranch }
export { isAheadOfOrigin }
export { getFileOnOrigin }
export { gitPush }
export { hasUncommittedChanges }

import execa from 'execa'
import pc from '@brillout/picocolors'
import { highlightCommand, logCommand } from '../../utils.ts'

/** The default branch of `origin` (e.g. `main`), as known locally, or `null` if unknown */
async function getDefaultBranch(cwd: string): Promise<string | null> {
  const { stdout, failed } = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (!failed && stdout.startsWith('origin/')) return stdout.slice('origin/'.length)
  // E.g. a repository created with `$ git init` then `$ git remote add origin`: origin/HEAD isn't set
  for (const branch of ['main', 'master']) {
    if (!(await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], cwd)).failed) return branch
  }
  return null
}

async function getCurrentBranch(cwd: string): Promise<string | null> {
  const { stdout, failed } = await git(['symbolic-ref', '--short', 'HEAD'], cwd)
  return failed ? null : stdout
}

/** Whether the branch `branch` has commits that `origin` doesn't have (as known locally, i.e. as of the last `$ git fetch`) */
async function isAheadOfOrigin(cwd: string, branch: string): Promise<boolean> {
  const { stdout, failed } = await git(
    ['rev-list', '--count', `refs/remotes/origin/${branch}..refs/heads/${branch}`],
    cwd,
  )
  // origin doesn't have the branch
  if (failed) return true
  return stdout !== '0'
}

/** The content of the file `filePath` on the branch `branch` of `origin` (as known locally), or `null` if it doesn't have it */
async function getFileOnOrigin(cwd: string, branch: string, filePath: string): Promise<string | null> {
  const { stdout, failed } = await execa('git', ['show', `refs/remotes/origin/${branch}:${filePath}`], {
    cwd,
    reject: false,
    stripFinalNewline: false,
  })
  return failed ? null : stdout.replace(/\r\n/g, '\n')
}

/** @returns Whether it succeeded */
async function gitPush(cwd: string, branch: string): Promise<boolean> {
  const args = ['push', 'origin', branch]
  logCommand(`$ git ${args.join(' ')}`)
  // stdin: the terminal, for a credential prompt
  const { failed, all: output } = await execa('git', args, {
    cwd,
    stdin: 'inherit',
    all: true,
    reject: false,
  })
  if (output) console.log(output)
  if (!failed) return true
  // GitHub refuses a token without the `workflow` scope to push a change of .github/workflows/ (e.g. the token of
  // `$ gh auth login`, which Git uses over HTTPS if `$ gh auth setup-git` was run)
  if (output?.includes('workflow') && output.includes('scope')) {
    console.log(
      pc.yellow(
        `GitHub refuses your token to push ${pc.bold('.github/workflows/')} changes: run ${highlightCommand(
          '$ gh auth refresh -s workflow',
        )}, then ${highlightCommand('$ git push')}.`,
      ),
    )
  }
  return false
}

/** Whether the files `filePaths` have changes that aren't committed */
async function hasUncommittedChanges(cwd: string, filePaths: string[]): Promise<boolean> {
  const { stdout } = await git(['status', '--porcelain', '--', ...filePaths], cwd)
  return stdout !== ''
}

async function git(args: string[], cwd: string) {
  const { stdout, failed } = await execa('git', args, { cwd, reject: false })
  return { stdout: stdout.trim(), failed }
}
