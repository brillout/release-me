import { describe, expect, it } from 'vitest'
import pc from '@brillout/picocolors'
import { getChecklistState, renderChecklist, type ChecklistItem } from './checklist.ts'

const items: ChecklistItem[] = [
  { label: 'Commit' },
  { label: 'Not on npm', getNotPossibleReason: () => "it isn't on npm yet" },
  { label: 'Push', getNotPossibleReason: (isChecked) => (isChecked(0) ? null : 'nothing is committed') },
]

describe('getChecklistState()', () => {
  it('checks the possible items', () => {
    expect(getChecklistState(items, new Set())).toEqual([
      { checked: true, notPossibleReason: null },
      { checked: false, notPossibleReason: "it isn't on npm yet" },
      { checked: true, notPossibleReason: null },
    ])
  })
  it('unchecking an item makes the items that depend on it not possible', () => {
    expect(getChecklistState(items, new Set([0]))).toEqual([
      { checked: false, notPossibleReason: null },
      { checked: false, notPossibleReason: "it isn't on npm yet" },
      { checked: false, notPossibleReason: 'nothing is committed' },
    ])
  })
  it('the user unchecks an item', () => {
    expect(getChecklistState(items, new Set([2])).map(({ checked }) => checked)).toEqual([true, false, false])
  })
})

describe('renderChecklist()', () => {
  it('renders the checkboxes, the cursor, and why items are not possible', () => {
    const lines = renderChecklist(items, getChecklistState(items, new Set([2])), 0).map((line) => pc.rm(line))
    expect(lines).toEqual(['❯ [x] Commit', "   ─  Not on npm: not possible, because it isn't on npm yet", '  [ ] Push'])
  })
})
