export { getRandomId }

import assert from 'assert'

function getRandomId(): string {
  const idLength = 5
  const randomId = Math.random()
    .toString()
    .slice(2, 2 + idLength)
  assert(/^[0-9]+$/.test(randomId) && randomId.length === idLength)
  return randomId
}
