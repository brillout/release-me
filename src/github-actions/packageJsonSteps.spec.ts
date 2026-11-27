import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getRepositoryValue, setPackageJsonFields } from './packageJsonSteps.ts'

describe('getRepositoryValue()', () => {
  it('single package', () => {
    expect(getRepositoryValue(undefined, 'vikejs/vike', '.')).toBe('https://github.com/vikejs/vike')
    expect(getRepositoryValue('github:brillout/vike', 'vikejs/vike', '.')).toBe('https://github.com/vikejs/vike')
  })
  it('monorepo package: with its directory', () => {
    expect(getRepositoryValue(undefined, 'vikejs/vike', 'packages/vike')).toEqual({
      type: 'git',
      url: 'https://github.com/vikejs/vike',
      directory: 'packages/vike',
    })
  })
  it('keeps the other fields of an object', () => {
    expect(
      getRepositoryValue(
        { type: 'git', url: 'https://github.com/brillout/vike', directory: 'vike' },
        'vikejs/vike',
        '.',
      ),
    ).toEqual({ type: 'git', url: 'https://github.com/vikejs/vike', directory: 'vike' })
  })
})

describe('setPackageJsonFields()', () => {
  it('keeps the indentation and the order of the fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-me-'))
    const packageJsonPath = path.join(dir, 'package.json')
    try {
      fs.writeFileSync(packageJsonPath, '{\n    "name": "a",\n    "repository": "x",\n    "version": "1.0.0"\n}\n')
      setPackageJsonFields(packageJsonPath, { repository: 'https://github.com/o/r', packageManager: 'pnpm@10.0.0' })
      expect(fs.readFileSync(packageJsonPath, 'utf8')).toBe(
        [
          '{',
          '    "name": "a",',
          '    "repository": "https://github.com/o/r",',
          '    "version": "1.0.0",',
          '    "packageManager": "pnpm@10.0.0"',
          '}',
          '',
        ].join('\n'),
      )
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
