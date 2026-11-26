export { abortIfNotOnNpm }
export { abortIfRepositoryMismatch }
export { getNotOnNpmReason }
export { getRepositoryMismatch }
export { isMissingOnNpm }
export { logStableRelease }
export { triggerCommitRelease }

// In repositories that use the GitHub Action (see ../workflowFiles.ts), `$ pnpm exec release-me` triggers the GitHub
// Action instead of publishing to npm: by pushing the release tag (stable release, see gitPush()) or by running the
// workflow (commit release).

import execa from 'execa'
import pc from '@brillout/picocolors'
import { assertUsage, logDetail, logTitle, run } from '../../utils.ts'
import { releaseNpmWorkflowFile } from '../workflowFiles.ts'
import { getGitHubRepo, parseGitHubRepo } from '../utils/githubRepo.ts'
import { getRunWorkflowCta, getWorkflowLink } from '../utils/workflowLink.ts'
import type { PackageJson } from '../../releaseMe.ts'

// After gitPush() pushed the release tag, which triggers the GitHub Action that publishes to npm
/** @param packageSpec The released package, e.g. `vike@0.4.271` */
async function logStableRelease(gitTag: string, packageSpec: string) {
  logTitle('npm publish')
  const workflowLink = getWorkflowLink(releaseNpmWorkflowFile, await getGitHubRepo())
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
  const workflowLink = getWorkflowLink(releaseNpmWorkflowFile, repo)
  const packageSpec = `${packageName}@${versionNew}` as const
  const runWorkflow = getRunWorkflowCta(
    workflowLink,
    `enter the commit ${pc.bold(commitHash)} and the package ${pc.bold(packageName)}`,
  )
  const ghUnavailable = await checkCommitOnGitHub(repo, commitHash, runWorkflow)
  if (ghUnavailable) {
    console.log(
      `${ghUnavailable}, so release-me can't trigger the GitHub Action ${pc.bold(releaseNpmWorkflowFile.fileName)}.`,
    )
    console.log(
      `To commit-release ${pc.cyan(packageSpec)}, push its commit (if it isn't on GitHub yet), then ${runWorkflow}.`,
    )
    return
  }
  await run([
    'gh',
    'workflow',
    'run',
    releaseNpmWorkflowFile.fileName,
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
  // No response (e.g. offline, or behind a proxy): let the release proceed
  if (!(await isMissingOnNpm(packageName))) return
  throw new Error(pc.red(pc.bold(`Release aborted, because ${getNotOnNpmReason(packageName)}.`)))
}
/** Whether npm's registry replies that the package `packageName` doesn't exist (`false` if it doesn't reply) */
async function isMissingOnNpm(packageName: string): Promise<boolean> {
  // The registry of trusted publishing
  const response = await fetch(`https://registry.npmjs.org/${packageName.replace('/', '%2F')}`, {
    method: 'HEAD',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null)
  return response?.status === 404
}
function getNotOnNpmReason(packageName: string) {
  return `${packageName} isn't on npm yet, and npm can't set up a trusted publisher for it until it is: publish its first version manually ($ pnpm publish), then set up its trusted publisher (see ${pc.underline(
    'https://github.com/brillout/release-me#npm-release',
  )})` as const
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
  const workflow = pc.bold(releaseNpmWorkflowFile.fileName)
  console.log(`GitHub Action ${workflow} will publish ${pc.cyan(packageSpec)} to npm: ${workflowLink}`)
  console.log(pc.dim(`(${hint})`))
}
