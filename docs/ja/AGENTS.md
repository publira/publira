# Writing Japanese pages

How a page under `docs/ja/` is written. What every translated page keeps from its English page, and how it is kept in step, is in [`docs/AGENTS.md`](../AGENTS.md#translating-a-page).

Japanese pages are written in the polite form, with no space between Japanese and Latin letters, digits, or inline code. Parentheses in prose are half-width, with a space on their outer side where a letter or a digit would otherwise touch them, since a half-width parenthesis run straight into Japanese is hard to pick out: `設定 (任意) は`, but `設定 (任意)、`. A colon, full-width or not, is an English device and is not used; the sentence says the same thing in Japanese. An enumeration inside a sentence joins its items with と, や, or 、, one way per list, and never with 中黒. A 読点 marks a pause the reader needs to parse the sentence, not every clause, and a sentence that needs many of them is split instead. Screen text quoted from `locales/ja.json`, in bold or in 「」, keeps the catalog's own characters, parentheses included.

`pnpm docs:check` fails on a half-width parenthesis that a letter or a digit touches on its outer side, outside bold and 「」.
