import { describe, it, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici'
import type { LinterResponse } from './linter.ts'

describe('linter', function () {
  let lintFiles: typeof import('./linter.ts').lintFiles
  const errorMock = mock.fn()
  const debugMock = mock.fn()

  const fileContents: Record<string, string | Error> = {}

  before(async function () {
    mock.module('fs', {
      namedExports: {
        readFileSync: (path: string) => {
          const content = fileContents[path]
          if (content instanceof Error) {
            throw content
          }
          if (content === undefined) {
            throw new Error(`ENOENT: no such file or directory, open '${path}'`)
          }
          return content
        }
      }
    })

    mock.module('@actions/core', {
      namedExports: {
        debug: debugMock,
        error: errorMock
      }
    })
  })

  const apiKey = 'test-api-key'
  const axeLinterUrl = 'https://test-linter.com'
  const linterConfig = { rules: { 'test-rule': 'error' } }
  const jsonReplyOptions = {
    headers: { 'content-type': 'application/json' }
  }

  function setupMockAgent(t: {
    after: (fn: () => Promise<void> | void) => void
  }) {
    const originalDispatcher = getGlobalDispatcher()
    const agent = new MockAgent()
    agent.disableNetConnect()
    setGlobalDispatcher(agent)

    t.after(async () => {
      await agent.close()
      setGlobalDispatcher(originalDispatcher)
    })

    return agent
  }

  function resetMocks() {
    errorMock.mock.resetCalls()
    debugMock.mock.resetCalls()
    for (const key of Object.keys(fileContents)) {
      delete fileContents[key]
    }
  }

  it('lintFiles', async function (lintFilesTest) {
    ;({ lintFiles } = await import('./linter.ts'))

    await lintFilesTest.test(
      'should process files and return total error count',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['test.js'] = '<div>test</div>'
        fileContents['test.html'] = '<div>test</div>'

        const mockResponses: Record<string, LinterResponse> = {
          'test.js': {
            report: {
              errors: [
                {
                  ruleId: 'test-rule-1',
                  lineNumber: 1,
                  column: 1,
                  endColumn: 10,
                  description: 'Test error 1',
                  helpURL: 'https://test-help-url-1.com'
                }
              ]
            }
          },
          'test.html': {
            report: {
              errors: [
                {
                  ruleId: 'test-rule-2',
                  lineNumber: 1,
                  column: 1,
                  endColumn: 15,
                  description: 'Test error 2',
                  helpURL: 'https://test-help-url-2.com'
                }
              ]
            }
          }
        }

        const pool = mockAgent.get(axeLinterUrl)
        for (const file of ['test.js', 'test.html']) {
          pool
            .intercept({
              method: 'POST',
              path: '/lint-source',
              headers: {
                authorization: apiKey,
                'content-type': 'application/json'
              }
            })
            .reply(200, mockResponses[file], jsonReplyOptions)
        }

        const errorCount = await lintFiles(
          ['test.js', 'test.html'],
          apiKey,
          axeLinterUrl,
          linterConfig
        )

        assert.strictEqual(
          errorCount,
          2,
          'should return correct total error count'
        )
        assert.strictEqual(
          errorMock.mock.calls.length,
          2,
          'should report each error'
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())

        // Verify first error reporting
        assert.strictEqual(
          errorMock.mock.calls[0].arguments[0],
          'test.js:1 - test-rule-1 - Test error 1\nhttps://test-help-url-1.com'
        )
        assert.deepStrictEqual(errorMock.mock.calls[0].arguments[1], {
          file: 'test.js',
          startLine: 1,
          startColumn: 1,
          endColumn: 10,
          title: 'Axe Linter'
        })

        // Verify second error reporting
        assert.strictEqual(
          errorMock.mock.calls[1].arguments[0],
          'test.html:1 - test-rule-2 - Test error 2\nhttps://test-help-url-2.com'
        )
        assert.deepStrictEqual(errorMock.mock.calls[1].arguments[1], {
          file: 'test.html',
          startLine: 1,
          startColumn: 1,
          endColumn: 15,
          title: 'Axe Linter'
        })
      }
    )

    await lintFilesTest.test('should handle a single file', async function (t) {
      resetMocks()
      const mockAgent = setupMockAgent(t)

      fileContents['test.js'] = '<div>test</div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool.intercept({ method: 'POST', path: '/lint-source' }).reply(
        200,
        {
          report: {
            errors: [
              {
                ruleId: 'test-rule-1',
                lineNumber: 1,
                column: 1,
                endColumn: 10,
                description: 'Test error 1',
                helpURL: 'https://test-help-url-1.com'
              }
            ]
          }
        },
        jsonReplyOptions
      )

      const errorCount = await lintFiles(
        ['test.js'],
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.strictEqual(
        errorCount,
        1,
        'should return one error for single file'
      )
      assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
    })

    await lintFilesTest.test('should skip empty files', async function (t) {
      resetMocks()
      const mockAgent = setupMockAgent(t)

      fileContents['empty.js'] = '   '

      const pool = mockAgent.get(axeLinterUrl)
      pool.intercept({ method: 'POST', path: '/lint-source' }).reply(200)

      const errorCount = await lintFiles(
        ['empty.js'],
        apiKey,
        axeLinterUrl,
        linterConfig
      )

      assert.strictEqual(
        errorCount,
        0,
        'should return zero errors for empty files'
      )
      assert.strictEqual(
        debugMock.mock.calls.some(
          (call: { arguments: string[] }) =>
            call.arguments[0] === 'Skipping empty file empty.js'
        ),
        true,
        'should log debug message'
      )
      assert.throws(() => mockAgent.assertNoPendingInterceptors())
    })

    await lintFilesTest.test(
      'should handle linter API errors',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['error.js'] = '<div><h1>hello world</h1></div>'

        const pool = mockAgent.get(axeLinterUrl)
        pool
          .intercept({ method: 'POST', path: '/lint-source' })
          .reply(200, { error: 'API Error' }, jsonReplyOptions)

        await assert.rejects(
          () => lintFiles(['error.js'], apiKey, axeLinterUrl, linterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            assert.strictEqual(err.message, 'API Error')
            return true
          }
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
      }
    )

    await lintFilesTest.test(
      'should handle file read errors',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['nonexistent.js'] = new Error('ENOENT')

        const pool = mockAgent.get(axeLinterUrl)
        pool.intercept({ method: 'POST', path: '/lint-source' }).reply(200)

        await assert.rejects(
          () =>
            lintFiles(['nonexistent.js'], apiKey, axeLinterUrl, linterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            assert.strictEqual(err.message, 'ENOENT')
            return true
          }
        )
        assert.throws(() => mockAgent.assertNoPendingInterceptors())
      }
    )

    await lintFilesTest.test(
      'should handle network errors',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['test.js'] = '<div><h1>hello world</h1></div>'

        const pool = mockAgent.get(axeLinterUrl)
        pool
          .intercept({ method: 'POST', path: '/lint-source' })
          .replyWithError(new Error('Network Error'))

        await assert.rejects(
          () => lintFiles(['test.js'], apiKey, axeLinterUrl, linterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            assert.ok(err.message.includes('fetch failed'))
            assert.strictEqual((err.cause as Error)?.message, 'Network Error')
            return true
          }
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
      }
    )

    await lintFilesTest.test('should handle HTTP errors', async function (t) {
      resetMocks()
      const mockAgent = setupMockAgent(t)

      fileContents['test.js'] = '<div><h1>hello world</h1></div>'

      const pool = mockAgent.get(axeLinterUrl)
      pool
        .intercept({ method: 'POST', path: '/lint-source' })
        .reply(500, 'Internal Server Error')

      await assert.rejects(
        () => lintFiles(['test.js'], apiKey, axeLinterUrl, linterConfig),
        (err: Error) => {
          assert.ok(err instanceof Error)
          return true
        }
      )
      assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
    })

    await lintFilesTest.test(
      'should handle malformed API responses',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['test.js'] = '<div><h1>hello world</h1></div>'

        const pool = mockAgent.get(axeLinterUrl)
        pool
          .intercept({ method: 'POST', path: '/lint-source' })
          .reply(200, { report: 'invalid-format' }, jsonReplyOptions)

        await assert.rejects(
          () => lintFiles(['test.js'], apiKey, axeLinterUrl, linterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            return true
          }
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
      }
    )

    await lintFilesTest.test(
      'should rethrow non-Error objects',
      async function (t) {
        resetMocks()

        fileContents['test.js'] = '<div><h1>hello world</h1></div>'

        const nonErrorObject = {
          type: 'CustomError',
          details: 'Something went wrong',
          statusCode: 500
        }

        const fetchMock = mock.method(globalThis, 'fetch', () =>
          Promise.reject(nonErrorObject)
        )
        t.after(() => fetchMock.mock.restore())

        try {
          await lintFiles(['test.js'], apiKey, axeLinterUrl, linterConfig)
          assert.fail('Should have thrown an error')
        } catch (error) {
          assert.strictEqual(
            error instanceof Error,
            false,
            'Error should not be an Error instance'
          )
          assert.deepStrictEqual(
            error,
            nonErrorObject,
            'Should be the original non-Error object'
          )
          assert.strictEqual(
            error.type,
            'CustomError',
            'Should preserve custom properties'
          )
          assert.strictEqual(
            error.details,
            'Something went wrong',
            'Should preserve error details'
          )
          assert.strictEqual(
            error.statusCode,
            500,
            'Should preserve status code'
          )
        }
      }
    )

    await lintFilesTest.test(
      'should handle invalid linter config errors from server',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['test.js'] = 'const x = 1;'

        const invalidLinterConfig = {
          rules: { 'invalid-rule': 'invalid-value' }
        }

        const pool = mockAgent.get(axeLinterUrl)
        pool
          .intercept({
            method: 'POST',
            path: '/lint-source',
            headers: {
              authorization: apiKey,
              'content-type': 'application/json'
            }
          })
          .replyWithError(new Error('Invalid config'))

        await assert.rejects(
          () =>
            lintFiles(['test.js'], apiKey, axeLinterUrl, invalidLinterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            assert.ok(err.message.includes('fetch failed'))
            assert.strictEqual((err.cause as Error)?.message, 'Invalid config')
            return true
          }
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
      }
    )

    await lintFilesTest.test(
      'should throw on invalid content type',
      async function (t) {
        resetMocks()
        const mockAgent = setupMockAgent(t)

        fileContents['test.js'] = '<div>hello</div>'

        const pool = mockAgent.get(axeLinterUrl)
        pool
          .intercept({ method: 'POST', path: '/lint-source' })
          .reply(200, 'not json', { headers: { 'content-type': 'text/plain' } })

        await assert.rejects(
          () => lintFiles(['test.js'], apiKey, axeLinterUrl, linterConfig),
          (err: Error) => {
            assert.ok(err instanceof Error)
            assert.strictEqual(err.message, 'Invalid content type')
            return true
          }
        )
        assert.doesNotThrow(() => mockAgent.assertNoPendingInterceptors())
      }
    )
  })
})
