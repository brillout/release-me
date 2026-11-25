// Run by the GitHub Action .github/workflows/release.yml in its jobs that the repository's code mustn't influence:
//   $ node release-me/dist/ci/index.js resolve
//   $ node release-me/dist/ci/index.js publish
// These jobs download the release-me package without its dependencies (they would be resolved anew, in a job allowed to
// publish to npm): the files of this directory must only import Node.js built-ins (node:*) and each other.

import { publish } from './publish.js'
import { resolve } from './resolve.js'
import { fail } from './utils.js'

const command = process.argv[2]
if (command === 'resolve') {
  await resolve()
} else if (command === 'publish') {
  publish()
} else {
  fail(`Unknown command ${JSON.stringify(command)}`)
}
