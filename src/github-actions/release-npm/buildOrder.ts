export { getPackagesToBuild }
export type { WorkspacePackage }

// The GitHub Action builds from a fresh checkout, which has no build output yet: a package whose build needs another
// workspace package's build output (e.g. vike-react-antd needs vike-react's types) must be built after it.

type WorkspacePackage = {
  packageRootDir: string
  packageJson: {
    name?: string
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
  }
}

/**
 * The directories to build, in order: the published packages, each after the workspace packages it (transitively)
 * depends on.
 *
 * - Dependencies are matched by name, not by version: a commit release sets the versions to `1.2.3-commit-abc1234`, so
 *   that a dependency's version range (e.g. `"vike-react": "0.6.32"`) no longer matches (and pnpm then doesn't consider
 *   it a workspace dependency).
 * - A dependency without a build script is skipped, and so is a package name used by several workspace packages
 *   (ambiguous).
 */
function getPackagesToBuild(published: { packageRootDir: string }[], workspacePackages: WorkspacePackage[]): string[] {
  const byDir = new Map(workspacePackages.map((pkg) => [pkg.packageRootDir, pkg]))
  const byName = new Map<string, WorkspacePackage | null>()
  for (const pkg of workspacePackages) {
    const { name } = pkg.packageJson
    if (!name) continue
    // null: ambiguous
    byName.set(name, byName.has(name) ? null : pkg)
  }
  const publishedDirs = new Set(published.map(({ packageRootDir }) => packageRootDir))

  const order: string[] = []
  const visited = new Set<string>()
  const visit = (packageRootDir: string) => {
    // Also breaks dependency cycles
    if (visited.has(packageRootDir)) return
    visited.add(packageRootDir)
    const pkg = byDir.get(packageRootDir)
    for (const dependencyName of getDependencyNames(pkg)) {
      const dependency = byName.get(dependencyName)
      if (dependency && dependency.packageRootDir !== packageRootDir) visit(dependency.packageRootDir)
    }
    if (publishedDirs.has(packageRootDir) || pkg?.packageJson.scripts?.build) order.push(packageRootDir)
  }
  for (const { packageRootDir } of published) visit(packageRootDir)
  return order
}

function getDependencyNames(pkg: WorkspacePackage | undefined): string[] {
  if (!pkg) return []
  const { dependencies, devDependencies, peerDependencies, optionalDependencies } = pkg.packageJson
  return [
    ...new Set(
      [dependencies, devDependencies, peerDependencies, optionalDependencies].flatMap((deps) =>
        Object.keys(deps ?? {}),
      ),
    ),
  ]
}
