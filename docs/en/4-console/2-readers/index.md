---
title: Readers, comments, and contact messages
description: Find and act on a reader's account, moderate comments and their reports, answer contact messages, and open a paid episode to a reader with an access ticket.
published: 2026-10-07
updated: 2026-10-21
---

The **Readers** group of the console is where the staff deal with the people who read the site: their accounts, the comments they leave on episodes, the messages they send through the contact form, and the access tickets that open a paid episode to one of them without payment. What is done here reaches a reader directly, sometimes without a way back, so each page says what an action does before saying how to take it.

Not every member of the staff sees every screen:

| Screen               | Tenant admin | Editor     | Auditor               |
| -------------------- | ------------ | ---------- | --------------------- |
| **Readers**          | Everything   | Not shown  | Not shown             |
| **Comments**         | Everything   | Everything | Reads, without acting |
| **Contact messages** | Everything   | Not shown  | Not shown             |
| **Access tickets**   | Everything   | Not shown  | Not shown             |

A screen that is not shown is missing from the menu, and its address answers as a page that does not exist.

## In this section

- [Readers](./1-readers.md): finding a reader's account, correcting their date of birth, removing their icon, and suspending or deleting the account.
- [Comments](./2-comments.md): what each state of a comment means, approving, removing, restoring, and purging comments, and working the approval and report queues.
- [Contact messages](./3-contact-messages.md): assigning and answering the messages readers send, where their replies go, and keeping track of what is handled.
- [Access tickets](./4-access-tickets.md): opening a paid episode to one reader without payment, and revoking the ticket.

## How the community limits apply

**Community limits**, under **Settings** › **Limits and retention**, caps how often one reader may act. A Tenant admin can make each limit stricter than the platform's, never looser, as [Limits and retention](../3-setup/1-settings.md#limits-and-retention) describes:

| Limit | What a reader runs into |
| --- | --- |
| **Comment posting**, per minute and per day | Posting more comments |
| **Comment reporting**, per minute and per day | Reporting more comments |
| **Contact messages per account**, per hour and per day | A signed-in reader sending more messages |
| **Contact messages per client**, per hour and per day | Anyone sending more messages from the same network address, signed in or not |
| **Duplicate comment window** | Posting the same text on the same episode again within that many minutes |

A reader over a limit is told "Too many requests in a short time. Please wait a moment and try again." and can act again once the period has passed. A reader repeating a comment inside the **Duplicate comment window** is told, on the site and in the app, "You have just posted this comment. The same text can be posted again after a while."

Tighten a limit when a reader or a script is flooding the comments or the contact form; suspend the account under [Readers](./1-readers.md#suspending-a-reader) when it is one reader. The limits count what readers do on the site and in the app, staff included when they comment there; what a moderator does in the console is not counted. What each limit counts is explained from the operator's side in [Platform defaults and policies](../../3-operations/9-platform-policies.md#community).
