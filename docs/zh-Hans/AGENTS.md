# Writing Simplified Chinese pages

How a page under `docs/zh-Hans/` is written. What every translated page keeps from its English page, and how it is kept in step, is in [`docs/AGENTS.md`](../AGENTS.md#translating-a-page).

Pages use the terms of mainland China, such as 服务器, 数据库, 文件, and 默认, and address the reader as 您, as `locales/zh-Hans.json` does. There is no space between Chinese and Latin letters, digits, or inline code. Punctuation in prose is full-width, parentheses and colons included, and a quotation is set in “”. Screen text quoted from `locales/zh-Hans.json` keeps the catalog's own characters.

A bold label next to a Chinese character does not render as bold when the label begins or ends in punctuation, so the punctuation of a run-in heading sits outside the bold (`**证书**。`), and a quoted label that ends in punctuation is set in quotation marks (“**忘记密码？**”).
