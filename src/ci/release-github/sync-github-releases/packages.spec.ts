import { describe, expect, it } from 'vitest'
import { getPackagesToSync, type SyncPackage } from './packages.ts'

describe('getPackagesToSync()', () => {
  const vike: SyncPackage = {
    packageName: 'vike',
    packageRootDir: '/repo/packages/vike',
    changelogPath: 'packages/vike/CHANGELOG.md',
  }
  const createVike: SyncPackage = {
    packageName: 'create-vike',
    packageRootDir: '/repo/packages/create-vike',
    changelogPath: 'packages/create-vike/CHANGELOG.md',
  }
  const rootPackage: SyncPackage = {
    packageName: 'some-package',
    packageRootDir: '/repo',
    changelogPath: 'CHANGELOG.md',
  }
  const noArgs = { packageArgs: [], cwd: '/repo' }

  it('picks the packages passed as arguments, by name or by directory relative to cwd', () => {
    expect(
      getPackagesToSync([vike, createVike], { packageArgs: ['create-vike'], cwd: '/repo', pushedFiles: null }),
    ).toEqual([createVike])
    expect(
      getPackagesToSync([vike, createVike], { packageArgs: ['packages/vike/'], cwd: '/repo', pushedFiles: null }),
    ).toEqual([vike])
    expect(
      getPackagesToSync([vike, createVike], { packageArgs: ['.'], cwd: '/repo/packages/vike', pushedFiles: null }),
    ).toEqual([vike])
    // The same package twice is synced once
    expect(
      getPackagesToSync([vike, createVike], {
        packageArgs: ['vike', 'packages/vike'],
        cwd: '/repo',
        pushedFiles: null,
      }),
    ).toEqual([vike])
  })

  it('the packages passed as arguments take precedence over the pushed files', () => {
    expect(
      getPackagesToSync([vike, createVike], {
        packageArgs: ['vike'],
        cwd: '/repo',
        pushedFiles: ['packages/create-vike/CHANGELOG.md'],
      }),
    ).toEqual([vike])
  })

  it("throws upon an argument that isn't a package to sync", () => {
    expect(() =>
      getPackagesToSync([vike, createVike], { packageArgs: ['packages/docs'], cwd: '/repo', pushedFiles: null }),
    ).toThrow(/packages\/docs.*isn't the name or directory of a package to sync.*vike, create-vike/)
  })

  it('on push, picks the packages whose CHANGELOG.md changed', () => {
    expect(
      getPackagesToSync([vike, createVike], {
        ...noArgs,
        pushedFiles: ['packages/create-vike/CHANGELOG.md', 'packages/vike/src/index.ts', 'packages/vike/README.md'],
      }),
    ).toEqual([createVike])
    expect(getPackagesToSync([rootPackage], { ...noArgs, pushedFiles: ['CHANGELOG.md', 'docs/CHANGELOG.md'] })).toEqual(
      [rootPackage],
    )
  })

  it("on push, picks nothing when no package's CHANGELOG.md changed", () => {
    // E.g. the CHANGELOG.md of a package that release-me doesn't release
    expect(getPackagesToSync([vike], { ...noArgs, pushedFiles: ['docs/CHANGELOG.md', 'README.md'] })).toEqual([])
  })

  it('otherwise (manual run without arguments), picks every package', () => {
    expect(getPackagesToSync([vike, createVike], { ...noArgs, pushedFiles: null })).toEqual([vike, createVike])
  })
})
