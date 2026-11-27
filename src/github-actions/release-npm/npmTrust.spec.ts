import { describe, expect, it } from 'vitest'
import {
  getNpmTrustArgs,
  getOtpRequest,
  getProvenanceWorkflow,
  isExpectedTrustedPublisher,
  isNpmTrustSupported,
  isPublishedByTrustedPublisher,
  parseNpmTrustList,
} from './npmTrust.ts'

describe('parseNpmTrustList()', () => {
  it('parses the JSON objects printed by `$ npm trust list --json`', () => {
    const stdout = [
      '{',
      '  "type": "github",',
      '  "id": "a1",',
      '  "file": "release-npm.yml",',
      '  "repository": "vikejs/vike",',
      '  "permissions": [',
      '    "createPackage"',
      '  ]',
      '}',
      '{',
      '  "type": "gitlab",',
      '  "id": "b2",',
      '  "file": "a } \\" {.yml"',
      '}',
      '',
    ].join('\n')
    expect(parseNpmTrustList(stdout)).toEqual([
      { type: 'github', id: 'a1', file: 'release-npm.yml', repository: 'vikejs/vike', permissions: ['createPackage'] },
      { type: 'gitlab', id: 'b2', file: 'a } " {.yml' },
    ])
  })
  it('no trusted publisher: npm prints nothing (with --json)', () => {
    expect(parseNpmTrustList('')).toEqual([])
    expect(parseNpmTrustList('\n')).toEqual([])
  })
  it('unexpected output', () => {
    expect(parseNpmTrustList('No trust configurations found')).toBe(null)
    expect(parseNpmTrustList('{ "id": "a1"')).toBe(null)
  })
})

describe('isExpectedTrustedPublisher()', () => {
  const expected = { id: 'a1', type: 'github', file: 'release-npm.yml', repository: 'vikejs/vike' }
  it('the trusted publisher of release-npm.yml', () => {
    expect(isExpectedTrustedPublisher(expected, 'vikejs/vike')).toBe(true)
    expect(isExpectedTrustedPublisher({ ...expected, repository: 'VikeJS/Vike' }, 'vikejs/vike')).toBe(true)
    expect(isExpectedTrustedPublisher({ ...expected, permissions: ['createPackage'] }, 'vikejs/vike')).toBe(true)
  })
  it('another trusted publisher', () => {
    for (const other of [
      { ...expected, file: 'release.yml' },
      { ...expected, repository: 'brillout/vike' },
      { ...expected, environment: 'production' },
      { ...expected, permissions: ['createStagedPackage'] },
      { id: 'c3', type: 'gitlab' },
    ]) {
      expect(isExpectedTrustedPublisher(other, 'vikejs/vike')).toBe(false)
    }
  })
})

describe('getOtpRequest()', () => {
  it('2FA in the browser', () => {
    const output = JSON.stringify({
      error: {
        code: 'EOTP',
        summary: 'This operation requires a one-time password.',
        authUrl: 'https://www.npmjs.com/auth/cli/1',
        doneUrl: 'https://registry.npmjs.org/-/v1/done?authId=1',
      },
    })
    expect(getOtpRequest(output)).toBe('web')
  })
  it('2FA with an authenticator app', () => {
    expect(getOtpRequest('npm error code EOTP\nnpm error This operation requires a one-time password.')).toBe('classic')
  })
  it('another error', () => {
    expect(getOtpRequest('npm error code E404\nnpm error 404 Not Found')).toBe(null)
  })
})

describe('isPublishedByTrustedPublisher()', () => {
  it("reads the registry's _npmUser", () => {
    const trustedPublisher = { id: 'github', oidcConfigId: '2e5fddec-9765-4b06-9ab5-7d61980d554a' }
    expect(
      isPublishedByTrustedPublisher({
        version: '0.5.8',
        _npmUser: { name: 'GitHub Actions', email: 'npm-oidc-no-reply@github.com', trustedPublisher },
      }),
    ).toBe(true)
    expect(isPublishedByTrustedPublisher({ version: '0.5.1', _npmUser: { name: 'brillout' } })).toBe(false)
    expect(isPublishedByTrustedPublisher({ version: '0.0.1' })).toBe(false)
  })
})

describe('getProvenanceWorkflow()', () => {
  const getAttestations = (statement: unknown) => ({
    attestations: [
      { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1' },
      {
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } },
      },
    ],
  })
  it('reads the workflow of the SLSA provenance', () => {
    const workflow = {
      ref: 'refs/tags/v0.5.8',
      repository: 'https://github.com/brillout/release-me',
      path: '.github/workflows/release-npm.yml',
    }
    expect(
      getProvenanceWorkflow(getAttestations({ predicate: { buildDefinition: { externalParameters: { workflow } } } })),
    ).toEqual({ repository: 'https://github.com/brillout/release-me', path: '.github/workflows/release-npm.yml' })
  })
  it('no provenance', () => {
    expect(getProvenanceWorkflow(getAttestations({ predicate: {} }))).toBe(null)
    expect(getProvenanceWorkflow({ attestations: [] })).toBe(null)
    expect(getProvenanceWorkflow(null)).toBe(null)
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
