import { getOctokit, context } from '@actions/github'
import { debug } from '@actions/core'
import { minimatch } from 'minimatch'

const FILE_PATTERNS = [
  '**/*.js',
  '**/*.jsx',
  '**/*.tsx',
  '**/*.esm',
  '**/*.html',
  '**/*.htm',
  '**/*.vue',
  '**/*.md',
  '**/*.markdown'
] as const

export async function getChangedFiles(token: string): Promise<string[]> {
  const octokit = getOctokit(token)

  console.log('GitHub context:', JSON.stringify(context, null, 2))

  if (!context.payload.pull_request) {
    debug('Not a pull request, checking push diff')
    const base = context.payload.before
    const head = context.payload.after

    const response = await octokit.rest.repos.compareCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base,
      head
    })

    return (
      response.data.files
        ?.filter(
          (file) =>
            file.status !== 'removed' &&
            FILE_PATTERNS.some((pattern) =>
              minimatch(file.filename, pattern, { nocase: true })
            )
        )
        .map((file) => file.filename) || []
    )
  }

  const response = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number
  })

  return response.data
    .filter(
      (file) =>
        file.status !== 'removed' &&
        FILE_PATTERNS.some((pattern) =>
          minimatch(file.filename, pattern, { nocase: true })
        )
    )
    .map((file) => file.filename)
}
