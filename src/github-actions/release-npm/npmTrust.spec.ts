import { describe, expect, it } from 'vitest'
import {
  getNpmTrustArgs,
  getProvenanceWorkflow,
  isNpmTrustSupported,
  isPublishedByTrustedPublisher,
} from './npmTrust.ts'

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
