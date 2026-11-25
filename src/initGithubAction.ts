export { initGithubAction }

// `$ pnpm exec release-me init-github-action` creates (or updates) .github/workflows/release.yml and .github/workflows/release-commit.yml

import * as path from 'path'
import pc from '@brillout/picocolors'
import { getReleaseMePackages } from './ciPack.js'
import { getGitHubRepo, parseGitHubRepo, workflows, writeWorkflows } from './githubAction.js'
import {
  findBoilerplatePacakge,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  logTitle,
  run,
} from './releaseMe.js'

async function initGithubAction() {
  const monorepoRootDir = await getMonorepoRootDir()
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(await getFilesInsideDir(monorepoRootDir))

  // Packages published by the GitHub Actions (including boilerplates create-${packageName})
  const packageRootDirs: string[] = []
  for (const { packageName, packageRootDir } of getReleaseMePackages(filesMonorepoPackageJson)) {
    packageRootDirs.push(packageRootDir)
    const boilerplatePackageJson = await findBoilerplatePacakge(packageName, filesMonorepoPackageJson)
    if (boilerplatePackageJson) packageRootDirs.push(path.dirname(boilerplatePackageJson))
  }

  const results = writeWorkflows(monorepoRootDir)

  logTitle('GitHub Actions', true)
  for (const { fileName, status } of results) {
    const file = pc.bold(`.github/workflows/${fileName}`)
    console.log(
      status === 'created'
        ? `Created ${file}`
        : status === 'updated'
          ? `Updated ${file}`
          : `${file} is already up-to-date`,
    )
  }
  const changed = results.filter((r) => r.status !== 'up-to-date')
  if (changed.length === 0) return
  // A new workflow file requires a new trusted publisher on npm
  const created = Object.values(workflows).filter((w) =>
    results.some((r) => r.fileName === w.fileName && r.status === 'created'),
  )

  const files = changed.map((r) => `.github/workflows/${r.fileName}`)
  await run(['git', 'add', '--', ...files], { cwd: monorepoRootDir })
  // Only commit the workflow files (`$ git commit -- <files>` ignores other staged changes)
  const commitMessage =
    created.length > 0 ? 'ci: set up release-me GitHub Actions' : 'ci: update release-me GitHub Actions'
  await run(['git', 'commit', '--quiet', '-m', commitMessage, '--', ...files], { cwd: monorepoRootDir })
  console.log(`Committed ${pc.dim(`(${commitMessage})`)}`)

  console.log()
  console.log('Next steps:')
  console.log(`1. Push the commit to the default branch ${pc.dim('$ git push')}`)
  if (created.length === 0) return

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
    `   and, under ${pc.bold('Trusted Publisher')}, press ${pc.bold('GitHub Actions')} to set up ${
      created.length === 1 ? 'this connection' : `these ${created.length} connections`
    }:`,
  )
  for (const { fileName, npmAllowedActions } of created) {
    console.log(
      `   - ${pc.bold(owner ?? '<owner>')} / ${pc.bold(repoName ?? '<repo>')}, workflow filename ${pc.bold(
        fileName,
      )}, ${npmAllowedActions.map((a) => pc.bold(`Allow ${a}`)).join(' and ')}`,
    )
  }
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
