export { init }

// `$ pnpm exec release-me init` creates (or updates) .github/workflows/release.yml

import * as path from 'path'
import pc from '@brillout/picocolors'
import { getGitHubRepo, parseGitHubRepo, releaseWorkflow, writeReleaseWorkflow } from './githubAction.js'
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
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(await getFilesInsideDir(monorepoRootDir))

  // Packages published by the GitHub Action (including boilerplates create-${packageName})
  const packageRootDirs: string[] = []
  for (const { packageName, packageRootDir } of getReleaseMePackages(filesMonorepoPackageJson)) {
    packageRootDirs.push(packageRootDir)
    const boilerplatePackageJson = await findBoilerplatePacakge(packageName, filesMonorepoPackageJson)
    if (boilerplatePackageJson) packageRootDirs.push(path.dirname(boilerplatePackageJson))
  }

  const status = writeReleaseWorkflow(monorepoRootDir)
  const file = `.github/workflows/${releaseWorkflow.fileName}`

  logTitle('GitHub Action', true)
  if (status === 'up-to-date') {
    console.log(`${pc.bold(file)} is already up-to-date`)
    return
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} ${pc.bold(file)}`)

  await run(['git', 'add', '--', file], { cwd: monorepoRootDir })
  // Only commit the workflow file (`$ git commit -- <file>` ignores other staged changes)
  const commitMessage =
    status === 'created' ? 'ci: set up release-me GitHub Action' : 'ci: update release-me GitHub Action'
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', file], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)

  console.log()
  console.log('Next steps:')
  console.log(`1. Push the commit to the default branch ${pc.dim('$ git push')}`)
  // A new workflow requires a trusted publisher on npm
  if (status === 'updated') return

  const repo = await getGitHubRepo(monorepoRootDir)
  const [owner, repoName] = repo ? repo.split('/') : []
  const packages = packageRootDirs.map((packageRootDir) => {
    const { packageJson } = getPackageJson(packageRootDir)
    const repository = getRepository((packageJson as { repository?: unknown }).repository)
    return {
      name: packageJson.name!,
      repositoryMismatch: !!repo && repository?.toLowerCase() !== repo.toLowerCase(),
    }
  })

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
  for (const { name } of packages.filter((p) => p.repositoryMismatch)) {
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
