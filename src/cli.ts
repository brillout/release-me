import { Command, program } from 'commander'
import { type CliArgs, releaseMe, type ReleaseType, releaseTypes, type ReleaseTarget } from './releaseMe.js'
import { ciPack } from './ciPack.js'
import { init } from './init.js'

const helpText = [
  '',
  'Examples:',
  '  $ pnpm exec release-me patch                        # bump patch semver',
  '  $ pnpm exec release-me minor                        # bump minor semver',
  '  $ pnpm exec release-me major                        # bump major semver',
  '  $ pnpm exec release-me commit                       # out-of-band release (as x.y.z-commit-123456 without npm tag)',
  '  $ pnpm exec release-me v${major}.${minor}.${patch}  # release specific version',
  '',
  'Publish to npm via a GitHub Action (see https://github.com/brillout/release-me#github-action):',
  '  $ pnpm exec release-me init                         # create/update .github/workflows/release.yml (GitHub Action that publishes to npm)',
  '  $ pnpm exec release-me ci-pack --out <dir> [--tag <git-tag>] [--package <name>]  # used by the GitHub Action',
].join('\n')

if (process.argv[2] === 'ci-pack') {
  cliCiPack()
} else if (process.argv[2] === 'init') {
  cliInit()
} else {
  cli()
}

function cliInit() {
  new Command('release-me init')
    .description(
      'Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see https://github.com/brillout/release-me#github-action).',
    )
    .showHelpAfterError()
    .parse(process.argv.slice(3), { from: 'user' })
  init()
}

function cli() {
  const packageRootDir = process.cwd()
  const args = parseArgs()
  releaseMe(args, packageRootDir)
}

function cliCiPack() {
  const command = new Command('release-me ci-pack')
    .description(
      'Build and pack the packages that the GitHub Action .github/workflows/release.yml publishes to npm (run by its job `pack`).',
    )
    .requiredOption('--out <dir>', 'directory where the tarballs are written')
    .option(
      '--tag <git-tag>',
      'stable release of the Git tag v1.2.3 or some-package@1.2.3 (default: commit release of HEAD)',
    )
    .option('--package <name>', 'commit release: only release this package (default: all packages that use release-me)')
    .showHelpAfterError()
  command.parse(process.argv.slice(3), { from: 'user' })
  const opts = command.opts<{ out: string; tag?: string; package?: string }>()
  ciPack({ tag: opts.tag ?? '', packageName: opts.package ?? '', outDir: opts.out })
}

function parseArgs(): CliArgs {
  program
    .name('release-me')
    .option(
      '--force',
      "skip validation — release even in unexpected situations (e.g. if the release contains no CHANGELOG.md entry, or if HEAD isn't up-to-date with origin/main)",
    )
    .option('--yes', 'skip confirmation — release without prompting the user to confirm the release')
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
    yes: (program.opts().yes as boolean) || false,
    releaseTarget,
  }
}

function isValidReleaseTarget(releaseTarget: string): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
