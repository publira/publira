---
title: Releases
description: What a version number tells you, what each kind of release may change, how 0.x differs, and which releases receive fixes.
published: 2026-10-11
updated: 2026-10-21
---

Publira is released as tags of the repository named `vMAJOR.MINOR.PATCH`, starting at `v0.1.0`. Each one is published with its release notes on the repository's [Releases](https://github.com/publira/publira/releases) page, and its images are pushed under the release's version, the tag without its `v`, and no other tag: `v0.1.0` is pulled as `ghcr.io/publira/<name>:0.1.0`. There is no `latest` and no `0.1`, so an install moves to a new release only when you change the version it runs. The release also carries the [Docker Compose](./3-docker-compose.md) install as `publira-deploy-<version>.tar.gz`: the Compose file, its `.env.example` naming the release's images, and the proxy's `Caddyfile`, as they are in the repository at the tag. It carries no signature, and neither do the images. This page says what the number of a release tells you before you upgrade to it, and which releases receive fixes.

## What the number tells you

- **A major release**, such as `v2.0.0`, is where every [change that breaks an install](#changes-that-break-an-install) lands. Read its notes before you upgrade.
- **A minor release**, such as `v2.1.0`, adds capabilities, and may carry a migration that `db migrate` applies with nothing else asked of you.
- **A patch release**, such as `v2.1.1`, fixes the minor release it belongs to and asks nothing of you beyond replacing the images.
- **A tag with a suffix**, such as `v2.0.0-rc.1`, is a prerelease, and the Releases page marks it as one. It is there to try a release before it is out, and it receives no fixes; run the release itself on an install that serves readers.

Releases before `1.0.0` number these differently, as [Before 1.0.0](#before-100) describes.

## Changes that break an install

A change that takes more from you than the steps every upgrade runs lands in a major release:

- a table, a column, or another part of the database schema that the release before it reads, dropped or renamed;
- a part of the API between the web apps and `publira server` that the release before it calls, dropped or renamed;
- the environment variables: one added that a process requires, one renamed, or one no longer read;
- the database roles: a role added, or what a role may reach;
- [what the edge has to do](./4-edge/index.md#what-the-edge-has-to-do), and the sample proxy configurations that do it;
- a process or a service the install did not run before;
- a migration that runs long or locks a busy table;
- the search index, which then has to be rebuilt.

Every such change is named in the **Upgrade notes** that open the release notes, and the notes say so when there is none; [Read the release notes](./7-upgrading.md#read-the-release-notes) says what to do about each.

Nothing promises yet that the processes of two releases work side by side, so upgrade to such a release the way [Upgrading](./7-upgrading.md) describes, whatever its notes say: the migrations and the roles first, and then every process together.

## Patch releases

A patch release carries fixes alone and is held to what can be applied by replacing the images: no migration, no environment variable added, renamed, or no longer read, no database role, no change to the routing in `infra/proxy/`, no process or service the install did not run before, and no search index to rebuild. A fix that needs any of them is released in the next minor release instead.

Its Upgrade notes therefore ask nothing of you. Upgrade to it the way [Upgrading](./7-upgrading.md) describes all the same, from the backup to replacing every process together: the steps cost little when the schema does not change, and the backup is still the way back if a patch release ever carries a change it should not.

## Before 1.0.0

While the major number is `0`, the minor number takes its place. A change that breaks an install lands in a minor release, such as `v0.2.0`, and everything else lands in a patch release, such as `v0.2.1`, new capabilities and migrations that only add included.

A `0.x` patch release may therefore carry a migration, and its processes can read what that migration adds and fail on a schema that does not have it. Replacing the images is not enough: run `db migrate` and `db roles` before the processes are replaced, as [Upgrading](./7-upgrading.md) describes.

## Which releases receive fixes

Only the newest minor release receives fixes, security fixes included, and they are released as patch releases of it. When a minor release is published, the one before it stops receiving fixes, so an install on an earlier minor release gets a fix by upgrading to the newest release.

Report a vulnerability privately, from [Report a vulnerability](https://github.com/publira/publira/security/advisories/new) on the repository's Security tab, rather than in a public issue.

## Skipping releases

You can upgrade from any release to any later one in a single step. `db migrate` applies the migrations of every release in between in one run, so the schema needs nothing from you.

What it does not apply is what the release notes ask of you, so read the notes of every release after the one you run, up to and including the one you upgrade to. Only the major releases among them name anything, and before `1.0.0` the minor releases. Their Upgrade notes add up: set every variable they add, pass `db roles` a password for every role added in between, and carry every routing change into your proxy.

## Next steps

[Upgrading](./7-upgrading.md) takes a running install to a new release of any kind, and says what to do when a migration fails.
