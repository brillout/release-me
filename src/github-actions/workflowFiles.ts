export { getWorkflowFilesToInit }
export { isWorkflowFileUpToDate }
export { publishesViaGitHubAction }
export { releaseGitHubWorkflowFile }
export { releaseNpmWorkflowFile }
export { writeWorkflowFiles }
export type { WorkflowFile }
export type { WorkflowFileOptions }
export type { WriteResult }

// The GitHub Actions of release-me, see https://github.com/brillout/release-me#npm-release and https://github.com/brillout/release-me#github-release
// - .github/workflows/release-npm.yml publishes to npm.
//   (release-me 0.5.0 named it release.yml: `$ pnpm exec release-me init` renames it.)
// - .github/workflows/release-github.yml keeps GitHub Releases in sync with CHANGELOG.md.
// They're copies of release-me's own workflow files (shipped in the npm package): `$ pnpm exec release-me init` creates and updates them.
// A repository sets up both or only one of them (`$ pnpm exec release-me init --npm` or `--github`).
// Releases fail if the ones it sets up aren't copies of the installed release-me's (e.g. after upgrading release-me).

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import assert from 'assert'
import pc from '@brillout/picocolors'

import { initCommand } from './commands.ts'

type WorkflowFile = {
  fileName: string
  filePath: string
  /** The option of `$ pnpm exec release-me init` that sets it up */
  option: 'npm' | 'github'
  /** The command the workflow runs, which tells release-me's workflow file apart from a file of the same name that has nothing to do with release-me */
  command: string
  /** Why the workflow file is outdated, and how to fix it */
  outdated: string
  /** The workflow file under its name of an older release-me (`$ pnpm exec release-me init` renames it) */
  old: WorkflowFileOld | null
}
type WorkflowFileOld = { fileName: string; filePath: string }
function getWorkflowFile(
  fileName: string,
  option: WorkflowFile['option'],
  command: string,
  fileNameOld?: string,
): WorkflowFile {
  const filePath = getWorkflowFilePath(fileName)
  // `$ pnpm install` first: if node_modules/ has an older release-me than the lockfile (e.g. after `$ git pull`), `$ pnpm exec release-me init` would downgrade the workflow file
  const outdated = `${filePath} doesn't match the installed release-me's (e.g. after upgrading release-me, or if it was modified): run ${pc.bold(
    '$ pnpm install',
  )} and ${pc.bold(initCommand)}, then push the commit it makes (if any).`
  const old = fileNameOld ? { fileName: fileNameOld, filePath: getWorkflowFilePath(fileNameOld) } : null
  return { fileName, filePath, option, command, outdated, old }
}
function getWorkflowFilePath(fileName: string) {
  return `.github/workflows/${fileName}`
}
const releaseNpmWorkflowFile = getWorkflowFile(
  'release-npm.yml',
  'npm',
  'pnpm exec release-me ci-publish',
  'release.yml',
)
const releaseGitHubWorkflowFile = getWorkflowFile(
  'release-github.yml',
  'github',
  'pnpm exec release-me github-release-sync',
)
const workflowFiles = [releaseNpmWorkflowFile, releaseGitHubWorkflowFile]

const thisPackageRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Whether the repository publishes to npm via the GitHub Action (instead of locally). Throws if a workflow file it sets up is outdated. */
function publishesViaGitHubAction(monorepoRootDir: string): boolean {
  const workflowFilesSetUp = getWorkflowFilesSetUp(monorepoRootDir)
  for (const workflowFile of workflowFilesSetUp) {
    if (!isWorkflowFileUpToDate(monorepoRootDir, workflowFile)) {
      throw new Error(pc.red(pc.bold(`Release aborted, because ${workflowFile.outdated}`)))
    }
  }
  return workflowFilesSetUp.includes(releaseNpmWorkflowFile)
}

/** The workflow files of release-me that the repository has (also under their old name) */
function getWorkflowFilesSetUp(monorepoRootDir: string): WorkflowFile[] {
  return workflowFiles.filter(
    (workflowFile) =>
      isReleaseMeWorkflowFile(readWorkflowFile(monorepoRootDir, workflowFile), workflowFile) ||
      getWorkflowFileOld(monorepoRootDir, workflowFile),
  )
}

type WorkflowFileOptions = Partial<Record<WorkflowFile['option'], boolean>>
/**
 * The workflow files that `$ pnpm exec release-me init` creates or updates:
 * - the ones of the options (`--npm`, `--github`), or else
 * - the ones that the repository already has (so that re-running `init`, e.g. after upgrading release-me, doesn't add one), or else
 * - all of them.
 */
function getWorkflowFilesToInit(monorepoRootDir: string, options: WorkflowFileOptions): WorkflowFile[] {
  const selected = workflowFiles.filter((workflowFile) => options[workflowFile.option])
  if (selected.length > 0) return selected
  const workflowFilesSetUp = getWorkflowFilesSetUp(monorepoRootDir)
  if (workflowFilesSetUp.length > 0) return workflowFilesSetUp
  return workflowFiles
}

function isWorkflowFileUpToDate(monorepoRootDir: string, workflowFile: WorkflowFile): boolean {
  return (
    readWorkflowFile(monorepoRootDir, workflowFile) === getWorkflowFileExpected(workflowFile) &&
    // Still under its old name (as well): both workflows would run
    !getWorkflowFileOld(monorepoRootDir, workflowFile)
  )
}

/** The workflow file under its old name, if the repository has it */
function getWorkflowFileOld(monorepoRootDir: string, workflowFile: WorkflowFile): WorkflowFileOld | null {
  const { old } = workflowFile
  if (!old || !isReleaseMeWorkflowFile(readFile(path.join(monorepoRootDir, old.filePath)), workflowFile)) return null
  return old
}

type WriteResult = { workflowFile: WorkflowFile } & (
  | { status: 'created' | 'updated' | 'up-to-date' }
  | { status: 'renamed'; old: WorkflowFileOld }
)
/** Create, update, or rename the workflow files `workflowFilesToWrite` */
function writeWorkflowFiles(monorepoRootDir: string, workflowFilesToWrite: WorkflowFile[]): WriteResult[] {
  // Check all files before writing any
  const writes = workflowFilesToWrite.map((workflowFile) => {
    const content = readWorkflowFile(monorepoRootDir, workflowFile)
    const filePath = path.join(monorepoRootDir, workflowFile.filePath)
    if (content !== null && !isReleaseMeWorkflowFile(content, workflowFile)) {
      // Don't overwrite a file that has nothing to do with release-me
      throw new Error(
        pc.red(
          pc.bold(
            `${filePath} already exists and it isn't release-me's: rename or remove it, then re-run ${pc.bold(
              initCommand,
            )}.`,
          ),
        ),
      )
    }
    return { workflowFile, filePath, content }
  })
  return writes.map(({ workflowFile, filePath, content }) => {
    const contentExpected = getWorkflowFileExpected(workflowFile)
    const old = getWorkflowFileOld(monorepoRootDir, workflowFile)
    if (content !== contentExpected) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, contentExpected)
    }
    if (old) {
      fs.rmSync(path.join(monorepoRootDir, old.filePath))
      return { workflowFile, status: 'renamed', old }
    }
    const status = content === contentExpected ? 'up-to-date' : content === null ? 'created' : 'updated'
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
