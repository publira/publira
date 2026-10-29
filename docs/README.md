# Documentation

`docs/` holds the user documentation that [publira/website](https://github.com/publira/website) publishes under `https://www.publira.dev/docs/`, one tree per locale: `docs/en/`, and a translation of it beside it for each locale it is translated into. This file is the contract between the two repositories: what a locale's tree looks like, how a translated tree follows `docs/en/`, and how the website turns a tree into pages. It is not published itself.

The pages live here, beside the code they describe, so that a change to a behaviour and the change to its documentation land in the same pull request, and a release tag carries the documentation of that release. Which kind of text belongs here and which stays in a `README.md` is stated in [`AGENTS.md`](../AGENTS.md#user-documentation-docs).

## Languages

`docs/en/` is the source. Every page is written in English first, and every other tree under `docs/` is a translation of it named after a locale the UI ships a catalog for in [`locales/`](https://github.com/publira/publira/tree/main/locales): `docs/ja/` is the Japanese one. The documentation is translated from 1.0.0 on, when the behaviour it describes is held stable between releases, so a page changes as often as that behaviour does rather than with every minor release.

A translated tree mirrors `docs/en/` entry for entry: the same directories, pages, and images under the same `<n>-<slug>` names, so every locale publishes the same pages at the same URLs. A translated page translates the prose, the `title`, the `description`, and the alt text of its images, and keeps everything else as it is: the code blocks, the inline code, the URLs, the image references, and `redirect_from`. A link to a heading names the anchor of the translated heading, which differs from the English one.

Each translated page records which English text it carries in `source_updated`: the `updated` date of the English page it was brought in line with, or that page's `published` date while it has none. The English page's date moves with every change a reader should notice, as [`AGENTS.md`](AGENTS.md#updated-bumped-by-the-pull-request-that-changes-the-page) states, so a translation whose `source_updated` is earlier than it is behind, and nothing has to be compared by eye.

A pull request that changes an English page in a way that moves its `updated` brings every translation of that page in line in the same pull request, and sets each one's `source_updated` to the new date. One that adds, removes, renames, or moves a page or an image under `docs/en/` does the same in every tree, and regenerates that tree's screenshots. The behaviour change and its documentation land together in every language: a translation left to catch up later is one that tells its reader something the release no longer does, with nothing on the page to say so, and a release tag cannot be fixed afterwards. A change that leaves `updated` alone, such as a typo or a broken link, owes the translation nothing, though a fix to something the translation carries too is made there as well.

`pnpm docs:check` fails on a page or an image missing from either tree, on a translated page whose `source_updated` is not its English page's date, on a translated page that redirects from other URLs than its English page, and on a tree under `docs/` that names no locale in `locales/`.

## Layout and URLs

```text
docs/
  README.md                 # this contract; not published
  en/
    1-getting-started.md    -> /docs/next/getting-started
    2-deployments/
      index.md              -> /docs/next/deployments
      1-overview.md         -> /docs/next/deployments/overview
  ja/                       # the same entries, translated
    1-getting-started.md
    2-deployments/
      index.md
      1-overview.md
```

- Every file and directory under a locale's tree is named `<n>-<slug>` (a page adds `.md`), except `index.md` and images.
  - `<n>` is a positive integer without a leading zero. It orders the entry among its siblings and is left out of the URL. Numbers are unique among siblings, and gaps are allowed, so an entry can be inserted without renaming its neighbours.
  - `<slug>` is lowercase ASCII letters and digits, in words joined by `-`. It is the entry's URL segment, so it is unique among siblings too.
- `index.md` is the page of its directory. Every directory under a locale's tree has one, so every URL prefix resolves to a page and the directory has a title in the navigation.
- The version segment — `next` for `main`, a release for a tag — is the website's concern, and so is the segment, if any, that names the locale of a translated tree. Nothing under `docs/` names a version.

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
| `redirect_from` | no | The URLs the page was published at before a rename or a move, each the path below the version segment, such as `/deployments/reverse-proxy`. The website redirects each of them to the page, in every version whose tree carries the entry. A translated page lists the same ones as its English page |
| `source_updated` | in a translated tree only, where it is required | `YYYY-MM-DD`, the `updated` date of the English page this translation carries the text of, or that page's `published` date while it has none, as **Languages** above states |

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
- A link to source code, or to anything else in the repository outside the page's own tree, is an absolute `https://github.com/publira/publira/...` URL, since the website does not serve the repository. One to `blob/main/` or `tree/main/` names a file or a directory the repository has, and a fragment after a Markdown file names a heading in it, as above.

### Screenshots

A screenshot of the product is generated, never captured by hand. An image goes stale the moment its screen changes, and nothing in the text shows that it has, so every one of them is taken by the `docs-screenshots` Playwright project in [`e2e/`](../e2e/README.md#documentation-screenshots) and compared with the committed file on every E2E run: a change to the console that alters a documented screen fails that run until the image is regenerated. To add one, add a test to the console's `e2e/tests/*.docs-screenshots.spec.ts` naming the page, the subject, and the region to take, and reference the image from the page.

A screenshot shows the console in one language, so each locale's tree holds the screenshots of that locale: `docs/en/` holds the English ones, and `docs/ja/` the Japanese ones. A translated page keeps the reference as it is, and it resolves to its own locale's image beside it. The project takes every shot once for every locale that has a tree under `docs/`.

Regenerate every image, after a change that meant to alter the screens, against an E2E stack that has just been seeded:

```bash
task e2e:prepare
task e2e:up && task e2e:db && task e2e:start-apps && task e2e:wait-ready
task e2e:test -- --project=docs-screenshots --update-snapshots
task e2e:down
```

A shot is a PNG of the region a passage explains — a form, a list row with its actions, a dialog — at a 1280px viewport and twice the density, and never the full page.

## Commands a script runs

A code block whose commands CI runs, so that a procedure is proven rather than only described, is kept in that script as well, between a `# quoted by <page>` comment naming the page by its path from the repository root and an `# end of quote` comment:

```bash
# quoted by docs/en/2-deployments/9-backup-and-restore.md
publiractl storage test
# end of quote
```

The lines between the two, without the indentation of the first comment, have to read the same as a code block on that page, so a change to either is made to both. What the page leaves to the reader — which image `publiractl` is, where the database is — the script provides around the quote, under the names the page uses. A block with a value the reader fills in, such as `<bucket>`, is not quoted.

## Checking a change

```bash
pnpm docs:check
```

It enforces every rule above that a program can, and `pnpm preflight` and CI's `Check` job run it. What it cannot judge — whether a page belongs here at all, and whether a change is one a reader should notice in `updated` — is left to review.
