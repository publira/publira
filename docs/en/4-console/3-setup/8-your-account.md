---
title: Your account
description: Change the email address you sign in to the console with, and protect your account with two-step verification and recovery codes.
published: 2026-10-07
---

Every member of staff, whatever their role, manages their own console account from **Account settings**, in the account menu at the top of the console. It has two cards: **Change the email address** and **Two-step verification**.

The console has no screen for changing your password. Sign out and use **Forgot your password?** on the sign-in screen, which mails you a link to set a new one.

## Changing your email address

Under **Change the email address**, enter your **Current email address**, the **New email address**, and your **Current password**, and choose **Send the confirmation email**.

A confirmation mail is sent to both addresses, and the change needs both links opened, each within 24 hours. Requiring the current address stops someone who has only your password from moving the account to an address of theirs. Until both are opened, you keep signing in with the current address. Once both are, you sign in with the new one, and the old address is told the address was changed.

The new address must not belong to another account on the tenant, a reader's included. A second request replaces the first, whose links stop working.

Since your console account is also your account on the site, the change applies to both.

## Two-step verification

Two-step verification asks for a code from an authenticator app on your phone after your password, so a stolen password is not enough to sign in. Any authenticator app that reads a QR code works, including the one built into many password managers.

The operator can require it of every Tenant admin on the install. A Tenant admin who has not set it up is then asked to, right after their password, before they can use the console, and **Two-step verification** says "This tenant requires two-step verification for administrators." Editors and Auditors are never required to, but can turn it on for themselves.

### Turning it on

1. Under **Two-step verification**, choose **Set up**.
2. Scan the QR code with your authenticator app. If you cannot scan it, enter the **Setup key** shown beside it by hand.
3. Enter the six-digit code the app shows under **Verification code**, and choose **Turn on two-step verification**.
4. The console shows ten **Recovery codes**. Store them somewhere other than your phone, such as a password manager or on paper. They are shown only this once.

From then on, the console asks for a code from the app each time you sign in. You have five minutes to enter it after your password. After five wrong codes, the account is locked for fifteen minutes.

### Recovery codes

A recovery code stands in for the app once, when you do not have your phone. Enter it where the console asks for the app's code. The console then tells you how many codes you have left.

**Regenerate recovery codes** issues ten new codes and makes every earlier one useless, used or not. It asks for a code from the app, not a recovery code. Do it once you have your phone back after using a recovery code, or whenever you think the codes may have been seen.

### Turning it off

**Turn off two-step verification** asks for a code from the app or a recovery code. If the operator requires two-step verification of Tenant admins, a Tenant admin who turns it off is asked to set it up again at their next sign-in.

### A new phone, or a lost one

Before you replace your phone, sign in on the new one with a code from the old one, turn two-step verification off, and turn it on again with the new phone. Some authenticator apps can also move their codes to a new phone themselves.

If you have lost the phone, sign in with a recovery code, turn two-step verification off, and set it up again with the new phone.

If you have lost both the phone and every recovery code, you cannot sign in to the console any more. Neither your password nor anyone on the staff can remove two-step verification from your account, and the operator cannot yet either ([#3796](https://github.com/publira/publira/issues/3796)). Another Tenant admin, or the operator, can give your role to a different account in the meantime.

Setting it up, turning it off, regenerating recovery codes, and each sign-in with a code or a recovery code are recorded in the tenant's [audit log](./7-audit-log.md).
