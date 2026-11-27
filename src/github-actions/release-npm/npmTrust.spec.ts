import { describe, expect, it } from 'vitest'
import {
  getNpmErrorReason,
  getNpmTrustArgs,
  getTrustedPublisherStatus,
  isNpmTrustSupported,
  parseNpmTrustList,
} from './npmTrust.ts'

describe('parseNpmTrustList()', () => {
  it('parses the JSON objects printed by `$ npm trust list --json`', () => {
    const stdout = [
      '{',
      '  "id": "a1",',
      '  "type": "github",',
      '  "file": "release-npm.yml",',
      '  "repository": "vikejs/vike",',
      '  "permissions": [',
      '    "createPackage"',
      '  ]',
      '}',
      '',
      '{',
      '  "id": "b2",',
      '  "type": "gitlab",',
      '  "file": "a } \\" {.yml"',
      '}',
      '',
    ].join('\n')
    expect(parseNpmTrustList(stdout)).toEqual([
      {
        id: 'a1',
        type: 'github',
        file: 'release-npm.yml',
        repository: 'vikejs/vike',
        permissions: ['createPackage'],
      },
      { id: 'b2', type: 'gitlab', file: 'a } " {.yml' },
    ])
  })
  it('no trusted publisher: npm prints nothing', () => {
    expect(parseNpmTrustList('')).toEqual([])
    expect(parseNpmTrustList('\n')).toEqual([])
  })
  it('unexpected output', () => {
    expect(parseNpmTrustList('No trust configurations found')).toBe(null)
    expect(parseNpmTrustList('{ "id": "a1"')).toBe(null)
  })
})

describe('getTrustedPublisherStatus()', () => {
  const upToDate = { id: 'a1', type: 'github', file: 'release-npm.yml', repository: 'vikejs/vike' }
  it('up-to-date', () => {
    expect(getTrustedPublisherStatus([upToDate], 'vikejs/vike')).toEqual({ status: 'up-to-date' })
    expect(getTrustedPublisherStatus([{ ...upToDate, repository: 'VikeJS/Vike' }], 'vikejs/vike')).toEqual({
      status: 'up-to-date',
    })
    expect(getTrustedPublisherStatus([{ ...upToDate, permissions: ['createPackage'] }], 'vikejs/vike')).toEqual({
      status: 'up-to-date',
    })
  })
  it('missing', () => {
    expect(getTrustedPublisherStatus([], 'vikejs/vike')).toEqual({ status: 'missing' })
  })
  it('outdated', () => {
    for (const current of [
      { ...upToDate, file: 'release.yml' },
      { ...upToDate, repository: 'brillout/vike' },
      { ...upToDate, environment: 'production' },
      { ...upToDate, permissions: ['createStagedPackage'] },
      { id: 'c3', type: 'gitlab' },
    ]) {
      expect(getTrustedPublisherStatus([current], 'vikejs/vike')).toEqual({ status: 'outdated', current })
    }
  })
})

describe('isNpmTrustSupported()', () => {
  it('requires npm >= 11.15.0', () => {
    expect(isNpmTrustSupported('11.15.0')).toBe(true)
    expect(isNpmTrustSupported('11.20.0')).toBe(true)
    expect(isNpmTrustSupported('12.0.0')).toBe(true)
    expect(isNpmTrustSupported('11.14.9')).toBe(false)
    expect(isNpmTrustSupported('10.99.0')).toBe(false)
  })
  it('handles pre-releases and unparsable versions', () => {
    expect(isNpmTrustSupported('11.15.0-pre.1\n')).toBe(true)
    expect(isNpmTrustSupported('')).toBe(false)
  })
})

describe('getNpmTrustArgs()', () => {
  it('sets up the trusted publisher of release-npm.yml', () => {
    expect(getNpmTrustArgs('vike', 'vikejs/vike')).toEqual([
      'trust',
      'github',
      'vike',
      '--file',
      'release-npm.yml',
      '--repository',
      'vikejs/vike',
      '--allow-publish',
      '--yes',
    ])
  })
})

describe('getNpmErrorReason()', () => {
  it('extracts the code and message of npm errors', () => {
    const stderr = [
      'npm error code EOTP',
      'npm error This operation requires a one-time password from your authenticator.',
      'npm error A complete log of this run can be found in: /home/me/.npm/_logs/debug-0.log',
    ].join('\n')
    expect(getNpmErrorReason(stderr)).toBe('EOTP: This operation requires a one-time password from your authenticator.')
    expect(getNpmErrorReason('')).toBe('npm failed')
  })
})
