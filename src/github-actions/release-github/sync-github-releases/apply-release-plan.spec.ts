import { describe, expect, it, vi } from 'vitest'
import { applyReleasePlan } from './apply-release-plan.ts'
import type { ReleasePlan } from './release-plan.ts'
import { GitHubApiError, type ReleasesClient } from '../utils/github.ts'
import { findReleaseCommit, gitTagExists } from '../utils/git.ts'

// Creating a release resolves its target commit by shelling out to git: stub it, so that the refusals run without a real repo
vi.mock('../utils/git.ts', () => ({ gitTagExists: vi.fn(), findReleaseCommit: vi.fn() }))

// Not called: the refusals happen before
const client = {} as ReleasesClient
const changelogPath = 'CHANGELOG.md'

describe('applyReleasePlan()', () => {
  // A create whose git tag is missing must never be tagged at the wrong commit. These two hard fails are
  // the tool's safety guards, and the create path has no e2e net — so they earn a test. Resolution runs
  // before the client is called, so even a dry run fails fast.
  describe('refuses to create a release whose git tag is missing', () => {
    const createPlan = (isLatest: boolean): ReleasePlan => ({
      releasesToCreate: [{ tag_name: 'v1.0.0', name: 'vike@1.0.0', body: 'Notes', version: '1.0.0', isLatest }],
      releasesToUpdate: [],
      releasesToDelete: [],
    })

    it('hard-fails the latest release (it must already be tagged)', async () => {
      vi.mocked(gitTagExists).mockReturnValue(false)

      await expect(applyReleasePlan({ plan: createPlan(true), client, changelogPath })).rejects.toThrow(
        /latest release must already be tagged/,
      )
    })

    it("hard-fails an older release whose commit can't be deduced", async () => {
      vi.mocked(gitTagExists).mockReturnValue(false)
      vi.mocked(findReleaseCommit).mockReturnValue(null)

      await expect(applyReleasePlan({ plan: createPlan(false), client, changelogPath })).rejects.toThrow(
        /couldn't be deduced/,
      )
    })
  })

  // The GitHub Action's token can't create a git tag at an old commit (its .github/workflows/ differs): the run must
  // still sync all other releases, and report the skipped ones instead of aborting at the first one.
  describe('skips a release whose missing git tag the token is forbidden to create', () => {
    const forbidden = new GitHubApiError('403', 403, '{"message":"Resource not accessible by integration"}')
    const plan: ReleasePlan = {
      releasesToCreate: [
        { tag_name: 'v1.0.0', body: 'Notes', version: '1.0.0', isLatest: false },
        { tag_name: 'v1.0.1', body: 'Notes', version: '1.0.1', isLatest: true },
      ],
      releasesToUpdate: [{ id: 1, tag_name: 'v0.9.0', body: 'Fresh' }],
      releasesToDelete: [],
    }
    const createClient = (createError: Error) => ({
      list: vi.fn(),
      create: vi.fn(async ({ tag_name }: { tag_name: string }) => {
        if (tag_name === 'v1.0.0') throw createError
      }),
      update: vi.fn(),
      delete: vi.fn(),
    })
    // v1.0.0's tag is missing (its commit is deduced), v1.0.1's tag exists
    const mockTags = () => {
      vi.mocked(gitTagExists).mockImplementation((releaseTag) => releaseTag !== 'v1.0.0')
      vi.mocked(findReleaseCommit).mockReturnValue('abc123')
    }

    it('skips it, syncs the other releases, and returns its tag', async () => {
      mockTags()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const client = createClient(forbidden)

      const skipped = await applyReleasePlan({ plan, client, changelogPath })

      expect(skipped).toEqual(['v1.0.0'])
      expect(client.create).toHaveBeenCalledTimes(2)
      expect(client.update).toHaveBeenCalledTimes(1)
      warnSpy.mockRestore()
    })

    it('rethrows a 403 of the rate limit', async () => {
      mockTags()
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const rateLimited = new GitHubApiError('403', 403, '{"message":"You have exceeded a secondary rate limit"}')

      await expect(applyReleasePlan({ plan, client: createClient(rateLimited), changelogPath })).rejects.toBe(
        rateLimited,
      )
    })

    it('rethrows a 403 of a release whose tag exists (the request creates no tag)', async () => {
      vi.mocked(gitTagExists).mockReturnValue(true)

      await expect(applyReleasePlan({ plan, client: createClient(forbidden), changelogPath })).rejects.toBe(forbidden)
    })
  })
})
