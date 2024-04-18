import { Command, program } from 'commander'
import { type Args, releaseMe, type ReleaseType, releaseTypes, type ReleaseTarget } from './releaseMe'

const args = parseArgs()
releaseMe(args)

function parseArgs(): Args {
  program
    .name('release-me')
    .option('--dev', 'dev mode')
    .option('--force')
    .option('--git-tag-prefix <string>')
    .option('--changelog-dir <string>', 'relative to git root, e.g. packages/my-pkg/')
    .argument('<release-target>')
  program.parse()
  // At this point, program.args contains the positional arguments and program.opts() contains the flags.

  if (program.args.length !== 1) {
    showUsage(program)
    process.exit(0)
  }

  const releaseTarget = program.args[0]
  if (!releaseTarget) {
    console.error('Wrong CLI usage: argument is missing.')
    showUsage(program)
    process.exit(0)
  }
  if (!isValidReleaseTarget(releaseTarget)) {
    console.error('Wrong CLI usage: argument is invalid.')
    showUsage(program)
    process.exit(0)
  }

  return {
    dev: (program.opts().dev as boolean) || false,
    force: (program.opts().force as boolean) || false,
    gitTagPrefix: (program.opts().gitTagPrefix as string) || null,
    changelogDir: (program.opts().changelogDir as string) || './',
    releaseTarget,
  }
}

function showUsage(program: Command) {
  program.outputHelp()
  console.log(
    [
      '',
      'Examples:',
      '  $ pnpm exec release-me patch                        # bump patch semver',
      '  $ pnpm exec release-me minor                        # bump minor semver',
      '  $ pnpm exec release-me major                        # bump major semver',
      '  $ pnpm exec release-me commit                       # out-of-band release (as x.y.z-commit-123456 without npm tag)',
      '  $ pnpm exec release-me v${major}.${minor}.${patch}  # release specific version',
      '  $ pnpm exec release-me --git-prefix my-pkg patch    # git tag prefix -> my-pkg@${major}.${minor}.${patch}',
    ].join('\n'),
  )
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
