import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findReleaseCommit } from './git.ts'

// Against a real Git repository: findReleaseCommit() relies on how Git's `-G` and `--follow` behave
describe('findReleaseCommit()', () => {
  const cwd = process.cwd()
  let repoDir: string
  // The commit of each step below, by step name
  const commits: Record<string, string> = {}

  function git(...args: string[]): string {
    const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false']
    return execFileSync('git', [...identity, ...args], { encoding: 'utf8' }).trim()
  }
  function commit(step: string, files: Record<string, string> = {}) {
    for (const [filePath, content] of Object.entries(files)) {
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }
    git('add', '--all')
    git('commit', '-q', '-m', step)
    commits[step] = git('rev-parse', 'HEAD')
  }

  beforeAll(() => {
    repoDir = mkdtempSync(path.join(tmpdir(), 'release-me-git-spec-'))
    process.chdir(repoDir)
    git('init', '-q')
    // Another package releases the same version first
    commit('b@0.1.1', {
      'packages/b/CHANGELOG.md': '## [0.2.10](https://example.com)\n\n## [0.1.1](https://example.com)\n',
    })
    // The first release has no link
    commit('a@0.1.0', { 'CHANGELOG.md': '## 0.1.0 (2026-01-01)\n' })
    commit('a@0.1.1', { 'CHANGELOG.md': '## [0.1.1](https://example.com) (2026-01-02)\n\n## 0.1.0 (2026-01-01)\n' })
    // Moved from the repository root to the package's directory
    mkdirSync('packages/a')
    git('mv', 'CHANGELOG.md', 'packages/a/CHANGELOG.md')
    commit('move')
  })
  afterAll(() => {
    process.chdir(cwd)
    rmSync(repoDir, { recursive: true, force: true })
  })

  it("finds the commit that added the version's heading, before CHANGELOG.md was moved", () => {
    expect(findReleaseCommit('0.1.1', 'packages/a/CHANGELOG.md')).toBe(commits['a@0.1.1'])
  })

  it("only searches the package's CHANGELOG.md", () => {
    expect(findReleaseCommit('0.1.1', 'packages/b/CHANGELOG.md')).toBe(commits['b@0.1.1'])
  })

  it('finds a heading without link', () => {
    expect(findReleaseCommit('0.1.0', 'packages/a/CHANGELOG.md')).toBe(commits['a@0.1.0'])
  })

  it('matches the whole version', () => {
    expect(findReleaseCommit('0.2.1', 'packages/b/CHANGELOG.md')).toBe(null)
  })
})
