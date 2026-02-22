import { readFileSync } from 'fs'
import { debug, error } from '@actions/core'
import { pluralize } from './utils.ts'

interface LinterError {
  ruleId: string
  lineNumber: number
  column: number
  endColumn: number
  description: string
  helpURL: string
}

interface LinterReport {
  errors: LinterError[]
}

export interface LinterResponse {
  error?: string
  report: LinterReport
}

export async function lintFiles(
  files: string[],
  apiKey: string,
  axeLinterUrl: string,
  linterConfig: Record<string, unknown>
): Promise<number> {
  let totalErrors = 0

  for (const file of files) {
    const fileContents = readFileSync(file, 'utf8')

    // Skip empty files
    if (!fileContents.trim()) {
      debug(`Skipping empty file ${file}`)
      continue
    }

    const response = await fetch(`${axeLinterUrl}/lint-source`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey
      },
      body: JSON.stringify({
        source: fileContents,
        filename: file,
        config: linterConfig
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const contentType = response.headers.get('content-type')

    if (!contentType?.includes('application/json')) {
      throw new Error('Invalid content type')
    }

    const result = (await response.json()) as LinterResponse

    if (result.error) {
      throw new Error(result.error)
    }

    const errors = result.report.errors
    totalErrors += errors.length

    // Report errors using GitHub annotations
    for (const err of errors) {
      error(
        `${file}:${err.lineNumber} - ${err.ruleId} - ${err.description}\n${err.helpURL}`,
        {
          file,
          startLine: err.lineNumber,
          startColumn: err.column,
          endColumn: err.endColumn,
          title: 'Axe Linter'
        }
      )
    }
  }

  debug(`Found ${totalErrors} error${pluralize(totalErrors)}`)
  return totalErrors
}
