export { getPackageJsonSteps }
export { setPackageJsonFields }
export { getRepositoryValue }
export type { PackageJsonStep }

// The package.json changes that the GitHub Actions of release-me require, as steps of `$ pnpm exec release-me init` (see
// ./steps.ts)

import * as fs from 'fs'
import * as path from 'path'
import execa from 'execa'
import pc from '@brillout/picocolors'
import { getRepositoryMismatch } from './release-npm/githubAction.ts'
import { hasUncommittedChanges } from './utils/gitPush.ts'
import type { Step } from './steps.ts'
import { getPackageJson, hasReleaseScript, type PackageJson, type ReleaseMePackage } from '../releaseMe.ts'

type PackageJsonStep = Step & {
  /** What the GitHub Action release-npm.yml requires, e.g. `a build script in package.json` (`null`: it doesn't require the step) */
  requiredByGitHubAction: string | null
}

const releaseScripts = {
  release: 'release-me patch',
  'release:minor': 'release-me minor',
  'release:major': 'release-me major',
  'release:commit': 'release-me commit',
}

/**
 * @param withReleaseNpm Whether the repository uses the GitHub Action release-npm.yml (which requires package.json#repository)
 * @param changedFiles The package.json files the steps change, to commit
 */
async function getPackageJsonSteps(
  monorepoRootDir: string,
  packages: ReleaseMePackage[],
  repo: string | null,
  withReleaseNpm: boolean,
  changedFiles: Set<string>,
): Promise<PackageJsonStep[]> {
  const steps: PackageJsonStep[] = []
  const getUncommittedReason = async (packageJsonPath: string) =>
    (await hasUncommittedChanges(monorepoRootDir, [packageJsonPath]))
      ? `${pc.bold(path.relative(monorepoRootDir, packageJsonPath))} has uncommitted changes`
      : null
  const update = (packageJsonPath: string, fields: Record<string, unknown>) => async () => {
    setPackageJsonFields(packageJsonPath, fields)
    changedFiles.add(packageJsonPath)
    return true
  }

  // The GitHub Actions install the pnpm version of the root package.json (pnpm/action-setup reads it)
  {
    const { packageJson, packageJsonPath } = getPackageJson(monorepoRootDir)
    const { packageManager, devEngines } = packageJson
    const isSet =
      packageManager?.startsWith('pnpm@') ||
      (devEngines?.packageManager?.name === 'pnpm' && !!devEngines.packageManager.version)
    if (!isSet) {
      const pnpmVersion = await getPnpmVersion()
      const value = `pnpm@${pnpmVersion ?? 'x.y.z'}`
      const field = pc.bold(`"packageManager": "${value}"`)
      const fileName = pc.bold(path.relative(monorepoRootDir, packageJsonPath))
      steps.push({
        label: `Set ${field} in ${fileName}`,
        notPossibleReason: pnpmVersion ? await getUncommittedReason(packageJsonPath) : "pnpm isn't installed",
        run: update(packageJsonPath, { packageManager: value }),
        manual: `Set ${field} in ${fileName} (the GitHub Actions install that pnpm version)`,
        requiredByGitHubAction: `${pc.bold('"packageManager"')} in ${fileName}`,
      })
    }
  }

  for (const { packageName, packageRootDir, packageRootDirRelative } of packages) {
    const { packageJson, packageJsonPath } = getPackageJson(packageRootDir)
    const fileName = pc.bold(path.relative(monorepoRootDir, packageJsonPath))

    // No script that runs release-me: the root package of a repository with a single package (see getReleaseMePackages())
    if (!hasReleaseScript(packageJson)) {
      const scripts = { ...releaseScripts, ...packageJson.scripts }
      const example = pc.dim(`("release": "release-me patch", …)`)
      steps.push({
        label: `Add the release scripts to ${fileName} ${example}`,
        notPossibleReason: await getUncommittedReason(packageJsonPath),
        run: update(packageJsonPath, { scripts }),
        manual: `Add the release scripts to ${fileName} ${example}`,
        // The GitHub Action releases the root package of a repository with a single package (see getReleaseMePackages())
        requiredByGitHubAction: null,
      })
    }

    // release-me runs `$ pnpm run build` before releasing: release-me can't know how the package is built
    if (!packageJson.scripts?.build) {
      const build = pc.bold('$ pnpm run build')
      steps.push({
        label: `Add a ${pc.bold('build')} script to ${fileName}`,
        notPossibleReason: `release-me doesn't know how ${pc.cyan(packageName)} is built`,
        run: async () => false,
        manual: `Add a ${pc.bold(
          'build',
        )} script to ${fileName} (release-me runs ${build} before releasing, e.g. ${pc.bold(
          `"build": "tsc"`,
        )}, or ${pc.bold(`"build": "echo 'No build step'"`)})`,
        // The GitHub Action builds the packages it publishes
        requiredByGitHubAction: `a ${pc.bold('build')} script in ${fileName}`,
      })
    }

    // npm's trusted publishing requires package.json#repository to match the GitHub repository
    if (withReleaseNpm && repo && getRepositoryMismatch(packageName, packageJson.repository, repo)) {
      const repository = getRepositoryValue(packageJson.repository, repo, packageRootDirRelative)
      const url = pc.underline(`https://github.com/${repo}`)
      const field = pc.bold('"repository"')
      const current = typeof packageJson.repository === 'string' ? packageJson.repository : packageJson.repository?.url
      const detail = `(npm's trusted publishing requires it${current ? `, it's ${current}` : ''})`
      steps.push({
        label: `Set ${field} of ${fileName} to ${url}`,
        notPossibleReason: await getUncommittedReason(packageJsonPath),
        run: update(packageJsonPath, { repository }),
        manual: `Set ${field} of ${fileName} to ${url} ${detail}`,
        requiredByGitHubAction: `${field} of ${fileName} to be ${url}`,
      })
    }
  }
  return steps
}

/** The new package.json#repository: the GitHub repository `repo` (in a monorepo, with the package's directory) */
function getRepositoryValue(
  repository: PackageJson['repository'],
  repo: string,
  packageRootDirRelative: string,
): PackageJson['repository'] {
  const url = `https://github.com/${repo}`
  if (typeof repository === 'object' && repository) return { ...repository, url }
  if (packageRootDirRelative === '.') return url
  return { type: 'git', url, directory: packageRootDirRelative }
}

/** Sets the fields `fields` of the package.json `packageJsonPath` (keeping its indentation, and the order of its fields) */
function setPackageJsonFields(packageJsonPath: string, fields: Record<string, unknown>) {
  const content = fs.readFileSync(packageJsonPath, 'utf8')
  const indent = /^\{\r?\n([ \t]+)"/.exec(content)?.[1] ?? '  '
  const packageJson = { ...JSON.parse(content), ...fields }
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, indent) + '\n')
}

async function getPnpmVersion(): Promise<string | null> {
  const { stdout, failed } = await execa('pnpm', ['--version'], { reject: false })
  return failed ? null : stdout.trim()
}
