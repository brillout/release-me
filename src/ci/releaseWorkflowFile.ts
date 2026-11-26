export { isReleaseWorkflowFileUpToDate }
export { publishesViaGitHubAction }
export { releaseWorkflowFileName }
export { releaseWorkflowFileOutdated }
export { releaseWorkflowFilePath }
export { writeReleaseWorkflowFile }

// .github/workflows/release.yml, the GitHub Action that publishes to npm, see https://github.com/brillout/release-me#github-action
// - It's a copy of release-me's own .github/workflows/release.yml (shipped in the npm package): `$ pnpm exec release-me init` creates and updates it.
// - Releases fail if it isn't a copy of the installed release-me's (e.g. after upgrading release-me).

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import pc from '@brillout/picocolors'

const initCommand = '$ pnpm exec release-me init'
const releaseWorkflowFileName = 'release.yml'
const releaseWorkflowFilePath = `.github/workflows/${releaseWorkflowFileName}`
// `$ pnpm install` first: if node_modules/ has an older release-me than the lockfile (e.g. after `$ git pull`), `$ pnpm exec release-me init` would downgrade release.yml
const releaseWorkflowFileOutdated = `${releaseWorkflowFilePath} doesn't match the installed release-me's (e.g. after upgrading release-me, or if it was modified): run $ pnpm install and ${initCommand}, then push the commit it makes (if any).`

const thisPackageRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Whether the repository publishes to npm via the GitHub Action (instead of locally). Throws if release.yml is outdated. */
function publishesViaGitHubAction(monorepoRootDir: string): boolean {
  if (!isReleaseMeWorkflowFile(readReleaseWorkflowFile(monorepoRootDir))) return false
  if (!isReleaseWorkflowFileUpToDate(monorepoRootDir)) {
    throw new Error(pc.red(pc.bold(`Release aborted, because ${releaseWorkflowFileOutdated}`)))
  }
  return true
}

function isReleaseWorkflowFileUpToDate(monorepoRootDir: string): boolean {
  return readReleaseWorkflowFile(monorepoRootDir) === getReleaseWorkflowFileExpected()
}

/** Create or update .github/workflows/release.yml */
function writeReleaseWorkflowFile(monorepoRootDir: string): 'created' | 'updated' | 'up-to-date' {
  const content = readReleaseWorkflowFile(monorepoRootDir)
  const contentExpected = getReleaseWorkflowFileExpected()
  if (content === contentExpected) return 'up-to-date'
  const filePath = path.join(monorepoRootDir, releaseWorkflowFilePath)
  if (content !== null && !isReleaseMeWorkflowFile(content)) {
    // Don't overwrite a release.yml that has nothing to do with release-me
    throw new Error(
      pc.red(
        pc.bold(
          `${filePath} already exists and it isn't release-me's: rename or remove it, then re-run ${initCommand}.`,
        ),
      ),
    )
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, contentExpected)
  return content === null ? 'created' : 'updated'
}

/** The release.yml of the installed release-me */
function getReleaseWorkflowFileExpected(): string {
  const content = readFile(path.join(thisPackageRootDir, releaseWorkflowFilePath))
  assert(content && isReleaseMeWorkflowFile(content))
  return content
}

function readReleaseWorkflowFile(monorepoRootDir: string): string | null {
  return readFile(path.join(monorepoRootDir, releaseWorkflowFilePath))
}
function readFile(filePath: string): string | null {
  try {
    // Git may check out the file with CRLF line endings (Windows)
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

function isReleaseMeWorkflowFile(releaseWorkflowContent: string | null): releaseWorkflowContent is string {
  return releaseWorkflowContent !== null && releaseWorkflowContent.includes('pnpm exec release-me ci-publish')
}
