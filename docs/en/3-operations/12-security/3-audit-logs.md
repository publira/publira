---
title: Audit logs
description: What the Platform Console's audit log and a tenant's audit log record, who can read each, and what neither records.
published: 2026-10-21
updated: 2026-10-27
---

An install keeps two audit logs that never share entries: the Platform Console's, for what operators and `publiractl` change, and each tenant's, for what its staff change in the tenant console. Entries are never deleted, and either log can be [exported as CSV](#exporting-a-log) a period at a time.

## The Platform Console's log

**Audit logs**, under **Governance** in the Platform Console, lists the newest entries first, 20 to a page. Every operator can read it, an **Auditor** included. Each entry shows the **Time**, the **Actor** with their role, the action with its outcome, and the **Target**. A change made from `publiractl` names no operator: its actor is **Command line**. The list can be narrowed to one actor by public ID and to one kind of action, but not to a date. **View audit logs** on a tenant's page opens it narrowed to that tenant as well: the entries that changed the tenant, its invitations, or the accounts of its staff and readers. The tenant is named above the list, and its close button drops that filter alone; **Clear** drops every filter.

![The Platform Console's audit log narrowed to one tenant: Tenant: Platform Docs Tenant with its close button, the actor and event filters, Filter, and Clear, and six entries, each with its time, its actor and their role or Command line, its action and outcome, and its target.](./audit-logs-tenant-filter.png)

It records:

- **Operators**: added, changed, suspended, reactivated, and deactivated; and each operator's own two-step verification: set up, a code asked for at sign-in, whether right or wrong, a sign-in with a recovery code, new recovery codes, and turning it off.
- **Platform settings and services**: each save of the general settings, the security and community policy, the retention defaults, the email, storage, and search settings, and the Web Push contact, and each test of the email, storage, and search connections, with its outcome.
- **Tenants and their staff**: tenants created, changed, suspended, and resumed; administrators invited, and invitations resent and canceled; members added, created with a password, given a new role, and removed.
- **Readers**: accounts suspended, restored, and deleted by an operator.
- **The log itself**: each export of it, with the period it covered and the tenant it was narrowed to.

## A tenant's log

Each tenant's **Audit logs**, under **Administration** in its console, records what its staff do there, two-step verification included, and only its Tenant admins can read it. What it records is in [Audit log](../../4-console/3-setup/8-audit-log.md). It cannot be read from the Platform Console, and what you change for a tenant from the Platform Console or `publiractl` is recorded in the Platform Console's log, not the tenant's.

## Exporting a log

Either log can be exported as one CSV file covering at most 366 days, by the people who can read it: a tenant's log by its Tenant admins, the Platform Console's by every operator, an **Auditor** included. The period is whole days, in the tenant's time zone for a tenant's log and in the platform's **Default time zone** for the Platform Console's, and the actor, the action, and for the Platform Console's log the tenant narrow the file the way they narrow the list.

The file holds every entry of the period, oldest first, one row to an entry: the time it was recorded, with the offset of the zone the period is in; the actor's public ID, name, and role; the action, its outcome, and its reason; the kind and ID of what it acted on; and the client address. A file of the Platform Console's log also names each entry's tenant, by public ID and name, and the public ID and name of what the entry acted on. The file is UTF-8 with a byte order mark, which is what makes a spreadsheet read it as UTF-8, and a value a spreadsheet would read as a formula is written with a leading apostrophe, so that it stays text.

An export is itself an entry in the log it read, so the log shows who took a copy of which period, and when.

## What neither log records

- **Signing in with a password.** Neither a successful sign-in nor a wrong password leaves an entry; a tenant's log records only the two-step verification step that follows. `publira server` logs every attempt to sign in to the site, a tenant console, or the Platform Console as a line beginning `audit auth`, with the action, the outcome, the reason, and the client address, such as `audit auth action=admin_login outcome=failure ... reason=invalid_credentials`. Keep the server's log if you need that record.
- **The install's secrets and variables.** Rotating a key, a password, or a token happens outside Publira and leaves no entry anywhere. Keep your own record of when you rotated what.

Every entry is also written to the log of `publira server` as a line with `msg=audit`, before it is stored. Most entries are stored a moment after the change, from a queue in the server's memory, and an entry that cannot be stored after a few attempts, or that is still queued when the server stops, is dropped from the console's list but stays in that log line. [Monitoring](../11-monitoring.md#the-audit-log) names the log lines and metrics to alert on for those drops.
