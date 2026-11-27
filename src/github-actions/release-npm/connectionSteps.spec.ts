import { describe, expect, it } from 'vitest'
import pc from '@brillout/picocolors'
import { createCommitReleaseStep, getConnectStep } from './connectionSteps.ts'
import type { PackageJsonStep } from '../packageJsonSteps.ts'
import type { Step } from '../steps.ts'

const repo = 'vikejs/vike'
const getNotPossibleReason = (step: Step, checked: Step[]) => {
  const reason = step.getNotPossibleReason!((s) => checked.includes(s))
  return reason && pc.rm(reason)
}
const getRequiredStep = (requiredByGitHubAction: string): PackageJsonStep => ({
  label: requiredByGitHubAction,
  packageJsonPath: '/package.json',
  run: async () => true,
  manual: null,
  requiredByGitHubAction,
})

describe('createCommitReleaseStep()', () => {
  const connectStep = getConnectStep('vike', repo, null)
  const pushStep: Step = { label: 'Push', run: async () => true, manual: null }
  const repositoryStep = getRequiredStep('"repository" of package.json to be https://github.com/vikejs/vike')
  const getStep = (isWorkflowOnGitHub: boolean, packageJsonSteps: PackageJsonStep[] = []) =>
    createCommitReleaseStep({
      repo,
      allPackageNames: ['vike'],
      connectSteps: [connectStep],
      ghUnavailableReason: null,
      isWorkflowOnGitHub,
      packageJsonSteps,
      pushStep,
    })

  it('requires a new connection', () => {
    expect(getNotPossibleReason(getStep(true), [pushStep])).toBe('no package gets a new connection')
  })
  it('requires release-npm.yml on GitHub', () => {
    expect(getNotPossibleReason(getStep(true), [connectStep])).toBe(null)
    expect(getNotPossibleReason(getStep(false), [connectStep])).toBe("release-npm.yml isn't on GitHub yet")
    expect(getNotPossibleReason(getStep(false), [connectStep, pushStep])).toBe(null)
  })
  it('requires the package.json changes, pushed', () => {
    const step = getStep(true, [repositoryStep])
    expect(getNotPossibleReason(step, [connectStep, pushStep])).toBe(
      'the GitHub Action requires "repository" of package.json to be https://github.com/vikejs/vike',
    )
    expect(getNotPossibleReason(step, [connectStep, repositoryStep])).toBe(
      "the package.json changes aren't on GitHub yet",
    )
    expect(getNotPossibleReason(step, [connectStep, repositoryStep, pushStep])).toBe(null)
  })
})
