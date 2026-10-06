---
title: Mobile app
description: Building, signing, and publishing a tenant's own iOS and Android app.
published: 2026-10-06
---

Every tenant can publish the Publira reader app under its own name: its own launcher name and store listings, its own push notifications, and links to its site that open in the app. These pages are for whoever builds and publishes that app, whether the operator or the publisher's own staff, and they assume no knowledge of the Flutter code it is built from.

The app is built from the repository rather than downloaded. One checkout builds the app of any tenant: everything that makes it a particular tenant's app lives in a small file you keep outside the repository, the app manifest, and in values the build reads from its environment.

## Before you start

- **The tenant's site is in service.** The app reads everything from the tenant's public site, and the stores check the links it claims against that same host. [Deployments](../2-deployments/index.md) covers bringing an install into service.
- **An Apple Developer Program membership and a Google Play Console developer account** for the publisher the app is published under. Both are paid and take time to approve, so apply first.
- **A Firebase project** for push notifications. It is free.
- **A checkout of the release the install runs**, so the app and the API it calls are from the same release.
- **A machine that builds the app.** Android builds on Linux, macOS, or Windows; iOS builds only on a Mac with Xcode. Both need the Flutter SDK at the version the repository pins, as the [prerequisites](https://github.com/publira/publira/blob/main/mobile/README.md#prerequisites) describe. The repository's Dev Container installs Flutter, and `task mobile:android-install` adds the Android SDK and a JDK to it.

After cloning, run `task setup` once from the repository root, or `task mobile:deps` if only the app is built there.

## In this section

The pages follow the order the work is done in. The first release takes all of them; a later release takes only the build and the submission.

- [The app manifest](./1-app-manifest.md): naming the app, the tenant it serves, and the identifiers the stores know it by.
- [Building and signing](./2-building.md): producing a signed Android App Bundle and iOS archive from the manifest.
- [Push notifications](./3-push-notifications.md): the Firebase project, Apple's push key, and the credentials the tenant console sends with.
- [App links](./4-app-links.md): making links to the tenant's site open in the app.
- [In-app purchase and sign-in](./5-purchases-and-sign-in.md): what the app needs to sell episodes through the stores and to sign readers in with Apple and Google.
- [Submitting to the stores](./6-store-submission.md): the store listings, and what App Review and Google Play's review need from the publisher.
