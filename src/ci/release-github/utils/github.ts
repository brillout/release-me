export { createReleasesClient }
export type { Release }
export type { NewRelease }
export type { ReleasesClient }

import { setTimeout } from 'node:timers/promises'

// The fields we use of a GitHub Release (https://docs.github.com/en/rest/releases/releases).
type Release = {
  id: number
  tag_name: string
  body: string | null
}

type NewRelease = {
  tag_name: string
  target_commitish?: string
  name: string
  body: string
  make_latest: 'true' | 'false'
}

// The GitHub Releases of one repository. The writes log what they do — or, under --dry-run, what they would do
// (instead of doing it).
type ReleasesClient = {
  list(): Promise<Release[]>
  create(release: NewRelease): Promise<void>
  /** Sets the body of the release to `release.body` */
  update(release: Release & { body: string }): Promise<void>
  delete(release: Release): Promise<void>
}

// Pause between write requests so bursts (e.g. backfilling many releases) stay under GitHub's
// secondary rate limit — its burst/concurrency limit, separate from the hourly primary quota.
// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
const RATE_LIMIT_DELAY_MS = 500

const pastTenseByAction = { create: 'Created', update: 'Updated', delete: 'Deleted' } as const

function createReleasesClient({
  repo,
  token,
  apiUrl,
  dryRun,
}: { repo: string; token: string; apiUrl: string; dryRun: boolean }): ReleasesClient {
  const releasesPath = `/repos/${repo}/releases`
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'release-me',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  let hasWritten = false

  async function request<T = void>(
    pathname: string,
    { body, method = 'GET' }: { body?: unknown; method?: 'GET' | 'PATCH' | 'POST' | 'DELETE' } = {},
  ): Promise<T> {
    const response = await fetch(new URL(pathname, apiUrl), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorBody = await response.text()
      throw new Error(
        `GitHub API request failed (${method} ${pathname}): ${response.status} ${response.statusText}\n${errorBody}`,
      )
    }

    return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
  }

  async function write(
    action: keyof typeof pastTenseByAction,
    releaseTag: string,
    sendRequest: () => Promise<void>,
  ): Promise<void> {
    if (dryRun) {
      console.log(`[dry-run] Would ${action} release ${releaseTag}`)
      return
    }
    // Only between writes: a single write (e.g. one new release) doesn't wait
    if (hasWritten) await setTimeout(RATE_LIMIT_DELAY_MS)
    hasWritten = true
    await sendRequest()
    console.log(`${pastTenseByAction[action]} release ${releaseTag}`)
  }

  return {
    // https://docs.github.com/en/rest/releases/releases#list-releases
    async list(): Promise<Release[]> {
      const releases: Release[] = []
      const perPage = 100
      // Keep paging until a short (or empty) page signals the end.
      for (let page = 1; ; page++) {
        const pageReleases = await request<Release[]>(`${releasesPath}?per_page=${perPage}&page=${page}`)
        releases.push(...pageReleases)
        if (pageReleases.length < perPage) return releases
      }
    },
    // https://docs.github.com/en/rest/releases/releases#create-a-release
    create(release: NewRelease): Promise<void> {
      return write('create', release.tag_name, () => request(releasesPath, { method: 'POST', body: release }))
    },
    // https://docs.github.com/en/rest/releases/releases#update-a-release
    update(release): Promise<void> {
      return write('update', release.tag_name, () =>
        request(`${releasesPath}/${release.id}`, { method: 'PATCH', body: { body: release.body } }),
      )
    },
    // https://docs.github.com/en/rest/releases/releases#delete-a-release
    delete(release): Promise<void> {
      return write('delete', release.tag_name, () => request(`${releasesPath}/${release.id}`, { method: 'DELETE' }))
    },
  }
}
