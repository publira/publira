---
name: release
description: Cut a Publira release, from choosing its version to checking the published Release. Use when asked to cut, tag, ship, or publish a release, to choose or bump the next version, to open the `chore(release): vX.Y.Z` pull request, to push a `v` tag, or to recover a release whose `Release notes` run was refused or failed. Decides between a minor and a patch release from the pull requests merged since the previous release tag and the rules in docs/en/2-deployments/10-releases.md, checks the preconditions, makes the release commit with scripts/release-version.ts, tags the commit that merges it, watches Check version, Images, and Publish release, and verifies the tag, the prerelease flag, the Upgrade notes, every image pulled signed out, and the Compose install archive attached to the Release.
---

# Cut a Release

A release is a Git tag `vMAJOR.MINOR.PATCH` on the commit that merges a release pull request. Pushing the tag starts the `Release notes` workflow, which checks the version, pushes the images, and publishes the GitHub Release; nothing else in the release is done by hand. What a release number promises an operator is stated in [`docs/en/2-deployments/10-releases.md`](../../docs/en/2-deployments/10-releases.md), and what each job does and refuses is stated under **Release notes** in [`.github/workflows/README.md`](../../.github/workflows/README.md#release-notes). Read both before starting; this skill is the order in which they are acted on.

A pushed tag publishes images to `ghcr.io` and a Release that operators and the website read, and neither is taken back cleanly. Every step before the tag push can be redone; check everything there.

## 1. Find the previous release

Work from a fresh `origin/main`, never from a local branch:

```bash
git fetch origin --tags
previous=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' --exclude '*-*' origin/main)
echo "$previous"
```

This is the release the workflow will write the notes from, and the one the version is chosen against. For a prerelease, drop `--exclude '*-*'`: a prerelease's notes run from the nearest tag of either kind, so an `rc.2` starts from `rc.1`.

## 2. Choose the version

A version the user named is the one to cut, but it is still held to the rules below; stop and say so if it breaks them rather than cutting it.

Otherwise, choose it from what has merged since `$previous`. List the pull requests and preview the Upgrade notes the release will open with, using the same renderer the workflow runs:

```bash
git log --format=%s "$previous"..origin/main
git log --format=%s "$previous"..origin/main | sed -nE 's/.*\(#([0-9]+)\)$/\1/p' |
  while read -r n; do gh pr view "$n" --json number,title,body; done |
  jq -s --arg previousTag "$previous" '{pulls: ., previousTag: $previousTag}' |
  node scripts/upgrade-notes.ts render
```

`main` is squash-merged through its queue, so every commit subject ends in `(#N)`; a commit without one reached `main` some other way, and its change has to be judged from its diff.

Then look at the diff for the changes that break an install, or the release before:

```bash
git diff --name-status "$previous"..origin/main -- infra/proxy/README.md docs/en/2-deployments/4-edge/index.md server/internal/dbroles/dbroles.go infra/deploy/compose.yaml
git diff "$previous"..origin/main -- 'db/migrations/*.up.sql' | grep -inE '^\+.*\b(drop|rename)\b'
```

The first command lists where what the edge has to do is stated — the routing contract and **What the edge has to do** on the Edge page — along with the roles and the Compose services. A change to the roles or to the services, secrets, and volumes of `compose.yaml` asks something of an operator; a change to the two edge files does when it changes what the edge has to do, and not when it only rewords them or describes a sample, so read their diff with `git diff "$previous"..origin/main -- infra/proxy/README.md docs/en/2-deployments/4-edge/index.md`. The sample proxy configurations under `infra/proxy/` are left out on purpose: an operator rewrites a sample for their own edge, so a change to one alone asks nothing, and a sample that starts doing something new comes with a change to the contract. The second lists every line an up migration adds that drops or renames something. A migration that only adds a table, a column, or an index prints nothing there and breaks nothing; each line it does print is judged on whether the release before reads what it removes. A `DROP DEFAULT` on a column the same migration adds, a constraint dropped to be recreated, and anything the previous release no longer reads are fine. A dropped or renamed table, column, type, or function that the previous release's queries name is not: every release works beside the one before it, as [Two releases side by side](../../docs/en/2-deployments/10-releases.md#two-releases-side-by-side) promises, and no version number makes up for breaking that. Stop and tell the user which pull request did it rather than cutting any release. Run `scripts/check-proto-compat.sh` too, and stop the same way when it fails.

Something since `$previous` breaks an install, judged on the list under **Changes that break an install** in [`10-releases.md`](../../docs/en/2-deployments/10-releases.md#changes-that-break-an-install), unless every one of these holds:

- the first diff command shows no change to what the edge has to do, to `dbroles.go`, or to the services, secrets, and volumes of `compose.yaml`;
- the previewed Upgrade notes ask nothing — no environment variable added as required, renamed, or no longer read, no role, no change to what the edge has to do, no new process, no migration that runs long or locks a busy table, no search index to rebuild.

Then choose the version:

- **A major release** (`X+1.0.0`) when something breaks an install.
- **A minor release** (`X.Y+1.0`) when nothing does, but a pull request adds a capability (a `feat`) or `git diff --name-status "$previous"..origin/main -- db/migrations` lists anything.
- **A patch release** (`X.Y.Z+1`) otherwise: fixes, dependency updates, and changes no install sees.

Before `1.0.0`, the minor number takes the place of the major one: a minor release when something breaks an install, and a patch release otherwise, a `feat` and a migration that only adds included.

A patch release also needs `$previous` to be the newest minor release, since only that one receives fixes. The repository has no maintenance branches, so do not invent one to ship a patch around a change that makes the release a larger one. When a fix is urgent and `main` already carries such a change, say so to the user and let them decide.

**A prerelease** (`X.Y.Z-rc.N`) is cut only when the user asks for one, to try a release before it is out. It gets a release commit and a pull request of its own, exactly like a release, and the release it previews gets another one later. The workflow marks it as a prerelease from the hyphen in the tag.

`1.0.0` itself is cut only when the user asks for it.

## 3. Check the preconditions

Do not open the release pull request until all of these hold:

- **`main` is green.** The latest `CI` run of `main` is a success on the commit you are releasing from, not in progress and not failed:

  ```bash
  gh run list --workflow ci.yml --branch main --event push --limit 1 --json headSha,status,conclusion
  git rev-parse origin/main
  ```

- **Nothing the release waits on is open.** The release's milestone is `Post-MVP` for a `0.x` release, `1.0.0` for that release, and `Post-1.0` for a `1.x` release:

  ```bash
  gh issue list --milestone "<milestone>" --state open --limit 200
  ```

  For `1.0.0`, every open Issue in the milestone holds the release. `Post-MVP` and `Post-1.0` span many releases, so an open Issue there holds this one only when the release waits on it: the user or the Issue that asked for the release names it, a fix is half-landed (a stacked pull request whose lower layer is on `main` while the layer above is still open), or the documentation does not yet describe a behaviour the release changes. Report each one you find and stop until it lands or the user releases without it.

## 4. Make the release commit and open its pull request

The release commit sets `version` in every tracked `package.json` to the bare number, without the `v`, and changes nothing else. Branch from `origin/main`:

```bash
git switch -c release/vX.Y.Z origin/main
node scripts/release-version.ts set X.Y.Z
node scripts/release-version.ts check X.Y.Z
git add -- package.json '*/package.json'
git diff --staged
git commit --allow-empty -m "chore(release): vX.Y.Z" --trailer "Assisted-by: <AGENT_NAME>:<MODEL_VERSION>"
```

Stage the manifests by path and never commit with `-a`: `git switch` carries any tracked edit already in the checkout onto the new branch, and `-a` would put it into the tagged release. Read `git diff --staged` before committing; it holds nothing but the `version` line of each `package.json`. If it holds anything else, the checkout had edits of its own, so stop and cut the release from a clean worktree instead (`git worktree add -b release/vX.Y.Z <path> origin/main`). `--allow-empty` is there for a release whose files already carry the number: it still gets its commit and its pull request, so the tag always goes on the commit that merges a release pull request.

Open the pull request with the `create-pr` skill, titled `chore(release): vX.Y.Z`. In its Summary, say why the release is a minor or a patch release, naming what decided it, so the reviewer can check the choice before the tag exists. Its own Upgrade notes are `None.`, since the release's notes are collected from the pull requests it carries, and its How to Test is `node scripts/release-version.ts check X.Y.Z`. Use `Fixes #N` when an Issue asked for this release.

The pull request merges through the queue like any other. Do not merge it yourself; wait until it is merged:

```bash
gh pr view <number> --json state,mergeCommit --jq '.state, .mergeCommit.oid'
```

## 5. Tag the merge commit and push the tag

Tag the commit that merged the release pull request — the `mergeCommit` above, not whatever `main` points at by the time you tag — with the version behind a `v`:

```bash
git fetch origin
git tag -a vX.Y.Z -m vX.Y.Z <merge commit>
git push origin vX.Y.Z
```

A tag without the `v` starts nothing. Do not create the GitHub Release by hand, before or after: the workflow creates it once the images are pushed, and a Release that already exists has its notes replaced.

## 6. Watch the run

```bash
gh run list --workflow release-notes.yml --branch vX.Y.Z --limit 1 --json databaseId,status,conclusion
gh run watch <run id> --exit-status
```

The jobs run in order — `Check version`, then `Images` (one `Images / Build / <name> (<arch>)` per image and architecture, then `Images / Publish`), then `Publish release` — and each one starts only once the one before it succeeds.

### When `Check version` refuses the tag

Its log names each `package.json` that does not carry the version. Nothing was pushed to `ghcr.io` and no Release exists, so the tag can be moved. Usually the tag is on the wrong commit; otherwise the release pull request did not set the version, and a new one has to. Delete the tag locally and on the remote, then tag the right commit and push again:

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

### When `Images` or `Publish release` fails

Do not move a tag that passed `Check version`: images may already be under its version. Read the failed job's log, and re-run only the failed jobs, which resumes from where it stopped and publishes the Release once the images are in:

```bash
gh run rerun <run id> --failed
```

`Images / Publish` names each package it cannot read signed out. A package a workflow creates for the first time can start out private, and `GITHUB_TOKEN` cannot change that: ask an organization owner to make each named package public under its **Package settings**, and re-run the failed jobs once they have.

A Release found wrong after it is published is fixed by the next release, not by moving its tag.

## 7. Check the published Release

```bash
gh release view vX.Y.Z --json tagName,isPrerelease,isDraft,url,body
```

- `tagName` is `vX.Y.Z`, and `isPrerelease` is `true` exactly when the tag carries a hyphen.
- The body opens with **Upgrade notes** matching the preview from step 2, followed by the list of pull requests since `$previous` (or a comparison link when the list does not fit). The first release has no list.
- Every image is pullable signed out under the bare version, for both architectures:

  ```bash
  version=X.Y.Z
  for name in publira publiractl web-storefront web-admin web-platform email-renderer; do
    token=$(curl -fsS "https://ghcr.io/token?scope=repository:publira/$name:pull" | jq -r .token)
    curl -fsS -H "Authorization: Bearer $token" -H 'Accept: application/vnd.oci.image.index.v1+json' \
      "https://ghcr.io/v2/publira/$name/manifests/$version" |
      jq -r --arg name "$name" '"\($name): " + ([.manifests[].platform | "\(.os)/\(.architecture)"] | join(", "))'
  done
  ```

  Each line lists `linux/amd64, linux/arm64`; a failed request is an image an operator cannot pull.

- The Compose install is attached and downloads signed out, the way [Docker Compose](../../docs/en/2-deployments/3-docker-compose.md#download-the-compose-file) has an operator fetch it:

  ```bash
  version=X.Y.Z
  curl -fsSL "https://github.com/publira/publira/releases/download/v$version/publira-deploy-$version.tar.gz" -o "/tmp/publira-deploy-$version.tar.gz"
  tar -tvzf "/tmp/publira-deploy-$version.tar.gz"
  tar -xzOf "/tmp/publira-deploy-$version.tar.gz" "publira-deploy-$version/.env.example" | grep '^PUBLIRA_IMAGE_TAG='
  ```

  The listing is one directory, `publira-deploy-X.Y.Z/`, holding `compose.yaml`, `.env.example`, `Caddyfile` as a regular file (`-rw`, not `lrwx`), and `README.md`, and the last line is `PUBLIRA_IMAGE_TAG=X.Y.Z`. A failed download is an archive missing from the Release: re-run `Publish release`, which attaches it.

Report the Release URL, the version and why it was chosen, the release pull request, and any job that had to be re-run and why.
