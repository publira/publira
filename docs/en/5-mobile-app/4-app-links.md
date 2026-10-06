---
title: App links
description: Make links to a tenant's site open in its app, by naming the published app in the tenant console.
published: 2026-10-06
---

A link to the tenant's site — a series, an episode, the announcements, or the confirmation and password reset links in the site's mail — opens in the app when it is installed, rather than in the browser. Android and iOS allow that only once they have checked that the site vouches for the app. They ask the site for two files:

- `https://<tenant.host>/.well-known/assetlinks.json`, for Android
- `https://<tenant.host>/.well-known/apple-app-site-association`, for iOS

The site builds both from what is saved under **Integrations** › **App links** in the tenant console. There is nothing to upload to the web server.

The same page names the app for the rest of the install, too. The App Store and Google Play sections of in-app purchase sell in the apps it names, and Sign in with Apple trusts the apps it names, so fill it in before trying either of those in the app.

## When to fill it in

The Android fingerprint is not yours to choose: with Play App Signing it belongs to the key Google signs the installed app with, which Play Console shows once the app has been created there and the first App Bundle uploaded. Fill in the iOS side whenever you like, and the Android side once Play Console shows the key.

The values are always those of the app the stores distribute, the store build of [Building and signing](./2-building.md). A value that differs from the published app by a single character leaves its links opening in the browser, and nothing reports the mismatch.

## Enter the apps

In the tenant console, open **Integrations** › **App links**.

### Android

Tick **Links open in the tenant's Android app**, and fill in:

| Field | Where the value comes from |
| --- | --- |
| **Application ID** | `android.applicationId` in the manifest. Google Play shows the same value as the `id=` in the app's store address |
| **SHA-256 signing certificate fingerprints** | The SHA-256 fingerprint of the **app signing key certificate** on the app's **App signing** page in Play Console. Not the upload key's: the upload key does not sign what Play delivers |

The fingerprint is 32 pairs of hex digits separated by colons, `AA:BB:…`, and the field takes up to ten, one per line. List a second one when a build signed another way should open links too: the release APK installed for testing, which is signed with the upload key, or a new key during a key rotation. The upload key's fingerprint is the `SHA256:` line of:

```bash
keytool -list -v -keystore ~/example-reader/upload.jks -alias upload
```

### iOS

Tick **Links open in the tenant's iOS app**, and fill in:

| Field | Where the value comes from |
| --- | --- |
| **Apple Team ID** | The ten-character Team ID under **Membership details** on the Apple Developer website: the `PUBLIRA_IOS_DEVELOPMENT_TEAM` the app was built with |
| **Bundle identifier** | `ios.bundleIdentifier` in the manifest. App Store Connect shows the same value as the Bundle ID under **App Information** |

Choose **Save the app links**. A platform left unticked is answered with `404`, which tells that platform there is no app; a tenant without apps ticks neither.

The manifest's `tenant.host` has no field here, because it is already decided: Android and iOS ask the host the link points at, and the app claims only that host. It therefore has to be a host the tenant's site is served on.

## Check the links

First check that the site serves both files:

```bash
curl -i https://reader.example.com/.well-known/assetlinks.json
curl -i https://reader.example.com/.well-known/apple-app-site-association
```

Each answers `200` with the identifiers you saved. Both phones refuse a file reached through a redirect, so the reverse proxy in front of the install has to answer these paths on the tenant host itself, over HTTPS.

On Android, the phone checks the site when the app is installed or updated. Install the build, then ask the phone what it decided:

```bash
adb shell pm get-app-links com.example.reader
```

The tenant host is listed as `verified` when the check passed. After correcting a value in the console, ask the phone to check again with `adb shell pm verify-app-links --re-verify com.example.reader`.

On iOS, Apple's servers fetch the file rather than the phone, and the phone takes it from them when the app is installed. A change in the console can take a while to reach a phone that way; reinstalling the app later picks it up.

On either phone, tap a link to a series on the tenant's site in a mail or a note. It opens the series in the app. A link typed into the browser's address bar stays in the browser; that is how both platforms behave, not a failed check.

Next: [In-app purchase and sign-in](./5-purchases-and-sign-in.md).
