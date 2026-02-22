import { describe, it, before, mock } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'

describe('run', function () {
  let run: typeof import('./run.ts').default

  const getInputMock =
    mock.fn<(name: string, opts?: Record<string, unknown>) => string>()
  const setFailedMock = mock.fn<(msg: string) => void>()
  const debugMock = mock.fn<(msg: string) => void>()
  const getChangedFilesMock = mock.fn<(token: string) => Promise<string[]>>()
  const lintFilesMock =
    mock.fn<
      (
        files: string[],
        apiKey: string,
        url: string,
        config: Record<string, unknown>
      ) => Promise<number>
    >()

  const fileContents: Record<string, string | Error | { throw: unknown }> = {}

  before(async function () {
    mock.module('fs', {
      namedExports: {
        readFileSync: (path: string) => {
          const content = fileContents[path]
          if (
            content !== null &&
            typeof content === 'object' &&
            'throw' in content
          ) {
            throw content.throw
          }
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
        getInput: getInputMock,
        setFailed: setFailedMock,
        debug: debugMock
      }
    })

    mock.module('./git.ts', {
      namedExports: {
        getChangedFiles: getChangedFilesMock
      }
    })

    mock.module('./linter.ts', {
      namedExports: {
        lintFiles: lintFilesMock
      }
    })
  })

  function resetMocks() {
    getInputMock.mock.resetCalls()
    setFailedMock.mock.resetCalls()
    debugMock.mock.resetCalls()
    getChangedFilesMock.mock.resetCalls()
    lintFilesMock.mock.resetCalls()
    for (const key of Object.keys(fileContents)) {
      delete fileContents[key]
    }
  }

  function setupInputs(options: {
    githubToken?: string | Error
    apiKey?: string | Error
    axeLinterUrl?: string
  }) {
    const {
      githubToken = 'test-token',
      apiKey = 'test-api-key',
      axeLinterUrl = 'https://test-linter.com'
    } = options

    getInputMock.mock.mockImplementation((name) => {
      switch (name) {
        case 'github_token':
          if (githubToken instanceof Error) throw githubToken
          return githubToken
        case 'api_key':
          if (apiKey instanceof Error) throw apiKey
          return apiKey
        case 'axe_linter_url':
          return axeLinterUrl
        default:
          throw new Error(`Unexpected input: ${name}`)
      }
    })
  }

  it('run', async function (runTest) {
    ;({ default: run } = await import('./run.ts'))

    await runTest.test(
      'should process files successfully with no errors',
      async function () {
        resetMocks()
        setupInputs({ axeLinterUrl: 'https://test-linter.com/' })

        getChangedFilesMock.mock.mockImplementation(async () => [
          'test.js',
          'test.html'
        ])

        const mockConfig = { rules: { 'test-rule': 'error' } }
        fileContents['axe-linter.yml'] = stringify(mockConfig)

        lintFilesMock.mock.mockImplementation(async () => 0)

        await run()

        // Verify getInput was called for each input
        const getInputCalls = getInputMock.mock.calls.map((c) => c.arguments[0])
        assert.ok(getInputCalls.includes('github_token'))
        assert.ok(getInputCalls.includes('api_key'))
        assert.ok(getInputCalls.includes('axe_linter_url'))

        // Verify getChangedFiles was called with the token
        assert.strictEqual(getChangedFilesMock.mock.calls.length, 1)
        assert.strictEqual(
          getChangedFilesMock.mock.calls[0].arguments[0],
          'test-token'
        )

        // Verify lintFiles was called with trailing slash removed
        assert.strictEqual(lintFilesMock.mock.calls.length, 1)
        assert.deepStrictEqual(lintFilesMock.mock.calls[0].arguments[0], [
          'test.js',
          'test.html'
        ])
        assert.strictEqual(
          lintFilesMock.mock.calls[0].arguments[1],
          'test-api-key'
        )
        assert.strictEqual(
          lintFilesMock.mock.calls[0].arguments[2],
          'https://test-linter.com'
        )
        assert.deepStrictEqual(
          lintFilesMock.mock.calls[0].arguments[3],
          mockConfig
        )

        // Verify no errors were reported
        assert.strictEqual(setFailedMock.mock.calls.length, 0)
      }
    )

    await runTest.test('should handle no changed files', async function () {
      resetMocks()
      setupInputs({})

      getChangedFilesMock.mock.mockImplementation(async () => [])

      await run()

      assert.strictEqual(
        debugMock.mock.calls.some(
          (call: { arguments: string[] }) =>
            call.arguments[0] === 'No files to lint'
        ),
        true,
        'Should log debug message for no files'
      )
      assert.strictEqual(
        lintFilesMock.mock.calls.length,
        0,
        'Linter should not be called'
      )
      assert.strictEqual(
        setFailedMock.mock.calls.length,
        0,
        'Should not set failed status'
      )
    })

    await runTest.test('should handle missing config file', async function () {
      resetMocks()
      setupInputs({ axeLinterUrl: '' })

      getChangedFilesMock.mock.mockImplementation(async () => ['test.js'])
      lintFilesMock.mock.mockImplementation(async () => 0)

      // Config file throws ENOENT
      fileContents['axe-linter.yml'] = new Error('ENOENT')

      await run()

      // Verify debug message for missing config
      assert.strictEqual(
        debugMock.mock.calls.some(
          (call: { arguments: string[] }) =>
            call.arguments[0] ===
            'Error loading axe-linter.yml no config found or invalid config: ENOENT'
        ),
        true,
        'Should log correct debug message for missing config'
      )

      // Verify linter was called with empty config
      assert.strictEqual(lintFilesMock.mock.calls.length, 1)
      assert.deepStrictEqual(lintFilesMock.mock.calls[0].arguments[0], [
        'test.js'
      ])
      assert.strictEqual(
        lintFilesMock.mock.calls[0].arguments[1],
        'test-api-key'
      )
      assert.strictEqual(lintFilesMock.mock.calls[0].arguments[2], '')
      assert.deepStrictEqual(lintFilesMock.mock.calls[0].arguments[3], {})

      // Verify setFailed was not called
      assert.strictEqual(setFailedMock.mock.calls.length, 0)
    })

    await runTest.test(
      'should handle non-Error config loading error',
      async function () {
        resetMocks()
        setupInputs({})

        getChangedFilesMock.mock.mockImplementation(async () => ['test.js'])
        lintFilesMock.mock.mockImplementation(async () => 0)

        // Throw a non-Error value from readFileSync
        fileContents['axe-linter.yml'] = { throw: 'string-error' }

        await run()

        assert.strictEqual(
          debugMock.mock.calls.some(
            (call: { arguments: string[] }) =>
              call.arguments[0] ===
              'Error loading axe-linter.yml no config found or invalid config: string-error'
          ),
          true,
          'Should log debug message with non-Error value'
        )

        // Verify linter was still called with empty config
        assert.strictEqual(lintFilesMock.mock.calls.length, 1)
        assert.deepStrictEqual(lintFilesMock.mock.calls[0].arguments[3], {})
        assert.strictEqual(setFailedMock.mock.calls.length, 0)
      }
    )

    await runTest.test('should handle linter errors', async function () {
      resetMocks()
      setupInputs({})

      getChangedFilesMock.mock.mockImplementation(async () => ['test.js'])
      fileContents['axe-linter.yml'] = 'rules:\n  test-rule: error'
      lintFilesMock.mock.mockImplementation(async () => 2)

      await run()

      assert.strictEqual(setFailedMock.mock.calls.length, 1)
      assert.strictEqual(
        setFailedMock.mock.calls[0].arguments[0],
        'Found 2 accessibility issues'
      )
    })

    await runTest.test('should handle single linter error', async function () {
      resetMocks()
      setupInputs({})

      getChangedFilesMock.mock.mockImplementation(async () => ['test.js'])
      fileContents['axe-linter.yml'] = 'rules:\n  test-rule: error'
      lintFilesMock.mock.mockImplementation(async () => 1)

      await run()

      assert.strictEqual(setFailedMock.mock.calls.length, 1)
      assert.strictEqual(
        setFailedMock.mock.calls[0].arguments[0],
        'Found 1 accessibility issue'
      )
    })

    await runTest.test(
      'should handle missing required inputs',
      async function () {
        resetMocks()
        setupInputs({
          githubToken: new Error(
            'Input required and not supplied: github_token'
          )
        })

        await run()

        assert.strictEqual(setFailedMock.mock.calls.length, 1)
        assert.strictEqual(
          setFailedMock.mock.calls[0].arguments[0],
          'Input required and not supplied: github_token'
        )
      }
    )

    await runTest.test('should handle git error', async function () {
      resetMocks()
      setupInputs({})

      getChangedFilesMock.mock.mockImplementation(async () => {
        throw new Error('Git error')
      })

      await run()

      assert.strictEqual(setFailedMock.mock.calls.length, 1)
      assert.strictEqual(setFailedMock.mock.calls[0].arguments[0], 'Git error')
    })

    await runTest.test('should handle non-Error exceptions', async function () {
      resetMocks()
      setupInputs({ axeLinterUrl: '' })

      getChangedFilesMock.mock.mockImplementation(async () => {
        throw { foo: 'bar' }
      })

      await run()

      assert.strictEqual(setFailedMock.mock.calls.length, 1)
      assert.strictEqual(
        setFailedMock.mock.calls[0].arguments[0],
        'An unexpected error occurred: {"foo":"bar"}'
      )
    })
  })
})
