export { runSteps }
export { logManualSteps }
export { getManual }
export type { Step }
export type { StepOutcome }

// The steps that `$ pnpm exec release-me init` and `$ pnpm exec release-me npm-connection` run on behalf of the user:
// listed first (the user unchecks the ones they don't want, and sees why the others aren't possible), then run. The manual
// instructions of the steps that aren't run (or that fail) are logged afterwards.

import pc from '@brillout/picocolors'
import { askChecklist, type ChecklistItem } from '../utils/checklist.ts'

type Step = {
  label: string
  /** Why the step isn't possible (it's listed, but the user can't check it) */
  notPossibleReason?: string | null
  /** Why the step isn't possible given the steps before it, e.g. because the user unchecked a step it depends on */
  getNotPossibleReason?: (isChecked: (step: Step) => boolean) => string | null
  /** Not listed: it always runs (also if the user skips the steps), e.g. committing the workflow files */
  alwaysRun?: true
  /**
   * @param isDone Whether a step before it succeeded
   * @returns Whether it succeeded
   */
  run: (isDone: (step: Step) => boolean) => Promise<boolean>
  /**
   * What the user can do instead, if the step isn't run or fails (`null`: nothing, or the caller logs it), given the
   * steps that were done
   */
  manual: string | null | ((isDone: (step: Step) => boolean) => string | null)
}
type StepOutcome = 'done' | 'failed' | 'unchecked' | 'not-possible'

/**
 * Lists the steps, asks the user which ones to run, and runs them (in order).
 * @returns The outcome of each step
 */
async function runSteps(steps: Step[]): Promise<Map<Step, StepOutcome>> {
  const listed = steps.filter((step) => !step.alwaysRun)
  const getNotPossibleReason = (step: Step, isChecked: (step: Step) => boolean) =>
    step.notPossibleReason ?? step.getNotPossibleReason?.(isChecked) ?? null
  const items: ChecklistItem[] = listed.map((step) => ({
    label: step.label,
    getNotPossibleReason: (isChecked) =>
      getNotPossibleReason(step, (s) => s.alwaysRun || (listed.includes(s) && isChecked(listed.indexOf(s)))),
  }))
  const checked =
    listed.length === 0
      ? []
      : await askChecklist(
          pc.blue(
            pc.bold('Press <SPACE> to uncheck a step, <ENTER> to run the checked steps, or <CTRL-C> to skip them all:'),
          ),
          items,
        )
  // Without terminal, the checklist isn't shown
  if (listed.length > 0 && !checked && !(process.stdin.isTTY && process.stdout.isTTY)) logNotPossibleSteps(listed)
  const isChecked = (step: Step) => !!step.alwaysRun || !!checked?.[listed.indexOf(step)]

  const outcomes = new Map<Step, StepOutcome>()
  for (const step of steps) {
    if (!isChecked(step)) {
      outcomes.set(step, getNotPossibleReason(step, isChecked) ? 'not-possible' : 'unchecked')
      continue
    }
    // A step it depends on wasn't done (e.g. it failed)
    if (getNotPossibleReason(step, (s) => outcomes.get(s) === 'done')) {
      outcomes.set(step, 'not-possible')
      continue
    }
    outcomes.set(step, (await step.run((s) => outcomes.get(s) === 'done')) ? 'done' : 'failed')
  }
  return outcomes
}

/** The steps that aren't possible, and why */
function logNotPossibleSteps(steps: Step[]) {
  for (const step of steps) {
    if (!step.notPossibleReason) continue
    console.log(pc.dim(`${step.label}: not possible, because ${step.notPossibleReason}`))
  }
}

/**
 * Logs, numbered, the manual instructions of the steps that weren't done.
 * @param extra More manual instructions (each one has one or more lines), logged before the step `before` (or last), e.g.
 * the ones of the steps whose `manual` is `null`
 */
function logManualSteps(
  steps: Step[],
  outcomes: Map<Step, StepOutcome>,
  extra: { manual: string[][]; before: Step | null } = { manual: [], before: null },
): void {
  const manualSteps: string[][] = []
  for (const step of steps) {
    if (step === extra.before) manualSteps.push(...extra.manual)
    const manual = getManual(step, outcomes)
    if (manual) manualSteps.push([manual])
  }
  if (!extra.before || !steps.includes(extra.before)) manualSteps.push(...extra.manual)
  for (const [i, lines] of manualSteps.entries()) {
    const [first, ...rest] = lines
    console.log(`${pc.bold(`${i + 1}.`)} ${first}`)
    for (const line of rest) console.log(line)
  }
}

/** The manual instructions of the step `step`, if it wasn't done */
function getManual(step: Step, outcomes: Map<Step, StepOutcome>): string | null {
  if (outcomes.get(step) === 'done') return null
  if (typeof step.manual !== 'function') return step.manual
  return step.manual((s) => outcomes.get(s) === 'done')
}
