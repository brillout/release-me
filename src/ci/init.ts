export { init }

// `$ pnpm exec release-me init [--npm] [--github]` creates (or updates) .github/workflows/release.yml and/or .github/workflows/release-github.yml (see getWorkflowFilesToInit())

import pc from '@brillout/picocolors'
import { getGitHubRepo, getRepositoryMismatch } from './githubAction.ts'
import {
  getWorkflowFilesToInit,
  releaseWorkflowFileName,
  writeWorkflowFiles,
  type WorkflowFileOptions,
} from './releaseWorkflowFile.ts'
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
  const releaseWorkflowStatus = results.find(
    ({ workflowFile }) => workflowFile.fileName === releaseWorkflowFileName,
  )?.status

  // CLI output is read bottom to top: the workflow files last
  if (releaseWorkflowStatus) {
    logTitle('npm trusted publisher', true)
    await logNpmSetup(
      monorepoRootDir,
      packages,
      releaseWorkflowStatus === 'created' ? 'Set up' : "If you didn't already, set up",
    )
  }

  // The first title has no margin
  logTitle('GitHub Action', releaseWorkflowStatus ? undefined : true)
  for (const { workflowFile, status } of results) {
    const filePath = pc.bold(workflowFile.filePath)
    if (status === 'up-to-date') console.log(`${filePath} is up-to-date`)
    else console.log(`${status === 'created' ? 'Created' : 'Updated'} ${filePath}`)
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

async function commitWorkflowFiles(monorepoRootDir: string, changes: ReturnType<typeof writeWorkflowFiles>) {
  const filePaths = changes.map(({ workflowFile }) => workflowFile.filePath)
  const isSetup = changes.some(({ status }) => status === 'created')
  const commitMessage = isSetup ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', ...filePaths], { cwd: monorepoRootDir })
  // Only commit the workflow files (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', ...filePaths], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
}

/** The steps to set up npm's trusted publishing, e.g. `intro` = `Set up` */
async function logNpmSetup(monorepoRootDir: string, packages: ReleaseMePackage[], intro: string) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  console.log(`${intro} ${packages.length === 1 ? "the package's" : "each package's"} trusted publisher:`)
  const links = packages.map(({ packageName }) => pc.underline(`https://www.npmjs.com/package/${packageName}/access`))
  if (links.length === 1) {
    console.log(`   1. Go to ${links[0]}`)
  } else {
    console.log('   1. Go to:')
    for (const link of links) console.log(`        ${link}`)
  }
  console.log(`   2. Under ${pc.bold('Trusted Publisher')}, click ${pc.bold('GitHub Actions')} and fill in:`)
  // The fields of npm's form
  const fields = [
    ['Organization or user', owner ?? '<owner>'],
    ['Repository', repoName ?? '<repo>'],
    ['Workflow filename', releaseWorkflowFileName],
    ['Allow npm publish', '✅'],
    // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases (see ./ci-publish.ts)
    ['Allow npm dist-tag', '✅'],
  ] as const
  for (const [label, value] of fields) {
    console.log(`        ${label.padEnd(22)}${pc.bold(value)}`)
  }
  console.log(`   3. Click ${pc.bold('Set up connection')}`)
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
