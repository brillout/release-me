export { githubReleaseDeleteAll }

// `$ pnpm exec release-me github-release-delete-all` deletes every GitHub Release of the repository — not only the ones
// created by github-release-sync. CHANGELOG.md and the Git tags are left untouched, so `$ pnpm exec release-me github-release-sync`
// can re-create them.

import readline from 'node:readline'
import pc from '@brillout/picocolors'
import { createReleasesClientFromEnv } from '../utils/github-env.ts'

async function githubReleaseDeleteAll({ dryRun, yes }: { dryRun: boolean; yes: boolean }): Promise<void> {
  const { client, owner, repo } = await createReleasesClientFromEnv(dryRun)

  console.log(`Fetching releases for ${owner}/${repo} …`)
  const githubReleases = await client.list()
  if (githubReleases.length === 0) {
    console.log('No releases to delete.')
    return
  }

  if (!dryRun && !yes) {
    const confirmed = await askConfirmation(
      pc.blue(
        pc.bold(
          `Press <ENTER> to delete all ${githubReleases.length} GitHub Releases of ${owner}/${repo}, or <CTRL-C> to abort.`,
        ),
      ),
    )
    if (!confirmed) {
      // The prompt's line doesn't end upon <CTRL-C>
      console.log('\nAborted — no release deleted.')
      process.exitCode = 1
      return
    }
  }

  // The client logs each deletion (`Deleted release <tag>`).
  console.log(`Starting delete of ${githubReleases.length} releases …`)
  for (const release of githubReleases) {
    await client.delete({ release_id: release.id, tag_name: release.tag_name })
  }

  if (!dryRun) console.log(`Deleted ${githubReleases.length} releases.`)
}

/** Resolves to `false` upon <CTRL-C> or the end of stdin */
function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    let confirmed = false
    rl.question(question, () => {
      confirmed = true
      rl.close()
    })
    rl.on('SIGINT', () => rl.close())
    rl.on('close', () => resolve(confirmed))
  })
}
