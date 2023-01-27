import { releaseMe, type ReleaseType, releaseTypes, type ReleaseTarget } from './releaseMe'

const releaseTarget = parseArgs()
releaseMe(releaseTarget)

function parseArgs() {
  const args = process.argv.slice(2)
  const releaseTarget = args[0]
  if (!releaseTarget) {
    console.error('Wrong CLI usage: argument is missing.')
    showUsage()
    process.exit(0)
  }
  if (args.length !== 1) {
    showUsage()
    process.exit(0)
  }
  if (!isValidReleaseTarget(releaseTarget)) {
    console.error('Wrong CLI usage: argument is invalid.')
    showUsage()
    process.exit(0)
  }
  return releaseTarget
}

function showUsage() {
  console.log(
    [
      'Commands:',
      '  $ pnpm exec release-me patch',
      '  $ pnpm exec release-me minor',
      '  $ pnpm exec release-me major',
      '  $ pnpm exec release-me experiment',
      '  $ pnpm exec release-me v${string}'
    ].join('\n')
  )
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
