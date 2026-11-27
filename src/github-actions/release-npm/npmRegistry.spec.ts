import { describe, expect, it } from 'vitest'
import { getProvenanceWorkflow } from './npmRegistry.ts'

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
