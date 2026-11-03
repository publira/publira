# Writing Korean pages

How a page under `docs/ko/` is written. What every translated page keeps from its English page, and how it is kept in step, is in [`docs/AGENTS.md`](../AGENTS.md#translating-a-page).

Korean pages are written in 합니다체, with standard Korean word spacing. A particle attaches directly to a Latin word or inline code, in the form its pronunciation takes (`` `publiractl`은 ``, `S3를`). Punctuation and parentheses are half-width, as `locales/ko.json` writes them. Screen text quoted from `locales/ko.json` keeps the catalog's own characters.

A bold label followed directly by a particle does not render as bold when the label ends in punctuation, so such a label is followed by a space and a noun (`**비밀번호를 잊으셨나요?** 링크를`), or the sentence is turned so that no particle follows it.
