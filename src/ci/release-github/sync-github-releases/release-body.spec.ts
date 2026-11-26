import { describe, expect, it } from 'vitest'
import { buildReleaseBody } from './release-body.ts'

describe('buildReleaseBody()', () => {
  const changelogUrl = 'https://example.com/CHANGELOG.md'
  const footer = `<sub>Automatically synced from [\`CHANGELOG.md\`](${changelogUrl})</sub>`

  it('tops the notes with the release date and tails them with the CHANGELOG.md footer', () => {
    expect(buildReleaseBody('### Bug Fixes\n\n* Fixed it.', { releaseDate: '2026-05-06', changelogUrl })).toBe(
      `_May 6, 2026_\n\n### Bug Fixes\n\n* Fixed it.\n\n${footer}`,
    )
    // Two-digit day at year-end: guards against UTC date drift and confirms no leading zero on the day.
    expect(buildReleaseBody('* Note.', { releaseDate: '2021-12-31', changelogUrl })).toBe(
      `_December 31, 2021_\n\n* Note.\n\n${footer}`,
    )
  })

  it('omits the date line when the date is unknown (no tag, no deducible commit)', () => {
    expect(buildReleaseBody('### Bug Fixes\n\n* Fixed it.', { releaseDate: null, changelogUrl })).toBe(
      `### Bug Fixes\n\n* Fixed it.\n\n${footer}`,
    )
  })
})
