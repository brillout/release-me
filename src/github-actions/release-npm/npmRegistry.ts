export { getPublishingStatus }
export { describeWorkflow }
export { getProvenanceWorkflow }
export { isPublishedByTrustedPublisher }
export type { PublishingStatus }

// Whether a package's npm <=> GitHub connection (npm's trusted publisher) is in use, according to npm's registry (no
// login needed): whether a release was published by a trusted publisher, and, if the release has provenance (stable
// releases), by which workflow. To read the connections themselves, see ./npmTrust.ts (it requires an npm login and 2FA).

import { releaseNpmWorkflowFile } from '../workflowFiles.ts'

// The registry of trusted publishing
const REGISTRY = 'https://registry.npmjs.org'
const REGISTRY_TIMEOUT = 10_000
// The dist-tags of the versions that release-npm.yml publishes (`commit`: unless npm let it remove it, see ./cli/ci-publish.ts)
const DIST_TAGS = ['latest', 'commit']

type ProvenanceWorkflow = { repository?: string; path?: string }
type PublishingStatus =
  /** The release `version` was published by a trusted publisher (of release-npm.yml, if the release has provenance) */
  | { status: 'in-use'; version: string; workflow: ProvenanceWorkflow | null }
  /** The latest release `version` wasn't published by the trusted publisher of release-npm.yml */
  | {
      status: 'not-in-use'
      version: string
      /** The npm user who published it, e.g. `brillout` */
      publisher: string | null
      /** The workflow of the trusted publisher that published it, if it isn't release-npm.yml (e.g. release.yml) */
      otherWorkflow: ProvenanceWorkflow | null
    }
  | { status: 'not-on-npm' }
  /** npm's registry didn't reply (e.g. offline) */
  | { status: 'unknown' }

/** Whether the package `packageName` is published by the trusted publisher of the GitHub Action release-npm.yml of the GitHub repository `repo` (e.g. `vikejs/vike`), according to npm's registry */
async function getPublishingStatus(packageName: string, repo: string): Promise<PublishingStatus> {
  let latest: { version: string; publisher: string | null; otherWorkflow: ProvenanceWorkflow | null } | null = null
  for (const distTag of DIST_TAGS) {
    const release = await fetchJson(`${REGISTRY}/${packageName.replace('/', '%2F')}/${distTag}`)
    if (release === undefined) return { status: 'unknown' }
    if (release === null) continue
    const { version } = release
    let otherWorkflow: ProvenanceWorkflow | null = null
    if (isPublishedByTrustedPublisher(release)) {
      const attestationsUrl = release.dist?.attestations?.provenance && release.dist.attestations.url
      // Commit releases don't have provenance (see ./cli/ci-publish.ts)
      if (!attestationsUrl) return { status: 'in-use', version, workflow: null }
      const attestations = await fetchJson(attestationsUrl)
      const workflow = attestations && getProvenanceWorkflow(attestations)
      if (!workflow || isReleaseNpmWorkflow(workflow, repo)) return { status: 'in-use', version, workflow }
      otherWorkflow = workflow
    }
    latest ??= { version, publisher: release._npmUser?.name ?? null, otherWorkflow }
  }
  if (!latest) return { status: 'not-on-npm' }
  return { status: 'not-in-use', ...latest }
}

function isPublishedByTrustedPublisher(release: any): boolean {
  return release?._npmUser?.trustedPublisher?.id === 'github'
}

/** The GitHub Action that published a release, according to its npm provenance */
function getProvenanceWorkflow(attestations: any): ProvenanceWorkflow | null {
  for (const attestation of attestations?.attestations ?? []) {
    if (attestation?.predicateType !== 'https://slsa.dev/provenance/v1') continue
    const payload = attestation.bundle?.dsseEnvelope?.payload
    if (typeof payload !== 'string') continue
    try {
      const statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
      const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow
      if (workflow) return { repository: workflow.repository, path: workflow.path }
    } catch {}
  }
  return null
}
function isReleaseNpmWorkflow(workflow: ProvenanceWorkflow, repo: string): boolean {
  return (
    workflow.repository?.toLowerCase() === `https://github.com/${repo}`.toLowerCase() &&
    workflow.path === releaseNpmWorkflowFile.filePath
  )
}
/** E.g. `vikejs/vike .github/workflows/release.yml` */
function describeWorkflow(workflow: ProvenanceWorkflow): string {
  const repository = workflow.repository?.replace(/^https:\/\/github\.com\//, '')
  return [repository, workflow.path].filter(Boolean).join(' ')
}

/** `null` upon 404, `undefined` if the registry didn't reply */
async function fetchJson(url: string): Promise<any | null | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REGISTRY_TIMEOUT) }).catch(() => null)
  if (!response) return undefined
  if (response.status === 404) return null
  if (!response.ok) return undefined
  return response.json().catch(() => undefined)
}
