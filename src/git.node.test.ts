import {describe, it, before, beforeEach, mock} from 'node:test'
import assert from 'node:assert/strict'
import type {context} from '@actions/github'

describe('git', function() {
  let getChangedFiles: typeof import('./git.ts').getChangedFiles;
  const debugMock = mock.fn();
  const mockContext: Partial<typeof context> = {
      repo: {
        owner: 'dequelabs-test',
        repo: 'i-really-do-not-exist'
      },
      payload: {
        before: 'base-sha',
        after: 'head-sha',
      }
    };

  const getOctokit = (token: string) => {
    return {
      rest: {
        pulls: {
          listFiles: async ({ owner, repo, pull_number }: { owner: string; repo: string; pull_number: number }) => {
            assert.strictEqual(owner, 'dequelabs-test', 'Owner should match context')
            assert.strictEqual(repo, 'i-really-do-not-exist', 'Repo should match context')

            switch (token) {
              case 'git > getChangedFiles > should handle pull request files':
                assert.strictEqual(pull_number, 123, 'Pull number should match context')
                return {
                  data: [
                    { filename: 'test.js', status: 'added' },
                    { filename: 'test.md', status: 'added' },
                    { filename: 'test.css', status: 'added' }, // Should be filtered out
                    { filename: 'test.tsx', status: 'added' }
                  ]
                }
              default:
                assert.fail(`Unexpected test token for a pull request: ${token}`)
            }
          }
        }
      }
    }
  };

  before(async function() {
    mock.module('@actions/github', {
      namedExports: {
        context: mockContext,
        getOctokit,
      }
    });

    mock.module('@actions/core', {
      namedExports: {
        debug: debugMock,
      }
    });
  });

  beforeEach(function() {
    mockContext.payload = {
      before: 'base-sha',
      after: 'head-sha',
    };
  });

  it('getChangedFiles', async function(getChangedFilesTest) {
    await getChangedFilesTest.test('should handle pull request files', async function(handlePrTest) {
      mockContext.payload!.pull_request = { number: 123 };

      ({getChangedFiles} = await import('./git.ts'))

      const result = await getChangedFiles(handlePrTest.fullName)

      assert.deepStrictEqual(
        result,
        ['test.js', 'test.md', 'test.tsx'],
        'should return correct filtered files'
      )
    });
  });
});
