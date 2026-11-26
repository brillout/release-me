export { isReleaseWorkflowFileUpToDate }
export { isWorkflowFileUpToDate }
export { publishesViaGitHubAction }
export { releaseWorkflowFileName }
export { releaseWorkflowFileOutdated }
export { releaseWorkflowFilePath }
export { syncWorkflowFile }
export { writeWorkflowFiles }
export type { WorkflowFile }

// The GitHub Actions of release-me, see https://github.com/brillout/release-me#github-action
// - .github/workflows/release.yml publishes to npm.
// - .github/workflows/sync-github-releases.yml keeps GitHub Releases in sync with CHANGELOG.md.
// They're copies of release-me's own workflow files (shipped in the npm package): `$ pnpm exec release-me init` creates and updates them.
// Releases fail if they aren't copies of the installed release-me's (e.g. after upgrading release-me).

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import pc from '@brillout/picocolors'

const initCommand = '$ pnpm exec release-me init'

type WorkflowFile = {
  fileName: string
  filePath: string
  /** The command the workflow runs, which tells release-me's workflow file apart from a file of the same name that has nothing to do with release-me */
  command: string
  /** Why the workflow file is outdated, and how to fix it */
  outdated: string
}
function getWorkflowFile(fileName: string, command: string): WorkflowFile {
  const filePath = `.github/workflows/${fileName}`
  // `$ pnpm install` first: if node_modules/ has an older release-me than the lockfile (e.g. after `$ git pull`), `$ pnpm exec release-me init` would downgrade the workflow file
  const outdated = `${filePath} doesn't match the installed release-me's (e.g. after upgrading release-me, or if it was modified): run $ pnpm install and ${initCommand}, then push the commit it makes (if any).`
  return { fileName, filePath, command, outdated }
}
const releaseWorkflowFile = getWorkflowFile('release.yml', 'pnpm exec release-me ci-publish')
const syncWorkflowFile = getWorkflowFile('sync-github-releases.yml', 'pnpm exec release-me sync-github-releases')
const workflowFiles = [releaseWorkflowFile, syncWorkflowFile]

const releaseWorkflowFileName = releaseWorkflowFile.fileName
const releaseWorkflowFilePath = releaseWorkflowFile.filePath
const releaseWorkflowFileOutdated = releaseWorkflowFile.outdated

const thisPackageRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Whether the repository publishes to npm via the GitHub Action (instead of locally). Throws if a workflow file is outdated. */
function publishesViaGitHubAction(monorepoRootDir: string): boolean {
  if (!isReleaseMeWorkflowFile(readWorkflowFile(monorepoRootDir, releaseWorkflowFile), releaseWorkflowFile))
    return false
  for (const workflowFile of workflowFiles) {
    if (!isWorkflowFileUpToDate(monorepoRootDir, workflowFile)) {
      throw new Error(pc.red(pc.bold(`Release aborted, because ${workflowFile.outdated}`)))
    }
  }
  return true
}

function isReleaseWorkflowFileUpToDate(monorepoRootDir: string): boolean {
  return isWorkflowFileUpToDate(monorepoRootDir, releaseWorkflowFile)
}
function isWorkflowFileUpToDate(monorepoRootDir: string, workflowFile: WorkflowFile): boolean {
  return readWorkflowFile(monorepoRootDir, workflowFile) === getWorkflowFileExpected(workflowFile)
}

/** Create or update the workflow files */
function writeWorkflowFiles(monorepoRootDir: string) {
  // Check all files before writing any
  const writes = workflowFiles.map((workflowFile) => {
    const content = readWorkflowFile(monorepoRootDir, workflowFile)
    const filePath = path.join(monorepoRootDir, workflowFile.filePath)
    if (content !== null && !isReleaseMeWorkflowFile(content, workflowFile)) {
      // Don't overwrite a file that has nothing to do with release-me
      throw new Error(
        pc.red(
          pc.bold(
            `${filePath} already exists and it isn't release-me's: rename or remove it, then re-run ${initCommand}.`,
          ),
        ),
      )
    }
    return { workflowFile, filePath, content }
  })
  return writes.map(({ workflowFile, filePath, content }) => {
    const contentExpected = getWorkflowFileExpected(workflowFile)
    const status: 'created' | 'updated' | 'up-to-date' =
      content === contentExpected ? 'up-to-date' : content === null ? 'created' : 'updated'
    if (status !== 'up-to-date') {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, contentExpected)
    }
    return { workflowFile, status }
  })
}

/** The workflow file of the installed release-me */
function getWorkflowFileExpected(workflowFile: WorkflowFile): string {
  const content = readFile(path.join(thisPackageRootDir, workflowFile.filePath))
  assert(content && isReleaseMeWorkflowFile(content, workflowFile))
  return content
}

function readWorkflowFile(monorepoRootDir: string, workflowFile: WorkflowFile): string | null {
  return readFile(path.join(monorepoRootDir, workflowFile.filePath))
}
function readFile(filePath: string): string | null {
  try {
    // Git may check out the file with CRLF line endings (Windows)
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

function isReleaseMeWorkflowFile(content: string | null, workflowFile: WorkflowFile): content is string {
  return content !== null && content.includes(workflowFile.command)
}
