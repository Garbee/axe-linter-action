import * as github from '@actions/github'
import * as core from '@actions/core'
import { extname } from 'path'

const FILE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.tsx',
  '.esm',
  '.html',
  '.htm',
  '.vue',
  '.md',
  '.markdown',
  '.liquid'
])

const TAG_REF_PREFIX = 'refs/tags/'

function isSupportedFile(filename: string): boolean {
  const hasDotSegment = filename.split('/').some((seg) => seg.startsWith('.'))
  return !hasDotSegment && FILE_EXTENSIONS.has(extname(filename).toLowerCase())
}

function getMergeGroupSHAs(): { base: string; head: string } | null {
  const { context } = github
  const mergeGroup = context.payload.merge_group
  if (
    mergeGroup &&
    typeof mergeGroup.base_sha === 'string' &&
    typeof mergeGroup.head_sha === 'string'
  ) {
    return { base: mergeGroup.base_sha, head: mergeGroup.head_sha }
  }
  return null
}

async function getPreviousTagName(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  currentTag: string
): Promise<string | null> {
  // REST listTags returns alphabetical order, so v10 sorts before v2.
  // GraphQL with TAG_COMMIT_DATE gives a chronological list we can scan.
  const result = await octokit.graphql<{
    repository: {
      refs: {
        nodes: Array<{ name: string }>
      } | null
    } | null
  }>(
    `query($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        refs(refPrefix: "refs/tags/", first: 100, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
          nodes { name }
        }
      }
    }`,
    { owner, repo }
  )

  const names = result.repository?.refs?.nodes?.map((node) => node.name) ?? []
  const currentIndex = names.indexOf(currentTag)

  if (currentIndex === -1) {
    return names[0] ?? null
  }

  return names[currentIndex + 1] ?? null
}

type Octokit = ReturnType<typeof github.getOctokit>

async function getPullRequestFiles(
  octokit: Octokit,
  pullNumber: number
): Promise<string[]> {
  const { context } = github
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pullNumber,
    per_page: 100
  })

  return files
    .filter(
      (file) => file.status !== 'removed' && isSupportedFile(file.filename)
    )
    .map((file) => file.filename)
}

async function getTagFiles(
  octokit: Octokit,
  tagName: string
): Promise<string[]> {
  const { context } = github
  core.debug(`Tag event for ${tagName}, finding previous tag for diff`)
  const previousTag = await getPreviousTagName(
    octokit,
    context.repo.owner,
    context.repo.repo,
    tagName
  )

  if (!previousTag) {
    core.debug('No previous tag found, nothing to lint')
    return []
  }

  core.debug(`Comparing ${previousTag}...${tagName}`)
  const response = await octokit.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: previousTag,
    head: tagName
  })

  const files = response.data.files

  if (files && files.length >= 300) {
    core.warning(
      'This tag changed at least 300 files. The GitHub API only returns up to the first 300 files when comparing commits, so some files may not be linted.'
    )
  }

  return (
    files
      ?.filter(
        (file) => file.status !== 'removed' && isSupportedFile(file.filename)
      )
      .map((file) => file.filename) || []
  )
}

async function getMergeGroupFiles(
  octokit: Octokit,
  baseSha: string,
  headSha: string
): Promise<string[]> {
  const { context } = github
  core.debug(`Merge group event, comparing ${baseSha}...${headSha}`)
  const response = await octokit.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: baseSha,
    head: headSha
  })

  const files = response.data.files

  if (files && files.length >= 300) {
    core.warning(
      'This merge group changed at least 300 files. The GitHub API only returns up to the first 300 files when comparing commits, so some files may not be linted.'
    )
  }

  return (
    files
      ?.filter(
        (file) => file.status !== 'removed' && isSupportedFile(file.filename)
      )
      .map((file) => file.filename) || []
  )
}

async function getPushFiles(octokit: Octokit): Promise<string[]> {
  const { context } = github
  core.debug('Not a pull request, checking push diff')
  const response = await octokit.rest.repos.compareCommits({
    owner: context.repo.owner,
    repo: context.repo.repo,
    base: context.payload.before,
    head: context.payload.after
  })

  const files = response.data.files

  if (files && files.length >= 300) {
    core.warning(
      'This push changed at least 300 files. The GitHub API only returns up to the first 300 files for push events, so some files may not be linted.'
    )
  }

  return (
    files
      ?.filter(
        (file) => file.status !== 'removed' && isSupportedFile(file.filename)
      )
      .map((file) => file.filename) || []
  )
}

export async function getChangedFiles(token: string): Promise<string[]> {
  const octokit = github.getOctokit(token)
  const { context } = github

  switch (context.eventName) {
    case 'pull_request':
    case 'pull_request_target': {
      return getPullRequestFiles(octokit, context.payload.pull_request!.number)
    }

    case 'merge_group': {
      const shas = getMergeGroupSHAs()
      if (shas) {
        return getMergeGroupFiles(octokit, shas.base, shas.head)
      }
      return getPushFiles(octokit)
    }

    case 'create': {
      if (
        context.payload.ref_type === 'tag' &&
        typeof context.payload.ref === 'string'
      ) {
        return getTagFiles(octokit, context.payload.ref)
      }
      return getPushFiles(octokit)
    }

    case 'push': {
      if (context.ref?.startsWith(TAG_REF_PREFIX)) {
        return getTagFiles(octokit, context.ref.slice(TAG_REF_PREFIX.length))
      }
      return getPushFiles(octokit)
    }

    default: {
      return getPushFiles(octokit)
    }
  }
}
