export { getRandomId }

import assert from 'assert'

function getRandomId(length = 5): string {
  const randomId = Math.random()
    .toString()
    .slice(2, 2 + length)
  assert(/^[0-9]+$/.test(randomId) && randomId.length === length)
  return randomId
}
