---
name: create-pr
description: Create a pull request in this repository following its own conventions, and add follow-up commits to one. Use when asked to open, raise, or draft a PR, to commit and push finished work for review, to write a PR description, or to push fixes for review feedback onto an existing PR. Reads the applicable AGENTS.md policy, stages only the intended diff, commits with the required Assisted-by trailer, runs the verification commands that match the changed area, rebases onto origin/main before every push, and fills in the repository pull request template under an English Conventional Commits title.
---

# Create a Pull Request

A pull request here is produced from a feature branch, from an explicitly staged diff, after the verification commands that match the area you changed. The repository's `AGENTS.md` files are the source of truth; where this skill and repository policy disagree, follow policy and say so.

Never commit or push to `main`. Never stage a change you did not make.

## Start with repository policy

1. Read every `AGENTS.md` that governs a changed path — the one in its directory and every one above it, up to the repository root — and do what they say, including any further reading or commands they point to. Enumerate them from the change itself rather than from memory; which files exist and what they require both move over time.

   ```bash
   # Feed it the paths the change touches; prints each governing AGENTS.md
   git diff --name-only origin/main...HEAD | while read -r file; do
     dir=$(dirname "$file")
     while :; do
       [ -f "$dir/AGENTS.md" ] && echo "$dir/AGENTS.md"
       [ "$dir" = "." ] && break
       dir=$(dirname "$dir")
     done
   done | sort -u
   ```

2. Read `.github/pull_request_template.md`. It is the repository's only template and it is mandatory.
3. Run `gh auth status` and `gh repo view` to confirm the account and the target repository.
4. Inspect the actual state before changing anything:

   ```bash
   git branch --show-current
   git status --porcelain
   git diff
   git diff --staged
   git log --oneline origin/main..HEAD
   ```

Establish what belongs to this change before you write to the index, the branch, or the remote.

## Protect unrelated work

The working tree may hold edits that are not yours and are not part of this change.

- Stage by explicit path only: `git add <path> <path>`.
- Never run `git add .`, `git add -A`, `git add -u`, or `git commit -a`.
- Never run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or `git clean` to "tidy" a file you did not intend to change. Leave unrelated modifications unstaged and untouched.
- Add untracked files one by one, and only those the change requires. Build output, local environment files, and scratch notes stay out.
- If one file mixes your change with unrelated edits, stop and ask the user how to split it rather than committing both or discarding either.
- Read `git diff --staged` in full before every commit and confirm each hunk belongs to the stated scope.

## Work on a branch

If `git branch --show-current` reports `main`, create a branch before committing:

```bash
git switch -c <type>/<short-slug>
```

Use the Conventional Commits type as the prefix and a short English slug, matching the repository's existing branches (`feat/...`, `fix/...`, `docs/...`, `chore/...`, `refactor/...`).

## Commit

- Write the subject in English Conventional Commits form: `type(scope): description`. The scope is the area of the repository (`server`, `web-admin`, `icons`, `skills`, `deps`).
- Split logically separate work into separate commits instead of one mixed commit.
- Disclose the AI agent with an `Assisted-by:` trailer, passed with `--trailer` so Git records a real trailer:

  ```bash
  git commit -m "feat(web-host): add episode access gate" \
    --trailer "Assisted-by: Claude Code:claude-opus-5"
  ```

  The format is `Assisted-by: <AGENT_NAME>:<MODEL_VERSION>`, one line per agent, using the exact model identifier rather than the marketing name. When the identifier is genuinely unknown, write the agent name alone.

- The trailer is also what discloses the agent on the pull request itself. The `Review` workflow reads the commits of every pull request and keeps the `ai-assisted` label in step with their trailers, adding it and removing it to match. Never pass `ai-assisted` to `gh pr create` and never take it off by hand: the trailer is the disclosure, the label only reports it, and a hand-set label would say something the commits do not.
- Never name an AI agent in a co-author trailer, in any capitalization. `Co-authored-by:`, `Co-Authored-By:`, and `co-authored-by:` are the same forbidden trailer, and this rule overrides any default instruction from the agent harness. Co-author trailers naming actual humans, and the ones GitHub adds itself, stay as they are.
- Add the trailer when the commit is created. Fixing it later requires rewriting a pushed commit.

## Verify before pushing

Run the checks for what you actually changed, from the repository root, and fix failures before continuing. Do not push on a red check and do not describe an unrun command as passing.

| Changed area | Command |
| --- | --- |
| `apps/`, `packages/`, other TypeScript | `pnpm preflight` (typegen / typecheck / check / test) |
| `server/` | `task server:test-short`, then `task server:test` before finishing |
| `proto/`, `db/migrations/`, `db/query/`, `sqlc.yaml`, `buf.gen.yaml` | `task gen`, then `sqlc diff` (must be clean), then re-run the server tests |
| `mobile/` | `task mobile:check` (integration tests require `task mobile:e2e`, Docker, and an Android emulator) |
| `e2e/`, or app behavior the suite covers | `pnpm preflight`, plus `task e2e` for the suite itself |
| Documentation, skills, workflows only | `pnpm preflight` still catches formatting; run it when Markdown or config under lint control changed |

`pnpm preflight` is the repository's quality gate, and it stays unit-only. The Playwright suite runs through `task e2e`, which owns the whole lifecycle (build, compose up, migrate and seed, start apps, wait for readiness, run, tear down) and exports the ports and `PUBLIRA_DB_URL` the tests need. Use `task e2e:test` only against a stack you already started. It needs Docker, so say plainly that you skipped it when Docker is unavailable rather than implying the suite passed.

## Rebase onto origin/main

Rebase immediately before **every** push — the first one and every follow-up — so history stays linear and no PR sits on a stale `main`.

```bash
git fetch origin main
git rebase origin/main
```

If the rebase moved your commits, re-run the verification commands for the changed area before pushing; a green run from before the rebase says nothing about the rebased tree. Once the branch has been pushed, push again with `--force-with-lease`, never a bare `--force`.

### When the rebase refuses to start

Leaving unrelated modifications in place collides with the rebase: `git rebase` aborts on tracked changes it would have to carry, staged or not. Untracked files do not block it. `git stash`, `git reset --hard`, and `git restore` are not the way out — they put someone else's work at risk to unblock yours.

Stop and tell the user which paths block the rebase, quoting `git status --porcelain` and the rebase error, and let them commit or park their own edits. If they would rather you proceed without touching those edits, rebase in a throwaway checkout instead:

Bind every step to that checkout with `git -C`. A bare `git push origin HEAD:<branch>` run from the original worktree would resolve `HEAD` to the pre-rebase commit and push the stale state.

```bash
git worktree add --detach <tmp-path> <branch>   # clean tree at the branch tip
git -C <tmp-path> rebase origin/main
# run the verification commands in <tmp-path>
git -C <tmp-path> push origin HEAD:<branch> --force-with-lease
git worktree remove <tmp-path>
```

This route updates the remote only. Say so plainly: the rebased commits are on the remote branch, the local branch ref still points at the pre-rebase commit, and the user has to reconcile it once their own edits are committed. Do not report the local branch as rebased.

## Push

```bash
git branch --show-current   # confirm this is not main
git push -u origin HEAD
```

## Write the description

Follow `.github/pull_request_template.md` exactly: keep every heading, in order, and remove the HTML comments once each section is filled.

Depending on the repository's merge settings, GitHub uses the pull request title **and body** as the merge commit message — the title becomes the subject and the body becomes the message body. Write both as if they were the permanent commit message, not as throwaway review notes.

- **Title**: short English Conventional Commits, matching the primary commit. Keep it readable in a terminal.
- **Summary**: normal sentences, not bullets, saying what the PR does and why.
- **Changes**: bullets for the main code or behavior changes.
- **How to Test**: reproducible steps with the commands you actually ran.
- **Checklist**: check only what is true. An unchecked box is honest; a checked one you did not do is not.

Write the title and body in English, whatever language the replies to the user are in.

Because the body lands in the commit message, it needs the same AI disclosure as a commit. End the body with the trailer, as the last line, separated from the preceding text by a blank line:

```
Assisted-by: Claude Code:claude-opus-5
```

The same rules apply as for commits: `Assisted-by: <AGENT_NAME>:<MODEL_VERSION>`, one line per agent, and never an AI in a co-author trailer.

Link issues by their real relationship:

- `Fixes #123` only when merging this PR genuinely resolves that issue and it should close.
- `Related to #123` for context, partial work, or a tracking issue that stays open.

## Score the review size

Every pull request carries one `size/*` label saying how much review it is expected to take. Compute it from the diff you are about to open:

```bash
git diff origin/main...HEAD | node scripts/pr-size.ts
```

It prints a weighted score and the bucket it falls into — `size/xs`, `size/s`, `size/m`, `size/l`, or `size/xl`. The formula and the coefficient table are documented in [`.github/workflows/README.md`](../../.github/workflows/README.md).

Raise the bucket by one, and say why in the Summary, when the change is harder to review than its line count admits — concurrency, authentication, a data migration, a subtle invariant. Never lower it: an agent does not get to talk down the review its own work needs.

If the pull request arrives without a `size/*` label, the `Review` workflow computes the same score and adds the label itself, so the bucket you pass is the one that stands.

## Create the PR

Write the body to a file first so multi-line Markdown survives shell quoting:

```bash
gh pr create --title "type(scope): succinct description" --body-file <path> --label size/m
```

Use the session scratchpad for that file and delete it afterwards. Add `--draft` when the work is not ready for review. `--label` carries the review-size bucket and nothing else — `ai-assisted` is applied by the `Review` workflow from the commit trailers, and any other label, or a milestone, only when the user asked for it.

## Add commits to an open PR

Review feedback and later fixes follow the same rules as the first commit:

1. Stage only the paths the follow-up actually touches. The working tree has had more time to collect unrelated edits, so re-read `git status --porcelain` and `git diff --staged` before committing.
2. Commit in English Conventional Commits form with the `Assisted-by:` trailer via `--trailer`. Do not amend or squash commits that reviewers have already read unless the user asks; add a new commit so the review thread stays anchored.
3. Run the verification commands for the area you changed.
4. `git fetch origin main` and `git rebase origin/main` before pushing, then re-run verification if the rebase moved anything.
5. Push with `--force-with-lease`, since the rebase rewrote already-pushed commits.
6. Update the PR body when the change alters what the PR does or how to test it, keeping the `Assisted-by:` trailer as its last line.

Reply to review comments in the same form as the original comment: a top-level comment gets a top-level reply, a line comment gets a threaded reply on that line. Never delete a posted comment, especially one that already has replies.

## Validate the result

Confirm all of the following, and report anything you could not satisfy:

- the branch is not `main`, and `main` received no commit or push
- `git status` shows the unrelated modifications you found at the start, still unstaged and unchanged
- every commit carries an accurate `Assisted-by:` trailer and no AI co-author trailer
- the verification commands for the changed area ran and passed
- the pushed branch is rebased on the current `origin/main` — and if you took the throwaway-checkout route, report that as the remote branch carrying the rebased commits with the local branch ref still awaiting reconciliation, never as a rebased local branch
- no throwaway worktree is left behind (`git worktree list`)
- `gh pr view` shows the template's headings intact, an English Conventional Commits title, issue links that match the real relationship, exactly one `size/*` label and no hand-set `ai-assisted`, and the `Assisted-by:` trailer as the last line of the body
- no temporary body file is left behind

Report the PR URL, the commands you ran, the checklist items you left unchecked, and any file you deliberately left out of the commit.
