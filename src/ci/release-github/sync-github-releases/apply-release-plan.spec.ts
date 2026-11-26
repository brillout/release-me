import { describe, expect, it, vi } from 'vitest'
import { applyReleasePlan } from './apply-release-plan.ts'
import type { ReleasePlan } from './release-plan.ts'
import type { ReleasesClient } from '../utils/github.ts'
import { findReleaseCommit, gitTagExists } from '../utils/git.ts'

// Creating a release resolves its target commit by shelling out to git: stub it, so that the refusals run without a real repo
vi.mock('../utils/git.ts', () => ({ gitTagExists: vi.fn(), findReleaseCommit: vi.fn() }))

const client: ReleasesClient = {
  list: async () => [],
  create: async () => {},
  update: async () => {},
  delete: async () => {},
}

describe('applyReleasePlan()', () => {
  // A create whose git tag is missing must never be tagged at the wrong commit. These two hard fails are
  // the tool's safety guards, and the create path has no e2e net — so they earn a test. Resolution runs
  // before the client is called, so even a dry run fails fast.
  describe('refuses to create a release whose git tag is missing', () => {
    const createPlan = (isLatest: boolean): ReleasePlan => ({
      releasesToCreate: [{ tag_name: 'v1.0.0', body: 'Notes', version: '1.0.0', isLatest }],
      releasesToUpdate: [],
      releasesToDelete: [],
    })

    it('hard-fails the latest release (it must already be tagged)', async () => {
      vi.mocked(gitTagExists).mockReturnValue(false)

      await expect(applyReleasePlan({ plan: createPlan(true), client })).rejects.toThrow(
        /latest release must already be tagged/,
      )
    })

    it("hard-fails an older release whose commit can't be deduced", async () => {
      vi.mocked(gitTagExists).mockReturnValue(false)
      vi.mocked(findReleaseCommit).mockReturnValue(null)

      await expect(applyReleasePlan({ plan: createPlan(false), client })).rejects.toThrow(/couldn't be deduced/)
    })
  })
})
