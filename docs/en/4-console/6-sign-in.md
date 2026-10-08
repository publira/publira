---
title: Sign-in with Apple and Google
description: Let readers sign in to the site and the app with an Apple or Google account, and create what Apple and Google need for it.
published: 2026-10-06
updated: 2026-10-08
---

Readers sign in to a tenant's site with an email address and a password. **Integrations** › **Sign-in** adds two buttons beside that form, **Continue with Apple** and **Continue with Google**, so a reader can sign up and sign in with an account they already have. This page takes a Tenant admin through both providers for the site, and says what readers see once they are on. The app shares the same setup; what only the app needs is on [In-app purchase and sign-in](../5-mobile-app/5-purchases-and-sign-in.md#sign-in-with-apple-and-google).

Only a Tenant admin sees **Sign-in**, and every save is recorded in **Audit logs** as **Sign-in providers updated**.

## Before you start

- **The site is served on its own domain, over HTTPS.** Apple and Google send a reader back only to an HTTPS address registered with them, and that address is on the domain of the tenant's public site, not on the console host.
- **For Apple, a membership of the Apple Developer Program**, under the organisation the reader should see they are signing in to. The same membership the app is published under, if the tenant has an app.
- **For Google, a Google Cloud project**, again owned by the publisher. A Firebase project created for [push notifications](../5-mobile-app/3-push-notifications.md) is a Google Cloud project and can be used.
- **If the tenant has an app**, fill in **Integrations** › **App links** first, as [App links](../5-mobile-app/4-app-links.md) describes. Sign in with Apple trusts the apps named there.

Open **Integrations** › **Sign-in** and keep it open: each provider's section shows a **Callback URL** with a button to copy it, which you register with the provider in the steps below. It is built on the site's domain:

| Provider | Callback URL                                             |
| -------- | -------------------------------------------------------- |
| Apple    | `https://comics.example.com/api/v1/auth/apple/callback`  |
| Google   | `https://comics.example.com/api/v1/auth/google/callback` |

The Apple section shows a second address, the **Android app callback URL**, which only the Android app uses.

If the operator later moves the tenant to another domain, these addresses move with it, and the new ones have to be registered with both providers, as [Tenants](../3-operations/2-tenants.md) notes.

## Sign in with Apple

Everything on Apple's side is created in the Apple Developer account, under **Certificates, Identifiers & Profiles**.

### What to create in the Apple Developer account

1. **An App ID with Sign in with Apple.** Under **Identifiers**, open the App ID of the tenant's iOS app, or register one if the tenant has no app, and turn on the **Sign in with Apple** capability. The other two identifiers are grouped under this one, which Apple calls the primary App ID.
2. **A Services ID.** Under **Identifiers**, register a Services ID, with a description readers may see, such as the site's name, and an identifier such as `com.example.comics.web`. Turn on **Sign in with Apple** for it and choose **Configure**:
   - **Primary App ID**: the App ID of step 1.
   - **Domains and Subdomains**: the site's domain alone, such as `comics.example.com`.
   - **Return URLs**: the Apple **Callback URL** from the console. If the tenant has an Android app, add the **Android app callback URL** here as well.
3. **A key.** Under **Keys**, register a key with **Sign in with Apple** turned on, configured with the same primary App ID. Download the `.p8` file it offers. Apple offers it once, so keep it somewhere safe; a lost key is replaced by registering a new one. The **Key ID** is shown beside the key.
4. **The Team ID**, shown in the account's membership details.

### Entering it in the console

In the **Apple** section of **Integrations** › **Sign-in**:

- **Services ID**: the identifier of the Services ID, such as `com.example.comics.web`. The site shows the Apple button only when this is filled in. Leave it empty only when the iOS app alone is to offer Apple.
- **Team ID** and **Key ID**: the ten-character IDs of step 4 and step 3.
- **Private key (.p8)**: choose the downloaded file, or paste its contents.
- **iOS bundle ID** is not entered here: it shows the iOS app named under **App links**.

Turn on **Offer Sign in with Apple** and choose **Save the sign-in providers**.

The key cannot be read back: on a later visit the console shows only that one is stored. **Replace** swaps it for a new one, and **Remove** deletes it when you save.

## Sign in with Google

Everything on Google's side is created in the Google Cloud console, in the publisher's project, under **Google Auth Platform**.

### What to create in the Google Cloud console

1. **The consent screen.** Under **Branding**, enter the name readers see when they choose an account, a support email, and the site's domain under **Authorized domains**. Under **Audience**, choose **External**, so any Google account can sign in, and publish the app to production. Until it is published, only the test users listed there can sign in. Publira asks Google only for a reader's identity, email address, and name, which Google classes as non-sensitive, so publishing does not wait for a review of them.
2. **A Web application client.** Under **Clients**, create an OAuth client of type **Web application**, and add the Google **Callback URL** from the console under **Authorized redirect URIs**. Nothing goes under **Authorized JavaScript origins**.

Google shows a client secret for the new client. Publira does not use it, and the console has nowhere to enter it.

### Entering it in the console

In the **Google** section of **Integrations** › **Sign-in**:

- **Web client ID**: the client ID of the Web application client, ending in `.apps.googleusercontent.com`. The site shows the Google button only when this is filled in, and the Android app signs in with the same client.
- **iOS client ID**: the client ID of an iOS client, which only the iOS app uses. Leave it empty if the tenant has no iOS app.

Turn on **Offer Sign in with Google** and choose **Save the sign-in providers**.

## Checking that it works

Each provider's section shows its state:

| State | Meaning |
| --- | --- |
| **Offered** | On and complete: readers can sign in with it |
| **Incomplete** | On, but something it needs is missing, so readers are not offered it |
| **Off** | Saved, but turned off |
| **Not set** | Nothing is saved for it |

An **Offered** provider also lists, under **Where readers see its button**, each place a reader can meet it: **Site**, **iOS app**, and **Android app**. Each says **Shown**, or what that place still needs before it shows the button:

|  | Apple | Google |
| --- | --- | --- |
| Site | A **Services ID** | A **Web client ID** |
| iOS app | The iOS app named under **App links** | An **iOS client ID**, and Apple shown in the iOS app, since the app offers Google only beside Apple |
| Android app | A **Services ID**, and the Android app named under **App links** | A **Web client ID** |

A provider can therefore be **Offered** and still say the site does not show it: Apple without a **Services ID**, or Google without a **Web client ID**, is set up for the apps alone. **Shown** for an app means the setup covers it; the app itself also has to be built for it, as the [app's page](../5-mobile-app/5-purchases-and-sign-in.md#sign-in-with-apple-and-google) describes.

The site picks up a change moments after it is saved. Open the site's sign-in page in a private window, choose **Continue with Apple** or **Continue with Google**, and sign in. A provider that sends you back to an error page of its own usually has an address that does not match: compare the address it reports with the **Callback URL**, character for character.

## What readers see

The site's **Sign in** and sign-up pages show **Continue with Apple** and **Continue with Google** below the email form, separated by **or**. A reader signing up this way does not choose a password and does not confirm their email address: the provider has already confirmed it. If the site asks readers to agree to its terms of service or privacy policy, a first sign-in stops on **Finish signing up** for them to agree before the account is created.

The app shows the same two buttons, on each phone where the setup covers it, as the [app's page](../5-mobile-app/5-purchases-and-sign-in.md#sign-in-with-apple-and-google) describes. An account works in both: a reader who signed up on the site with Apple signs in to the app with Apple, and the other way round.

### An existing account and an Apple or Google sign-in

An Apple or Google account is linked to one reader's account on the tenant. Which one is decided the first time the reader uses it:

- **The reader already has an account with the same email address.** The Apple or Google account is linked to it, and the reader is signed in to their existing account, with their purchases and history. There is no confirmation step: Apple and Google have confirmed the address, which is the same proof the site's own confirmation mail asks for.
- **The reader has an account with that address, but never confirmed it.** The Apple or Google account takes it over: the account is linked, its address counts as confirmed, and the password it was created with is removed. Whoever created it without being able to confirm the address loses it to the address's owner.
- **No account has the address.** A new account is created, with the address the provider gave and no password.

A reader who chose **Hide My Email** with Apple gives the site an address at `privaterelay.appleid.com` instead of their own. It matches no existing account, so it creates a new one. A reader who already has an account and wants to keep it signs in with their email address instead, or shares their real address with Apple.

The tenant's refused email addresses under **Settings** do not apply to these sign-ins, since the provider supplies the address. A reader whose account is suspended cannot sign in with Apple or Google either.

### What a reader can manage

Under **Settings** › **Security** on the site, and in the app's account screen, **Linked accounts** lists the Apple and Google accounts the reader can sign in with, each with **Unlink**. A reader cannot link an account from there; a provider is linked by signing in with it as described above.

An account created through Apple or Google has no password. The same screen offers **Set a password**, which mails a link to set one, after which the reader can sign in with their email address as well. Until then:

- The last linked account cannot be unlinked.
- Deleting the account and changing the email address are confirmed by signing in with Apple or Google again, through **Confirm with Apple** or **Confirm with Google**, in place of the password.

### Mail to a Hide My Email address

Apple forwards mail sent to a `privaterelay.appleid.com` address only from senders the publisher has registered with it. Mail from any other sender, the site's own password reset mail included, never reaches the reader.

Register the address the tenant's mail is sent from in the Apple Developer account, under **Certificates, Identifiers & Profiles** › **Services** › **Sign in with Apple for Email Communication**: the **Sender email address** under **Integrations** › **Email** if the tenant sends through its own server, or the platform's sending address, which the operator knows, if it does not. Apple also checks that the sending domain passes SPF, as described there.

## Turning a provider off

Turning **Offer Sign in with Apple** or **Offer Sign in with Google** off removes its button from the site and the app, and keeps everything saved for it, so it can be turned on again as it was. The readers' links stay as well.

A reader who has a password goes on signing in with their email address. A reader who signed up with the provider has none, and cannot sign in until they set one: **Forgot your password?** on the sign-in page mails them a link. Tell such readers before you turn a provider off, for instance with an announcement. A reader with a Hide My Email address receives that mail only if the sender is registered with Apple, as described above.
