---
title: Web Push
description: Turn on the browser notifications readers can receive from every tenant's site, and the key pair they are signed with.
published: 2026-10-06
---

A reader can let a tenant's site send notifications to their browser, so they hear of a new episode without opening the site. The install sends them through the push service of each reader's browser, and signs each one with a VAPID key pair that belongs to the install. Web Push is optional and off until you turn it on; an install that never does sends no browser notifications and fails nothing.

Every `publiractl` command here is shown bare; run it the way [The Platform Console and publiractl](./1-platform-console.md#choosing-between-them) describes, with `PUBLIRA_PLATFORM_DB_URL` set to the `publira_platform` connection and the same `PUBLIRA_SECRET_ENCRYPTION_KEYS` and `PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID` the processes run with. Every flag is in the [`publiractl` reference](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#webpush).

## What turning it on takes

Two things, both kept in the install's settings rather than in any process's environment:

- **The VAPID key pair**, which the browsers' push services check every notification against. Publira generates it; you never handle either key. The private key is stored encrypted with the install's encryption keys and never shown, and the public key is handed to each reader's browser when it subscribes.
- **The subject**, a contact the push services can reach you at if something is wrong with what the install sends: an email address as `mailto:push@example.com`, or the `https://` URL of a contact page.

Web Push stays off until a subject is saved. Until then the storefront does not offer browser notifications, and the worker sends none.

## Turning it on

### From publiractl

```bash
publiractl webpush init --subject mailto:push@example.com
publiractl webpush show
```

`webpush init` generates the key pair if none is stored yet and saves the subject. `webpush show` prints the subject and the public key.

`publiractl setup` offered this step too, so an install that answered it already has Web Push on.

### From the Platform Console

Choose **Web Push** under **Services** in the sidebar. Opening the screen generates the key pair if none is stored yet. Enter the **Contact (VAPID subject)** and choose **Save Web Push settings**; the screen then says Web Push is configured. An Operator or a Super admin can save; an Auditor only sees the screen.

If the screen says it cannot set Web Push up because the API server has no secret encryption keys, `publira server` was started without `PUBLIRA_SECRET_ENCRYPTION_KEYS`. Set the same keys the other processes run with, restart it, and open the screen again.

### Checking that it works

The API and the worker read the settings again every ten seconds, so the saved subject reaches them without a restart. The first save also has the worker drop the cached copy of every tenant's site information about twenty seconds later, once the API is answering with the subject, so each site offers browser notifications from its next request on. That drop is a cache revalidation in the outbox, sent like every other one: a worker without `PUBLIRA_REVALIDATE_TOKEN` cannot send it, as [The outbox](./10-scheduled-jobs.md#the-outbox-mail-push-and-cache-revalidation) describes.

To see it work, sign in to a tenant's site as a reader, turn on **New episode notifications** under **Browser notifications** in the reader's notification settings, and follow a series: the next episode published in it arrives as a browser notification.

Each save is recorded in **Audit logs**.

## Changing it later

The subject can be changed at any time, with `webpush init` and a new `--subject` or from the same screen. It cannot be removed: once a subject is saved, Web Push stays on.

The key pair is never replaced. Every browser subscription was made against its public key, so a new pair would silently stop notifications to every reader who turned them on; nothing in `publiractl` or the Platform Console generates a second one. This makes the pair part of what the install's backups have to keep: it lives in the database, encrypted with the encryption keys, and is lost if either is. Nothing seals the private key again under a new encryption key, so an install that rotates its keys keeps the old one in the list, as [Rotating the secret encryption keys](./12-security.md#rotating-the-secret-encryption-keys) describes.

A subscription a browser has given up — because the reader revoked the permission or cleared the site's data — is removed the next time a notification to it is refused.

## Notifications on the mobile app

Web Push covers browsers only. The notifications a tenant's mobile app receives are sent through the tenant's own Firebase project, which its administrators set up from the tenant console; nothing about them is an install setting. [Push notifications](../5-mobile-app/3-push-notifications.md) describes that setup.
