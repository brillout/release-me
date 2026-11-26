export { getGitHubRepo }
export { parseGitHubRepo }

import execa from 'execa'

/** The GitHub repository of `origin`, e.g. `vikejs/vike` */
async function getGitHubRepo(cwd?: string): Promise<string | null> {
  let remoteUrl: string
  try {
    remoteUrl = (await execa('git', ['remote', 'get-url', 'origin'], { cwd })).stdout.trim()
  } catch {
    return null
  }
  return parseGitHubRepo(remoteUrl)
}
function parseGitHubRepo(url: string): string | null {
  // git@github.com:vikejs/vike.git
  // https://github.com/vikejs/vike
  // git+https://github.com/vikejs/vike.git
  // ssh://git@github.com/vikejs/vike.git
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url)
  return match?.[1] ?? null
}
