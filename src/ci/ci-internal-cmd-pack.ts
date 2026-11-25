export { ciPack }

// `$ release-me ci-internal-cmd-pack`: job `pack` of the GitHub Action, builds and packs the packages to publish (with the released commit's code, so this job isn't allowed to publish to npm).

import * as fs from 'fs'
import * as path from 'path'
import { logTitle, run } from '../utils.ts'
import { getCommitReleaseVersion, parseReleaseTag } from './versions.ts'
import { fail, getEnv } from './utils.ts'
import {
  build,
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
  // Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release: empty.
  const tag = getEnv('TAG')
  const monorepoRootDir = await getMonorepoRootDir()
  const packages = getReleaseMePackages(getFilesMonorepoPackageJson(await getFilesInsideDir(monorepoRootDir)))

  const toPack = tag ? [getTaggedPackage(tag, packages)] : await prepareCommitRelease(packages, getEnv('PACKAGE'))
  for (const { packageRootDir } of toPack) {
    await build(packageRootDir)
  }
  fs.mkdirSync(outDir, { recursive: true })
  for (const pkg of toPack) {
    await pack(pkg, outDir)
  }
}

/** The package that the Git tag releases (the job `publish` checks the version) */
function getTaggedPackage(tag: string, packages: ReleaseMePackage[]): ReleaseMePackage {
  const releaseTag = parseReleaseTag(tag)
  if (!releaseTag) fail(`${tag} isn't a release tag (v1.2.3 or some-package@1.2.3).`)
  const { packageName } = releaseTag
  if (!packageName) {
    if (packages.length > 1) {
      fail(
        `The Git tag ${tag} is ambiguous: there are several packages (${list(
          packages,
        )}) and their release tags are some-package@1.2.3.`,
      )
    }
    return packages[0]!
  }
  const pkg = packages.find((p) => p.packageName === packageName)
  if (!pkg) fail(`The Git tag ${tag} doesn't match any package released by release-me (packages: ${list(packages)}).`)
  return pkg
}

/** Sets the commit release version of the package `packageName` (empty: of all packages) */
async function prepareCommitRelease(packages: ReleaseMePackage[], packageName: string): Promise<ReleaseMePackage[]> {
  const selected = packageName ? packages.filter((p) => p.packageName === packageName) : packages
  if (selected.length === 0) fail(`No package ${packageName} is released by release-me (packages: ${list(packages)}).`)
  const commitHash = await getCommitHash('HEAD')
  // Set all versions before building, so that packages depending on each other reference the commit release versions
  for (const { packageRootDir } of selected) {
    const versionOld = getPackageJson(packageRootDir).packageJson.version!
    const versionNew = getCommitReleaseVersion(versionOld, commitHash)
    await updateVersionMacro(versionOld, versionNew, await getFilesInsideDir(packageRootDir))
    updatePackageJsonVersion(packageRootDir, versionNew)
  }
  return selected
}

async function pack({ packageName, packageRootDir }: ReleaseMePackage, outDir: string) {
  logTitle(`Pack ${packageName}`)
  // `$ pnpm publish` runs prepublishOnly, whereas `$ pnpm pack` doesn't
  await run('pnpm run --if-present prepublishOnly', { cwd: packageRootDir })
  // `$ pnpm pack` replaces `workspace:` and `catalog:` dependency versions
  await run(['pnpm', 'pack', '--pack-destination', outDir], { cwd: packageRootDir })
}

function list(packages: ReleaseMePackage[]): string {
  return packages.map((p) => p.packageName).join(', ')
}
