export { init }

// `$ pnpm exec release-me init` creates (or updates) .github/workflows/release.yml

import pc from '@brillout/picocolors'
import { getGitHubRepo, parseGitHubRepo } from './githubAction.ts'
import { releaseWorkflowFileName, releaseWorkflowPath, writeReleaseWorkflow } from './releaseWorkflow.ts'
import {
  assertInstalledAtRoot,
  getFilesInsideDir,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  type PackageJson,
  type ReleaseMePackage,
} from '../releaseMe.ts'
import { assertUsage, logTitle, run } from '../utils.ts'

async function init() {
  const monorepoRootDir = await getMonorepoRootDir()
  assertInstalledAtRoot(monorepoRootDir)
  assertPackageManager(monorepoRootDir)
  const packages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))

  const status = writeReleaseWorkflow(monorepoRootDir)
  logTitle('GitHub Action', true)
  if (status === 'up-to-date') {
    console.log(`${pc.bold(releaseWorkflowPath)} is already up-to-date`)
    return
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} ${pc.bold(releaseWorkflowPath)}`)
  await commitReleaseWorkflow(monorepoRootDir, status)

  console.log()
  console.log('Next steps:')
  console.log(`1. Push the commit to the default branch ${pc.dim('$ git push')}`)
  // A new workflow requires a trusted publisher on npm
  if (status === 'created') await logNpmSetup(monorepoRootDir, packages)
}

/** The GitHub Action installs the pnpm version of the root package.json */
function assertPackageManager(monorepoRootDir: string) {
  const { packageJson, packageJsonPath } = getPackageJson(monorepoRootDir)
  const { packageManager, devEngines } = packageJson
  assertUsage(
    packageManager?.startsWith('pnpm@') || devEngines?.packageManager?.name === 'pnpm',
    `The GitHub Action installs the pnpm version of ${packageJsonPath}: set its ${pc.bold(
      'packageManager',
    )} (e.g. ${pc.bold('"packageManager": "pnpm@x.y.z"')}).`,
  )
}

async function commitReleaseWorkflow(monorepoRootDir: string, status: 'created' | 'updated') {
  const commitMessage =
    status === 'created' ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', releaseWorkflowPath], { cwd: monorepoRootDir })
  // Only commit the workflow file (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', releaseWorkflowPath], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
}

/** The steps to set up npm's trusted publishing */
async function logNpmSetup(monorepoRootDir: string, packages: ReleaseMePackage[]) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  console.log(
    `2. On npmjs.com, go to ${packages.length === 1 ? "the package's" : "each package's"} ${pc.bold('Settings')}:`,
  )
  for (const { packageName } of packages) {
    console.log(`   ${pc.underline(`https://www.npmjs.com/package/${packageName}/access`)}`)
  }
  console.log(
    `   and, under ${pc.bold('Trusted Publisher')}, press ${pc.bold('GitHub Actions')} to set up a connection:`,
  )
  // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases (see ./ci-publish.ts)
  console.log(
    `   - ${pc.bold(owner ?? '<owner>')} / ${pc.bold(repoName ?? '<repo>')}, workflow filename ${pc.bold(
      releaseWorkflowFileName,
    )}, ${pc.bold('Allow npm publish')} and ${pc.bold('Allow npm dist-tag')}`,
  )
  console.log(`   ${pc.dim("(A new connection expires if it isn't used within 2 days.)")}`)

  // npm's trusted publishing requires package.json#repository to match the GitHub repository
  for (const { packageName, packageRootDir } of packages) {
    const repository = getRepository(getPackageJson(packageRootDir).packageJson.repository)
    if (!repo || repository?.toLowerCase() === repo.toLowerCase()) continue
    console.log()
    console.log(
      pc.yellow(
        `Warning: set ${pc.cyan(packageName)}'s ${pc.bold('package.json#repository')} to ${pc.bold(
          `https://github.com/${repo}`,
        )} — npm's trusted publishing requires it to match the GitHub repository.`,
      ),
    )
  }
}

/** package.json#repository => `owner/repo` */
function getRepository(repository: PackageJson['repository']): string | null {
  const url = typeof repository === 'string' ? repository : repository?.url
  if (!url) return null
  // Shorthand: `vikejs/vike` or `github:vikejs/vike`
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url)
  if (shorthand) return shorthand[1]!
  return parseGitHubRepo(url)
}
