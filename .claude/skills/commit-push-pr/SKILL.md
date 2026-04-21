---
name: commit-push-pr
description: Commit staged changes, push, open draft PR against develop.
---

## Steps

1. `git status` — confirm what is staged vs unstaged. Stage only task-related files.
2. If amending: `git commit --amend --no-edit` (or `-m "<msg>"` if a new message is provided).
   Else: draft a concise message from `git diff --cached`, then `git commit -m "<msg>"`.
3. Push: `git push` (add `-u origin <branch>` if no upstream; use `--force-with-lease` only when amending).
4. PR: `gh pr view --json url 2>/dev/null`. If none, `gh pr create --draft --base develop --title "<t>" --body "<b>"`.

## Rules
- Never `--force` (only `--force-with-lease` when amending).
- Never `--no-verify`.
- PRs always draft, always targeting `develop`.
- If pre-commit hook fails, fix the issue — do not skip.
- If push rejects, `git pull --rebase origin <branch>` then retry.
