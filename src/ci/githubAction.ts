export { abortIfNotOnNpm }
export { getGitHubRepo }
export { parseGitHubRepo }
export { triggerCommitRelease }
export { triggerStableRelease }

// In repositories that use the GitHub Action (see ./releaseWorkflow.ts), `$ pnpm exec release-me` triggers the GitHub
// Action instead of publishing to npm: it pushes the release tag (stable release) or runs the workflow (commit release).

import execa from 'execa'
import pc from '@brillout/picocolors'
import { assertUsage, logDetail, logTitle, run } from '../utils.ts'
import { releaseWorkflowFileName, releaseWorkflowPath } from './releaseWorkflow.ts'

/** @param packageSpec The released package, e.g. `vike@0.4.271` */
async function triggerStableRelease(gitTag: string, packageSpec: string) {
  logTitle('Git push')
  // - Push the release commit and its tag atomically: the tag triggers the GitHub Action that publishes to npm.
  // - Only push this one tag: GitHub doesn't trigger any workflow when more than three tags are pushed at once.
  await run(['git', 'push', '--atomic', 'origin', 'HEAD', `refs/tags/${gitTag}`])
  logTitle('npm publish')
  const workflowLink = getWorkflowLink(await getGitHubRepo())
  logWillPublish(
    packageSpec,
    workflowLink,
    `If it fails, you can retry it: ${getRunWorkflowCta(
      workflowLink,
      `select the tag ${pc.bold(gitTag)} in ${pc.bold('Use workflow from')}`,
    )}.`,
  )
}

async function triggerCommitRelease(packageName: string, versionNew: string, commitHash: string) {
  logTitle('Trigger commit release')
  const repo = await getGitHubRepo()
  assertUsage(
    repo,
    `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}.`,
  )
  const workflowLink = getWorkflowLink(repo)
  const packageSpec = `${packageName}@${versionNew}`
  const runWorkflow = getRunWorkflowCta(
    workflowLink,
    `enter the commit ${pc.bold(commitHash)} and the package ${pc.bold(packageName)}`,
  )
  const ghUnavailable = await checkCommitOnGitHub(repo, commitHash, runWorkflow)
  if (ghUnavailable) {
    console.log(`${ghUnavailable}, so release-me can't trigger the GitHub Action ${pc.bold(releaseWorkflowFileName)}.`)
    console.log(
      `To commit-release ${pc.cyan(packageSpec)}, push its commit (if it isn't on GitHub yet), then ${runWorkflow}.`,
    )
    return
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
  logWillPublish(
    packageSpec,
    workflowLink,
    `You can also commit-release any commit you trust: ${getRunWorkflowCta(workflowLink)}.`,
  )
}

/** The GitHub Action can't publish a package that isn't on npm yet: npm can't set up a trusted publisher for it */
async function abortIfNotOnNpm(packageName: string) {
  // The registry of trusted publishing. Offline or behind a proxy => no response => let the release proceed.
  const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2F')}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  if (response?.status !== 404) return
  throw new Error(
    pc.red(
      pc.bold(
        `Release aborted, because ${packageName} isn't on npm yet, and npm can't set up a trusted publisher for it until it is: publish its first version manually ($ pnpm publish), then set up its trusted publisher (see https://github.com/brillout/release-me#github-action).`,
      ),
    ),
  )
}

/** E.g. `go to https://github.com/vikejs/vike/actions/workflows/release.yml, press Run workflow, and ${nextStep}` */
function getRunWorkflowCta(workflowLink: string, nextStep?: string): string {
  const press = `press ${pc.bold(pc.cyan('Run workflow'))}`
  return nextStep ? `go to ${workflowLink}, ${press}, and ${nextStep}` : `go to ${workflowLink} and ${press}`
}

/**
 * Aborts if GitHub doesn't have the commit: the GitHub Action can only release commits that exist on GitHub (any branch, including pull requests from forks).
 * @returns Why `$ gh` can't be used (it isn't installed, or isn't logged in), otherwise `null`
 */
async function checkCommitOnGitHub(repo: string, commitHash: string, runWorkflow: string): Promise<string | null> {
  const ghArgs = ['api', `repos/${repo}/commits/${commitHash}`, '--silent']
  try {
    await execa('gh', ghArgs, { all: true })
    return null
  } catch (err) {
    const { code, exitCode, all: output } = err as execa.ExecaError & NodeJS.ErrnoException
    if (code === 'ENOENT')
      return `The GitHub CLI ${pc.cyan('gh')} isn't installed ${logDetail('https://cli.github.com')}`
    // `$ gh` exits with 4 when it requires authentication (`$ gh help exit-codes`), and GitHub replies 401 to an invalid token
    if (exitCode === 4 || output?.includes('(HTTP 401)')) {
      return `The GitHub CLI ${pc.cyan('gh')} isn't logged in ${logDetail('$ gh auth login')}`
    }
    const isMissingCommit = !!output?.includes('(HTTP 422)')
    const reason = isMissingCommit
      ? `GitHub (${repo}) doesn't have the commit ${commitHash.slice(0, 7)} — push it first`
      : `${pc.cyan('gh')} failed`
    throw new Error(
      [
        pc.red(pc.bold(`Release aborted, because ${reason}.`)),
        output && `${pc.dim(`$ gh ${ghArgs.join(' ')}`)}\n${output}`,
        !isMissingCommit && `Alternatively, ${runWorkflow}.`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

function logWillPublish(packageSpec: string, workflowLink: string, hint: string) {
  console.log(
    `GitHub Action ${pc.bold(releaseWorkflowFileName)} will publish ${pc.cyan(packageSpec)} to npm: ${workflowLink}`,
  )
  console.log(pc.dim(`(${hint})`))
}

/** The GitHub repository of `origin`, e.g. `vikejs/vike` */
async function getGitHubRepo(cwd?: string): Promise<string | null> {
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

function getWorkflowLink(repo: string | null): string {
  if (!repo) return pc.bold(releaseWorkflowPath)
  return pc.underline(`https://github.com/${repo}/actions/workflows/${releaseWorkflowFileName}`)
}
