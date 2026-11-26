export { createReleasesClientFromEnv }
export { getDefaultBranch }
export { getPushedFiles }

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import execa from 'execa'
import pc from '@brillout/picocolors'
import { getChangedFiles } from './git.ts'
import { createReleasesClient, type ReleasesClient } from './github.ts'
import { getGitHubRepo } from '../../githubAction.ts'
import { assertUsage, logDetail } from '../../../utils.ts'

// How a run discovers what to act on, as whom, and against which branch: the repository, the auth
// token, the default branch, and — on a push — which files changed. All read from the GitHub Actions
// environment, with fallbacks for local runs. Kept apart from the API client (github.ts), which
// shouldn't care where these values come from.

// A GitHub Releases client for the repository this run targets, wired up from the environment. Returns
// the resolved owner/repo too — callers need them for the web links and log lines the client doesn't
// expose. dryRun is passed straight through to the client, which gates and logs the writes.
async function createReleasesClientFromEnv(
  dryRun: boolean,
): Promise<{ client: ReleasesClient; owner: string; repo: string }> {
  const { owner, repo } = await getRepository()
  const token = await getGitHubToken()
  const client = createReleasesClient({ owner, repo, token, apiUrl: getApiUrl(), dryRun })
  return { client, owner, repo }
}

// GitHub Actions: the token of the run (see sync-github-releases.yml). Locally: GITHUB_TOKEN, or else the token of the GitHub CLI.
async function getGitHubToken(): Promise<string> {
  const token = process.env.GITHUB_TOKEN
  if (token) return token
  try {
    const { stdout } = await execa('gh', ['auth', 'token'])
    if (stdout.trim()) return stdout.trim()
  } catch {}
  assertUsage(
    false,
    `Set the environment variable ${pc.bold('GITHUB_TOKEN')}, or log in the GitHub CLI ${pc.cyan('gh')} ${logDetail(
      '$ gh auth login',
    )}.`,
  )
}

// The GitHub REST API base URL. GITHUB_API_URL is provided on GitHub Actions (and points at the right
// host on GitHub Enterprise); fall back to the public API for local runs.
function getApiUrl(): string {
  return process.env.GITHUB_API_URL ?? 'https://api.github.com'
}

function getDefaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH ?? 'main'
}

async function getRepository(): Promise<{ owner: string; repo: string }> {
  const repository = process.env.GITHUB_REPOSITORY ?? (await getGitHubRepo())
  assertUsage(
    repository,
    `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}.`,
  )
  const [owner, repo] = repository.split('/')
  assert(owner && repo, `Cannot parse owner/repo from repository: ${repository}`)
  return { owner, repo }
}

// The files the triggering push changed, or null when this isn't a push (manual workflow_dispatch, or
// a local run) — the caller then falls back to syncing every package.
function getPushedFiles(): string[] | null {
  if (process.env.GITHUB_EVENT_NAME !== 'push') return null
  const beforeSha = getCommitBeforePush()
  const headSha = process.env.GITHUB_SHA
  if (!beforeSha || !headSha) return null
  return getChangedFiles(beforeSha, headSha)
}

// The commit the branch pointed at before the push (`github.event.before`). GitHub Actions writes the
// triggering event's payload to the file at GITHUB_EVENT_PATH.
function getCommitBeforePush(): string | null {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return null
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { before?: string }
  const beforeSha = event.before
  // GitHub uses an all-zero SHA when there's no prior commit (e.g. a branch's first push).
  if (!beforeSha || /^0+$/.test(beforeSha)) return null
  return beforeSha
}
