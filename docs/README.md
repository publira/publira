# Documentation

`docs/en/` is the user documentation that [publira/website](https://github.com/publira/website) publishes under `https://www.publira.dev/docs/`. This file is the contract between the two repositories: what the tree under `docs/en/` looks like, and how the website turns it into pages. It is not published itself.

The pages live here, beside the code they describe, so that a change to a behaviour and the change to its documentation land in the same pull request, and a release tag carries the documentation of that release. Which kind of text belongs here and which stays in a `README.md` is stated in [`AGENTS.md`](../AGENTS.md#user-documentation-docsen).

## Languages

Until 1.0.0 the documentation is written in English alone: `docs/en/` is the only tree under `docs/`, and a pull request that adds another — `docs/ja/` or any other locale — is not accepted.

Throughout 0.x a minor release can still change the behaviour a page describes, and every such change rewrites the English page in the same pull request. A translation kept beside it would have to follow each of those changes, and a copy that nothing checks drifts from its original without anyone noticing, which is why the repository keeps none.

The documentation is translated from 1.0.0 on, Japanese first and the other locales the UI ships after it. The English page is the source every translation follows. How a translated page records which English page it follows, and how a stale one is found, is decided together with the first translation.

`pnpm docs:check` fails on any directory under `docs/` other than `en/`, so the rule is enforced rather than remembered; the first translation lifts that check.

## Layout and URLs

```text
docs/
  README.md                 # this contract; not published
  en/
    1-getting-started.md    -> /docs/next/getting-started
    2-deployments/
      index.md              -> /docs/next/deployments
      1-overview.md         -> /docs/next/deployments/overview
```

- Every file and directory under `docs/en/` is named `<n>-<slug>` (a page adds `.md`), except `index.md` and images.
  - `<n>` is a positive integer without a leading zero. It orders the entry among its siblings and is left out of the URL. Numbers are unique among siblings, and gaps are allowed, so an entry can be inserted without renaming its neighbours.
  - `<slug>` is lowercase ASCII letters and digits, in words joined by `-`. It is the entry's URL segment, so it is unique among siblings too.
- `index.md` is the page of its directory. Every directory under `docs/en/` has one, so every URL prefix resolves to a page and the directory has a title in the navigation.
- The version segment — `next` for `main`, a release for a tag — is the website's concern. Nothing under `docs/` names a version.

## Page format

A page is plain Markdown: CommonMark plus GFM tables, parsed as the website parses its own `content/<locale>/*.md`. There is no MDX — no JSX, no imports, no expressions — so a stray `<` or `{` is text, and a translation tool can segment the file by paragraph.

A page opens with YAML frontmatter:

```markdown
---
title: Overview
description: What a Publira install runs, and the services it depends on.
published: 2026-10-04
updated: 2026-10-04
---

A Publira install is made of ...

## What an install runs
```

| Key | Required | Meaning |
| --- | --- | --- |
| `title` | yes | The page title: the `<h1>`, the `<title>`, and the label in the navigation. The body does not repeat it as a `#` heading, and starts at `##` |
| `description` | yes | One sentence for the meta description and the Open Graph card |
| `published` | yes | `YYYY-MM-DD`, the date the page was first published |
| `updated` | no | `YYYY-MM-DD`, the date of the last change a reader should notice, never earlier than `published`. Omitted until there is one; a typo fix does not bump it |
| `redirect_from` | no | The URLs the page was published at before a rename or a move, each the path below the version segment, such as `/deployments/reverse-proxy`. The website redirects each of them to the page, in every version whose tree carries the entry |

No other key is allowed: a misspelt one would otherwise be ignored by both sides.

### Renaming or moving a page

A page's slug, and the slugs of the directories above it, are its URL, so renaming either or moving the page to another directory changes where it is published. Bookmarks, search results, and links from outside the repository still name the old URL, so the page lists it in `redirect_from` in the same pull request:

```markdown
---
title: Edge
description: What the load balancer, proxy, or CDN in front of an install has to do.
published: 2026-10-06
redirect_from:
  - /deployments/reverse-proxy
---
```

An entry stays when the page moves again, and the new former URL is added beside it, so every URL the page was ever published at keeps reaching it. An entry may not be the URL of a page the tree has, which the website would serve in place of the redirect, nor one another page lists too. Changing only a number changes no URL, and needs no entry.

The dates are written down rather than derived from `git log`, because the numbered names make renames routine — moving `2-deployments/` to `3-deployments/` would reset a date taken from history — and the website may build from a shallow clone.

## Links and images

- A link to another page is a relative path to its `.md` file, a directory's page included (`[Deployments](./2-deployments/index.md)`). It works when the file is read on GitHub, and the website rewrites it to the page URL. A fragment (`./1-overview.md#what-an-install-runs`) is kept, and is the anchor of a heading on that page: its text lowercased, without punctuation, with each space turned into `-`, and `-1`, `-2`, and so on after a heading that repeats an earlier one.
- An image sits beside the page that shows it and is referenced by a relative path. It is an `.avif`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.svg`, or `.webp` file, and a page in the same directory shows it.
- An image is named `<page slug>-<subject>`, where the page slug is the name of a page that shows it, without its number — `index` for an `index.md` — and the subject is lowercase ASCII words joined by `-`: `episodes-create-form.png` beside `2-episodes.md`, `index-sidebar.png` beside `index.md`. Leaving the number out keeps a reordering from renaming images, and the slug keeps the images of sibling pages apart.
- Every image has alt text that says what it shows, for a reader who cannot see it.
- A link to source code, or to anything else in the repository outside `docs/en/`, is an absolute `https://github.com/publira/publira/...` URL, since the website does not serve the repository. One to `blob/main/` or `tree/main/` names a file or a directory the repository has, and a fragment after a Markdown file names a heading in it, as above.

### Screenshots

A screenshot of the product is generated, never captured by hand. An image goes stale the moment its screen changes, and nothing in the text shows that it has, so every one of them is taken by the `docs-screenshots` Playwright project in [`e2e/`](../e2e/README.md#documentation-screenshots) and compared with the committed file on every E2E run: a change to the console that alters a documented screen fails that run until the image is regenerated. To add one, add a test to the console's `e2e/tests/*.docs-screenshots.spec.ts` naming the page, the subject, and the region to take, and reference the image from the page.

A screenshot shows the console in one language, so each locale's tree holds the screenshots of that locale: `docs/en/` holds the English ones. A translated page keeps the reference as it is, and it resolves to its own locale's image beside it. The project takes every shot once for every locale that has a tree under `docs/`.

Regenerate every image, after a change that meant to alter the screens, against an E2E stack that has just been seeded:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test -- --project=docs-screenshots --update-snapshots
task e2e:down
```

A shot is a PNG of the region a passage explains — a form, a list row with its actions, a dialog — at a 1280px viewport and twice the density, and never the full page.

## Checking a change

```bash
pnpm docs:check
```

It enforces every rule above that a program can, and `pnpm preflight` and CI's `Check` job run it. What it cannot judge — whether a page belongs here at all, and whether a change is one a reader should notice in `updated` — is left to review.
