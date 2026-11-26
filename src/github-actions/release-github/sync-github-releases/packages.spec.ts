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
})
