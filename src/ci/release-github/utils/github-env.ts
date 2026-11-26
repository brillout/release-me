export { createReleasesClientFromEnv }
export { getDefaultBranch }
export { getPushedFiles }

import { readFileSync } from 'node:fs'
import execa from 'execa'
import pc from '@brillout/picocolors'
import { getChangedFiles } from './git.ts'
import { createReleasesClient, type ReleasesClient } from './github.ts'
import { getGitHubRepo } from '../../utils/githubRepo.ts'
import { assertUsage, logDetail } from '../../../utils.ts'

// The inputs of a run (the repository, the token, the default branch, the pushed files), read from the GitHub Actions
// environment, with fallbacks for local runs.

// The client of the repository's GitHub Releases, and the repository (for the web links and the log lines)
async function createReleasesClientFromEnv(dryRun: boolean): Promise<{ client: ReleasesClient; repo: string }> {
  const repo = await getRepo()
  const token = await getGitHubToken()
  const client = createReleasesClient({ repo, token, apiUrl: getApiUrl(), dryRun })
  return { client, repo }
}

// GitHub Actions: the token of the run (see release-github.yml). Locally: GITHUB_TOKEN, or else the token of the GitHub CLI.
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

// GITHUB_API_URL is set by GitHub Actions (it differs on GitHub Enterprise)
function getApiUrl(): string {
  return process.env.GITHUB_API_URL ?? 'https://api.github.com'
}

function getDefaultBranch(): string {
  return process.env.GITHUB_DEFAULT_BRANCH ?? 'main'
}

/** The repository, e.g. `vikejs/vike` */
async function getRepo(): Promise<string> {
  const repo = process.env.GITHUB_REPOSITORY ?? (await getGitHubRepo())
  assertUsage(
    repo,
    `Couldn't determine the GitHub repository of ${pc.cyan('origin')} ${logDetail('$ git remote get-url origin')}.`,
  )
  return repo
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
