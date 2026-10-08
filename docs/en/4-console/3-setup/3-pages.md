---
title: Pages
description: Write the site's own pages in Markdown, publish and roll back their versions, translate them, and make two of them the terms of service and privacy policy readers agree to.
published: 2026-10-07
---

**Pages**, under **Site**, holds the pages the publisher writes for the site: the terms of service, the privacy policy, a page about the publisher, submission guidelines, and anything else that is not a series. A page is written in Markdown, kept in versions, and can be translated into each of the site's languages.

A Tenant admin and an Editor can create, edit, publish, and translate pages. An Auditor can open them without changing anything.

## Creating a page

Choose **Create page** and fill in:

- **slug**: the page's address on the site. `privacy` serves the page at `https://comics.example.com/privacy`, and `legal/terms` at `https://comics.example.com/legal/terms`. Use lowercase letters, digits, and hyphens, with `/` between the parts of a nested path. The slug cannot be changed once the page exists, because links to it would break. Paths the site uses itself, such as its sign-in and account pages, are refused.
- **Title**: shown at the top of the page and wherever it is linked. The page is created in the site's default language.
- **Show in footer**: lists the page by its title in the footer of every page of the site once it is published. It can be changed later on the edit screen.
- **Content**: the first version of the page's body, in Markdown. It may be left empty and written on the next screen.

**Create page** creates the page as a draft and opens its edit screen. Nothing appears on the site until a version is published.

Pages cannot be deleted. A page that should no longer be read is unpublished instead, as described below.

## Writing and publishing

The edit screen holds the page's body on two tabs: **Write**, where you write Markdown, and **Preview**, which shows how it will look. The body takes headings, paragraphs, lists, quotes, code blocks, bold and italic text, and links.

**Save page** saves a changed title and **Show in footer** at once. A changed body is saved as a new **Draft** version, which readers do not see. Saving never publishes.

**Show in footer** belongs to the page rather than to one of its translations, so changing it on any language's tab changes it for every language. The footer follows moments after the save, for as long as the page is published.

**Versions** lists every version of the page, numbered `v1`, `v2`, and onward, with its status: **Published** for the one readers see, **Previously published**, or **Draft**. On each one:

- **Publish** makes that version the one readers see, in place of the version published before.
- **Load content** puts that version's body back into the editor, to continue from.
- **Roll back to this version** copies that version's body into a new draft. Publish the draft to put the old text back on the site.

**Compare versions** shows the lines added and removed between any two versions, once the page has two.

**Unpublish**, beside the page's status, takes the page off the site. Its versions are kept, and publishing one puts the page back.

The site shows a change moments after it is published.

## Translations

The edit screen has a tab for each of the site's languages under **Languages**. A language without its own translation is marked **(not added)**, and readers browsing the site in that language see the page in another language, with a note saying so. To add one, open its tab, enter a title, and choose **Add translation**. Then write and publish its body as above.

Each translation has its own title, versions, and published version, so a correction to one does not reach the others until it is made there too. **Delete this translation** removes one, but not the last.

## The terms of service and the privacy policy

Publira has no special kind of page for legal text. The terms of service and the privacy policy are ordinary pages, which a Tenant admin then names under **Settings** › **Terms and privacy policy**:

1. Create and publish each page here, in each language the site offers if readers should read them in their own.
2. Under **Settings**, choose them as **Terms of service** and **Privacy policy**, and choose **Save the terms and privacy policy**.

From then on:

- The site and the app link to both pages, whether or not they are in the footer.
- The sign-up form shows "I have read and agree to the following." above links to the two pages, and an account cannot be created without ticking it. A reader signing up with Apple or Google for the first time is shown the same agreement on **Finish signing up**.
- The tenant records which published version of each page every new reader agreed to, and when.

A page that is chosen but not published is not asked about at sign-up. If no page is chosen, sign-up asks for no agreement at all.

### Publishing a new version

Publishing a new version of either page changes what new readers agree to from then on. If a reader has the sign-up form open when you publish, their sign-up is refused with "The pages to agree to have been updated. Read them and agree again.", so nobody agrees to text they were not shown.

Readers who already have an account are not asked to agree to the new version. Publira asks for agreement only when an account is created, so they go on using the site under the version they agreed to, and the console has no way to ask them again yet ([#3798](https://github.com/publira/publira/issues/3798), [#3799](https://github.com/publira/publira/issues/3799), [#3800](https://github.com/publira/publira/issues/3800)). Until it does, tell readers about a change that matters to them with an [announcement](./4-announcements.md), linking to the page.
