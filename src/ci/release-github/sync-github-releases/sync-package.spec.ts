import { describe, expect, it, vi } from 'vitest'
import { syncPackage, type SyncContext } from './sync-package.ts'

// syncPackage() reads CHANGELOG.md from disk; stub it so the test can hand it a CHANGELOG.md that parses
// to zero versions.
vi.mock('node:fs/promises', () => ({
  readFile: async () => 'A CHANGELOG.md with no version headings.',
}))

describe('syncPackage()', () => {
  it('skips the package when its CHANGELOG.md parses to zero versions, touching nothing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const release = { id: 1, tag_name: 'v1.0.0', body: 'Notes' }
    const client = { list: vi.fn(async () => [release]), create: vi.fn(), update: vi.fn(), delete: vi.fn() }
    const context: SyncContext = { client, repo: 'vikejs/vike', defaultBranch: 'main', hasMultiplePackages: false }

    await syncPackage(
      { packageName: 'vike', packageRootDir: '/repo/packages/vike', changelogPath: 'packages/vike/CHANGELOG.md' },
      context,
    )

    // It must not even fetch the releases, let alone delete them: an empty parse is never "delete everything".
    for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No versions parsed'))
    warnSpy.mockRestore()
  })
})
