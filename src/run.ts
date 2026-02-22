import { readFileSync } from 'fs'
import { getInput, setFailed, debug } from '@actions/core'
import { parse } from 'yaml'
import { lintFiles } from './linter.ts'
import { getChangedFiles } from './git.ts'
import { pluralize } from './utils.ts'

async function run(): Promise<void> {
  try {
    const inputs = {
      githubToken: getInput('github_token', { required: true }),
      apiKey: getInput('api_key', { required: true }),
      axeLinterUrl: getInput('axe_linter_url')
    }

    // Remove trailing slash if present
    inputs.axeLinterUrl = inputs.axeLinterUrl.replace(/\/$/, '')

    const changedFiles = await getChangedFiles(inputs.githubToken)

    if (changedFiles.length === 0) {
      debug('No files to lint')
      return
    }

    // Load linter config if exists
    let linterConfig = {}
    try {
      const configFile = readFileSync('axe-linter.yml', 'utf8')
      const parsedConfig = parse(configFile)
      if (parsedConfig && typeof parsedConfig === 'object') {
        linterConfig = parsedConfig
      }
    } catch (error) {
      if (error instanceof Error) {
        debug(
          `Error loading axe-linter.yml no config found or invalid config: ${error.message}`
        )
      } else {
        debug(
          'Error loading axe-linter.yml no config found or invalid config: ' +
            error
        )
      }
    }

    // Run linter
    const errorCount = await lintFiles(
      changedFiles,
      inputs.apiKey,
      inputs.axeLinterUrl,
      linterConfig
    )

    if (errorCount > 0) {
      setFailed(
        `Found ${errorCount} accessibility issue${pluralize(errorCount)}`
      )
    }
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    } else {
      setFailed('An unexpected error occurred: ' + JSON.stringify(error))
    }
  }
}

export default run
