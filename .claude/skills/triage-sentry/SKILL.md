---
name: triage-sentry
description: Pull recent unresolved Sentry issues for the decked project, summarize them, and optionally run Seer analysis on the top hit. Use when asked about "errors in prod", "what's broken", or after a deploy.
---

# Triage Sentry

Surface what's currently exploding in production via the Sentry MCP.

## Steps

1. List orgs/projects if unknown (`mcp__sentry__find_organizations`, `mcp__sentry__find_projects`) — cache the result mentally for the rest of the session.
2. Search recent unresolved issues:
   - Use `mcp__sentry__search_issues` with `naturalLanguageQuery: "unresolved issues from the last 24 hours sorted by event count"` for the `decked` project.
3. For each top issue (≤5), report:
   - Title, level, event count (24h), users affected, first/last seen
   - Short link to the issue
4. If the user asks "why" or "what caused X", run `mcp__sentry__analyze_issue_with_seer` on that issue's ID.
5. If correlating with a deploy, cross-reference timestamps against `git log --since="<first_seen>"` and recent Railway deploys (`railway status`).

## Notes

- Both server (`@sentry/node`) and client (`@sentry/nextjs`) emit to the same Sentry org.
- Don't propose code fixes from Sentry data alone — verify the suspect file/line in the current codebase first (Sentry traces can lag behind a deploy).
