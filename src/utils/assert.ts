export function assert(condition: unknown, errMsg: string): asserts condition {
  if (condition) return
  throw new Error(errMsg)
}
