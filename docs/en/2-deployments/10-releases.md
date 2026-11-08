---
title: Releases
description: What a version number tells you, what each kind of release may change, how 0.x differs, which releases run side by side, which releases receive fixes, and how to verify what a release publishes.
published: 2026-10-11
updated: 2026-11-08
---

Publira is released as tags of the repository named `vMAJOR.MINOR.PATCH`, starting at `v0.1.0`. Each one is published with its release notes on the repository's [Releases](https://github.com/publira/publira/releases) page, and its images are pushed under the release's version, the tag without its `v`, and no other tag: `v0.1.0` is pulled as `ghcr.io/publira/<name>:0.1.0`. There is no `latest` and no `0.1`, so an install moves to a new release only when you change the version it runs. The release also carries the [Docker Compose](./3-docker-compose.md) install as `publira-deploy-<version>.tar.gz`: the Compose file, its `.env.example` naming the release's images, and the proxy's `Caddyfile`, as they are in the repository at the tag. The images and the archive are signed by the workflow that publishes them, as [Verify a release](#verify-a-release) describes. This page says what the number of a release tells you before you upgrade to it, which releases run side by side, which releases receive fixes, and how to verify what you pull.

## What the number tells you

- **A major release**, such as `v2.0.0`, is where every [change that breaks an install](#changes-that-break-an-install) lands. Read its notes before you upgrade.
- **A minor release**, such as `v2.1.0`, adds capabilities, and may carry a migration that `db migrate` applies with nothing else asked of you.
- **A patch release**, such as `v2.1.1`, fixes the minor release it belongs to and asks nothing of you beyond replacing the images.
- **A tag with a suffix**, such as `v2.0.0-rc.1`, is a prerelease, and the Releases page marks it as one. It is there to try a release before it is out, and it receives no fixes; run the release itself on an install that serves readers.

Releases before `1.0.0` number these differently, as [Before 1.0.0](#before-100) describes.

## Changes that break an install

A change that takes more from you than the steps every upgrade runs lands in a major release:

- the environment variables: one added that a process requires, one renamed, or one no longer read;
- the database roles: a role added, or what a role may reach;
- [what the edge has to do](./4-edge/index.md#what-the-edge-has-to-do);
- a process or a service the install did not run before;
- a migration that runs long or locks a busy table;
- the search index, which then has to be rebuilt.

A change to the [sample configurations](./4-edge/1-sample-configurations.md) of a proxy is not one of them on its own: they are a starting point you rewrite for your own edge, and the Docker Compose install receives its `Caddyfile` with the release.

Every such change is named in the **Upgrade notes** that open the release notes, and the notes say so when there is none; [Read the release notes](./8-upgrading.md#read-the-release-notes) says what to do about each.

Upgrade to such a release the way [Upgrading](./8-upgrading.md) describes, whatever its notes say: the migrations and the roles first, and then the processes.

## Two releases side by side

Every release works with the release right before it, prereleases aside, whatever its number:

- The web apps and `publira server` of the two releases call each other, in either direction.
- The processes of the earlier release keep working on the schema and the roles that the later release's `db migrate` and `db roles` leave. A release drops or renames a table, a column, or a grant only once the release before it no longer reads it.

So an upgrade to the next release can keep the install serving, with its processes replaced one copy at a time, and what the new release adds works once every process runs it. The promise reaches one release: between releases further apart, stop the processes before you upgrade, or upgrade one release at a time.

## Patch releases

A patch release carries fixes alone and is held to what can be applied by replacing the images: no migration, no environment variable added, renamed, or no longer read, no database role, no change to what the edge has to do, no process or service the install did not run before, and no search index to rebuild. A fix that needs any of them is released in the next minor release instead.

Its Upgrade notes therefore ask nothing of you. Upgrade to it the way [Upgrading](./8-upgrading.md) describes all the same, from the backup to replacing the processes: the steps cost little when the schema does not change, and the backup is still the way back if a patch release ever carries a change it should not.

## Before 1.0.0

While the major number is `0`, the minor number takes its place. A change that breaks an install lands in a minor release, such as `v0.2.0`, and everything else lands in a patch release, such as `v0.2.1`, new capabilities and migrations that only add included.

A `0.x` patch release may therefore carry a migration, and its processes can read what that migration adds and fail on a schema that does not have it. Replacing the images is not enough: run `db migrate` and `db roles` before the processes are replaced, as [Upgrading](./8-upgrading.md) describes.

## Which releases receive fixes

Only the newest minor release receives fixes, security fixes included, and they are released as patch releases of it. When a minor release is published, the one before it stops receiving fixes, so an install on an earlier minor release gets a fix by upgrading to the newest release.

Report a vulnerability privately, from [Report a vulnerability](https://github.com/publira/publira/security/advisories/new) on the repository's Security tab, rather than in a public issue.

## Skipping releases

You can upgrade from any release to any later one in a single step. `db migrate` applies the migrations of every release in between in one run, so the schema needs nothing from you.

What it does not apply is what the release notes ask of you, so read the notes of every release after the one you run, up to and including the one you upgrade to. Only the major releases among them name anything, and before `1.0.0` the minor releases. Their Upgrade notes add up: set every variable they add, pass `db roles` a password for every role added in between, and carry every change to what the edge has to do into your edge. A release in between may also have retired something the release you run still reads, so [stop the processes](./8-upgrading.md#decide-whether-to-stop-the-processes-first) before you skip one.

## Verify a release

Every image of a release, and its Compose install, carries a keyless [Sigstore](https://www.sigstore.dev/) signature made by the repository's workflow when it publishes them. The signature names that workflow and the release's tag, so there is no key to fetch or trust, and an image or an archive built anywhere else fails to verify. Verifying needs [cosign](https://docs.sigstore.dev/cosign/system_config/installation/). Nothing requires it: `docker pull` and the Compose install work as before without it.

### The images

Verify each image you run against the workflow that pushes the images, with `<version>` the release's version, such as `0.1.0` for `v0.1.0`:

```bash
cosign verify ghcr.io/publira/publira:<version> \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-images.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It lists the checks it made, then prints the signature's claims as JSON, where `docker-manifest-digest` is the digest of the image the signature covers. It fails on an image that has no signature from that workflow at that tag. Repeat it for `publiractl`, `web-storefront`, and `web-admin`, and for `web-platform` and `email-renderer` if you run them. A tag can be pushed again, so to run exactly what you verified, refer to the image by that digest, `ghcr.io/publira/publira@sha256:<digest>`, instead of by its tag.

### What the attestations hold

Each image carries two attestations for each of its platforms, which BuildKit writes while it builds the image:

- **An SBOM**, in SPDX: the operating system packages, the Node.js packages, and the Go modules the image holds.
- **SLSA provenance**: the commit and the workflow run that built the image, the Dockerfile and the arguments it was built with, and the digests of the base images it started from.

They are stored in the image's list of platforms beside the platform they describe, which is why that list shows an `unknown/unknown` entry next to `linux/amd64` and next to `linux/arm64`. `docker pull` and container runtimes skip those entries. The signature covers the list, and the list names each attestation by its digest, so read them through the digest `cosign verify` printed:

```bash
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/publira/publira@sha256:<digest> --format '{{json .Provenance}}'
```

Each prints a JSON object with one entry for `linux/amd64` and one for `linux/arm64`.

### The Compose install

The Release carries the archive's signature beside it, as `publira-deploy-<version>.tar.gz.sigstore.json`, made by the workflow that publishes the Release. Download both, and verify the archive before you extract it:

```bash
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz
curl -fsSLO https://github.com/publira/publira/releases/download/v<version>/publira-deploy-<version>.tar.gz.sigstore.json
cosign verify-blob publira-deploy-<version>.tar.gz \
  --bundle publira-deploy-<version>.tar.gz.sigstore.json \
  --certificate-identity https://github.com/publira/publira/.github/workflows/release-notes.yml@refs/tags/v<version> \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

It prints `Verified OK`, and fails on an archive that differs from the one the workflow signed by a single byte. The archive names the images by their tag, so verify them as well, as [The images](#the-images) describes.

## Next steps

[Upgrading](./8-upgrading.md) takes a running install to a new release of any kind, and says what to do when a migration fails.
