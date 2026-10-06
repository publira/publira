---
title: The app manifest
description: Write the file that names a tenant's app and the identifiers the stores know it by, and check it before building.
published: 2026-10-06
---

The app manifest is a short YAML file that says whose app a build is: the name on the home screen, the one tenant it serves, and the identifiers it is published under. Every build of the tenant's app reads it, so keep it with the tenant's other build inputs, outside the repository, and under version control of your own.

## Write the manifest

Copy [`mobile/config/app.example.yaml`](https://github.com/publira/publira/blob/main/mobile/config/app.example.yaml) to a directory of your own, such as `~/example-reader/app.yaml`, and replace every value with the tenant's:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/publira/publira/main/mobile/config/app.schema.json
schemaVersion: 1

app:
  name: Example Reader

tenant:
  host: reader.example.com

android:
  applicationId: com.example.reader

ios:
  bundleIdentifier: com.example.reader
  googleSignInClientId: 123456789012-abc123.apps.googleusercontent.com
```

| Field | What to enter |
| --- | --- |
| `schemaVersion` | `1`. It names the format of the file, not a version of the app |
| `app.name` | The name under the icon on the home screen. Keep it short enough not to be cut off there; the store listing has a title of its own |
| `tenant.host` | The host name of the tenant's public site, without `https://` or a path. The app serves this tenant alone, and Android and iOS check its links against this host |
| `android.applicationId` | The application ID Google Play will know the app by, such as `com.example.reader`: two or more parts separated by dots, each starting with a letter and holding only letters, digits, and underscores |
| `ios.bundleIdentifier` | The bundle ID the App Store will know the app by: two or more parts separated by dots, of letters, digits, and hyphens |
| `ios.googleSignInClientId` | Optional. The iOS client of the tenant's Google sign-in, as [In-app purchase and sign-in](./5-purchases-and-sign-in.md#sign-in-with-apple-and-google) describes. Leave the line out when the iOS app does not offer Google |

Every other field is required, and a field the format does not define is an error rather than ignored.

### Choose the identifiers once

The application ID and the bundle ID are how the stores know the app. Once a store has a build under one, it cannot be changed: a different identifier is a different app, with no reviews, no installs, and no way to move readers across. Choose them before the first upload and keep them for every later release.

The usual form is a domain the publisher owns, reversed, followed by the app's name: `com.example.reader` for `example.com`. The two may be the same, and usually are. They may also differ, which lets a publisher that already has an app in one store keep its identifier there.

The development build of the app appends `.dev` to both, so it can sit beside the published app on a test device. That build is never uploaded, and its identifiers are never entered anywhere.

## Check the manifest

From the repository root, check the file before building with it:

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

The line it prints is the identity a build from this manifest gets, which is also what you copy into the tenant console and the store consoles later. A manifest with a problem is answered with every problem at once and a non-zero exit, and a build refuses it the same way:

```console
$ dart run mobile/scripts/app_manifest.dart ~/example-reader/app.yaml
/home/you/example-reader/app.yaml is not a valid app manifest:
  - tenant.host "https://Reader.example.com" must be the host name alone, without a scheme (e.g. reader.example.com)
  - android.applicationId "com.example-reader" is not a valid Android application ID: it needs at least two dot-separated segments, and each must start with a letter and contain only letters, digits, and underscores (e.g. com.example.reader)
```

An editor that understands JSON Schema checks the file as you type: the comment on its first line points it at the [format](https://github.com/publira/publira/blob/main/mobile/config/app.schema.json).

Next: [Building and signing](./2-building.md).
