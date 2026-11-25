#!/usr/bin/env node

// In release-me's own repository, which installs release-me with `link:./` (e.g. in its GitHub Action), dist/ may not be built yet
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
if (!existsSync(new URL('./dist/cli.js', import.meta.url))) {
  execSync('pnpm run build', { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'inherit', 'inherit'] })
}
await import('./dist/cli.js')
