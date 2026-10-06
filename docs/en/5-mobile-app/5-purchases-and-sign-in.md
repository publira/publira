---
title: In-app purchase and sign-in
description: What a tenant's app needs to sell episodes through the App Store and Google Play, and to sign readers in with Apple and Google.
published: 2026-10-06
---

Selling episodes and signing in with Apple or Google are set up once for the whole tenant, in the tenant console, and the site and the app share that setup. This page covers what is particular to the app: the parts of each store's and each provider's console that only the app needs, and how the app decides what to offer. The app's build needs nothing for either beyond the [manifest](./1-app-manifest.md) and [App links](./4-app-links.md), except the Google client named in the manifest for Google sign-in on iOS.

Both rely on **Integrations** › **App links**: the store sections of in-app purchase sell in the apps named there, and Sign in with Apple trusts the apps named there. Fill it in first.

## Selling episodes in the app

Under **Integrations** › **Payments**, two settings decide what the app offers on a paid episode:

- **Where episodes are sold** decides whether an episode can be bought in the app at all: **Web and app**, **Web only**, or **App only**. A series or an episode can override it.
- **How the app sells episodes**, in the **In-app purchase** section, decides how the app sells an episode it may sell. **Web checkout** opens the site's checkout in the phone's browser and brings the reader back to the episode once paid. **In-app purchase** sells with the store's own payment sheet, and the store charges the reader and keeps its commission.

The App Store and Google Play each have rules on how an app may sell digital content, and they decide in review whether an app follows them. Read their current guidelines before choosing **Web checkout** for an app you submit.

### What each store needs for in-app purchase

The app sells each episode as a store product named after its price. **Store products**, on the same console page, lists the product ID each price your paid episodes sell at needs, such as `episode_300`. Create every listed product in both stores, as a consumable product at that price, and add one whenever a new price appears in the list.

In **App Store Connect**:

- Accept the Paid Apps agreement, and complete the banking and tax details it asks for. No product can be sold until it is in effect.
- Create the listed products under the app's **In-App Purchases**, as consumables.
- Create the key the install verifies purchases with, and enter its **Issuer ID**, **Key ID**, and **Private key (.p8)** under the **App Store** section of **In-app purchase**.
- Enter the **App Store Server Notifications URL** the console shows as both the Production and the Sandbox Server URL, under the app's **App Information**. A refund Apple reports there takes the episode back from the reader.

In **Play Console**:

- Set up a payments profile, so the account can sell.
- Upload an App Bundle to a testing track before creating products. Play Console can refuse products for an app that has not yet uploaded a build that uses Google Play's billing, which every Publira build does.
- Create the listed products as one-time products.
- Create a service account in Google Cloud with the Google Play Android Developer API enabled, and enter its **Service account key (JSON)** under the **Google Play** section of **In-app purchase**. Then invite the **Service account** the console shows under **Users and permissions** in Play Console, so it may read the app's orders.

Turn on **Use the App Store** and **Use Google Play**, choose **In-app purchase** as how the app sells episodes, and choose **Save the in-app purchase settings**. The console allows that choice only once a store is ready: turned on, with its key, and with its app named under **App links**.

The [server reference](https://github.com/publira/publira/blob/main/server/README.md) describes how a purchase is verified with each store and how refunds are applied.

### Testing a purchase

Test in-app purchase with the stores' own test buyers: a sandbox account on an iPhone running a TestFlight build, and a license tester on an Android phone with a build from a testing track. Neither is charged. The install records such a purchase as a test: it opens the episode, and it is left out of royalty statements and the content statistics.

## Sign in with Apple and Google

**Integrations** › **Sign-in** offers Apple and Google to readers of the site and the app at once. The app offers a provider only when the tenant offers it — **Offer Sign in with Apple** or **Offer Sign in with Google** is on and complete — and only where the setup covers the phone the app runs on:

|  | Apple | Google |
| --- | --- | --- |
| iOS | When the app's bundle ID is the one named under **App links** | When the console's **iOS client ID** is the client the app was built with, and only beside Apple, as the App Store requires |
| Android | When a **Services ID** is entered and the app's application ID is the one named under **App links** | When a **Web client ID** is entered |

### iOS

Sign in with Apple needs no Services ID in the iOS app: the console's **Team ID**, **Key ID**, and **Private key (.p8)** are enough, with the bundle ID from **App links**. The app's bundle ID is registered with the Sign in with Apple capability by Xcode when it builds.

Google sign-in on iOS needs an OAuth client of type iOS in the Google Cloud console, created with the manifest's `ios.bundleIdentifier`. Its client ID goes in two places, which have to agree:

- `ios.googleSignInClientId` in the [manifest](./1-app-manifest.md), which registers the client with the app when it is built.
- The **iOS client ID** under **Integrations** › **Sign-in** › **Google**, which tells the app the tenant offers it.

A change to the client therefore takes a new build as well as a change in the console.

### Android

Sign in with Apple on Android signs in through Apple's web flow, under the tenant's **Services ID**. Register the **Android app callback URL** the console shows under the Return URLs of that Services ID, beside the site's own callback URL.

Google sign-in on Android uses the **Web client ID** the site signs in with. In the same Google Cloud project, also create an OAuth client of type Android, with the manifest's `android.applicationId` and the SHA-1 fingerprint of the app signing key, which Play Console shows beside the SHA-256 one on the app's **App signing** page. Google uses it to recognise the app; nothing in Publira names it.

Next: [Submitting to the stores](./6-store-submission.md).
