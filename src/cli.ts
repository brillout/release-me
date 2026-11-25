import { Command, program } from 'commander'
import type { CliArgs, ReleaseType, ReleaseTarget } from './releaseMe.js'

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
  '  $ pnpm exec release-me ci-resolve|ci-pack|ci-publish  # used by the GitHub Action',
].join('\n')

// Each command only loads its own code: the GitHub Action's jobs `resolve` and `publish` run as little code as possible
switch (process.argv[2]) {
  case 'init':
    await cliInit()
    break
  case 'ci-resolve':
    await (await import('./ci/resolve.js')).resolve()
    break
  case 'ci-pack':
    await cliCiPack()
    break
  case 'ci-publish':
    ;(await import('./ci/publish.js')).publish()
    break
  default:
    await cli()
}

async function cliInit() {
  new Command('release-me init')
    .description(
      'Create or update .github/workflows/release.yml, the GitHub Action that publishes to npm (see https://github.com/brillout/release-me#github-action).',
    )
    .showHelpAfterError()
    .parse(process.argv.slice(3), { from: 'user' })
  const { init } = await import('./init.js')
  init()
}

async function cli() {
  const { releaseMe, releaseTypes } = await import('./releaseMe.js')
  const packageRootDir = process.cwd()
  const args = parseArgs(releaseTypes)
  releaseMe(args, packageRootDir)
}

async function cliCiPack() {
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
  const { ciPack } = await import('./ciPack.js')
  ciPack({ tag: opts.tag ?? '', packageName: opts.package ?? '', outDir: opts.out })
}

function parseArgs(releaseTypes: readonly ReleaseType[]): CliArgs {
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
  if (!isValidReleaseTarget(releaseTarget, releaseTypes)) {
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

function isValidReleaseTarget(
  releaseTarget: string,
  releaseTypes: readonly ReleaseType[],
): releaseTarget is ReleaseTarget {
  return releaseTarget.startsWith('v') || releaseTypes.includes(releaseTarget as ReleaseType)
}
