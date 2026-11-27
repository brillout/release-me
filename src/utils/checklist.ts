export { askChecklist }
export { getChecklistState }
export { renderChecklist }
export type { ChecklistItem }

// A list of checkboxes in the terminal: <UP>/<DOWN> to move, <SPACE> to toggle, <ENTER> to confirm, <CTRL-C> to cancel.

import readline from 'node:readline'
import pc from '@brillout/picocolors'

type ChecklistItem = {
  label: string
  /**
   * Why the item can't be checked, given the items before it (`isChecked(j)` with `j` < the item's index), or `null` if it
   * can be checked
   */
  getNotPossibleReason?: (isChecked: (index: number) => boolean) => string | null
}
type ItemState = { checked: boolean; notPossibleReason: string | null }

/**
 * The state of each item: checked if the user didn't uncheck it (`unchecked`) and if it's possible.
 * An item can depend on the items before it: e.g. unchecking an item makes the items that depend on it not possible.
 */
function getChecklistState(items: ChecklistItem[], unchecked: ReadonlySet<number>): ItemState[] {
  const states: ItemState[] = []
  const isChecked = (j: number) => states[j]?.checked ?? false
  for (const [i, item] of items.entries()) {
    const notPossibleReason = item.getNotPossibleReason?.(isChecked) ?? null
    states.push({ checked: !notPossibleReason && !unchecked.has(i), notPossibleReason })
  }
  return states
}

/** @param cursor The index of the item under the cursor, or `null` to render the list without cursor (e.g. once confirmed) */
function renderChecklist(items: ChecklistItem[], states: ItemState[], cursor: number | null): string[] {
  return items.map((item, i) => {
    const { checked, notPossibleReason } = states[i]!
    const pointer = i === cursor ? pc.cyan('❯') : ' '
    if (notPossibleReason)
      return `${pointer}  ─  ${pc.dim(`${item.label}: not possible, because ${notPossibleReason}`)}`
    return `${pointer} ${checked ? pc.green('[x]') : '[ ]'} ${item.label}`
  })
}

/**
 * Asks the user to check the items (if none is possible: only lists them).
 * @returns Whether each item is checked, or `null` if the user cancelled (<CTRL-C>) or if there is no terminal (the list isn't shown)
 */
async function askChecklist(question: string, items: ChecklistItem[]): Promise<boolean[] | null> {
  const { stdin, stdout } = process
  if (!stdin.isTTY || !stdout.isTTY) return null
  const unchecked = new Set<number>()
  // The items the user can toggle: the ones possible regardless of the other items
  const isTogglable = (i: number) => !getChecklistState(items, new Set()).at(i)?.notPossibleReason
  let cursor: number | null = items.findIndex((_, i) => isTogglable(i))
  if (cursor === -1) {
    console.log(renderChecklist(items, getChecklistState(items, unchecked), null).join('\n'))
    return items.map(() => false)
  }

  console.log(question)
  let rows = 0
  const render = () => {
    if (rows > 0) {
      readline.moveCursor(stdout, 0, -rows)
      readline.cursorTo(stdout, 0)
      readline.clearScreenDown(stdout)
    }
    const lines = renderChecklist(items, getChecklistState(items, unchecked), cursor)
    stdout.write(lines.join('\n') + '\n')
    // A line longer than the terminal is wrapped onto several rows
    const columns = stdout.columns || 80
    rows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(pc.rm(line).length / columns)), 0)
  }

  return new Promise((resolve) => {
    readline.emitKeypressEvents(stdin)
    stdin.setRawMode(true)
    stdin.resume()
    // Hide the cursor
    stdout.write('\x1b[?25l')
    render()
    const done = (result: boolean[] | null) => {
      stdin.off('keypress', onKeypress)
      stdin.setRawMode(false)
      stdin.pause()
      cursor = null
      render()
      stdout.write('\x1b[?25h')
      resolve(result)
    }
    const move = (direction: 1 | -1) => {
      for (let i = cursor! + direction; i >= 0 && i < items.length; i += direction) {
        if (!isTogglable(i)) continue
        cursor = i
        return
      }
    }
    const onKeypress = (_: string, key: readline.Key | undefined) => {
      if (!key) return
      if ((key.ctrl && key.name === 'c') || key.name === 'escape') return done(null)
      if (key.name === 'return') return done(getChecklistState(items, unchecked).map(({ checked }) => checked))
      if (key.name === 'up' || key.name === 'k') move(-1)
      else if (key.name === 'down' || key.name === 'j') move(1)
      else if (key.name === 'space') {
        if (unchecked.has(cursor!)) unchecked.delete(cursor!)
        else unchecked.add(cursor!)
      } else return
      render()
    }
    stdin.on('keypress', onKeypress)
  })
}
