import { describe, expect, it, vi } from 'vitest'
import { getPackagesToSync, syncPackage, type SyncContext, type SyncPackage } from './sync-package.ts'
import type { Release, ReleasesClient } from '../utils/github.ts'

// syncPackage() reads CHANGELOG.md from disk; stub it so the test can hand it a CHANGELOG.md that parses
// to zero versions.
vi.mock('node:fs/promises', () => ({
  readFile: async () => 'A CHANGELOG.md with no version headings.',
}))

function createFakeClient(): { client: ReleasesClient; calls: string[] } {
  const calls: string[] = []
  const client: ReleasesClient = {
    async list() {
      calls.push('list')
      return [{ id: 1, tag_name: 'v1.0.0', body: 'Notes' }] as Release[]
    },
    async create() {
      calls.push('create')
    },
    async update() {
      calls.push('update')
    },
    async delete() {
      calls.push('delete')
    },
  }
  return { client, calls }
}

describe('syncPackage()', () => {
  it('skips the package when its CHANGELOG.md parses to zero versions, touching nothing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, calls } = createFakeClient()
    const context: SyncContext = {
      client,
      owner: 'vikejs',
      repo: 'vike',
      defaultBranch: 'main',
      hasMultiplePackages: false,
    }

    await syncPackage({ packageName: 'vike', changelogPath: 'packages/vike/CHANGELOG.md' }, context)

    // It must not even fetch the releases, let alone delete them: an empty parse is never "delete everything".
    expect(calls).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No versions parsed'))
    warnSpy.mockRestore()
  })
})

describe('getPackagesToSync()', () => {
  const vike: SyncPackage = { packageName: 'vike', changelogPath: 'packages/vike/CHANGELOG.md' }
  const createVike: SyncPackage = { packageName: 'create-vike', changelogPath: 'packages/create-vike/CHANGELOG.md' }
  const rootPackage: SyncPackage = { packageName: 'some-package', changelogPath: 'CHANGELOG.md' }

  it('on push, picks the packages whose CHANGELOG.md changed', () => {
    expect(
      getPackagesToSync(
        [vike, createVike],
        ['packages/create-vike/CHANGELOG.md', 'packages/vike/src/index.ts', 'packages/vike/README.md'],
      ),
    ).toEqual([createVike])
    expect(getPackagesToSync([rootPackage], ['CHANGELOG.md', 'docs/CHANGELOG.md'])).toEqual([rootPackage])
  })

  it("on push, picks nothing when no package's CHANGELOG.md changed", () => {
    // E.g. the CHANGELOG.md of a package that release-me doesn't release
    expect(getPackagesToSync([vike], ['docs/CHANGELOG.md', 'README.md'])).toEqual([])
  })

  it('otherwise (manual run), picks every package', () => {
    expect(getPackagesToSync([vike, createVike], null)).toEqual([vike, createVike])
  })
})
