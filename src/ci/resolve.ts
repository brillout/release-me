export { resolve }

// Job `resolve` of the GitHub Action: decides what to release, from what triggered the workflow.

import { parseReleaseTag } from './versions.js'
import { fail, getEnv, getInput, notice, setOutputs } from './utils.js'
import { isReleaseWorkflowUpToDate, releaseWorkflowPath } from '../githubAction.js'

type Release = {
  /** The Git ref that the job `pack` checks out */
  ref: string
  /** Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release: empty. */
  tag: string
  provenance: boolean
}

async function resolve() {
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isReleaseWorkflowUpToDate(getEnv('GITHUB_WORKSPACE'))) {
    fail(
      `${releaseWorkflowPath} isn't up-to-date (or was modified): run \`$ pnpm exec release-me init\` and push the commit it makes.`,
    )
  }
  const { ref, tag, provenance } = await getRelease()
  console.log(tag ? `Stable release: ${tag}` : `Commit release: ${ref}`)
  setOutputs({ ref, tag, provenance: String(provenance) })
}

async function getRelease(): Promise<Release> {
  const sha = getEnv('GITHUB_SHA')
  const refName = getEnv('GITHUB_REF_NAME')
  const isTag = getEnv('GITHUB_REF_TYPE') === 'tag'
  if (getEnv('GITHUB_EVENT_NAME') === 'push') {
    if (!isTag) fail(`Stable releases are triggered by pushing a release tag, but the branch ${refName} was pushed.`)
    return stable(refName, sha)
  }

  // "Run workflow" button: a release tag that exists => stable release, otherwise => commit release
  const input = getInput('ref')
  if (!input) return isTag ? stable(refName, sha) : commit(sha)
  if (/\s/.test(input)) fail(`Invalid commit or tag: ${JSON.stringify(input)}`)
  const tagCommit = parseReleaseTag(input) && (await getTagCommit(input))
  return tagCommit ? stable(input, tagCommit) : commit(input)
}

function stable(tag: string, tagCommit: string): Release {
  if (!parseReleaseTag(tag)) fail(`${tag} isn't a release tag (v1.2.3 or some-package@1.2.3).`)
  // Provenance attests that the package was built from GITHUB_SHA (the commit the workflow run belongs to)
  const provenance = tagCommit === getEnv('GITHUB_SHA')
  if (!provenance) {
    notice(
      `${tag} is published without npm provenance, because the workflow runs on another commit. (To get provenance, leave the input empty and select the tag ${tag} in "Use workflow from".)`,
    )
  }
  return { ref: `refs/tags/${tag}`, tag, provenance }
}

function commit(ref: string): Release {
  return { ref, tag: '', provenance: false }
}

/** The commit of the Git tag, or `null` if the tag doesn't exist */
async function getTagCommit(tag: string): Promise<string | null> {
  const ref = await getGitObject(`git/ref/tags/${tag}`)
  if (!ref) return null
  // Annotated tag => the commit it points to
  if (ref.object.type === 'tag') return (await getGitObject(`git/tags/${ref.object.sha}`))!.object.sha
  return ref.object.sha
}

async function getGitObject(apiPath: string): Promise<{ object: { type: string; sha: string } } | null> {
  const url = `${getEnv('GITHUB_API_URL')}/repos/${getEnv('GITHUB_REPOSITORY')}/${apiPath}`
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${getEnv('GITHUB_TOKEN')}` },
  })
  if (response.status === 404) return null
  if (!response.ok) fail(`GET ${url} failed: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}
