---
name: commit-push
description: Commit staged/unstaged changes and push to the remote branch in one step
---

# Commit & Push Skill

Commit all current changes and push to the remote in a single workflow.

## Process

1. **Check state** — Run `git status` (no `-uall`), `git diff` (staged + unstaged), and `git log --oneline -5` in parallel
2. **Abort if clean** — If there are no changes, inform the user and stop
3. **Stage files** — Add changed files by name (never use `git add -A` or `git add .`). Skip files that look like secrets (`.env`, credentials, tokens)
4. **Draft commit message** — Follow the repo's `JS-XXXX: short description` convention. Summarize the "why", not the "what"
5. **Commit** — Use a HEREDOC for the message. Always append the co-author trailer:
   ```
   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   ```
6. **Push** — Push to the current remote-tracking branch (typically `origin/develop`). Use `git push` (never force-push)
7. **Confirm** — Show the resulting commit hash and remote status

## Rules

- Never amend existing commits
- Never force-push
- Never skip hooks (`--no-verify`)
- Never commit files that contain secrets
- Always create a NEW commit, even after a hook failure
- Push target is always the current branch's upstream (usually `develop`)
