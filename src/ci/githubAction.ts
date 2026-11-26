// TODO/after-merge: move to new dir src/ci/release-npm/ (like src/ci/release-github/)

export { abortIfNotOnNpm }
export { abortIfRepositoryMismatch }
export { getRepositoryMismatch }
export { triggerCommitRelease }
export { triggerStableRelease }

// In repositories that use the GitHub Action (see ./releaseWorkflowFile.ts), `$ pnpm exec release-me` triggers the GitHub
// Action instead of publishing to npm: it pushes the release tag (stable release) or runs the workflow (commit release).

import execa from 'execa'
import pc from '@brillout/picocolors'
import { assertUsage, logDetail, logTitle, run } from '../utils.ts'
import { releaseWorkflowFileName, releaseWorkflowFilePath } from './releaseWorkflowFile.ts'
import { getGitHubRepo, parseGitHubRepo } from './utils/githubRepo.ts'
import type { PackageJson } from '../releaseMe.ts'

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
  const packageSpec = `${packageName}@${versionNew}` as const
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
  // The registry of trusted publishing
  const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2F')}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  // No response (e.g. offline, or behind a proxy): let the release proceed
  if (response?.status !== 404) return
  throw new Error(
    pc.red(
      pc.bold(
        `Release aborted, because ${packageName} isn't on npm yet, and npm can't set up a trusted publisher for it until it is: publish its first version manually ($ pnpm publish), then set up its trusted publisher (see ${pc.underline(
          'https://github.com/brillout/release-me#github-action',
        )}).`,
      ),
    ),
  )
}

/** Otherwise the GitHub Action fails to publish, after the release is pushed */
async function abortIfRepositoryMismatch(packageName: string, repository: PackageJson['repository']) {
  const repositoryMismatch = getRepositoryMismatch(packageName, repository, await getGitHubRepo())
  if (!repositoryMismatch) return
  throw new Error(pc.red(pc.bold(`Release aborted, because ${repositoryMismatch}.`)))
}

/** @returns Why package.json#repository doesn't match the GitHub repository `repo` (`null` if it does, or if `repo` is unknown) */
function getRepositoryMismatch(packageName: string, repository: PackageJson['repository'], repo: string | null) {
  const url = typeof repository === 'string' ? repository : repository?.url
  if (!repo || (url && parseRepositoryUrl(url)?.toLowerCase() === repo.toLowerCase())) return null
  return `npm's trusted publishing requires ${pc.cyan(packageName)}'s ${pc.bold(
    'package.json#repository',
  )} to match ${pc.underline(`https://github.com/${repo}`)} (${url ? `it's ${pc.bold(url)}` : "it isn't set"})` as const
}
/** package.json#repository => `owner/repo` */
function parseRepositoryUrl(url: string): string | null {
  // Shorthand: `vikejs/vike` or `github:vikejs/vike`
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url)
  if (shorthand) return shorthand[1]!
  return parseGitHubRepo(url)
}

/** E.g. `go to https://github.com/vikejs/vike/actions/workflows/release.yml, press Run workflow, and ${nextStep}` */
function getRunWorkflowCta(workflowLink: string, nextStep?: string) {
  const press = `press ${pc.bold(pc.cyan('Run workflow'))}` as const
  return nextStep
    ? (`go to ${workflowLink}, ${press}, and ${nextStep}` as const)
    : (`go to ${workflowLink} and ${press}` as const)
}

/**
 * Aborts if GitHub doesn't have the commit: the GitHub Action can only release commits that exist on GitHub (any branch, including pull requests from forks).
 * @returns Why `$ gh` can't be used (it isn't installed, or isn't logged in), otherwise `null`
 */
async function checkCommitOnGitHub(repo: string, commitHash: string, runWorkflow: string) {
  const ghArgs = ['api', `repos/${repo}/commits/${commitHash}`, '--silent']
  try {
    await execa('gh', ghArgs, { all: true })
    return null
  } catch (err) {
    const { code, exitCode, all: output } = err as execa.ExecaError & NodeJS.ErrnoException
    if (code === 'ENOENT')
      return `The GitHub CLI ${pc.cyan('gh')} isn't installed ${logDetail(
        pc.underline('https://cli.github.com'),
      )}` as const
    // `$ gh` exits with 4 when it requires authentication (`$ gh help exit-codes`), and GitHub replies 401 to an invalid token
    if (exitCode === 4 || output?.includes('(HTTP 401)')) {
      return `The GitHub CLI ${pc.cyan('gh')} isn't logged in ${logDetail('$ gh auth login')}` as const
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

function getWorkflowLink(repo: string | null) {
  if (!repo) return pc.bold(releaseWorkflowFilePath)
  return pc.underline(`https://github.com/${repo}/actions/workflows/${releaseWorkflowFileName}`)
}
