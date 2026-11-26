export { init }

// `$ pnpm exec release-me init [--npm] [--github]` creates (or updates) .github/workflows/release-npm.yml and/or .github/workflows/release-github.yml (see getWorkflowFilesToInit())

import pc from '@brillout/picocolors'
import { getRepositoryMismatch } from './release-npm/githubAction.ts'
import { getTrustedPublisherSteps } from './release-npm/trustedPublisher.ts'
import { getGitHubRepo } from './utils/githubRepo.ts'
import {
  getWorkflowFilesToInit,
  releaseNpmWorkflowFile,
  writeWorkflowFiles,
  type WorkflowFileOptions,
  type WriteResult,
} from './workflowFiles.ts'
import {
  assertInstalledAtRoot,
  getFilesInsideDir,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  type ReleaseMePackage,
} from '../releaseMe.ts'
import { assertUsage, logTitle, run } from '../utils.ts'

async function init(options: WorkflowFileOptions) {
  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)
  assertPackageManager(monorepoRootDir)
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))

  const results = writeWorkflowFiles(monorepoRootDir, getWorkflowFilesToInit(monorepoRootDir, options))
  const releaseNpmResult = results.find(({ workflowFile }) => workflowFile === releaseNpmWorkflowFile)

  // CLI output is read bottom to top: the workflow files last
  if (releaseNpmResult) {
    logTitle('npm trusted publisher', true)
    await logNpmSetup(monorepoRootDir, packages, releaseNpmResult)
  }

  // The first title has no margin
  logTitle('GitHub Action', releaseNpmResult ? undefined : true)
  for (const result of results) {
    const filePath = pc.bold(result.workflowFile.filePath)
    if (result.status === 'up-to-date') console.log(`${filePath} is up-to-date`)
    else if (result.status === 'renamed') console.log(`Renamed ${pc.bold(result.old.filePath)} to ${filePath}`)
    else console.log(`${result.status === 'created' ? 'Created' : 'Updated'} ${filePath}`)
  }
  const changes = results.filter(({ status }) => status !== 'up-to-date')
  if (changes.length === 0) return
  await commitWorkflowFiles(monorepoRootDir, changes)
  console.log(`Push the commit to the default branch ${pc.dim('$ git push')}`)
}

/** The GitHub Action installs the pnpm version of the root package.json (pnpm/action-setup reads it) */
function assertPackageManager(monorepoRootDir: string) {
  const { packageJson, packageJsonPath } = getPackageJson(monorepoRootDir)
  const { packageManager, devEngines } = packageJson
  assertUsage(
    packageManager?.startsWith('pnpm@') ||
      (devEngines?.packageManager?.name === 'pnpm' && !!devEngines.packageManager.version),
    `The GitHub Action installs the pnpm version of ${packageJsonPath}: set its ${pc.bold(
      'packageManager',
    )} (e.g. ${pc.bold('"packageManager": "pnpm@x.y.z"')}).`,
  )
}

async function commitWorkflowFiles(monorepoRootDir: string, changes: WriteResult[]) {
  // A renamed workflow file: also its removed old file
  const filePaths = changes.flatMap((change) =>
    change.status === 'renamed' ? [change.old.filePath, change.workflowFile.filePath] : [change.workflowFile.filePath],
  )
  const isSetup = changes.some(({ status }) => status === 'created')
  const commitMessage = isSetup ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', ...filePaths], { cwd: monorepoRootDir })
  // Only commit the workflow files (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', ...filePaths], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
}

/** The steps to set up npm's trusted publishing */
async function logNpmSetup(monorepoRootDir: string, packages: ReleaseMePackage[], releaseNpmResult: WriteResult) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const trustedPublisher = `${packages.length === 1 ? "the package's" : "each package's"} trusted publisher`
  if (releaseNpmResult.status === 'created') {
    console.log(`Set up ${trustedPublisher}:`)
  } else if (releaseNpmResult.status === 'renamed') {
    // A trusted publisher is bound to the workflow filename, which npm can't change
    const { fileName } = releaseNpmWorkflowFile
    console.log(
      `${pc.bold(releaseNpmResult.old.fileName)} was renamed ${pc.bold(fileName)}: set up ${trustedPublisher} anew:`,
    )
  } else {
    console.log(`If you didn't already, set up ${trustedPublisher}:`)
  }
  for (const step of getTrustedPublisherSteps(
    packages.map(({ packageName }) => packageName),
    repo,
  )) {
    console.log(step)
  }
  if (releaseNpmResult.status === 'renamed') {
    console.log(`   4. Delete the trusted publisher of ${pc.bold(releaseNpmResult.old.fileName)}`)
  }
  console.log(
    `   ${pc.bold(
      '⚠️  Use it within 2 days',
    )} to persist the connection (e.g. make a commit release) after creating it (otherwise the connection creation is cancelled)`,
  )

  for (const { packageName, packageRootDir } of packages) {
    const { repository } = getPackageJson(packageRootDir).packageJson
    const repositoryMismatch = getRepositoryMismatch(packageName, repository, repo)
    if (!repositoryMismatch) continue
    console.log()
    console.log(pc.yellow(`Warning: ${repositoryMismatch}.`))
  }
}
