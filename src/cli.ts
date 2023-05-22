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
      '  $ pnpm exec release-me patch # bump patch semver',
      '  $ pnpm exec release-me minor # bump minor semver',
      '  $ pnpm exec release-me major # bump major semver',
      '  $ pnpm exec release-me commit # out-of-band release (as x.y.z-commit-123456 without npm tag)',
      '  $ pnpm exec release-me v${major}.${minor}.${patch} # release specific version'
    ].join('\n')
  )
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
