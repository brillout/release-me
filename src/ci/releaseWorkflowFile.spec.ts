import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getWorkflowFilesToInit,
  publishesViaGitHubAction,
  syncWorkflowFile,
  workflowFiles,
  writeWorkflowFiles,
  type WorkflowFile,
} from './releaseWorkflowFile.ts'

const [releaseWorkflowFile] = workflowFiles as [WorkflowFile, WorkflowFile]
const releaseMeRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

let repoDirs: string[] = []
afterEach(() => {
  for (const dir of repoDirs) fs.rmSync(dir, { recursive: true, force: true })
  repoDirs = []
})
/** A repository with the given workflow files: release-me's (`true`) or some other content */
function createRepo(files: { workflowFile: WorkflowFile; content: true | string }[] = []): string {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-me-spec-'))
  repoDirs.push(repoDir)
  for (const { workflowFile, content } of files) {
    const filePath = path.join(repoDir, workflowFile.filePath)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const contentReleaseMe = fs.readFileSync(path.join(releaseMeRootDir, workflowFile.filePath), 'utf8')
    fs.writeFileSync(filePath, content === true ? contentReleaseMe : content)
  }
  return repoDir
}

describe('getWorkflowFilesToInit()', () => {
  it('picks the workflow files of the options', () => {
    const repoDir = createRepo([{ workflowFile: releaseWorkflowFile, content: true }])
    expect(getWorkflowFilesToInit(repoDir, { github: true })).toEqual([syncWorkflowFile])
    expect(getWorkflowFilesToInit(repoDir, { npm: true })).toEqual([releaseWorkflowFile])
    expect(getWorkflowFilesToInit(repoDir, { npm: true, github: true })).toEqual(workflowFiles)
  })

  it('without options, picks the workflow files that the repository already has', () => {
    const repoDir = createRepo([{ workflowFile: syncWorkflowFile, content: true }])
    expect(getWorkflowFilesToInit(repoDir, {})).toEqual([syncWorkflowFile])
  })

  it("without options, picks all workflow files if the repository has none (a file that isn't release-me's doesn't count)", () => {
    expect(getWorkflowFilesToInit(createRepo(), {})).toEqual(workflowFiles)
    const repoDir = createRepo([{ workflowFile: releaseWorkflowFile, content: 'name: Some other release workflow\n' }])
    expect(getWorkflowFilesToInit(repoDir, {})).toEqual(workflowFiles)
  })
})

describe('writeWorkflowFiles()', () => {
  it('only writes the given workflow files', () => {
    const repoDir = createRepo()
    expect(writeWorkflowFiles(repoDir, [syncWorkflowFile])).toEqual([
      { workflowFile: syncWorkflowFile, status: 'created' },
    ])
    expect(fs.existsSync(path.join(repoDir, syncWorkflowFile.filePath))).toBe(true)
    expect(fs.existsSync(path.join(repoDir, releaseWorkflowFile.filePath))).toBe(false)
  })

  it("doesn't overwrite a file that isn't release-me's, nor writes any other file", () => {
    const repoDir = createRepo([{ workflowFile: syncWorkflowFile, content: 'name: Some other workflow\n' }])
    expect(() => writeWorkflowFiles(repoDir, workflowFiles)).toThrow(/isn't release-me's/)
    expect(fs.existsSync(path.join(repoDir, releaseWorkflowFile.filePath))).toBe(false)
  })
})

describe('publishesViaGitHubAction()', () => {
  it('is true if the repository has release.yml, and false otherwise', () => {
    expect(publishesViaGitHubAction(createRepo())).toBe(false)
    expect(publishesViaGitHubAction(createRepo([{ workflowFile: releaseWorkflowFile, content: true }]))).toBe(true)
    expect(publishesViaGitHubAction(createRepo([{ workflowFile: syncWorkflowFile, content: true }]))).toBe(false)
  })

  it('throws if a workflow file that the repository has is outdated, but not if one is missing', () => {
    const outdated = (workflowFile: WorkflowFile) => {
      const content = fs.readFileSync(path.join(releaseMeRootDir, workflowFile.filePath), 'utf8')
      return `# An older version\n${content}`
    }
    expect(() =>
      publishesViaGitHubAction(
        createRepo([{ workflowFile: releaseWorkflowFile, content: outdated(releaseWorkflowFile) }]),
      ),
    ).toThrow(/release\.yml doesn't match/)
    expect(() =>
      publishesViaGitHubAction(
        createRepo([
          { workflowFile: releaseWorkflowFile, content: true },
          { workflowFile: syncWorkflowFile, content: outdated(syncWorkflowFile) },
        ]),
      ),
    ).toThrow(/release-github\.yml doesn't match/)
    // Only syncs GitHub Releases (publishes locally): its workflow file is still checked
    expect(() =>
      publishesViaGitHubAction(createRepo([{ workflowFile: syncWorkflowFile, content: outdated(syncWorkflowFile) }])),
    ).toThrow(/release-github\.yml doesn't match/)
  })
})
