export { initCommand }
export { npmConnectionCommand }
export { githubReleaseSyncCommand }

// The commands of release-me that its messages tell the user to run

const initCommand = '$ pnpm exec release-me init'
const npmConnectionCommand = '$ pnpm exec release-me npm-connection'
const githubReleaseSyncCommand = '$ pnpm exec release-me github-release-sync'
