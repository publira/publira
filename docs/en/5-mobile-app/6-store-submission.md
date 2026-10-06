---
title: Submitting to the stores
description: List a tenant's app on the App Store and Google Play, and give each store's review what it asks the publisher for.
published: 2026-10-06
---

The app is listed under the publisher's own developer accounts, and each store reviews it before readers can install it. Most of what a review asks for is about the publisher rather than the code: who runs the service, what data it keeps, and an account the reviewer can sign in with. This page lists what to prepare, then the steps in each store.

## Prepare for review

### A demo reader account

Both stores' reviewers sign in to an app that has accounts, and neither can create one for themselves when sign-up needs a mail they cannot read. Give them a reader account of the tenant:

1. Sign up on the tenant's site with an address you control and a password, and confirm the address from the mail. An account that signs in only with Apple or Google cannot be handed to a reviewer.
2. Sign in to the app with it once, to check it works.
3. Enter the address and password in each store's review information, described below.

Make sure the tenant has published at least one series with an episode the account can read, so the reviewer sees what the app is for. When the app sells episodes, a reviewer's purchase is a store test purchase: it opens the episode, is not charged, and is left out of royalty statements.

### The pages a listing links to

- **A privacy policy.** Publish it as a page of the tenant's site, and choose it under **Settings** › **Terms and privacy policy** in the tenant console so the app links to it as well. Both stores ask for its address.
- **A support address.** The site's contact form, `https://<tenant.host>/contact`, serves, and it reaches the staff under **Contact messages** in the tenant console.
- **Where a reader deletes their account.** The app deletes an account from **Account** › **Delete account**, as the App Store requires. Google Play also asks for a web address, which is the site's account settings, `https://<tenant.host>/settings`, under **Delete account**.

### What the app collects

Both stores ask what data the app collects and why, in **App Privacy** on the App Store and **Data safety** on Google Play. The answers are the publisher's, because they depend on how the tenant runs its service, and this is what the app sends to the install:

- the reader's name, email address, and password, their date of birth where the tenant checks ages, and the Apple or Google account they sign in with;
- what they buy, and their purchases' store transactions;
- what they read, where they stopped, and what they follow;
- the comments and contact messages they write;
- the phone's push notification token, when they turn notifications on;
- a random identifier that counts a signed-out reader's views towards the tenant's rankings.

Everything is sent over HTTPS to the install, at the address the app was built with. The app includes no advertising or analytics library, and does not track readers across other companies' apps or sites. Push notifications go through Firebase Cloud Messaging, and purchases and Apple and Google sign-in through the stores' and the providers' own services.

## App Store

1. **Create the app.** In App Store Connect, under **Apps**, add a new iOS app. Choose the bundle ID of the manifest; it is in the list once Xcode has built the app for the team, or once you register it under **Certificates, Identifiers & Profiles** › **Identifiers**.
2. **Upload a build**, as [Building and signing](./2-building.md#ios) describes, and try it through TestFlight.
3. **Fill in the listing**: the name, description, screenshots, keywords, category, the privacy policy and support addresses, the **App Privacy** answers, and the age rating questionnaire, which depends on the tenant's catalog.
4. **Fill in the review information**: the demo account's address and password, and contact details for the reviewer. Add a note when anything about the service needs explaining, such as which series to open.
5. **Add the in-app purchases** when the app sells through the App Store: the first products are submitted for review together with a version of the app.
6. **Submit the version for review.**

## Google Play

1. **Create the app.** In Play Console, create an app with the store name and default language, as a free app: the app itself costs nothing, and sells episodes inside it.
2. **Upload the first App Bundle** to a testing track. Play App Signing is turned on with it, and the app's **App signing** page then shows the key [App links](./4-app-links.md) needs.
3. **Set up the app** from the dashboard's tasks: the privacy policy, **App access** with the demo account's address and password, the content rating questionnaire, the target audience, **Data safety** with the account deletion address, and the store listing.
4. **Test before production.** Play Console may require a closed test with a number of testers before it grants production access, depending on the kind of developer account; it says so on the dashboard when it does.
5. **Release to production** with the App Bundle of the version to publish.

## Once the app is listed

Enter each store listing's address under **Integrations** › **Payments** › **Where episodes are sold**, as the **App Store address** and the **Google Play address**. An episode sold in the app alone sends a reader on the web to these addresses.

A later release repeats only part of this: build both apps from the checkout of the release the install now runs, with a higher build number, and submit each as a new version. The manifest, the keys, the Firebase project, and everything in the tenant console stay as they are.
