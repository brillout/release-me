export { init }

// `$ pnpm exec release-me init` creates (or updates) .github/workflows/release.yml

import * as path from 'path'
import pc from '@brillout/picocolors'
import {
  getGitHubRepo,
  parseGitHubRepo,
  releaseWorkflow,
  releaseWorkflowPath,
  writeReleaseWorkflow,
} from './githubAction.js'
import {
  findBoilerplatePacakge,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  logTitle,
  run,
} from './releaseMe.js'

async function init() {
  const monorepoRootDir = await getMonorepoRootDir()
  const packages = await getPublishedPackages(monorepoRootDir)

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

async function commitReleaseWorkflow(monorepoRootDir: string, status: 'created' | 'updated') {
  const commitMessage =
    status === 'created' ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'add', '--', releaseWorkflowPath], { cwd: monorepoRootDir })
  // Only commit the workflow file (`$ git commit -- <file>` ignores other staged changes)
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', releaseWorkflowPath], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)
}

/** The steps to set up npm's trusted publishing */
async function logNpmSetup(monorepoRootDir: string, packages: PublishedPackage[]) {
  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  console.log(
    `2. On npmjs.com, go to ${packages.length === 1 ? "the package's" : "each package's"} ${pc.bold('Settings')}:`,
  )
  for (const { name } of packages) {
    console.log(`   ${pc.underline(`https://www.npmjs.com/package/${name}/access`)}`)
  }
  console.log(
    `   and, under ${pc.bold('Trusted Publisher')}, press ${pc.bold('GitHub Actions')} to set up a connection:`,
  )
  console.log(
    `   - ${pc.bold(owner ?? '<owner>')} / ${pc.bold(repoName ?? '<repo>')}, workflow filename ${pc.bold(
      releaseWorkflow.fileName,
    )}, ${releaseWorkflow.npmAllowedActions.map((a) => pc.bold(`Allow ${a}`)).join(' and ')}`,
  )
  console.log(`   ${pc.dim("(A new connection expires if it isn't used within 2 days.)")}`)

  // npm's trusted publishing requires package.json#repository to match the GitHub repository
  for (const { name, repository } of packages) {
    if (!repo || repository?.toLowerCase() === repo.toLowerCase()) continue
    console.log()
    console.log(
      pc.yellow(
        `Warning: set ${pc.cyan(name)}'s ${pc.bold('package.json#repository')} to ${pc.bold(
          `https://github.com/${repo}`,
        )} — npm's trusted publishing requires it to match the GitHub repository.`,
      ),
    )
  }
}

type PublishedPackage = Awaited<ReturnType<typeof getPublishedPackages>>[number]
/** The packages published by the GitHub Action (including boilerplates create-${packageName}) */
async function getPublishedPackages(monorepoRootDir: string) {
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(await getFilesInsideDir(monorepoRootDir))
  const packageRootDirs: string[] = []
  for (const { packageName, packageRootDir } of getReleaseMePackages(filesMonorepoPackageJson)) {
    packageRootDirs.push(packageRootDir)
    const boilerplatePackageJson = await findBoilerplatePacakge(packageName, filesMonorepoPackageJson)
    if (boilerplatePackageJson) packageRootDirs.push(path.dirname(boilerplatePackageJson))
  }
  return packageRootDirs.map((packageRootDir) => {
    const { packageJson } = getPackageJson(packageRootDir)
    return {
      name: packageJson.name!,
      repository: getRepository((packageJson as { repository?: unknown }).repository),
    }
  })
}

/** package.json#repository => `owner/repo` */
function getRepository(repository: unknown): string | null {
  const url =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository && typeof repository.url === 'string'
        ? repository.url
        : null
  if (!url) return null
  // Shorthand: `vikejs/vike` or `github:vikejs/vike`
  const shorthand = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url)
  if (shorthand) return shorthand[1]!
  return parseGitHubRepo(url)
}
