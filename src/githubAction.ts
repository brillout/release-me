export { getCiWorkflow }
export { getGitHubRepo }
export { getWorkflowLink }
export { parseGitHubRepo }
export { releaseWorkflow }
export { releaseWorkflowPath }
export { writeReleaseWorkflow }
export type { CiWorkflow }

// The GitHub Action that publishes to npm, see https://github.com/brillout/release-me#github-action
// - The repository's .github/workflows/release.yml is a copy of release-me's own .github/workflows/release.yml (shipped
//   in the npm package), with the release-me version that runs the jobs set to the installed one.
// - `$ pnpm exec release-me init` creates it, and stable releases update it (e.g. after upgrading release-me).

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import execa from 'execa'
import pc from '@brillout/picocolors'

const initCommand = '$ pnpm exec release-me init'
const releaseWorkflow = {
  fileName: 'release.yml',
  // `$ npm dist-tag rm` removes the dist-tag that `$ npm publish` requires for commit releases
  npmAllowedActions: ['npm publish', 'npm dist-tag'],
}
const releaseWorkflowPath = `.github/workflows/${releaseWorkflow.fileName}`

const thisPackageRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Read when this module is loaded, because releasing release-me itself bumps the version of this package.json
const thisVersion: string = JSON.parse(fs.readFileSync(path.join(thisPackageRootDir, 'package.json'), 'utf8')).version

// `RELEASE_ME: '@brillout/release-me@1.2.3'`
const versionLine = /^(\s*RELEASE_ME: '@brillout\/release-me@)[^']+(')$/m

type CiWorkflow = {
  /** GitHub repository, e.g. `vikejs/vike` */
  repo: string | null
}

/** Whether the repository publishes to npm via the GitHub Action (instead of locally) */
async function getCiWorkflow(monorepoRootDir: string): Promise<CiWorkflow | null> {
  if (!isReleaseMeWorkflow(readReleaseWorkflow(monorepoRootDir))) return null
  return { repo: await getGitHubRepo(monorepoRootDir) }
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

/** release-me's own release.yml, with the installed release-me version */
function getReleaseWorkflowExpected(): string {
  const content = readFile(path.join(thisPackageRootDir, releaseWorkflowPath))
  assert(content && isReleaseMeWorkflow(content))
  return content.replace(versionLine, `$1${thisVersion}$2`)
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
  return releaseWorkflowContent !== null && versionLine.test(releaseWorkflowContent)
}

async function getGitHubRepo(cwd: string): Promise<string | null> {
  let remoteUrl: string
  try {
    remoteUrl = (await execa('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim()
  } catch {
    return null
  }
  return parseGitHubRepo(remoteUrl)
}
function parseGitHubRepo(url: string): string | null {
  // git@github.com:vikejs/vike.git
  // https://github.com/vikejs/vike
  // git+https://github.com/vikejs/vike.git
  // ssh://git@github.com/vikejs/vike.git
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return match?.[1] ?? null
}

function getWorkflowLink(ciWorkflow: CiWorkflow): string {
  const { repo } = ciWorkflow
  if (!repo) return pc.bold(releaseWorkflowPath)
  return pc.underline(`https://github.com/${repo}/actions/workflows/${releaseWorkflow.fileName}`)
}
