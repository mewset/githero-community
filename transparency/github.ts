/**
 * GitHero - GitHub Data Access Layer
 *
 * TRANSPARENCY NOTICE
 * ===================
 * This file is intentionally over-commented for transparency purposes.
 * Every function documents exactly what GitHub data it reads and how.
 *
 * GitHero operates on a STRICT READ-ONLY basis:
 *   - We ONLY use GitHub's REST API (GET requests) and GraphQL API (queries),
 *     pinned to API version 2026-03-10 via X-GitHub-Api-Version header.
 *   - We NEVER perform mutations, writes, or modifications to any user data.
 *   - We NEVER create, update, or delete repositories, issues, PRs, or any other resource.
 *   - We NEVER store raw GitHub API responses. Data is processed into aggregated
 *     stats (counts, streaks, timestamps) before being stored in our database.
 *
 * The GitHub OAuth scopes we request are limited to read-only access.
 * All API calls in this file are transparent and auditable.
 */

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  location: string | null;
  company: string | null;
  blog: string | null;
  twitter_username: string | null;
  hireable: boolean | null;
  created_at: string;
  public_gists: number;
  email: string | null;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  owner: { login: string };
  fork: boolean;
  topics: string[];
  watchers_count: number;
  license: { key: string; name: string } | null;
  description: string | null;
  created_at: string;
  pushed_at: string;
  has_wiki: boolean;
}

interface ContributionDay {
  date: string;
  contributionCount: number;
}

interface CommitWithTimestamp {
  date: string;
  hour: number;
}

interface CommitTimestampResult {
  commits: CommitWithTimestamp[];
}

interface GitHubCommitDetail {
  sha: string;
  commit: {
    message: string;
    author: {
      date: string;
    };
    verification?: {
      verified: boolean;
    };
  };
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{ filename: string }>;
}

interface GitHubPRDetail {
  number: number;
  title: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  closed_at: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  comments: number;
  review_comments: number;
  commits: number;
  head: {
    repo: {
      full_name: string;
    } | null;
  };
  base: {
    repo: {
      full_name: string;
    };
  };
}

interface GitHubSearchPRItem {
  number: number;
  title: string;
  state: string;
  created_at: string;
  closed_at: string | null;
  pull_request: {
    merged_at: string | null;
  };
  repository_url: string;
}

export interface GitHubIssueDetail {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  comments: number;
  reactions: { total_count: number };
  created_at: string;
  closed_at: string | null;
  repository_url: string;
}

interface GitHubSearchIssueItem {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  comments: number;
  reactions?: { total_count: number };
  created_at: string;
  closed_at: string | null;
  repository_url: string;
}

export interface GitHubReviewDetail {
  id: number;
  user: { login: string };
  body: string | null;
  state: string;
  submitted_at: string;
  pull_request_url: string;
}

interface GitHubReviewWithReactions {
  id: string;
  state: string;
  body: string | null;
  submittedAt: string;
  reactionGroups: Array<{ content: string; users: { totalCount: number } }>;
  comments: { totalCount: number };
  pullRequest: {
    number: number;
    repository: { nameWithOwner: string };
  };
}

interface ContributionWeek {
  contributionDays: ContributionDay[];
}

interface ContributionsCollection {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  contributionCalendar: {
    totalContributions: number;
    weeks: ContributionWeek[];
  };
}

export class GitHubService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Internal helper: Performs a READ-ONLY GET request to the GitHub REST API.
   *
   * READS: Whatever the specified endpoint returns (always via HTTP GET).
   * WRITES: Nothing. This method only issues GET requests.
   *
   * Used by all REST-based methods in this class to fetch data from GitHub.
   */
  private async fetchREST<T>(endpoint: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/vnd.github.v3+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };

    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers,
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        const retryAfter = response.headers.get("Retry-After") || "60";
        const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");

        if (response.status === 403 && rateLimitRemaining !== "0") {
          throw new Error(`GitHub API forbidden: ${response.status}`);
        }

        throw new Error(
          `GitHub API rate limited. Retry after ${retryAfter} seconds.`
        );
      }

      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Internal helper: Performs a READ-ONLY query to the GitHub GraphQL API.
   *
   * READS: Whatever the specified GraphQL query requests.
   * WRITES: Nothing. This method only sends GraphQL queries, never mutations.
   *
   * Although GraphQL uses HTTP POST, this is only for sending the query payload.
   * No mutations are ever constructed or sent through this method.
   */
  private async fetchGraphQL<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
    });

    if (!response.ok) {
      if (response.status === 429 || response.status === 403) {
        const retryAfter = response.headers.get("Retry-After") || "60";
        const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");

        if (response.status === 403 && rateLimitRemaining !== "0") {
          throw new Error(`GitHub GraphQL forbidden: ${response.status}`);
        }

        throw new Error(
          `GitHub API rate limited. Retry after ${retryAfter} seconds.`
        );
      }

      throw new Error(`GitHub GraphQL error: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  }

  /**
   * Fetches the authenticated user's basic profile information.
   *
   * READS: Public profile data (username, display name, avatar URL, bio,
   *        location, company, website, Twitter handle, email, account
   *        creation date, public repo/gist/follower/following counts).
   * WRITES: Nothing.
   *
   * GitHub API: GET /user
   */
  async getUser(): Promise<GitHubUser> {
    return this.fetchREST<GitHubUser>("/user");
  }

  /**
   * Fetches all repositories accessible to the authenticated user.
   * Paginates through all pages to get a complete list.
   *
   * READS: Repository metadata for each repo (name, description, language,
   *        star/fork/watcher counts, topics, license, visibility, fork status,
   *        creation date, last push date).
   * WRITES: Nothing.
   *
   * GitHub API: GET /user/repos (paginated, 100 per page)
   */
  async getRepos(): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const pageRepos = await this.fetchREST<GitHubRepo[]>(
        `/user/repos?per_page=${perPage}&page=${page}&type=all`
      );
      repos.push(...pageRepos);

      if (pageRepos.length < perPage) break;
      page++;
    }

    return repos;
  }

  /**
   * Fetches the user's contribution activity for the last year via GraphQL.
   *
   * READS: Aggregated contribution counts (total commits, total PRs,
   *        total PR reviews) and the contribution calendar (daily
   *        contribution counts for each day of the year).
   * WRITES: Nothing.
   *
   * GitHub API: GraphQL query on user.contributionsCollection
   */
  async getContributions(
    username: string
  ): Promise<ContributionsCollection | null> {
    const query = `
      query {
        user(login: "${username}") {
          contributionsCollection {
            totalCommitContributions
            totalPullRequestContributions
            totalPullRequestReviewContributions
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  date
                  contributionCount
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.fetchGraphQL<{
        user: { contributionsCollection: ContributionsCollection } | null;
      }>(query);
      return data.user?.contributionsCollection || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches the total and merged pull request counts for a user.
   *
   * READS: Two aggregated counts only: total number of PRs authored by the
   *        user, and total number of merged PRs authored by the user.
   *        No PR content, titles, or details are fetched.
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (with per_page=1 for count only)
   */
  async getPullRequests(
    username: string
  ): Promise<{ total: number; merged: number }> {
    const query = `author:${username} type:pr`;
    const response = await this.fetchREST<{ total_count: number }>(
      `/search/issues?q=${encodeURIComponent(query)}&per_page=1`
    );

    const mergedQuery = `author:${username} type:pr is:merged`;
    const mergedResponse = await this.fetchREST<{ total_count: number }>(
      `/search/issues?q=${encodeURIComponent(mergedQuery)}&per_page=1`
    );

    return {
      total: response.total_count,
      merged: mergedResponse.total_count,
    };
  }

  /**
   * Fetches commit timestamps for the last year to enable time-based
   * achievements (e.g. "Night Owl", "Early Bird" badges).
   *
   * READS: Date and hour of each commit contribution across up to 100
   *        repositories for the last year. Only the timestamp is extracted,
   *        not the commit message, diff, or any code content.
   * WRITES: Nothing.
   *
   * GitHub API: GraphQL query on user.contributionsCollection.commitContributionsByRepository
   */
  async getCommitTimestamps(username: string): Promise<CommitTimestampResult> {
    const commits: CommitWithTimestamp[] = [];

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const fromDate = oneYearAgo.toISOString();

    const query = `
      query {
        user(login: "${username}") {
          contributionsCollection(from: "${fromDate}") {
            commitContributionsByRepository(maxRepositories: 100) {
              repository {
                name
                owner {
                  login
                }
              }
              contributions(first: 100) {
                nodes {
                  occurredAt
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.fetchGraphQL<{
        user: {
          contributionsCollection: {
            commitContributionsByRepository: Array<{
              repository: { name: string; owner: { login: string } };
              contributions: { nodes: Array<{ occurredAt: string }> };
            }>;
          };
        } | null;
      }>(query);

      if (data.user?.contributionsCollection?.commitContributionsByRepository) {
        for (const repo of data.user.contributionsCollection.commitContributionsByRepository) {
          for (const contribution of repo.contributions.nodes) {
            const timestamp = new Date(contribution.occurredAt);
            commits.push({
              date: timestamp.toISOString().split('T')[0],
              hour: timestamp.getUTCHours(),
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch commit timestamps:', error);
    }

    return { commits };
  }

  /**
   * Fetches detailed information about a single commit.
   *
   * READS: Commit message, author date, verification status, and diff
   *        statistics (lines added/deleted/total) and list of changed
   *        filenames. No actual file content or diffs are fetched.
   * WRITES: Nothing.
   *
   * GitHub API: GET /repos/{owner}/{repo}/commits/{sha}
   */
  async getCommitDetails(
    owner: string,
    repo: string,
    sha: string
  ): Promise<GitHubCommitDetail | null> {
    try {
      return await this.fetchREST<GitHubCommitDetail>(
        `/repos/${owner}/${repo}/commits/${sha}`
      );
    } catch {
      return null;
    }
  }

  /**
   * Fetches recent commits from a specific repository for a given author,
   * including line-change statistics for each commit.
   *
   * READS: List of commits by the specified author in the repo, then for
   *        each commit: message, date, verification status, lines added/
   *        deleted, and changed filenames. Fetched in batches of 10.
   *        No actual code content or diffs are read.
   * WRITES: Nothing.
   *
   * GitHub API: GET /repos/{owner}/{repo}/commits (paginated)
   *             + GET /repos/{owner}/{repo}/commits/{sha} per commit
   */
  async getRepoCommitsWithStats(
    owner: string,
    repo: string,
    author: string,
    limit: number = 100
  ): Promise<GitHubCommitDetail[]> {
    const commits: GitHubCommitDetail[] = [];
    let page = 1;
    const perPage = Math.min(limit, 100);

    try {
      while (commits.length < limit) {
        const pageCommits = await this.fetchREST<GitHubCommitDetail[]>(
          `/repos/${owner}/${repo}/commits?author=${author}&per_page=${perPage}&page=${page}`
        );

        if (pageCommits.length === 0) break;

        const commitsToFetch = pageCommits.slice(0, limit - commits.length);
        const BATCH_SIZE = 10;

        for (let i = 0; i < commitsToFetch.length; i += BATCH_SIZE) {
          const batch = commitsToFetch.slice(i, i + BATCH_SIZE);
          const detailedBatch = await Promise.all(
            batch.map(commit => this.getCommitDetails(owner, repo, commit.sha))
          );
          commits.push(...detailedBatch.filter((d): d is GitHubCommitDetail => d !== null));
        }

        if (pageCommits.length < perPage) break;
        page++;
      }
    } catch (error) {
      console.error(`Failed to fetch commits for ${owner}/${repo}:`, error);
    }

    return commits;
  }

  /**
   * Fetches detailed pull request information for a user's most recent PRs.
   *
   * READS: For each PR: title, state, creation/merge/close dates, lines
   *        added/deleted, number of changed files, comment counts, commit
   *        count, and source/target repository names. No PR body content,
   *        review comments, or code diffs are fetched.
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (to find user's PRs)
   *             + GET /repos/{owner}/{repo}/pulls/{number} per PR
   */
  async getUserPRsDetailed(
    username: string,
    limit: number = 50
  ): Promise<GitHubPRDetail[]> {
    const prs: GitHubPRDetail[] = [];

    try {
      const searchQuery = `author:${username} type:pr`;
      const searchResults = await this.fetchREST<{
        total_count: number;
        items: GitHubSearchPRItem[];
      }>(`/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=${Math.min(limit, 100)}&sort=created&order=desc`);

      const prItems = searchResults.items.slice(0, limit).map(item => {
        const repoMatch = item.repository_url.match(/repos\/([^/]+)\/([^/]+)$/);
        if (!repoMatch) return null;
        return { owner: repoMatch[1], repo: repoMatch[2], number: item.number };
      }).filter((item): item is { owner: string; repo: string; number: number } => item !== null);

      const BATCH_SIZE = 10;
      for (let i = 0; i < prItems.length; i += BATCH_SIZE) {
        const batch = prItems.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(item =>
            this.fetchREST<GitHubPRDetail>(`/repos/${item.owner}/${item.repo}/pulls/${item.number}`)
          )
        );
        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            prs.push(result.value);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to fetch PRs for ${username}:`, error);
    }

    return prs;
  }

  /**
   * Calculates the time in minutes between PR creation and merge.
   * Pure utility function, no API calls.
   *
   * READS: Nothing from GitHub. Operates on already-fetched date strings.
   * WRITES: Nothing.
   */
  static calculateMergeTimeMinutes(
    createdAt: string,
    mergedAt: string | null
  ): number | null {
    if (!mergedAt) return null;
    const created = new Date(createdAt).getTime();
    const merged = new Date(mergedAt).getTime();
    return Math.round((merged - created) / (1000 * 60));
  }

  /**
   * Fetches issues created by a user, sorted by creation date (newest first).
   *
   * READS: Issue metadata: number, title, state, author, comment count,
   *        reaction count, creation/close dates, and repository URL.
   *        No issue body content is fetched.
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (filtered to type:issue, author:{username})
   */
  async getUserIssuesCreated(
    username: string,
    limit: number = 100
  ): Promise<GitHubSearchIssueItem[]> {
    const issues: GitHubSearchIssueItem[] = [];

    try {
      const searchQuery = `author:${username} type:issue`;
      const searchResults = await this.fetchREST<{
        total_count: number;
        items: GitHubSearchIssueItem[];
      }>(
        `/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=${Math.min(limit, 100)}&sort=created&order=desc`
      );

      issues.push(...searchResults.items.slice(0, limit));
    } catch (error) {
      console.error(`Failed to fetch issues created by ${username}:`, error);
    }

    return issues;
  }

  /**
   * Fetches aggregated issue counts for a user: how many they opened
   * and how many of those were closed.
   *
   * READS: Two aggregated counts only: total issues authored by the user,
   *        and total closed issues authored by the user. No issue content
   *        or details are fetched (per_page=1 for count only).
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (two queries, per_page=1 for count only)
   */
  async getUserIssuesClosed(
    username: string
  ): Promise<{ opened: number; closed: number }> {
    try {
      const openedQuery = `author:${username} type:issue`;
      const openedResults = await this.fetchREST<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(openedQuery)}&per_page=1`
      );

      const closedQuery = `author:${username} type:issue is:closed`;
      const closedResults = await this.fetchREST<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(closedQuery)}&per_page=1`
      );

      return {
        opened: openedResults.total_count,
        closed: closedResults.total_count,
      };
    } catch (error) {
      console.error(`Failed to fetch issue counts for ${username}:`, error);
      return { opened: 0, closed: 0 };
    }
  }

  /**
   * Fetches code reviews submitted by a user, including reaction data,
   * using the GraphQL API for richer detail.
   *
   * READS: For each review: review ID, state (approved/changes requested/etc),
   *        body text, submission date, reaction counts grouped by type,
   *        comment count, and the associated PR number and repository name.
   * WRITES: Nothing.
   *
   * GitHub API: GraphQL query on user.contributionsCollection.pullRequestReviewContributions
   */
  async getUserReviewsWithReactions(
    username: string,
    limit: number = 50
  ): Promise<GitHubReviewWithReactions[]> {
    const reviews: GitHubReviewWithReactions[] = [];

    const query = `
      query($username: String!, $first: Int!) {
        user(login: $username) {
          contributionsCollection {
            pullRequestReviewContributions(first: $first) {
              nodes {
                pullRequestReview {
                  id
                  state
                  body
                  submittedAt
                  reactionGroups {
                    content
                    users {
                      totalCount
                    }
                  }
                  comments {
                    totalCount
                  }
                  pullRequest {
                    number
                    repository {
                      nameWithOwner
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    try {
      const data = await this.fetchGraphQL<{
        user: {
          contributionsCollection: {
            pullRequestReviewContributions: {
              nodes: Array<{ pullRequestReview: GitHubReviewWithReactions | null }>;
            };
          };
        } | null;
      }>(query, { username, first: Math.min(limit, 100) });

      const contributions =
        data.user?.contributionsCollection?.pullRequestReviewContributions
          ?.nodes || [];

      for (const contribution of contributions) {
        if (contribution.pullRequestReview) {
          reviews.push(contribution.pullRequestReview);
        }
      }
    } catch (error) {
      console.error(`Failed to fetch reviews for ${username}:`, error);
    }

    return reviews;
  }

  /**
   * Fetches aggregated code review counts for a user: total reviews
   * and estimated approvals.
   *
   * READS: Total count of PRs reviewed by the user (via search API,
   *        per_page=1 for count only). Approval count is estimated
   *        at 70% of total since the search API cannot filter by
   *        review state. No review content is fetched.
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (filtered to reviewed-by:{username})
   */
  async getUserReviewCounts(
    username: string
  ): Promise<{ total: number; approved: number }> {
    try {
      const reviewQuery = `reviewed-by:${username} type:pr`;
      const reviewResults = await this.fetchREST<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(reviewQuery)}&per_page=1`
      );

      return {
        total: reviewResults.total_count,
        approved: Math.round(reviewResults.total_count * 0.7),
      };
    } catch (error) {
      console.error(`Failed to fetch review counts for ${username}:`, error);
      return { total: 0, approved: 0 };
    }
  }

  /**
   * Fetches the count of merged PRs a user has contributed to specific
   * open-source projects. Used for OSS contribution achievements.
   *
   * READS: For each specified project: the count of merged PRs authored
   *        by the user. Projects are batched (5 per query) for efficiency.
   *        Only counts are extracted, no PR content or details.
   * WRITES: Nothing.
   *
   * GitHub API: GET /search/issues (filtered to author:{username} type:pr
   *             is:merged repo:{owner}/{repo})
   */
  async getOSSContributions(
    username: string,
    projects: Array<{ owner: string; repo: string }>
  ): Promise<Map<string, number>> {
    const contributions = new Map<string, number>();

    for (const project of projects) {
      const key = `${project.owner}/${project.repo}`.toLowerCase();
      contributions.set(key, 0);
    }

    const BATCH_SIZE = 5;

    for (let i = 0; i < projects.length; i += BATCH_SIZE) {
      const batch = projects.slice(i, i + BATCH_SIZE);

      try {
        const repoFilters = batch
          .map((p) => `repo:${p.owner}/${p.repo}`)
          .join(" ");
        const searchQuery = `author:${username} type:pr is:merged ${repoFilters}`;

        const searchResults = await this.fetchREST<{
          total_count: number;
          items: Array<{
            repository_url: string;
            number: number;
          }>;
        }>(
          `/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=100`
        );

        for (const item of searchResults.items) {
          const repoMatch = item.repository_url.match(
            /repos\/([^/]+)\/([^/]+)$/
          );
          if (repoMatch) {
            const [, owner, repo] = repoMatch;
            const key = `${owner}/${repo}`.toLowerCase();
            const current = contributions.get(key) || 0;
            contributions.set(key, current + 1);
          }
        }

        if (searchResults.total_count > 100) {
          for (const project of batch) {
            const key = `${project.owner}/${project.repo}`.toLowerCase();
            const singleQuery = `author:${username} type:pr is:merged repo:${project.owner}/${project.repo}`;
            const singleResults = await this.fetchREST<{ total_count: number }>(
              `/search/issues?q=${encodeURIComponent(singleQuery)}&per_page=1`
            );
            contributions.set(key, singleResults.total_count);
          }
        }
      } catch (error) {
        console.error(
          `Failed to fetch OSS contributions for batch ${i}:`,
          error
        );
        for (const project of batch) {
          try {
            const key = `${project.owner}/${project.repo}`.toLowerCase();
            const singleQuery = `author:${username} type:pr is:merged repo:${project.owner}/${project.repo}`;
            const singleResults = await this.fetchREST<{ total_count: number }>(
              `/search/issues?q=${encodeURIComponent(singleQuery)}&per_page=1`
            );
            contributions.set(key, singleResults.total_count);
          } catch {
            // Keep 0 for failed projects
          }
        }
      }
    }

    return contributions;
  }

  /**
   * Calculates the current and longest contribution streaks from
   * the contribution calendar data. Pure utility function, no API calls.
   *
   * READS: Nothing from GitHub. Operates on already-fetched contribution
   *        calendar weeks (daily contribution counts).
   * WRITES: Nothing.
   */
  calculateStreak(
    weeks: ContributionWeek[]
  ): { current: number; longest: number } {
    const days = weeks.flatMap((w) => w.contributionDays);

    let current = 0;
    let longest = 0;
    let streak = 0;
    let foundActiveStreak = false;

    const sortedDays = [...days].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    for (const day of sortedDays) {
      if (day.contributionCount > 0) {
        streak++;
        foundActiveStreak = true;
        current = streak;
        longest = Math.max(longest, streak);
      } else {
        if (foundActiveStreak) {
          break;
        }
        streak = 0;
      }
    }

    return { current, longest };
  }
}

export type {
  GitHubUser,
  GitHubRepo,
  ContributionWeek,
  CommitWithTimestamp,
  CommitTimestampResult,
  GitHubCommitDetail,
  GitHubPRDetail,
  GitHubSearchIssueItem,
  GitHubReviewWithReactions,
};

// ============================================================================
// Utility functions for public GitHub data (no authentication required)
// ============================================================================

/**
 * Checks if a GitHub user exists by attempting to fetch their avatar.
 * Uses the public GitHub avatar CDN which doesn't require authentication.
 *
 * READS: Sends a HEAD request to the public GitHub avatar URL.
 *        No user data is fetched, only the HTTP status code is checked.
 * WRITES: Nothing.
 */
export async function checkGitHubUserExists(
  username: string
): Promise<boolean> {
  try {
    const res = await fetch(`https://github.com/${username}.png`, {
      method: "HEAD",
      next: { revalidate: 86400 },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Returns the public GitHub avatar URL for a username.
 * Pure utility function, no API calls.
 *
 * READS: Nothing from GitHub.
 * WRITES: Nothing.
 */
export function getGitHubAvatarUrl(username: string): string {
  return `https://github.com/${username}.png`;
}
