import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReleasesClient } from './github.ts'

describe('createReleasesClient()', () => {
  afterEach(() => vi.restoreAllMocks())

  it('under --dry-run, logs what it would do and sends no request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }))
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const client = createReleasesClient({
      repo: 'owner/repo',
      token: 'token',
      apiUrl: 'https://api.github.com',
      dryRun: true,
    })

    await client.create({ tag_name: 'v1.0.0', name: 'v1.0.0', body: 'Notes', make_latest: 'true' })
    await client.update({ release_id: 1, tag_name: 'v0.9.0', body: 'Fresh' })
    await client.delete({ release_id: 2, tag_name: 'v0.8.0' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(logSpy.mock.calls.flat()).toEqual([
      '[dry-run] Would create release v1.0.0',
      '[dry-run] Would update release v0.9.0',
      '[dry-run] Would delete release v0.8.0',
    ])
  })
})
