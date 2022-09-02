import { releaseMe } from './releaseMe'

const { updateTarget } = parseArgs()

releaseMe(updateTarget)

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    return { updateTarget: null }
  }
  if (args.length === 1) {
    const updateTarget = args[0]
    return { updateTarget }
  }
  console.log(
    [
      // prettier-ignore
      'Commands:',
      '  $ pnpm exec release-me patch',
      '  $ pnpm exec release-me minor',
      '  $ pnpm exec release-me major',
      '  $ pnpm exec release-me ${version}',
    ].join('\n')
  )
  process.exit(0)
}
