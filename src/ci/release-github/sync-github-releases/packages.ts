export { getPackages }
export { getPackagesToSync }
export type { SyncPackage }

import * as path from 'node:path'
import pc from '@brillout/picocolors'
import { getChangelogPath, getFilesInsideDir, getReleaseMePackages } from '../../../releaseMe.ts'
import { assertUsage } from '../../../utils.ts'

// A package released by release-me. packageRootDir is absolute; changelogPath is relative to the repository root
// (e.g. `packages/vike/CHANGELOG.md`).
type SyncPackage = {
  packageName: string
  packageRootDir: string
  changelogPath: string
}

/** The packages released by release-me that have a CHANGELOG.md */
async function getPackages(monorepoRootDir: string) {
  const releaseMePackages = getReleaseMePackages(await getFilesInsideDir(monorepoRootDir))
  // When there are several, they share the repository's tags, so their release tags are qualified with the package
  // name (see getTagScheme()).
  const hasMultiplePackages = releaseMePackages.length > 1
  const packages: SyncPackage[] = releaseMePackages.flatMap(({ packageName, packageRootDir }) => {
    const { changeLogFilePath, changeLogFileAlreadyExisted } = getChangelogPath(
      packageRootDir,
      monorepoRootDir,
      hasMultiplePackages,
    )
    // Not released yet
    if (!changeLogFileAlreadyExisted) return []
    // git reports forward-slash paths on every OS
    const changelogPath = path.relative(monorepoRootDir, changeLogFilePath).split(path.sep).join('/')
    return [{ packageName, packageRootDir: path.resolve(packageRootDir), changelogPath }]
  })
  return { packages, hasMultiplePackages }
}

// Which packages to sync, in priority order:
//  - the packages passed as arguments, if any — each a package name or directory (relative to cwd), or
//  - on push (CI): the packages whose CHANGELOG.md changed, or
//  - otherwise (manual workflow_dispatch, or a local run without arguments): every package.
function getPackagesToSync(
  packages: SyncPackage[],
  { packageArgs, cwd, pushedFiles }: { packageArgs: string[]; cwd: string; pushedFiles: string[] | null },
): SyncPackage[] {
  if (packageArgs.length > 0) {
    const packageNames = packages.map((pkg) => pkg.packageName).join(', ')
    const selected = packageArgs.map((packageArg) => {
      const pkg = packages.find(
        (pkg) => pkg.packageName === packageArg || pkg.packageRootDir === path.resolve(cwd, packageArg),
      )
      assertUsage(
        pkg,
        `${pc.cyan(
          packageArg,
        )} isn't the name or directory of a package to sync (the packages released by release-me that have a CHANGELOG.md: ${packageNames})`,
      )
      return pkg
    })
    return [...new Set(selected)]
  }
  if (pushedFiles) return packages.filter((pkg) => pushedFiles.includes(pkg.changelogPath))
  return packages
}
