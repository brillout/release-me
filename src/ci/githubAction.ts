export { getCiWorkflow }
export { getGitHubRepo }
export { gitPushReleaseTag }
export { logCiPublish }
export { parseGitHubRepo }
export { triggerCommitRelease }
export type { CiWorkflow }

// In repositories that use the GitHub Action (see ./releaseWorkflow.ts), `$ pnpm exec release-me` pushes the release
// (stable release) or triggers the workflow (commit release) instead of publishing to npm.

import execa from 'execa'
import pc from '@brillout/picocolors'
import { assertUsage, logDetail, logTitle, run } from '../utils.ts'
import {
  assertReleaseWorkflowUpToDate,
  isReleaseMeWorkflow,
  readReleaseWorkflow,
  releaseWorkflowFileName,
  releaseWorkflowPath,
} from './releaseWorkflow.ts'

type CiWorkflow = {
  /** GitHub repository, e.g. `vikejs/vike` */
  repo: string | null
}

/** Whether the repository publishes to npm via the GitHub Action (instead of locally). Throws if release.yml is outdated. */
async function getCiWorkflow(monorepoRootDir: string): Promise<CiWorkflow | null> {
  if (!isReleaseMeWorkflow(readReleaseWorkflow(monorepoRootDir))) return null
  assertReleaseWorkflowUpToDate(monorepoRootDir)
  return { repo: await getGitHubRepo(monorepoRootDir) }
}

async function gitPushReleaseTag(gitTag: string) {
  logTitle('Git push')
  // - Push the release commit and its tag atomically: the tag triggers the GitHub Action that publishes to npm.
  // - Only push this one tag: GitHub doesn't trigger any workflow when more than three tags are pushed at once.
  await run(['git', 'push', '--atomic', 'origin', 'HEAD', `refs/tags/${gitTag}`])
}

/** The pushed release tag triggers the GitHub Action, which publishes the packages to npm */
function logCiPublish(ciWorkflow: CiWorkflow, gitTag: string, published: string[]) {
  const workflowLink = getWorkflowLink(ciWorkflow)
  logTitle('npm publish')
  console.log(
    `GitHub Action ${pc.bold(releaseWorkflowFileName)} will publish ${published
      .map((p) => pc.cyan(p))
      .join(' and ')} to npm: ${workflowLink}`,
  )
  console.log(
    pc.dim(`(If it fails, you can retry it: go to ${workflowLink}, press Run workflow, and enter the tag ${gitTag}.)`),
  )
}

async function triggerCommitRelease(
  ciWorkflow: CiWorkflow,
  packageName: string,
  versionNew: string,
  commitHash: string,
) {
  logTitle('Trigger commit release')
  const { repo } = ciWorkflow
  assertUsage(
    repo,
    `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}.`,
  )
  const workflowLink = getWorkflowLink(ciWorkflow)

  // The GitHub Action can only release commits that exist on GitHub (any branch, including pull requests from forks)
  const ghArgs = ['api', `repos/${repo}/commits/${commitHash}`, '--silent']
  try {
    await execa('gh', ghArgs, { all: true })
  } catch (err) {
    const { code, all: output } = err as execa.ExecaError & NodeJS.ErrnoException
    const isMissingCommit = !!output?.includes('(HTTP 422)')
    const reason =
      code === 'ENOENT'
        ? `triggering the GitHub Action ${releaseWorkflowFileName} requires the GitHub CLI ${pc.cyan(
            'gh',
          )} (https://cli.github.com)`
        : isMissingCommit
          ? `GitHub (${repo}) doesn't have the commit ${commitHash.slice(0, 7)} — push it first`
          : `${pc.cyan('gh')} failed`
    throw new Error(
      [
        pc.red(pc.bold(`Release aborted, because ${reason}.`)),
        output && `${pc.dim(`$ gh ${ghArgs.join(' ')}`)}\n${output}`,
        !isMissingCommit &&
          `Alternatively, go to ${workflowLink} and press ${pc.bold('Run workflow')} with commit ${pc.bold(
            commitHash,
          )}.`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  await run([
    'gh',
    'workflow',
    'run',
    releaseWorkflowFileName,
    '--repo',
    repo,
    '-f',
    `ref=${commitHash}`,
    '-f',
    `package=${packageName}`,
  ])
  console.log(
    `GitHub Action ${pc.bold(releaseWorkflowFileName)} will publish ${pc.cyan(
      `${packageName}@${versionNew}`,
    )} to npm: ${workflowLink}`,
  )
  console.log(
    pc.dim(
      `(You can also commit-release any commit, including pull requests from forks: go to ${workflowLink} and press Run workflow.)`,
    ),
  )
}

async function getGitHubRepo(cwd: string): Promise<string | null> {
  let remoteUrl: string
  try {
    remoteUrl = (await execa('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim()
  } catch {
    return null
  }
  return parseGitHubRepo(remoteUrl)
}
function parseGitHubRepo(url: string): string | null {
  // git@github.com:vikejs/vike.git
  // https://github.com/vikejs/vike
  // git+https://github.com/vikejs/vike.git
  // ssh://git@github.com/vikejs/vike.git
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return match?.[1] ?? null
}

function getWorkflowLink(ciWorkflow: CiWorkflow): string {
  const { repo } = ciWorkflow
  if (!repo) return pc.bold(releaseWorkflowPath)
  return pc.underline(`https://github.com/${repo}/actions/workflows/${releaseWorkflowFileName}`)
}
