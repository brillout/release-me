export { ciResolve }

// `$ release-me ci-internal-cmd-resolve`: job `resolve` of the GitHub Action, decides what to release from what triggered the workflow.

import { parseReleaseTag } from './versions.ts'
import { fail, getEnv, getInput, setOutputs } from './utils.ts'
import { isReleaseWorkflowUpToDate, releaseWorkflowOutdated } from './releaseWorkflow.ts'

type Release = {
  /** The Git ref that the job `pack` checks out */
  ref: string
  /** Stable release: its Git tag (`v1.2.3` or `some-package@1.2.3`). Commit release: empty. */
  tag: string
}

function ciResolve() {
  // E.g. after upgrading release-me without re-running `$ pnpm exec release-me init`
  if (!isReleaseWorkflowUpToDate(getEnv('GITHUB_WORKSPACE'))) fail(releaseWorkflowOutdated)
  const { ref, tag } = getRelease()
  console.log(tag ? `Stable release: ${tag}` : `Commit release: ${ref}`)
  setOutputs({ output_ref: ref, output_tag: tag })
}

function getRelease(): Release {
  const refName = getEnv('GITHUB_REF_NAME')
  const isTag = getEnv('GITHUB_REF_TYPE') === 'tag'
  if (getEnv('GITHUB_EVENT_NAME') === 'push') {
    if (!isTag) fail(`Stable releases are triggered by pushing a release tag, but the branch ${refName} was pushed.`)
    return stable(refName)
  }

  // "Run workflow" button: commit release of the input, otherwise of the selected branch (or stable release of the selected tag)
  const input = getInput('ref')
  if (!input) return isTag ? stable(refName) : commit(getEnv('GITHUB_SHA'))
  if (/\s/.test(input)) fail(`Invalid commit: ${JSON.stringify(input)}`)
  return commit(input)
}

function stable(tag: string): Release {
  if (!parseReleaseTag(tag)) fail(`${tag} isn't a release tag (v1.2.3 or some-package@1.2.3).`)
  return { ref: `refs/tags/${tag}`, tag }
}

function commit(ref: string): Release {
  return { ref, tag: '' }
}
