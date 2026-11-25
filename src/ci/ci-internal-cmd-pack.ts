export { ciPack }

// `$ release-me ci-internal-cmd-pack`: job `pack` of the GitHub Action, builds and packs the packages to publish (with the released commit's code, so this job isn't allowed to publish to npm).

import * as fs from 'fs'
import * as path from 'path'
import pc from '@brillout/picocolors'
import { assertUsage, logTitle, run } from '../utils.ts'
import { getCommitReleaseVersion, parseReleaseTag } from './versions.ts'
import { getEnv } from './utils.ts'
import {
  build,
  findBoilerplatePacakge,
  getCommitHash,
  getFilesInsideDir,
  getFilesMonorepoPackageJson,
  getMonorepoRootDir,
  getPackageJson,
  getReleaseMePackages,
  updatePackageJsonVersion,
  updateVersionMacro,
  type ReleaseMePackage,
} from '../releaseMe.ts'

async function ciPack() {
  // Directory where the tarballs are written
  const outDir = path.resolve(getEnv('PACKED_PACKAGES_DIR'))
  // Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release of HEAD: empty.
  const tag = getEnv('TAG')
  // Commit release: only release this package (empty: all packages)
  const packageName = getEnv('PACKAGE')
  const monorepoRootDir = await getMonorepoRootDir()
  const filesMonorepo = await getFilesInsideDir(monorepoRootDir)
  const filesMonorepoPackageJson = getFilesMonorepoPackageJson(filesMonorepo)
  const packages = getReleaseMePackages(filesMonorepoPackageJson)

  const toPack: { packageRootDir: string; skipBuild?: true }[] = []
  if (!tag) {
    let selected = packages
    if (packageName) {
      selected = packages.filter((p) => p.packageName === packageName)
      assertUsage(
        selected.length === 1,
        `No package ${pc.cyan(packageName)} is released by release-me (packages: ${listPackages(packages)}).`,
      )
    }
    const commitHash = await getCommitHash('HEAD')
    // Set all versions before building, so that packages depending on each other reference the commit release versions
    for (const { packageRootDir } of selected) {
      const versionOld = getPackageJson(packageRootDir).packageJson.version!
      const versionNew = getCommitReleaseVersion(versionOld, commitHash)
      await updateVersionMacro(versionOld, versionNew, await getFilesInsideDir(packageRootDir))
      updatePackageJsonVersion(packageRootDir, versionNew)
    }
    toPack.push(...selected.map(({ packageRootDir }) => ({ packageRootDir })))
  } else {
    const { pkg, version } = parseGitTag(tag, packages)
    const { packageJson } = getPackageJson(pkg.packageRootDir)
    assertUsage(
      packageJson.version === version,
      `The Git tag ${pc.bold(tag)} doesn't match ${pkg.packageName}'s package.json#version ${pc.bold(
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

function parseGitTag(gitTag: string, packages: ReleaseMePackage[]): { pkg: ReleaseMePackage; version: string } {
  const releaseTag = parseReleaseTag(gitTag)
  assertUsage(
    releaseTag,
    `${pc.bold(gitTag)} isn't a release tag (${pc.bold('v1.2.3')} or ${pc.bold('some-package@1.2.3')}).`,
  )
  const { packageName, version } = releaseTag
  if (packageName) {
    const pkg = packages.find((p) => p.packageName === packageName)
    assertUsage(
      pkg,
      `The Git tag ${pc.bold(gitTag)} doesn't match any package released by release-me (packages: ${listPackages(
        packages,
      )}).`,
    )
    return { pkg, version }
  }
  assertUsage(
    packages.length === 1,
    `The Git tag ${pc.bold(gitTag)} is ambiguous: there are several packages (${listPackages(
      packages,
    )}) and their release tags are ${pc.bold('some-package@1.2.3')}.`,
  )
  return { pkg: packages[0]!, version }
}

function listPackages(packages: ReleaseMePackage[]) {
  return packages.map((p) => pc.cyan(p.packageName)).join(', ')
}
