import { describe, expect, it } from 'vitest'
import { getNpmTrustArgs, isNpmTrustSupported } from './npmTrust.ts'

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
