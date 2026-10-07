---
title: Email
description: Send the tenant's mail through the publisher's own SMTP server, under its own address, instead of the platform's.
published: 2026-10-07
---

The tenant sends mail to its readers and its staff: address confirmations, password resets, invitations, replies to contact messages. Until a Tenant admin sets up a server of the tenant's own, all of it goes out through the platform's mail server, from the platform's address, which the operator chooses. **Integrations** › **Email** sends it through the publisher's own SMTP server instead, from an address on the publisher's domain.

Only a Tenant admin sees this screen. There is nothing for the operator to allow first.

## What goes through it

With the tenant's own server turned on, it sends every mail the tenant sends:

- To readers: the sign-up confirmation, password resets and the notice that a password changed, email address change confirmations and the notice that an address changed, and the notice that someone tried to sign up with an address that already has an account.
- Replies to readers' contact messages.
- To staff: invitations to new Tenant admins, the console's password resets and email address changes, and the notice of a new contact message.

The tenant sends no purchase receipts. Announcements and other notices reach readers on the site and in the app, not by mail.

## Before you start

Have these from whoever runs the publisher's mail:

- The SMTP server's host name and port, and whether it expects TLS from the start of the connection (usually port 465) or STARTTLS (usually port 587).
- A username and password for it.
- The address the mail should come from, which the server is allowed to send as. Have the domain's SPF and DKIM records cover the server, or readers' mail services are likely to file the tenant's mail as spam.

## Setting it up

1. Open **Integrations** › **Email** and tick **Enable the override** under **Use this tenant's own SMTP server**. The fields below it open.
2. Fill in:
   - **Host** and **Port**.
   - **Username** and **Password**.
   - **Encryption**: **TLS**, **STARTTLS**, or **None**. **TLS** and **STARTTLS** both require TLS 1.2 or later, and **STARTTLS** fails rather than sending in the clear when the server does not offer it. Choose **None** only for a server that is reached over a private network.
   - **Sender email address**: the address the mail comes from, such as `noreply@comics.example.com`.
   - **Sender name (optional)**: the name readers see beside that address, usually the site's name. Fill it in: although the screen says the tenant name is used when it is empty, mail is then sent from the bare address, with no name at all ([#3792](https://github.com/publira/publira/issues/3792)).
   - **Reply-to address (optional)**: where a reader's reply goes, such as a support address. Left empty, replies go to the sender address. A reply to a contact message keeps its own reply-to address instead.
3. Choose **Test the connection**, then **Run the test**. The test sends a message through the values in the form, without saving them, to your own address, or to another one if you clear **Send it to myself**. A failed test says which step failed where it can tell: connecting, TLS or STARTTLS, signing in, the server refusing the recipient, or the server taking too long to answer.
4. Choose **Save**. The next mail the tenant sends goes through the new server.

A saved password is never shown again. The field shows that one is stored, and **Change** replaces it.

## When it stops working

Once the tenant's own server is on, its mail does not fall back to the platform's server. If the server refuses a mail or cannot be reached, the platform keeps trying for a while, at growing intervals, and then gives up on that mail. Nothing in the console reports a failure. If readers say their confirmation or password reset mail does not arrive, run **Test the connection** again with the saved settings.

To go back to the platform's mail server, clear **Enable the override** and choose **Save**. The rest of the settings are kept for when you turn it on again.

Every save is recorded in the [audit log](./7-audit-log.md) as **Email settings updated**, and every test, successful or not, as **SMTP connection tested**. The operator's side of the tenant's mail is described in [Email](../../3-operations/6-email.md#a-tenants-own-smtp-account).
