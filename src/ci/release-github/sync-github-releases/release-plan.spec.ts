import { describe, expect, it } from 'vitest'
import { getReleasePlan } from './release-plan.ts'
import { getTagScheme } from './tag-scheme.ts'

describe('getReleasePlan()', () => {
  it('creates missing past releases alongside the current release and updates stale notes', () => {
    const plan = getReleasePlan({
      tagScheme: getTagScheme('vike', false),
      releaseBodyByVersion: {
        '1.0.1': 'New release notes',
        '1.0.0': 'Updated old notes',
        '0.9.0': 'Existing notes',
        '0.8.0': 'Missing past notes',
      },
      githubReleases: [
        { id: 1, tag_name: 'v1.0.0', body: 'Outdated old notes' },
        { id: 2, tag_name: 'v0.9.0', body: 'Existing notes' },
      ],
    })

    expect(plan).toEqual({
      releasesToCreate: [
        { tag_name: 'v0.8.0', body: 'Missing past notes', version: '0.8.0', isLatest: false },
        { tag_name: 'v1.0.1', body: 'New release notes', version: '1.0.1', isLatest: true },
      ],
      releasesToUpdate: [{ id: 1, tag_name: 'v1.0.0', body: 'Updated old notes' }],
      releasesToDelete: [],
    })
  })

  it('leaves releases we do not own untouched (no spurious update or delete)', () => {
    const plan = getReleasePlan({
      tagScheme: getTagScheme('vike', false),
      releaseBodyByVersion: { '1.0.0': 'Notes' },
      githubReleases: [
        { id: 1, tag_name: 'v1.0.0', body: 'Notes' },
        // Not one of our vX.Y.Z tags: must not be updated (no undefined body) nor deleted.
        { id: 2, tag_name: 'nightly', body: 'Unrelated release' },
      ],
    })

    expect(plan).toEqual({ releasesToCreate: [], releasesToUpdate: [], releasesToDelete: [] })
  })

  it('deletes a release whose version was removed from the changelog', () => {
    const plan = getReleasePlan({
      tagScheme: getTagScheme('vike', false),
      releaseBodyByVersion: { '1.0.0': 'Notes' },
      githubReleases: [
        { id: 1, tag_name: 'v1.0.0', body: 'Notes' },
        { id: 2, tag_name: 'v0.9.0', body: 'Removed from changelog' },
      ],
    })

    expect(plan).toEqual({
      releasesToCreate: [],
      releasesToUpdate: [],
      releasesToDelete: [{ id: 2, tag_name: 'v0.9.0', body: 'Removed from changelog' }],
    })
  })

  it('only deletes releases in its own namespace', () => {
    const plan = getReleasePlan({
      tagScheme: getTagScheme('create-vike-core', true),
      releaseBodyByVersion: { '0.0.1': 'Notes' },
      githubReleases: [
        { id: 1, tag_name: 'create-vike-core@0.0.1', body: 'Notes' },
        // Another package's release — not ours to delete.
        { id: 2, tag_name: 'vike@0.4.0', body: 'Another package' },
      ],
    })

    expect(plan).toEqual({ releasesToCreate: [], releasesToUpdate: [], releasesToDelete: [] })
  })
})
