---
title: Building and signing
description: Produce a signed Android App Bundle and iOS archive of a tenant's app from its manifest.
published: 2026-10-06
---

A release of the tenant's app is built with one command, `task mobile:build`, once for Android and once for iOS. The command reads the [app manifest](./1-app-manifest.md), checks every input before it starts, and builds the store version of the app from an unmodified checkout. This page goes through the inputs it reads from the environment, then the two builds.

Every flag the command accepts is listed in the [mobile app reference](https://github.com/publira/publira/blob/main/mobile/README.md#building-a-tenants-app).

## What every build needs

### The address the app connects to

Export the origin of the tenant's site as `PUBLIRA_BASE_URL`. The app asks it for the API under `/api` and for images under `/images`, which the install's reverse proxy already routes:

```bash
export PUBLIRA_BASE_URL=https://reader.example.com
```

It has to be `https://` and an origin alone, with no path. The build refuses anything else rather than shipping an app that fails only on a reader's phone. It is usually the manifest's `tenant.host`, but the manifest does not decide it: an install can serve the API on another host name.

### Push notifications

The Firebase project the app receives push notifications through is built into the app. Set it up before the first release, as [Push notifications](./3-push-notifications.md) describes, and keep its values in a file of their own, such as `~/example-reader/firebase.json`. A build given no Firebase values still works, but has no push notifications, and the switch for them is missing from the app's **Account** screen.

### The version

Each upload to a store needs a build number higher than the last one the store took, and readers see the version name. Give both to every release build:

```bash
--build-name 1.2.0 --build-number 7
```

Without them the build is `1.0.0`, build `1`, which a store refuses from the second upload on.

## Android

### Create the upload key

Google Play needs every upload signed by the same key, the upload key. Create it once, on the machine that builds or in your secret store:

```bash
keytool -genkeypair -v -keystore ~/example-reader/upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool` comes with every JDK, and asks for the keystore's password and the key's. Keep the file and both passwords outside the repository and back them up: Play Console can replace a lost upload key, but only through a request Google has to approve, and uploads wait until it does.

New apps on Google Play use Play App Signing: Google keeps the key the installed app is signed with, and the upload key only proves that an upload comes from you. That distinction matters again on the [App links](./4-app-links.md) page.

### Build the App Bundle

Name the keystore and its passwords in the environment, then build:

```bash
export PUBLIRA_ANDROID_KEYSTORE=~/example-reader/upload.jks
export PUBLIRA_ANDROID_KEYSTORE_PASSWORD='...'
export PUBLIRA_ANDROID_KEY_ALIAS=upload
export PUBLIRA_ANDROID_KEY_PASSWORD='...'

task mobile:build -- ~/example-reader/app.yaml appbundle \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

Run it from the repository root. A relative path to the manifest or the keystore is read from the directory you start in; the Firebase file is read from `mobile/`, which is why the example gives its full path.

The build stops before compiling when any of the four signing variables is missing, rather than signing with a key Google Play would refuse. The App Bundle to upload is `mobile/build/app/outputs/bundle/productionRelease/app-production-release.aab`.

To try the release on a phone before uploading it, build `apk` instead of `appbundle`, under the same variables, and install `mobile/build/app/outputs/flutter-apk/app-production-release.apk`. Such a build is signed with the upload key, so links to the site do not open it unless the upload key's fingerprint is listed under [App links](./4-app-links.md) as well.

## iOS

### Prepare the Mac

An iOS build runs on a Mac with Xcode. Sign Xcode in to an Apple account that belongs to the publisher's Apple Developer team, under **Xcode** › **Settings** › **Accounts**. The build uses automatic signing: Xcode registers the bundle ID with the capabilities the app uses — push notifications, associated domains, and Sign in with Apple — and creates the certificate and profiles itself, so there is nothing to download from the Apple Developer website by hand.

Find the team's Team ID, ten letters and digits, under **Membership details** on the Apple Developer website, and name it in the environment:

```bash
export PUBLIRA_IOS_DEVELOPMENT_TEAM=ABCDE12345
```

The same Team ID is entered under [App links](./4-app-links.md) later.

### Build the archive

```bash
task mobile:build -- ~/example-reader/app.yaml ipa \
  --dart-define-from-file="$HOME/example-reader/firebase.json" \
  --build-name 1.2.0 --build-number 7
```

The archive is `mobile/build/ios/archive/Runner.xcarchive`, and the file to upload is the `.ipa` in `mobile/build/ios/ipa/`. Upload the `.ipa` with Apple's Transporter app, or open the archive in Xcode's **Organizer** and choose **Distribute App**. Once App Store Connect has processed it, it can go to TestFlight for testing on a phone, and then to review.

A build for a device stops at its first step when `PUBLIRA_IOS_DEVELOPMENT_TEAM` is not set, rather than signing under whichever team Xcode finds first.

## What the build leaves behind

The build writes the tenant's identity only into files Git ignores, and fails when it leaves a change in any file the repository tracks. The same checkout therefore builds the next tenant's app, or the next release, without being cleaned first.

Next: [Push notifications](./3-push-notifications.md).
