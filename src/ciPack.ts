export { ciPack }
export { getReleaseMePackages }
export type { CiPackArgs }

// `$ release-me ci-pack` is run by the reusable workflow .github/workflows/publish.yml (its job that doesn't have permission to publish to npm):
// - It builds and packs the packages to publish.
// - The workflow then publishes the tarballs in a separate job that doesn't run any code of the repository.

import * as fs from 'fs'
import * as path from 'path'
import pc from '@brillout/picocolors'
import { assertUsage } from './utils.js'
import { assertCiWorkflowsUpToDate, getCiWorkflow } from './githubAction.js'
import {
  build,
  findBoilerplatePacakge,
  getCommitHash,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  getVersion,
  logTitle,
  run,
  thisPackageName,
  updatePackageJsonVersion,
  updateVersionMacro,
  type Files,
} from './releaseMe.js'

type CiPackArgs = {
  /** Git tag of a stable release (`v1.2.3` or `some-package@1.2.3`), or `commit` for a commit release of HEAD */
  target: string
  /** Directory where the tarballs are written */
  outDir: string
  /** Commit release: only release this package (default: all packages that use release-me) */
  packageName?: string
}
type ReleaseMePackage = { packageName: string; packageRootDir: string }

async function ciPack({ target, outDir, packageName }: CiPackArgs) {
  outDir = path.resolve(outDir)
  const monorepoRootDir = await getMonorepoRootDir()
  // Fail on drift also in CI (normally caught earlier, when releasing locally). Skipped if the released commit predates the workflows.
  if (await getCiWorkflow(monorepoRootDir, target === 'commit' ? 'commit' : 'stable'))
    assertCiWorkflowsUpToDate(monorepoRootDir)
  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(filesMonorepo)
  const packages = getReleaseMePackages(filesMonorepoPackageJson)

  const toPack: { packageRootDir: string; skipBuild?: true }[] = []
  if (target === 'commit') {
    let selected = packages
    if (packageName) {
      selected = packages.filter((p) => p.packageName === packageName)
      assertUsage(
        selected.length === 1,
        `No package ${pc.cyan(packageName)} uses ${thisPackageName} (packages: ${listPackages(packages)}).`,
      )
    }
    const commitHash = await getCommitHash('HEAD')
    // Set all versions before building, so that packages depending on each other reference the commit release versions
    for (const { packageRootDir } of selected) {
      const { versionOld, versionNew } = await getVersion(packageRootDir, 'commit', commitHash)
      await updateVersionMacro(versionOld, versionNew, await getFilesInsideDir(packageRootDir))
      updatePackageJsonVersion(packageRootDir, versionNew)
    }
    toPack.push(...selected.map(({ packageRootDir }) => ({ packageRootDir })))
  } else {
    const { pkg, version } = parseGitTag(target, packages)
    const { packageJson } = getPackageJson(pkg.packageRootDir)
    assertUsage(
      packageJson.version === version,
      `The Git tag ${pc.bold(target)} doesn't match ${pkg.packageName}'s package.json#version ${pc.bold(
        String(packageJson.version),
      )}.`,
    )
    toPack.push({ packageRootDir: pkg.packageRootDir })
    // Same as the local release: the boilerplate create-${packageName} is published alongside (without build step)
    const boilerplatePackageJson = await findBoilerplatePacakge(pkg.packageName, filesMonorepoPackageJson)
    if (boilerplatePackageJson) toPack.push({ packageRootDir: path.dirname(boilerplatePackageJson), skipBuild: true })
  }

  for (const { packageRootDir, skipBuild } of toPack) {
    if (!skipBuild) await build(packageRootDir)
  }

  fs.mkdirSync(outDir, { recursive: true })
  for (const { packageRootDir } of toPack) {
    logTitle(`Pack ${getPackageJson(packageRootDir).packageJson.name}`)
    // `$ pnpm publish` runs prepublishOnly, whereas `$ pnpm pack` doesn't
    await run('pnpm run --if-present prepublishOnly', { cwd: packageRootDir })
    // `$ pnpm pack` replaces `workspace:` and `catalog:` dependency versions
    await run(['pnpm', 'pack', '--pack-destination', outDir], { cwd: packageRootDir })
  }
}

function getReleaseMePackages(filesMonorepoPackageJson: Files): ReleaseMePackage[] {
  const packages: ReleaseMePackage[] = []
  for (const { filePathAbsolute } of filesMonorepoPackageJson) {
    const packageRootDir = path.dirname(filePathAbsolute)
    const { packageJson } = getPackageJson(packageRootDir)
    if (!packageJson.name || !packageJson.devDependencies?.[thisPackageName]) continue
    packages.push({ packageName: packageJson.name, packageRootDir })
  }
  assertUsage(packages.length > 0, `No package.json has ${thisPackageName} in its devDependencies.`)
  return packages
}

function parseGitTag(gitTag: string, packages: ReleaseMePackage[]): { pkg: ReleaseMePackage; version: string } {
  // some-package@1.2.3, @some-scope/some-package@1.2.3
  const i = gitTag.lastIndexOf('@')
  if (i > 0) {
    const name = gitTag.slice(0, i)
    const pkg = packages.find((p) => p.packageName === name)
    assertUsage(
      pkg,
      `The Git tag ${pc.bold(gitTag)} doesn't match any package that uses ${thisPackageName} (packages: ${listPackages(
        packages,
      )}).`,
    )
    return { pkg, version: gitTag.slice(i + 1) }
  }
  // v1.2.3
  assertUsage(
    gitTag.startsWith('v'),
    `${pc.bold(gitTag)} isn't a release tag (${pc.bold('v1.2.3')} or ${pc.bold('some-package@1.2.3')}).`,
  )
  assertUsage(
    packages.length === 1,
    `The Git tag ${pc.bold(gitTag)} is ambiguous: there are several packages (${listPackages(
      packages,
    )}) and their release tags are ${pc.bold('some-package@1.2.3')}.`,
  )
  return { pkg: packages[0]!, version: gitTag.slice(1) }
}

function listPackages(packages: ReleaseMePackage[]) {
  return packages.map((p) => pc.cyan(p.packageName)).join(', ')
}
