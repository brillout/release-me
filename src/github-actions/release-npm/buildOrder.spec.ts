import { describe, expect, it } from 'vitest'
import { getPackagesToBuild, type WorkspacePackage } from './buildOrder.ts'

const pkg = (
  packageRootDir: string,
  name: string,
  deps: Partial<Pick<WorkspacePackage['packageJson'], 'dependencies' | 'devDependencies' | 'peerDependencies'>> = {},
  build = true,
): WorkspacePackage => ({
  packageRootDir,
  packageJson: { name, ...(build ? { scripts: { build: 'tsc' } } : {}), ...deps },
})

describe('getPackagesToBuild()', () => {
  // A commit release of vike-react's monorepo: the published extensions must be built after vike-react
  const vikeReact = pkg('/r/packages/vike-react', 'vike-react')
  const antd = pkg('/r/packages/vike-react-antd', 'vike-react-antd', {
    // A commit release changed vike-react's version: the range doesn't match anymore, the name still does
    devDependencies: { 'vike-react': '0.6.32' },
    peerDependencies: { 'vike-react': '>=0.4.13' },
  })
  const query = pkg('/r/packages/vike-react-query', 'vike-react-query', { devDependencies: { 'vike-react': '0.6.32' } })
  const workspace = [antd, query, vikeReact, pkg('/r', 'vike-react-monorepo', {}, false)]

  it('builds the dependencies first, whatever the order of the published packages', () => {
    expect(getPackagesToBuild([antd, query, vikeReact], workspace)).toEqual([
      '/r/packages/vike-react',
      '/r/packages/vike-react-antd',
      '/r/packages/vike-react-query',
    ])
  })

  it('builds an unpublished dependency (e.g. the stable release of vike-react-antd)', () => {
    expect(getPackagesToBuild([antd], workspace)).toEqual(['/r/packages/vike-react', '/r/packages/vike-react-antd'])
  })

  it('skips a dependency without build script, and ignores dependencies outside the workspace', () => {
    const lib = pkg('/r/packages/lib', 'lib', {}, false)
    const app = pkg('/r/packages/app', 'app', { dependencies: { lib: 'workspace:*', react: '^19.0.0' } })
    expect(getPackagesToBuild([app], [lib, app])).toEqual(['/r/packages/app'])
  })

  it('handles dependency cycles', () => {
    const a = pkg('/r/a', 'a', { dependencies: { b: '1.0.0' } })
    const b = pkg('/r/b', 'b', { devDependencies: { a: '1.0.0' } })
    expect(getPackagesToBuild([a, b], [a, b])).toEqual(['/r/b', '/r/a'])
  })

  it('ignores an ambiguous package name', () => {
    const dep1 = pkg('/r/one/dep', 'dep')
    const dep2 = pkg('/r/two/dep', 'dep')
    const app = pkg('/r/app', 'app', { dependencies: { dep: '1.0.0' } })
    expect(getPackagesToBuild([app], [dep1, dep2, app])).toEqual(['/r/app'])
  })
})
