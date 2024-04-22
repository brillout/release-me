import { program } from 'commander'
import { type Args, releaseMe, type ReleaseType, releaseTypes, type ReleaseTarget } from './releaseMe'

const helpText = [
  '',
  'Examples:',
  '  $ pnpm exec release-me patch                        # bump patch semver',
  '  $ pnpm exec release-me minor                        # bump minor semver',
  '  $ pnpm exec release-me major                        # bump major semver',
  '  $ pnpm exec release-me commit                       # out-of-band release (as x.y.z-commit-123456 without npm tag)',
  '  $ pnpm exec release-me v${major}.${minor}.${patch}  # release specific version',
].join('\n')

cli()

function cli() {
  const packageRootDir = process.cwd()
  const args = parseArgs()
  releaseMe(args, packageRootDir)
}

function parseArgs(): Args {
  program
    .name('release-me')
    .option('--force', "Release even if the current commit (i.e. HEAD) isn't up-to-date with origin/main")
    .argument('<release-target>')
  program.addHelpText('afterAll', helpText)
  program.showHelpAfterError()
  program.parse()
  // At this point, program.args contains the positional arguments and program.opts() contains the flags.

  if (program.args.length !== 1) {
    program.outputHelp()
    process.exit(0)
  }

  const releaseTarget = program.args[0]
  if (!releaseTarget) {
    console.error('Wrong CLI usage: argument is missing.')
    program.outputHelp()
    process.exit(0)
  }
  if (!isValidReleaseTarget(releaseTarget)) {
    console.error('Wrong CLI usage: argument is invalid.')
    program.outputHelp()
    process.exit(0)
  }

  return {
    force: (program.opts().force as boolean) || false,
    releaseTarget,
  }
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
