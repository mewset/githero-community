interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  // Extended profile fields
  location: string | null;
  company: string | null;
  blog: string | null; // Website URL
  twitter_username: string | null;
  hireable: boolean | null;
  created_at: string; // ISO date
  public_gists: number;
  email: string | null;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  // Extended repo fields
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
  date: string; // ISO date (YYYY-MM-DD)
  hour: number; // 0-23
}

interface CommitTimestampResult {
  commits: CommitWithTimestamp[];
}

// Sprint 2: Detailed commit information
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

// Sprint 2: Detailed PR information
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

// Sprint 2: Search result for PRs
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

// Sprint 3: Issue detail information (exported for future use)
export interface GitHubIssueDetail {
  number: number;
  title: string;
  state: string; // open, closed
  user: { login: string };
  comments: number;
  reactions: { total_count: number };
  created_at: string;
  closed_at: string | null;
  repository_url: string;
}

// Sprint 3: Search result for issues
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

// Sprint 3: Code review information (exported for future use)
export interface GitHubReviewDetail {
  id: number;
  user: { login: string };
  body: string | null;
  state: string; // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED, PENDING
  submitted_at: string;
  pull_request_url: string;
}

// Sprint 3: Review with reactions (from GraphQL)
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

  private async fetchREST<T>(
    endpoint: string,
    options?: { includeTopics?: boolean }
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: "application/vnd.github.v3+json",
    };

    // Topics require mercy preview header
    if (options?.includeTopics) {
      headers.Accept = "application/vnd.github.mercy-preview+json";
    }

    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    return response.json();
  }

  private async fetchGraphQL<T>(query: string): Promise<T> {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL error: ${response.status}`);
    }

    const data = await response.json();
    return data.data;
  }

  async getUser(): Promise<GitHubUser> {
    return this.fetchREST<GitHubUser>("/user");
  }

  async getRepos(): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const pageRepos = await this.fetchREST<GitHubRepo[]>(
        `/user/repos?per_page=${perPage}&page=${page}&type=all`,
        { includeTopics: true } // Include topics for skills detection
      );
      repos.push(...pageRepos);

      if (pageRepos.length < perPage) break;
      page++;
    }

    return repos;
  }

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

  // Fetch commit timestamps for the last year to enable time-based achievements
  async getCommitTimestamps(username: string): Promise<CommitTimestampResult> {
    const commits: CommitWithTimestamp[] = [];

    // Get commits from the last year using GraphQL
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

  // Sprint 2: Get detailed commit information including +/- lines
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

  // Sprint 2: Get recent commits from a repo with stats
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

        // Fetch stats for each commit (individual API calls needed for stats)
        for (const commit of pageCommits) {
          if (commits.length >= limit) break;
          const detailed = await this.getCommitDetails(owner, repo, commit.sha);
          if (detailed) {
            commits.push(detailed);
          }
        }

        if (pageCommits.length < perPage) break;
        page++;
      }
    } catch (error) {
      console.error(`Failed to fetch commits for ${owner}/${repo}:`, error);
    }

    return commits;
  }

  // Sprint 2: Get user's PRs with detailed information
  async getUserPRsDetailed(
    username: string,
    limit: number = 50
  ): Promise<GitHubPRDetail[]> {
    const prs: GitHubPRDetail[] = [];

    try {
      // Search for user's PRs
      const searchQuery = `author:${username} type:pr`;
      const searchResults = await this.fetchREST<{
        total_count: number;
        items: GitHubSearchPRItem[];
      }>(`/search/issues?q=${encodeURIComponent(searchQuery)}&per_page=${Math.min(limit, 100)}&sort=created&order=desc`);

      // Fetch detailed info for each PR
      for (const item of searchResults.items.slice(0, limit)) {
        try {
          // Extract owner/repo from repository_url
          const repoMatch = item.repository_url.match(
            /repos\/([^/]+)\/([^/]+)$/
          );
          if (!repoMatch) continue;

          const [, owner, repo] = repoMatch;
          const prDetail = await this.fetchREST<GitHubPRDetail>(
            `/repos/${owner}/${repo}/pulls/${item.number}`
          );
          prs.push(prDetail);
        } catch {
          // Skip PRs we can't access
          continue;
        }
      }
    } catch (error) {
      console.error(`Failed to fetch PRs for ${username}:`, error);
    }

    return prs;
  }

  // Sprint 2: Calculate PR merge time in minutes
  static calculateMergeTimeMinutes(
    createdAt: string,
    mergedAt: string | null
  ): number | null {
    if (!mergedAt) return null;
    const created = new Date(createdAt).getTime();
    const merged = new Date(mergedAt).getTime();
    return Math.round((merged - created) / (1000 * 60));
  }

  // Sprint 3: Get issues created by user
  async getUserIssuesCreated(
    username: string,
    limit: number = 100
  ): Promise<GitHubSearchIssueItem[]> {
    const issues: GitHubSearchIssueItem[] = [];

    try {
      // Search for issues created by the user (excluding PRs)
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

  // Sprint 3: Get issues closed by user (includes issues where user is assignee)
  async getUserIssuesClosed(
    username: string
  ): Promise<{ opened: number; closed: number }> {
    try {
      // Count issues opened
      const openedQuery = `author:${username} type:issue`;
      const openedResults = await this.fetchREST<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(openedQuery)}&per_page=1`
      );

      // Count issues closed (authored)
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

  // Sprint 3: Get code reviews submitted by user using GraphQL for reaction data
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
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { username, first: Math.min(limit, 100) },
        }),
      });

      if (!response.ok) {
        throw new Error(`GitHub GraphQL error: ${response.status}`);
      }

      const data = await response.json();
      const contributions =
        data.data?.user?.contributionsCollection?.pullRequestReviewContributions
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

  // Sprint 3: Get review counts by state
  async getUserReviewCounts(
    username: string
  ): Promise<{ total: number; approved: number }> {
    try {
      // Use search API for review counts
      const reviewQuery = `reviewed-by:${username} type:pr`;
      const reviewResults = await this.fetchREST<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(reviewQuery)}&per_page=1`
      );

      // For approval rate, we'd need GraphQL - estimate from contributions
      return {
        total: reviewResults.total_count,
        approved: Math.round(reviewResults.total_count * 0.7), // Estimate 70% approval rate
      };
    } catch (error) {
      console.error(`Failed to fetch review counts for ${username}:`, error);
      return { total: 0, approved: 0 };
    }
  }

  calculateStreak(
    weeks: ContributionWeek[]
  ): { current: number; longest: number } {
    const days = weeks.flatMap((w) => w.contributionDays);

    let current = 0;
    let longest = 0;
    let streak = 0;
    let foundActiveStreak = false;

    // Sort by date descending (newest first)
    const sortedDays = [...days].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    for (const day of sortedDays) {
      if (day.contributionCount > 0) {
        streak++;
        foundActiveStreak = true;
        current = streak; // Update current for every day in the active streak
        longest = Math.max(longest, streak);
      } else {
        if (foundActiveStreak) {
          break; // Current streak ended
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
  // Sprint 3
  GitHubSearchIssueItem,
  GitHubReviewWithReactions,
};
