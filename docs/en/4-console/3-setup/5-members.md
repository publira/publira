---
title: Members
description: Invite the publisher's staff to the console, give each of them the role they need, and remove them when they leave.
published: 2026-10-07
---

**Members**, under **Administration**, lists everyone who can sign in to this console, and is where a Tenant admin brings staff in, changes their roles, and takes them out again. Only a Tenant admin sees it.

A member of staff is an account on the tenant's site that also holds a console role. Staff sign in to the console with the same email address and password they use on the site, and taking someone's role away leaves their account on the site as it was. [A tenant's staff](../../3-operations/3-tenant-staff.md#members-and-users) explains this from the operator's side.

## The roles

| Role | What it may do |
| --- | --- |
| **Tenant admin** | Everything in the console, this screen included |
| **Editor** | The catalog, the site's pages and announcements, and comment moderation |
| **Auditor** | See what an Editor works on, and the tenant's settings, without changing any of it |

[Tenant console](../index.md#roles) lists what each role covers. Keep the number of Tenant admins small: a Tenant admin can replace the tenant's payment and mail credentials, suspend and delete its readers' accounts, and change its staff.

## Inviting a Tenant admin

Under **Invite a tenant admin**, enter the address in **Email address to invite** and choose **Send invitation**:

- **An address with no account on the site** is mailed an invitation, in the tenant's default language. The link in it leads to this console, where the invitee enters their **Full name** and a **Password** and chooses **Accept invitation**. They then sign in as a Tenant admin. The link is valid for 24 hours.
- **An address that already has an account on the site** is made a Tenant admin at once, and no mail is sent. Any role it held before is replaced.

An invitation can only make a Tenant admin.

**Admin invitations** lists each invitation as **Pending**, **Accepted**, **Canceled**, or **Expired**. On a pending one, **Resend** mails it again with a new link, valid for another 24 hours, and **Cancel invitation** withdraws it. Either way the earlier link stops working. To try again after an invitation has expired or been canceled, invite the same address again.

An invitation is mailed by the platform's mail server unless the tenant sends through its own, as [Email](./6-email.md) describes. If one does not arrive, check the invitee's spam folder, then the tenant's mail settings.

## Adding an Editor or an Auditor

The console cannot yet give an Editor or an Auditor role to someone who holds no role ([#3794](https://github.com/publira/publira/issues/3794), [#3795](https://github.com/publira/publira/issues/3795)). Until it can, choose one of these:

- **Ask the operator.** The Platform Console and `publiractl` can give any role to an account that already exists on the site, so the person signs up on the site first and the operator then gives the account its role, as [Adding an existing user](../../3-operations/3-tenant-staff.md#adding-an-existing-user) describes. The account never holds more than the role it needs.
- **Invite, then change the role.** Invite the person as a Tenant admin, and once they hold the role, change it as described below. For as long as they are a Tenant admin, they can do everything a Tenant admin can, so do this only for someone you would trust with it, and change the role as soon as they appear in **Members**.

## Changing a role

In **Members**, choose the new role in the member's **Role** column and choose **Change role**. The change applies to the member's next action in the console, including in a console they already have open.

## Removing a member

**Remove** on a member's row, confirmed with **Remove**, takes every role from them. They are shut out of the console from their next action. Their account stays on the site as a reader's, with their purchases and history.

To take away their reading too, suspend or delete the account from their page under **Readers**, which the member's name in the list links to. [Readers](../2-readers.md#readers) describes what each of the two leaves in place.

## The last Tenant admin

The console refuses to demote or remove the tenant's last active Tenant admin, yourself included, so that someone can always manage the staff. Make someone else a Tenant admin first.

If the last Tenant admin leaves the publisher or loses access to their account anyway, the operator can give the role to someone else, as [Recovering a tenant with no administrator](../../3-operations/3-tenant-staff.md#recovering-a-tenant-with-no-administrator) describes.

## What is recorded

Every invitation, resend, cancellation, acceptance, role change, and removal is recorded in the [audit log](./7-audit-log.md), with the Tenant admin who made it.
