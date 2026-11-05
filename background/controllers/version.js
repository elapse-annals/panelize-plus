/**
 * Owns version behavior and its page-local state.
 * Deferred controller getters keep composition in the entry point.
 */


export function createVersionController() {
  // Handle version check by fetching latest commit from GitHub API
  async function handleFetchLatestCommit() {
    try {
      const GITHUB_API_URL = 'https://api.github.com/repos/elapse-annals/panelize-plus/commits/master';

      const response = await fetch(GITHUB_API_URL, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        success: true,
        data: {
          sha: data.sha,
          shortSha: data.sha.substring(0, 7),
          date: data.commit.committer.date,
          message: data.commit.message
        }
      };
    } catch (error) {
      console.error('[Background] Error fetching latest commit:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  return {
    handleFetchLatestCommit,
  };
}
