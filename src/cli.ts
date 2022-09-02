import { releaseMe } from './releaseMe'

const { versionTarget } = parseArgs()

releaseMe(versionTarget)

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length !== 1) {
    showUsage()
    process.exit(0)
  }
  const versionTarget = args[0]
  return { versionTarget }
}

function showUsage() {
  console.log(
    [
      'Commands:',
      '  $ pnpm exec release-me patch',
      '  $ pnpm exec release-me minor',
      '  $ pnpm exec release-me major',
      '  $ pnpm exec release-me ${version}'
    ].join('\n')
  )
}
