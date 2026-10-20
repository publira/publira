---
title: Releases
description: What a 0.x version number tells you, what a minor and a patch release may change, and which releases receive fixes.
published: 2026-10-11
updated: 2026-10-20
---

Publira is released as tags of the repository named `vMAJOR.MINOR.PATCH`, starting at `v0.1.0`. Each one is published with its release notes on the repository's [Releases](https://github.com/publira/publira/releases) page, and its images are pushed under the release's version, the tag without its `v`, and no other tag: `v0.1.0` is pulled as `ghcr.io/publira/<name>:0.1.0`. There is no `latest` and no `0.1`, so an install moves to a new release only when you change the version it runs. The release also carries the [Docker Compose](./3-docker-compose.md) install as `publira-deploy-<version>.tar.gz`: the Compose file, its `.env.example` naming the release's images, and the proxy's `Caddyfile`, as they are in the repository at the tag. It carries no signature, and neither do the images. This page says what the number of a `0.x` release tells you before you upgrade to it, and which releases receive fixes.

## What the number tells you

- **A minor release**, such as `v0.2.0`, is where every change that asks something of you lands. Read its notes before you upgrade.
- **A patch release**, such as `v0.2.1`, fixes the minor release it belongs to and asks nothing of you beyond replacing the images.
- **A tag with a suffix**, such as `v0.2.0-rc.1`, is a prerelease, and the Releases page marks it as one. It is there to try a release before it is out, and it receives no fixes; run the release itself on an install that serves readers.

## Minor releases

A minor release may change anything an install depends on:

- the database schema, including dropping or renaming a table or a column the release before it reads;
- the API between the web apps and `publira server`;
- the environment variables: one added that a process requires, one renamed, or one no longer read;
- the database roles: a role added, or what a role may reach;
- [what the edge has to do](./4-edge.md#what-the-edge-has-to-do), and the sample proxy configurations that do it;
- the processes and the services an install runs;
- the search index, which then has to be rebuilt.

Every such change that asks something of you is named in the **Upgrade notes** that open the release notes, and the notes say so when there is none; [Read the release notes](./7-upgrading.md#read-the-release-notes) says what to do about each. A schema change is not named there when `db migrate` and `db roles` are all it takes, since every upgrade runs them anyway.

Nothing promises yet that the processes of two releases work side by side, so upgrade to a minor release the way [Upgrading](./7-upgrading.md) describes, whatever its notes say: the migrations and the roles first, and then every process together.

## Patch releases

A patch release carries fixes to the minor release it belongs to, and is held to what can be applied by replacing the images:

- **No migration.** The schema stays the one its minor release brought, so `db migrate` logs the same version before and after, and `db roles` changes nothing. A fix that needs a migration is released in the next minor release instead.
- **No environment variable** added, renamed, or no longer read.
- **No database role** added, and no change to what a role may reach.
- **No change to the routing** in `infra/proxy/`.
- **No process or service** the install did not run before.
- **No search index** to rebuild.

Its Upgrade notes therefore always say there is nothing to do. Upgrade to it the way [Upgrading](./7-upgrading.md) describes all the same, from the backup to replacing every process together: the steps cost little when the schema does not change, and the backup is still the way back if a patch release ever carries a change it should not.

## Which releases receive fixes

Only the newest minor release receives fixes, security fixes included, and they are released as patch releases of it. When a minor release is published, the one before it stops receiving fixes, so an install on an earlier minor release gets a fix by upgrading to the newest release.

Report a vulnerability privately, from [Report a vulnerability](https://github.com/publira/publira/security/advisories/new) on the repository's Security tab, rather than in a public issue.

## Skipping releases

You can upgrade from any release to any later one in a single step. `db migrate` applies the migrations of every release in between in one run, so the schema needs nothing from you.

What it does not apply is what the release notes ask of you, so read the notes of every release after the one you run, up to and including the one you upgrade to. Only the minor releases among them name anything. Their Upgrade notes add up: set every variable they add, pass `db roles` a password for every role added in between, and carry every routing change into your proxy.

## Next steps

[Upgrading](./7-upgrading.md) takes a running install to a new release, minor or patch, and says what to do when a migration fails.
