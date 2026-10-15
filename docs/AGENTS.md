# Documentation Agent Guide

Conventions for writing the pages under `docs/en/`. Prefer this file when editing a page; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth, and [`README.md`](README.md) is the contract the website reads — the names, the URLs, the frontmatter, and the link rules.

## `updated`: bumped by the pull request that changes the page

A change to a page that a reader should notice sets the page's `updated` frontmatter to the date of the pull request that makes it, in that same pull request. A reader should notice a new or removed step, requirement, option, screen, or behaviour, and a corrected statement of fact. A typo, a broken link, or a sentence reworded to say the same thing does not bump it. The format of the key — `YYYY-MM-DD`, never earlier than `published`, omitted until there is a first such change — is the one in the frontmatter table under **Page format** in [`README.md`](README.md#page-format).

The author makes that judgement and bumps the date before requesting review, and the reviewer confirms the judgement rather than making it. The website shows `updated` on the page and hands it to search engines as the page's modification date, so a body that changed under an older date tells a returning reader, and a crawler, that there is nothing new to read. A bump left for review to ask for costs a review round and a follow-up commit every time.

`node scripts/check-docs.ts` in the `Check` job enforces the format. Whether a change is one a reader should notice is a review judgement, which no program can make.
