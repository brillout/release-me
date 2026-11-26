import { describe, expect, it, vi } from 'vitest'
import { syncPackage, type SyncContext } from './sync-package.ts'
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
      repo: 'vikejs/vike',
      defaultBranch: 'main',
      hasMultiplePackages: false,
    }

    await syncPackage(
      { packageName: 'vike', packageRootDir: '/repo/packages/vike', changelogPath: 'packages/vike/CHANGELOG.md' },
      context,
    )

    // It must not even fetch the releases, let alone delete them: an empty parse is never "delete everything".
    expect(calls).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No versions parsed'))
    warnSpy.mockRestore()
  })
})
