export { assertReleaseWorkflowUpToDate }
export { isReleaseMeWorkflow }
export { isReleaseWorkflowUpToDate }
export { readReleaseWorkflow }
export { releaseWorkflow }
export { releaseWorkflowPath }
export { writeReleaseWorkflow }

// .github/workflows/release.yml, the GitHub Action that publishes to npm, see https://github.com/brillout/release-me#github-action
// - It's a copy of release-me's own .github/workflows/release.yml (shipped in the npm package): `$ pnpm exec release-me init` creates and updates it.
// - Releases fail if it isn't a copy of the installed release-me's (e.g. after upgrading release-me).

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import pc from '@brillout/picocolors'

const initCommand = '$ pnpm exec release-me init'
const releaseWorkflow = {
  fileName: 'release.yml',
  // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases
  npmAllowedActions: ['npm publish', 'npm dist-tag'],
}
const releaseWorkflowPath = `.github/workflows/${releaseWorkflow.fileName}`

const thisPackageRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

function assertReleaseWorkflowUpToDate(monorepoRootDir: string) {
  if (isReleaseWorkflowUpToDate(monorepoRootDir)) return
  throw new Error(
    [
      pc.red(pc.bold(`Release aborted, because ${releaseWorkflowPath} isn't up-to-date (or was modified).`)),
      `Run ${pc.bold(initCommand)} and push the commit it makes.`,
    ].join(' '),
  )
}

function isReleaseWorkflowUpToDate(monorepoRootDir: string): boolean {
  return readReleaseWorkflow(monorepoRootDir) === getReleaseWorkflowExpected()
}

/** Create or update .github/workflows/release.yml */
function writeReleaseWorkflow(monorepoRootDir: string): 'created' | 'updated' | 'up-to-date' {
  const content = readReleaseWorkflow(monorepoRootDir)
  const contentExpected = getReleaseWorkflowExpected()
  if (content === contentExpected) return 'up-to-date'
  const filePath = path.join(monorepoRootDir, releaseWorkflowPath)
  if (content !== null && !isReleaseMeWorkflow(content)) {
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
function getReleaseWorkflowExpected(): string {
  const content = readFile(path.join(thisPackageRootDir, releaseWorkflowPath))
  assert(content && isReleaseMeWorkflow(content))
  return content
}

function readReleaseWorkflow(monorepoRootDir: string): string | null {
  return readFile(path.join(monorepoRootDir, releaseWorkflowPath))
}
function readFile(filePath: string): string | null {
  try {
    // Git may check out the file with CRLF line endings (Windows)
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

function isReleaseMeWorkflow(releaseWorkflowContent: string | null): releaseWorkflowContent is string {
  return (
    releaseWorkflowContent !== null && releaseWorkflowContent.includes('pnpm exec release-me ci-internal-cmd-publish')
  )
}
