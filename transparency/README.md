# Source Code Transparency

These files are **automatically synced** from our private repository to provide transparency about how Githero interacts with your GitHub data.

## What's included

| File | Purpose |
|------|---------|
| `github.ts` | All GitHub API interactions |

## What you can verify

By reading `github.ts`, you can confirm that:

1. **Read-only operations**: We only use `GET` requests and read-only GraphQL queries
2. **No write endpoints**: No `POST`, `PUT`, `PATCH`, or `DELETE` calls to your repos
3. **No code modification**: We never touch your code, issues, PRs, or settings

## API calls we make

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/user` | Read your profile |
| GET | `/user/repos` | List your repositories |
| GET | `/repos/.../commits` | Read commit history |
| GET | `/search/issues` | Count PRs and issues |
| POST | `/graphql` | Read-only contribution queries |

## Learn more

- [How We Use Your GitHub Data](https://githero.dev/github-data)
- [Privacy Policy](https://githero.dev/privacy)
- [Terms of Service](https://githero.dev/terms)

---

*Last synced: Auto-updated on every change to main branch*
