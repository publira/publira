---
title: Platform defaults and policies
description: Choose the defaults, security limits, community limits, and retention periods every tenant inherits, and what a tenant can change for itself.
published: 2026-10-06
---

An install runs on a handful of settings that no tenant owns: the language and time zone new tenants start from, the limits that keep one reader or one address from overwhelming the platform, and how long expiring records are kept. This page says what each group protects against, how to change it, and which parts a tenant's administrators can change for their own tenant.

Every policy and retention value has a built-in default, and an install that saves none runs on those. So does the default time zone, which is `UTC` until one is saved. The default language has none: `publiractl setup` saved one, and the Platform Console's setup screen replaced it with the language its first operator chose. The range and the built-in default of each value are in the `publiractl` reference, under [`policy`](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#policy) and [Retention periods](https://github.com/publira/publira/blob/main/server/cmd/publiractl/README.md#retention-periods); this page does not repeat them.

## Where the settings are

Each group can be set from the Platform Console or from `publiractl`, run the way [The Platform Console and publiractl](./1-platform-console.md#choosing-between-them) describes:

| Group | Platform Console | `publiractl` |
| --- | --- | --- |
| The default language and time zone | **General**, under **Platform** | `platform set`, `platform show` |
| Two-step verification, the password, purchase, ticket, and mail limits, and the disposable email domain list | **Security**, under **Policies** | `policy set`, `policy show` |
| The sign-in attempt limits | None yet | `policy set`, `policy show` |
| The comment, report, rating, contact, and viewer limits | **Community**, under **Policies** | `policy set`, `policy show` |
| How long expiring records are kept | **Retention**, under **Policies** | `retention set`, `retention show` |

Both write through the same code. A `set` command changes only the values its flags name and keeps the rest, and a page in the Platform Console saves every value on it at once. A save that changes nothing is not recorded; any other save is recorded in **Audit logs** as **Updated platform settings**, **Updated the platform policy**, or **Updated the retention defaults**. The **Security**, **Community**, and **Retention** pages do not overwrite a save they have not seen: if someone saved that page after you opened it, the Platform Console refuses with "Another operator changed these settings, so nothing was saved. Reload and try again." **Security** and **Community** are saved as one policy, so a save of either one refuses a stale copy of the other too. The two forms on **General settings** do not check this: each saves its own value over whatever is stored, and keeps the other value as stored. `publiractl` reads the stored values just before it writes them, and if another save lands between the two, it exits `1`, after which running the same command again applies its flags over that save.

An Operator or a Super admin can save these pages. An Auditor sees the same forms and has the save refused.

Until a policy is saved, the **Setup status** card on the Platform Console's dashboard reads "The built-in sign-in, abuse-control, and data retention limits apply." That is a working install, not an unfinished one: change a value only when the built-in one does not suit the platform.

## Platform defaults

**General settings** holds two values, each with its own save button.

**Default language** is the language the Platform Console is shown in to an operator who has not chosen one, its sign-in screen included, and the language of the mail the Platform Console sends its operators, such as a password reset. It does not decide any tenant's language: every tenant is given its own default language when it is created, as [Tenants](./2-tenants.md#before-you-create-a-tenant) describes. The first operator chose this value on the setup screen.

**Default time zone** is the time zone a new tenant starts on when it is created without one, and the one the Platform Console shows and counts dates in. A tenant keeps the time zone it was created on, so changing the default moves only tenants created afterwards. A tenant's administrators change its time zone from the tenant console.

From the command line:

```bash
publiractl platform set --default-locale en --default-timezone America/New_York
```

## Security

**Security policy** holds the values that apply to every tenant alike, and that no tenant can change. Each one guards an account, an operation that sends mail, or one that touches money.

### Two-step verification for tenant administrators

**Require multi-factor authentication for tenant administrators** (`--mfa-required-for-tenant-admin`) stops a tenant administrator from signing in to the tenant console with a password alone. An administrator who has not set up an authenticator app is not turned away: after the password, the console shows **Set up two-step verification**, and signing in finishes only once they have registered one. The screen tells them the tenant requires it, although the requirement is the platform's and a tenant cannot turn it off.

It applies to every tenant at once and only to the **Admin** role; editors and auditors are never asked. It takes effect at each administrator's next sign-in, not on sessions already open. An administrator can still turn their authenticator off from their account settings, and is asked to set one up again the next time they sign in.

The Platform Console's own operators are not covered by this setting.

### Rate limits

Each limit is a count per minute or per hour, with a second count per day, and the daily count is never lower than the shorter one. A request over a limit is refused until its window has passed. The windows are fixed on the clock, not started by a reader's first request, so a count starts again at the turn of each minute or hour, and a daily count at midnight UTC.

| On the Security page | What it guards |
| --- | --- |
| **Password verifications per minute** and **per day** | A reader typing their current password to change it, to change their email address, or to delete their account. Each counts per account, and a correct password clears the count, so it slows someone guessing the password of a session they hold, not a reader who mistyped once |
| **Email requests per address per hour** and **per day** | Mail sent to one address by the forms that send it: reader sign-up and email verification, password resets and email changes in all three apps, staff invitations, administrator invitations from the Platform Console, and replies to contact messages. An address counts within its own tenant, or within the Platform Console, and an address with a `+tag` counts as the address without it |
| **Email requests per source per hour** and **per day** | The same mail counted by the client address that asked for it, across every address and every tenant, so one client cannot mail a long list of strangers |
| **In-app purchase confirmations per reader per minute** and **per day** | Store transactions one reader hands the server to verify with Apple or Google |
| **Wait-for-free ticket uses per reader per minute** and **per day** | One reader's requests to spend a wait-for-free ticket. A spent ticket is already limited by its series' recharge time; this bounds the refused attempts |

Each invitation counts as one request, including every **Initial admin emails** address on **Create tenant**, which are all counted before the tenant is created: if one is over a limit, no tenant is created and no mail is sent. `publiractl` sends through no form and counts against none of these limits.

The client address is the first address in `X-Forwarded-For`, which the reverse proxy has to set rather than append to, as [The headers the proxy owns](../2-deployments/4-reverse-proxy.md#the-headers-the-proxy-owns) describes. Readers behind one shared address, such as an office or a mobile carrier's gateway, share its per-source and per-client counts.

### Sign-in attempts

Two more limits guard signing in itself, with a password, to a tenant's site, its tenant console, or the Platform Console. The **Security** page does not show them yet ([#3765](https://github.com/publira/publira/issues/3765)), so they are set with `publiractl policy set` alone, and saving the page keeps them as they are stored:

| Flags | What it guards |
| --- | --- |
| `--login-attempts-per-account-per-minute` and `--login-attempts-per-account-per-day` | Passwords tried for one address. An address counts within its own tenant, where the tenant's site and its tenant console share one count, or within the Platform Console. A sign-in with the right password clears the count, so it slows someone guessing one account's password, not a person who mistyped |
| `--login-attempts-per-source-per-hour` and `--login-attempts-per-source-per-day` | Failed sign-ins from one client address, across every address, every tenant, and the Platform Console, so one client cannot try a password against a long list of addresses. A sign-in with the right password does not count against it |

An attempt over either limit is refused before the password is checked, and refused the same way whether or not the address has an account, so the refusal tells a guesser nothing about which addresses are registered. Two-step verification is a separate check after the password, and these limits do not count its codes.

The per-account limit also lets anyone who knows an address keep its owner from signing in with a password until the window passes, by spending its count with wrong passwords. Sign-in with Apple or Google and a password reset are not affected by it. Keep the per-day value high enough that a day without a password sign-in is not the price of someone else's script.

### Where the counts are kept

The limits are counted by `publira server`, in the Valkey or Redis server named by its `PUBLIRA_REDIS_URL`, which [Installing](../2-deployments/2-installing.md#provision-the-services) has you provision. Every instance of `publira server` shares those counts, so a limit holds across the install whatever number of instances you run.

Without that variable, each instance counts in its own memory, with nothing in its log to say so. A reader whose requests are spread across three instances then gets three times the limit, and a restart starts every count from zero. The same happens while the instances cannot reach Redis: a server that cannot connect at startup logs an error and counts on its own, and one that loses the connection later logs a warning, counts on its own until the connection comes back, and logs again when it does. If you run more than one instance of `publira server`, set `PUBLIRA_REDIS_URL` on every one.

A saved change reaches every running instance within ten seconds, without a restart.

### The disposable email domain list

**Disposable email domain list URL** (`--disposable-email-domains-url`) is where `publira server` reads a list of domains made for throwaway mail. No list ships with Publira, so until you give a URL there is none.

The list is a plain-text file of one domain per line; blank lines and lines starting with `#` are ignored, which is the format of the [disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) project's blocklist. A listed domain also covers its subdomains. Each instance reads the list when it is first needed and again an hour later. If a read fails, or the file has a line that is not a domain, the instance keeps using the last list it read and logs a warning; with no earlier list, it refuses nothing and tries again an hour later. A new URL is read on the next lookup after it is saved.

Saving a list refuses nothing on its own. A tenant that wants disposable addresses refused turns on **Refuse disposable email domains** under **Refused email addresses** in its console's **Settings**, and from then on a reader cannot sign up with, or change their address to, an address on a listed domain. Sign-in with Apple or Google is not affected. When the platform has no list, that switch says it has no effect.

## Community

**Community limits** are the limits on what readers do in a tenant's community. Each value here is the starting point for every tenant and also the loosest value a tenant may choose: a tenant can make a limit stricter for itself, never looser.

| On the Community page | What it limits |
| --- | --- |
| **Comment posts per minute** and **per day** | Comments one reader posts |
| **Comment reports per minute** and **per day** | Comments one reader reports |
| **Contact messages per account per hour** and **per day** | Messages one signed-in reader sends through the tenant's contact form |
| **Contact messages per client per hour** and **per day** | Messages sent through the contact form from one client address, signed in or not, counted across every tenant |
| **Episode ratings per minute** and **per day** | Presses of the episode rating one reader makes |
| **Viewer preference updates per minute** and **per day** | Times one reader saves the viewer's layout |
| **Duplicate comment window (minutes)** | How long a reader is refused when posting the same comment on the same episode again, from 1 minute to one week. The comparison is exact after trimming surrounding spaces |

These are counted in the same place as the security limits, so [Where the counts are kept](#where-the-counts-are-kept) applies to them too.

## Retention

**Retention defaults** sets how long four kinds of record are kept for every tenant that has set no period of its own. Each period is a whole number of days. `publira worker` deletes what has passed its period on its own schedule; nothing has to be set up to run it, and `publiractl job` runs the same purge by hand.

| Record | What it is | Deleted by | How often |
| --- | --- | --- | --- |
| **Withdrawn comments** | Comments their authors deleted, kept so staff can still read them while a report or dispute about them is open. The reports filed on a comment go with it | `purge-withdrawn-comments` | Every hour |
| **Content events** | Each view, finished read, purchase, favourite, rating, and comment, as it happened | `purge-content-events` | Every 24 hours |
| **Daily ranking snapshots** | Each day's leaderboards | `purge-ranking-snapshots` | Every 24 hours |
| **Weekly ranking snapshots** | Each week's leaderboards | `purge-ranking-snapshots` | Every 24 hours |

Each purge reads the periods when it starts, so a saved change applies from its next run. Each also runs when `publira worker` starts if it has not run in its current interval, and its first pass after downtime deletes everything that expired in the meantime.

Some records outlive their period by design:

- A comment hidden by staff, or by the report threshold, is never deleted, whatever its age: it is the record of a moderation decision. Only comments their authors withdrew are purged.
- The newest leaderboard a tenant has of each kind is always kept, so a ranking never goes blank.

Choosing a period:

- **Content events** feed two things after they are recorded: each day's statistics, built once the day ends, and the recommendations, which are built from the last 28 days the tenant has finished in its own time zone. The statistics outlive the events, so a short period does not shrink a tenant's reports. A period under 30 days, the 28 plus the day the recommendations are built on and one for a day that a clock change makes longer, would leave the recommendations working from fewer days, and could delete a day's events before its statistics are built, so it is refused, for the platform's default and for a tenant's own period alike. A shorter period saved before Publira refused one is kept as 30 days.
- **Ranking snapshots** are kept for comparison over time; only the newest is ever shown to readers. A shorter period only shortens how far back that comparison reaches.
- **Withdrawn comments** should cover how long your tenants take to settle a report or a dispute about a comment. The tenant console shows staff when each withdrawn comment is due to be deleted.

From the command line:

```bash
publiractl retention set --content-event-days 120
```

## What a tenant can change

A tenant's administrators change some of these for their own tenant from **Settings** → **Limits and retention** in the tenant console, as [Settings](../4-console/3-setup/1-settings.md#limits-and-retention) describes for them. Editors and auditors see that page without being able to save it.

| Group | What a tenant can do |
| --- | --- |
| **General**: default language and time zone | Nothing here; each tenant has its own language and time zone from the moment it is created, and changes them from **Settings** in its console |
| **Security**: every value | Nothing. The one related choice a tenant makes is whether to refuse disposable email domains, and the list it refuses with is the platform's |
| **Community**: every value | Make any of them stricter: lower limits, or a longer duplicate comment window. A value looser than the platform's is refused |
| **Retention**: every period | Set any of them longer or shorter than the platform's default, from 1 to 36500 days, and from 30 days for **Content events** |

On that page each group starts with **Use the platform default** ticked, and shows the platform's value beside it. Clearing the box lets an administrator enter the tenant's own values, which **Save the community limits** or **Save the retention periods** keeps; ticking it again and saving returns the group to the platform's. A tenant on the platform default follows every later change you make to it.

A tenant's own value stays when the platform's changes, with one exception. A tenant's community limits are compared with the platform's on every request, and the stricter of the two applies, so lowering a platform limit below a tenant's own value tightens that tenant too. Raising it again does not loosen a tenant that chose a stricter value. Retention periods have no such comparison: a tenant's own period is used as it is.

A tenant's changes are recorded in its console's audit log, as **Community limits updated** and **Retention periods updated**.
