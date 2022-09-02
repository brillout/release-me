import { releaseMe } from './releaseMe'

const { version } = parseArgs()

releaseMe(version)

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    return { version: null }
  }
  if (args.length === 1) {
    const version = args[0]
    return { version }
  }
  console.log(
    [
      // prettier-ignore
      'Commands:',
      '  $ pnpm exec release-me',
      '  $ pnpm exec release-me ${version}'
    ].join('\n')
  )
  process.exit(0)
}
