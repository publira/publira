# Writing Traditional Chinese pages

How a page under `docs/zh-Hant/` is written. What every translated page keeps from its English page, and how it is kept in step, is in [`docs/AGENTS.md`](../AGENTS.md#translating-a-page).

Pages use the terms of Taiwan, such as 伺服器, 資料庫, 檔案, and 預設, and address the reader as 您, as `locales/zh-Hant.json` does. There is no space between Chinese and Latin letters, digits, or inline code. Punctuation in prose is full-width, parentheses and colons included, and a quotation is set in 「」, with 『』 inside it. Screen text quoted from `locales/zh-Hant.json` keeps the catalog's own characters.

A bold label next to a Chinese character does not render as bold when the label begins or ends in punctuation, so the punctuation of a run-in heading sits outside the bold (`**憑證**。`), and a quoted label that ends in punctuation is set in quotation marks (「**忘記密碼？**」).
