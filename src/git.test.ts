import { describe, it, before, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import type { context } from '@actions/github'

describe('git', function () {
  let getChangedFiles: typeof import('./git.ts').getChangedFiles
  const debugMock = mock.fn()
  const mockContext: Partial<typeof context> = {
    repo: {
      owner: 'dequelabs-test',
      repo: 'i-really-do-not-exist'
    },
    payload: {
      before: 'base-sha',
      after: 'head-sha'
    }
  }

  const getOctokit = (token: string) => {
    return {
      rest: {
        pulls: {
          listFiles: async ({
            owner,
            repo,
            pull_number
          }: {
            owner: string
            repo: string
            pull_number: number
          }) => {
            assert.strictEqual(
              owner,
              'dequelabs-test',
              'Owner should match context'
            )
            assert.strictEqual(
              repo,
              'i-really-do-not-exist',
              'Repo should match context'
            )

            switch (token) {
              case 'git > getChangedFiles > should handle pull request files':
                assert.strictEqual(
                  pull_number,
                  123,
                  'Pull number should match context'
                )
                return {
                  data: [
                    { filename: 'test.js', status: 'added' },
                    { filename: 'test.md', status: 'added' },
                    { filename: 'test.css', status: 'added' }, // Should be filtered out
                    { filename: 'test.tsx', status: 'added' }
                  ]
                }
              case 'git > getChangedFiles > should handle empty file lists':
                assert.strictEqual(pull_number, 123)
                return { data: [] }
              case 'git > getChangedFiles > should filter out unsupported file types':
                assert.strictEqual(pull_number, 123)
                return {
                  data: [
                    { filename: 'test.cpp', status: 'added' },
                    { filename: 'test.py', status: 'added' },
                    { filename: 'test.rb', status: 'added' }
                  ]
                }
              case 'git > getChangedFiles > should throw an error when API call fails':
                throw new Error('API Error')
              case 'git > getChangedFiles > should exclude deleted files in pull request':
                assert.strictEqual(pull_number, 123)
                return {
                  data: [
                    { filename: 'test.js', status: 'added' },
                    { filename: 'removed.js', status: 'removed' },
                    { filename: 'modified.jsx', status: 'modified' },
                    { filename: 'deleted.md', status: 'removed' },
                    { filename: 'test.tsx', status: 'added' }
                  ]
                }
              case 'git > getChangedFiles > should handle files with different statuses':
                assert.strictEqual(pull_number, 123)
                return {
                  data: [
                    { filename: 'test1.js', status: 'added' },
                    { filename: 'test2.js', status: 'modified' },
                    { filename: 'test3.js', status: 'renamed' },
                    { filename: 'test4.js', status: 'removed' },
                    { filename: 'test5.js', status: 'changed' }
                  ]
                }
              default:
                assert.fail(
                  `Unexpected test token for a pull request: ${token}`
                )
            }
          }
        },
        repos: {
          compareCommits: async ({
            owner,
            repo,
            base,
            head
          }: {
            owner: string
            repo: string
            base: string
            head: string
          }) => {
            assert.strictEqual(
              owner,
              'dequelabs-test',
              'Owner should match context'
            )
            assert.strictEqual(
              repo,
              'i-really-do-not-exist',
              'Repo should match context'
            )
            assert.strictEqual(
              base,
              'base-sha',
              'Base SHA should match context'
            )
            assert.strictEqual(
              head,
              'head-sha',
              'Head SHA should match context'
            )

            switch (token) {
              case 'git > getChangedFiles > should handle push event files':
                return {
                  data: {
                    files: [
                      { filename: 'test.jsx', status: 'added' },
                      { filename: 'test.vue', status: 'added' },
                      { filename: 'test.py', status: 'added' },
                      { filename: 'test.html', status: 'added' }
                    ]
                  }
                }
              case 'git > getChangedFiles > should handle undefined files in compare commits response':
                return { data: { files: undefined } }
              case 'git > getChangedFiles > should exclude deleted files in push event':
                return {
                  data: {
                    files: [
                      { filename: 'test.vue', status: 'added' },
                      { filename: 'deleted.js', status: 'removed' },
                      { filename: 'test.html', status: 'modified' },
                      { filename: 'removed.md', status: 'removed' }
                    ]
                  }
                }
              case 'git > file pattern matching > should match JavaScript files correctly':
                return {
                  data: {
                    files: [
                      { filename: 'src/app.js', status: 'added' },
                      { filename: 'test/test.js', status: 'modified' },
                      {
                        filename: 'src/components/Button.jsx',
                        status: 'added'
                      },
                      { filename: 'src/utils/helper.esm', status: 'modified' },
                      { filename: 'src/types.ts', status: 'added' },
                      { filename: 'src/styles.css', status: 'modified' }
                    ]
                  }
                }
              case 'git > file pattern matching > should match HTML files correctly':
                return {
                  data: {
                    files: [
                      { filename: 'index.html', status: 'modified' },
                      { filename: 'public/about.htm', status: 'added' },
                      { filename: 'templates/page.html', status: 'modified' },
                      { filename: 'docs/readme.txt', status: 'added' },
                      { filename: 'styles/main.css', status: 'modified' }
                    ]
                  }
                }
              case 'git > file pattern matching > should handle case insensitive matching':
                return {
                  data: {
                    files: [
                      { filename: 'src/App.JS', status: 'added' },
                      { filename: 'src/Component.JSX', status: 'modified' },
                      { filename: 'docs/README.MD', status: 'added' },
                      { filename: 'docs/test.MaRkDoWn', status: 'added' },
                      { filename: 'public/INDEX.HTML', status: 'modified' },
                      { filename: 'src/Test.VUE', status: 'added' }
                    ]
                  }
                }
              case 'git > file pattern matching > should handle nested paths correctly':
                return {
                  data: {
                    files: [
                      {
                        filename: 'deeply/nested/path/component.jsx',
                        status: 'added'
                      },
                      {
                        filename: 'very/deep/structure/util.js',
                        status: 'modified'
                      },
                      { filename: 'nested/docs/guide.md', status: 'added' },
                      { filename: 'a/b/c/d/e/f/page.html', status: 'modified' },
                      { filename: 'deep/path/app.vue', status: 'added' }
                    ]
                  }
                }
              case 'git > file pattern matching > should handle files without extensions correctly':
                return {
                  data: {
                    files: [
                      { filename: 'README', status: 'modified' },
                      { filename: 'LICENSE', status: 'added' },
                      { filename: 'docs/markdown', status: 'modified' },
                      { filename: 'test.html', status: 'added' },
                      { filename: 'test.', status: 'modified' }
                    ]
                  }
                }
              case 'git > file pattern matching > should handle push event diff correctly':
                return {
                  data: {
                    files: [
                      { filename: 'src/app.js', status: 'added' },
                      { filename: 'test/test.jsx', status: 'modified' }
                    ]
                  }
                }
              default:
                assert.fail(`Unexpected test token for push event: ${token}`)
            }
          }
        }
      }
    }
  }

  before(async function () {
    mock.module('@actions/github', {
      namedExports: {
        context: mockContext,
        getOctokit
      }
    })

    mock.module('@actions/core', {
      namedExports: {
        debug: debugMock
      }
    })
  })

  beforeEach(function () {
    debugMock.mock.resetCalls()
    mockContext.payload = {
      before: 'base-sha',
      after: 'head-sha'
    }
  })

  it('getChangedFiles', async function (getChangedFilesTest) {
    ;({ getChangedFiles } = await import('./git.ts'))

    await getChangedFilesTest.test(
      'should handle pull request files',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        const result = await getChangedFiles(t.fullName)

        assert.deepStrictEqual(
          result,
          ['test.js', 'test.md', 'test.tsx'],
          'should return correct filtered files'
        )
      }
    )

    await getChangedFilesTest.test(
      'should handle push event files',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        assert.deepStrictEqual(
          result,
          ['test.jsx', 'test.vue', 'test.html'],
          'should return correct filtered files'
        )
        assert.strictEqual(
          debugMock.mock.calls.some(
            (call: { arguments: string[] }) =>
              call.arguments[0] === 'Not a pull request, checking push diff'
          ),
          true,
          'should log debug message'
        )
      }
    )

    await getChangedFilesTest.test(
      'should handle empty file lists',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        const result = await getChangedFiles(t.fullName)

        assert.ok(Array.isArray(result), 'should return an array')
        assert.strictEqual(result.length, 0, 'should return empty array')
      }
    )

    await getChangedFilesTest.test(
      'should handle undefined files in compare commits response',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        assert.ok(Array.isArray(result), 'should return an array')
        assert.strictEqual(result.length, 0, 'should return empty array')
      }
    )

    await getChangedFilesTest.test(
      'should filter out unsupported file types',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        const result = await getChangedFiles(t.fullName)

        assert.ok(Array.isArray(result), 'should return an array')
        assert.strictEqual(result.length, 0, 'should return empty array')
      }
    )

    await getChangedFilesTest.test(
      'should throw an error when API call fails',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        await assert.rejects(
          () => getChangedFiles(t.fullName),
          (err: Error) => {
            assert.strictEqual(
              err.message,
              'API Error',
              'should throw the original error'
            )
            return true
          }
        )
      }
    )

    await getChangedFilesTest.test(
      'should exclude deleted files in pull request',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        const result = await getChangedFiles(t.fullName)

        assert.deepStrictEqual(result, ['test.js', 'modified.jsx', 'test.tsx'])
        assert.strictEqual(result.includes('removed.js'), false)
        assert.strictEqual(result.includes('deleted.md'), false)
      }
    )

    await getChangedFilesTest.test(
      'should exclude deleted files in push event',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        assert.deepStrictEqual(result, ['test.vue', 'test.html'])
        assert.strictEqual(result.includes('deleted.js'), false)
        assert.strictEqual(result.includes('removed.md'), false)
        assert.strictEqual(
          debugMock.mock.calls.some(
            (call: { arguments: string[] }) =>
              call.arguments[0] === 'Not a pull request, checking push diff'
          ),
          true
        )
      }
    )

    await getChangedFilesTest.test(
      'should handle files with different statuses',
      async function (t) {
        mockContext.payload!.pull_request = { number: 123 }

        const result = await getChangedFiles(t.fullName)

        assert.deepStrictEqual(result, [
          'test1.js',
          'test2.js',
          'test3.js',
          'test5.js'
        ])
        assert.strictEqual(result.includes('test4.js'), false)
      }
    )
  })

  it('file pattern matching', async function (filePatternTest) {
    ;({ getChangedFiles } = await import('./git.ts'))

    await filePatternTest.test(
      'should match JavaScript files correctly',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        for (const file of [
          'src/app.js',
          'test/test.js',
          'src/components/Button.jsx',
          'src/utils/helper.esm'
        ]) {
          assert.ok(result.includes(file), `should include ${file}`)
        }
        assert.strictEqual(result.includes('src/types.ts'), false)
        assert.strictEqual(result.includes('src/styles.css'), false)
      }
    )

    await filePatternTest.test(
      'should match HTML files correctly',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        for (const file of [
          'index.html',
          'public/about.htm',
          'templates/page.html'
        ]) {
          assert.ok(result.includes(file), `should include ${file}`)
        }
        assert.strictEqual(result.includes('docs/readme.txt'), false)
        assert.strictEqual(result.includes('styles/main.css'), false)
      }
    )

    await filePatternTest.test(
      'should handle case insensitive matching',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        for (const file of [
          'src/App.JS',
          'src/Component.JSX',
          'docs/README.MD',
          'docs/test.MaRkDoWn',
          'public/INDEX.HTML',
          'src/Test.VUE'
        ]) {
          assert.ok(result.includes(file), `should include ${file}`)
        }
      }
    )

    await filePatternTest.test(
      'should handle nested paths correctly',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        for (const file of [
          'deeply/nested/path/component.jsx',
          'very/deep/structure/util.js',
          'nested/docs/guide.md',
          'a/b/c/d/e/f/page.html',
          'deep/path/app.vue'
        ]) {
          assert.ok(result.includes(file), `should include ${file}`)
        }
      }
    )

    await filePatternTest.test(
      'should handle files without extensions correctly',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        assert.ok(result.includes('test.html'), 'should include test.html')
        assert.strictEqual(result.includes('README'), false)
        assert.strictEqual(result.includes('LICENSE'), false)
        assert.strictEqual(result.includes('docs/markdown'), false)
        assert.strictEqual(result.includes('test.'), false)
      }
    )

    await filePatternTest.test(
      'should handle push event diff correctly',
      async function (t) {
        const result = await getChangedFiles(t.fullName)

        for (const file of ['src/app.js', 'test/test.jsx']) {
          assert.ok(result.includes(file), `should include ${file}`)
        }
      }
    )
  })
})
