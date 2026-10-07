---
title: Series
description: Create a series, decide when and where it is shown, and set its age rating, reading direction, comments, cover image, and Free if you wait.
published: 2026-10-07
---

A series is the work a reader follows: it has a title, a synopsis, a cover, a label, and its Authors, and it holds the episodes readers open. **Series**, in the sidebar's **Catalog** group, lists the tenant's series, newest first, twenty to a page. **Serialization status** and **Age rating** above the list narrow it.

Each row opens the series with **Edit**, or **View** for an Auditor, and its episodes with **Episodes**. A row's **Status** is **Published** once the series has a **Publication date and time**, even one still ahead ([#3827](https://github.com/publira/publira/issues/3827)), and **Draft** without one. A series not shown on both the site and the app carries **Web only** or **App only** beside its title.

## Creating a series

Choose **Create series**. The form is the same one the series is edited with later, and every field on it can be changed afterwards. Choose **Create series** at the bottom to save it, which opens its edit page.

### What readers see first

- **Title**: up to 255 characters.
- **Synopsis**: the description on the series page, up to 10,000 characters.
- **Authors**: the people credited on the series, each in a role, as [Authors and Author roles](./4-authors.md#crediting-authors) describes. The percentage beside each is their share of the sales of the series' episodes, which [Reports and royalties](../5-reports-and-royalties.md#what-an-author-is-owed) explains. These credits are copied onto each episode when it is created: changing them later leaves the existing episodes as they are.
- **Label**: the imprint the series is published under. A series must have one, so create a label first, as [Labels](./3-labels.md) describes.
- **Genres**: any number of the tenant's genres, shown in the order set under **Genres**.
- **Tags**: up to 20 free words, each up to 50 characters, that readers can browse by. A tag that matches one already in use, ignoring case, is filed under it.
- **Cover image**: a JPEG, PNG, or WebP image of at most 10 MB and at least 2400 × 3200 pixels. It is offered on this form only when creating the series; afterwards it is changed on the **Cover image** tab, as [The cover image](#the-cover-image) describes.

### Publication date and time

**Publication date and time** is what makes a series public. It is read in the tenant's time zone, which the field names.

- **Empty**: the series is hidden. Its page answers as if it did not exist, and none of its episodes can be read, whatever their own state.
- **A time that has passed**, or the current time: the series is public as soon as it is saved.
- **A time in the future**: the series stays hidden until then. `publira worker` looks for series whose time has passed once a minute and refreshes the site's cached pages, so its lists and its top page include it within about a minute of that time.

Clearing the field later takes a public series off the site again, with its episodes. This is the only way to withdraw a series, since a series cannot be deleted.

### Shown on and Sold on

**Shown on** decides where readers can find the series: **Web and app**, **Web only**, or **App only**. A new series starts on **Web and app**. On a surface it is not shown on, the series and its episodes do not exist for the reader, and an episode can narrow this setting but never widen it.

**Sold on** decides where its paid episodes can be bought. It starts on **Follow the tenant setting**, which follows **Where episodes are sold** under **Integrations** › **Payments**, including after that changes. [Selling episodes](../4-selling-episodes.md#where-episodes-are-sold) covers both settings and why a tenant with an app might keep a series on the site alone.

### Serialization status and update schedule

**Serialization status** is **Ongoing**, **Completed**, or **On hiatus**. Readers see it on the series page and can filter the series list by it. It changes nothing else: a **Completed** series can still be given episodes.

**Update schedule** marks the weekdays a new episode is expected on. The series page then reads "Updates on" followed by those days, and the series is listed under each of them in **Browse by weekday** on the site's top page. With no day checked, the series page says nothing about a schedule, and the series is under no day ([#3827](https://github.com/publira/publira/issues/3827)). Nothing publishes an episode on those days: that is still each episode's own **Publication date and time**.

### Age rating

**Age rating** is **All ages**, **R15**, or **R18**. A series rated **R15** or **R18** carries the rating on the site, and its pages ask the reader to confirm their age before they open. Until a reader has confirmed it, rated series are also left out of the top page and of search results.

Whether confirming is enough, or the reader must also be signed in with a date of birth that proves their age, is decided for the whole tenant by **Ratings that need a proven age**, as [Settings](../3-setup/1-settings.md#age-verification) describes. A series cannot set this for itself.

### Comments

**Comments** decides how readers' comments on the series' episodes are published: **Do not accept comments**, **Publish straight away**, or **Publish after approval**. It starts on **Follow the tenant setting**, which follows **How comments are published** under **Settings**, including after that changes, as [Settings](../3-setup/1-settings.md#reader-comments) describes. Approving and moderating the comments is covered in [Comments](../2-readers.md#comments).

A choice made here applies to the series whatever the tenant setting is, so a series set to **Publish straight away** takes comments even while the tenant does not accept them.

### Reading direction and spreads

**Reading direction** is the way the series' pages are turned: **Right to left**, the way Japanese manga reads and the default, or **Left to right**. It sets the direction of a page turn, the order of the two pages in a spread, the progress bar, and which side the previous and next episode are on.

**Spreads start at page** decides where pages begin to be shown in pairs, on a screen wide enough for two. Pages before it are shown alone. `2`, the default, keeps the first page, usually the cover, on its own; `1` pairs from the first page. An episode with fewer pages than this is shown one page at a time.

An episode can set its own of either, as [Page layout](./2-episodes.md#page-layout) describes. One that does not follows the series, including after it changes.

### Reading period

The series form has a **Reading period**, in hours, but nothing uses it: each episode's own **Reading period** is what a purchase keeps the episode open for, and a new episode does not take the series' value ([#3768](https://github.com/publira/publira/issues/3768)). Set the period on each episode, as [Selling episodes](../4-selling-episodes.md#price-and-reading-period) describes.

## The cover image

The **Cover image** tab of a series replaces or removes the image chosen when the series was created. Under **Eye-catch image**, select a new image and choose **Update cover image**, or choose **Delete the current eye-catch image** to leave the series without one. A new image must be a JPEG, PNG, or WebP image of at most 10 MB and at least 2400 × 3200 pixels.

The site does not show the image as uploaded. Saving it cuts four images of fixed shapes out of it, which **Aspect ratio images** below shows. Their slots are headed by the names the site uses for them ([#3828](https://github.com/publira/publira/issues/3828)):

| Slot | Shape | At least | Where it is used |
| --- | --- | --- | --- |
| `portrait` | 3:4 | 1200 × 1600 | The series' cover on its page and wherever the series is listed |
| `square` | 1:1 | 1200 × 1200 | Square tiles in the app, and one of the images the site offers search engines |
| `landscape` | 16:9 | 1600 × 900 | Wide banners, and the picture beside each episode in the series' episode list |
| `og` | 1200:630 | 1200 × 630 | The preview shown when a link to the series is shared |

Each shape is cropped from the centre of the image. To frame one differently, choose **Adjust the frame** on its slot, or upload a separate image for that shape alone with **Replace**, which leaves the other three as they are. Uploading a new cover image above replaces all four.

Labels and genres have the same tab, with the same sizes.

## Free if you wait

**Free if you wait**, below the series form on the **Basic information** tab, lets signed-in readers open the series' paid episodes free, one at a time, with a ticket that comes back after a wait:

- **Offer free tickets on this series** turns it on. Turning it off keeps the numbers below for the next time, and an episode a reader already opened with a ticket stays open until its time is up.
- **Hours until the next ticket**: how long after using a ticket a reader gets the next one, from 1 to 8760. It starts at `23`. A change applies from each reader's next use.
- **Hours an episode stays open**: how long an episode opened with a ticket stays readable, from 1 to 8760. It starts at `72`.
- **Newest episodes a ticket cannot open**: how many of the latest published episodes, counted back from the last one in the series' order, are kept for buyers. `0` lets a ticket open any paid episode.

Choose **Save free-if-you-wait settings** to save. A reader holds one ticket per series, and tickets do not pile up while unused. A ticket cannot open an episode that is already free to everyone, one the reader can already open, or one their age does not allow. The series page tells readers how the tickets work, and marks the episodes a ticket cannot open with **No free ticket**.

[Selling episodes](../4-selling-episodes.md#free-reading-periods-and-free-if-you-wait) describes how tickets sit beside prices and free reading periods.
