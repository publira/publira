# Documentation Agent Guide

Conventions for writing the documentation pages, which live in one tree per locale under `docs/`: `docs/en/`, and a tree for each translation of it, as **Languages** in [`README.md`](README.md#languages) states. Prefer this file when editing a page; root [AGENTS.md](../AGENTS.md) remains the top-level source of truth, and [`README.md`](README.md) is the contract the website reads — the names, the URLs, the frontmatter, and the link rules.

## `updated`: bumped by the pull request that changes the page

A change to a page, in any locale's tree, that a reader should notice sets the page's `updated` frontmatter to the date of the pull request that makes it, in that same pull request. A reader should notice a new or removed step, requirement, option, screen, or behaviour, and a corrected statement of fact. A typo, a broken link, or a sentence reworded to say the same thing does not bump it. The format of the key — `YYYY-MM-DD`, never earlier than `published`, omitted until there is a first such change — is the one in the frontmatter table under **Page format** in [`README.md`](README.md#page-format).

Each page carries its own `updated`, so a translated page is judged by what changed in its own body for its own reader, not by the date of the English page it follows.

The author makes that judgement and bumps the date before requesting review, and the reviewer confirms the judgement rather than making it. The website shows `updated` on the page and hands it to search engines as the page's modification date, so a body that changed under an older date tells a returning reader, and a crawler, that there is nothing new to read. A bump left for review to ask for costs a review round and a follow-up commit every time.

`pnpm docs:check` enforces the format. Whether a change is one a reader should notice is a review judgement, which no program can make.

## Translating a page

A translated page says what its English page says, for a reader of that locale: every step, condition, caveat, and reason survives, and nothing is added that the English page does not say. A fact that is wrong or missing in the translation is fixed in the English page first and carried across, so the two never disagree on what the product does.

A screen element is named by its label in that locale's catalog, `locales/<locale>.json`, at the key whose `locales/en.json` text the English page uses, so the reader finds on screen the words the page names. The credited creator and the writer of a comment take the words the root [AGENTS.md](../AGENTS.md#a-credited-creator-creator-in-code-author-on-screen) fixes for that locale.

Japanese pages are written in the polite form, with no space between Japanese and Latin letters, digits, or inline code. Parentheses in prose are half-width. A colon, full-width or not, is an English device and is not used; the sentence says the same thing in Japanese. An enumeration inside a sentence joins its items with と, や, or 、, one way per list, and never with 中黒. A 読点 marks a pause the reader needs to parse the sentence, not every clause, and a sentence that needs many of them is split instead. Screen text quoted from `locales/ja.json` keeps the catalog's own characters.

`pnpm docs:check` checks the shape a translation keeps — the pages and images it mirrors, the `source_updated` it records, and the links and anchors it resolves. Whether its text says what the English page says is a review judgement.
