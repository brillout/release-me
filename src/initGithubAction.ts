export { initGithubAction }

// `$ pnpm exec release-me init-github-action` creates (or updates) .github/workflows/release.yml

import * as path from 'path'
import pc from '@brillout/picocolors'
import { getReleaseMePackages } from './ciPack.js'
import { getGitHubRepo, parseGitHubRepo, releaseWorkflowFileName, writeReleaseWorkflow } from './githubAction.js'
import {
  findBoilerplatePacakge,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  logTitle,
} from './releaseMe.js'

async function initGithubAction() {
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
  const filePathRelative = `.github/workflows/${releaseWorkflowFileName}`

  logTitle('GitHub Action', true)
  if (status === 'up-to-date') {
    console.log(`${pc.bold(filePathRelative)} is already up-to-date.`)
    return
  }
  console.log(`${status === 'created' ? 'Created' : 'Updated'} ${pc.bold(filePathRelative)}.`)
  console.log()
  if (status === 'updated') {
    console.log(`Next step: commit and push ${pc.bold(filePathRelative)}.`)
    return
  }

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

  console.log('Next steps:')
  console.log(`1. Commit and push ${pc.bold(filePathRelative)} to the default branch.`)
  console.log(`2. On npmjs.com, add a trusted publisher to ${packages.length === 1 ? 'the package' : 'each package'}:`)
  for (const { name } of packages) {
    console.log(`   - ${pc.cyan(name)}: ${pc.underline(`https://www.npmjs.com/package/${name}/access`)}`)
  }
  console.log('   with these settings:')
  console.log(`   - Publisher: ${pc.bold('GitHub Actions')}`)
  console.log(`   - Organization or user: ${pc.bold(owner ?? '(your GitHub user or organization)')}`)
  console.log(`   - Repository: ${pc.bold(repoName ?? '(your GitHub repository)')}`)
  console.log(`   - Workflow filename: ${pc.bold(releaseWorkflowFileName)}`)
  console.log(
    `   - Allowed actions: ${pc.bold('npm publish')} and ${pc.bold('npm dist-tag')} ${pc.dim(
      '(npm dist-tag removes the commit dist-tag of commit releases)',
    )}`,
  )
  console.log(`   ${pc.dim("A new trusted publisher expires if it isn't used within 2 days.")}`)
  console.log(
    `3. Recommended: on the same page, set ${pc.bold('Publishing access')} to ${pc.bold(
      'Require two-factor authentication and disallow tokens',
    )}.`,
  )
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
