# mobile

The end-user mobile app for iOS and Android, built with Flutter.

## Role

- Provide a mobile reading experience equivalent to `web-storefront`
- Reflect each tenant's theme and brand in the mobile UI
- Speak the public API through types generated from `proto/`, as the web apps do through `packages/api-client/`
- Keep what the reader has read on the device, so an episode opens without a network

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install), at the version `FLUTTER_VERSION` in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) pins; [`scripts/setup-flutter.sh`](../scripts/setup-flutter.sh) installs it
- Xcode (for iOS builds)
- Android Studio or the Android SDK (for Android builds)

## Setup

### Dev Container

`task setup` at the repository root (also run by the Dev Container's `postCreate`) includes `flutter pub get`. No additional manual steps are needed.

To refresh dependencies only:

```bash
# From the repository root
task mobile:deps

# Or from mobile/
cd mobile
flutter pub get
```

### Android emulator in the Dev Container

The Dev Container carries no Android SDK, because nothing outside `mobile/` needs one. The integration tests and device screenshots do, and install it on demand:

```bash
task mobile:android-install   # once per machine; asks you to accept the Android SDK license
task mobile:emulator-start    # boots the emulator headless and waits until Android has booted
task mobile:emulator-stop
```

`task mobile:android-install` runs `scripts/android-install.sh`, which installs only what is missing:

- the Temurin build `ci.yml` sets up, under `~/Android/`, set as Flutter's JDK with `flutter config --jdk-dir`. Renovate updates the version in the script and in `ci.yml` together
- the Android command-line tools, `platform-tools`, `emulator`, and `system-images;android-34;default;x86_64` under `~/Android/Sdk`, the directory Flutter finds without configuration
- the `publira-pixel-7` AVD (Pixel 7 hardware profile, with a 4 GB data partition)
- a group for the GID `/dev/kvm` belongs to, with you in it
- `adb` linked into `~/.local/bin`
- a Gradle heap cap in `~/.gradle/gradle.properties`, unless that file already sets `org.gradle.jvmargs`

`sdkmanager` shows the [Android SDK License Agreement](https://developer.android.com/studio/terms) and asks you to accept it, so run the task from a terminal; without one it stops before installing any package. Everything is downloaded from Google by you rather than shipped in the image, which the license does not allow.

The emulator needs KVM. The task stops before downloading anything when the container has no `/dev/kvm`, which is the case whenever the host does not pass one through. The platforms, build tools, NDK, and CMake a build needs are fetched by Gradle on the first build.

`~/Android`, `~/.android`, and `~/.gradle` are the `android-sdk`, `android-user-home`, and `gradle-user-home` volumes, so the JDK, the SDK and the license you accepted, the AVD, and Gradle's caches survive a rebuild of the Dev Container. Flutter's JDK setting, the `/dev/kvm` group, and the `adb` link live in the container, and `task mobile:emulator-start` and `task mobile:build` set them up again with `scripts/android-install.sh --attach` before they start, which downloads nothing and does nothing on a machine that has never run the install. A rebuilt container therefore boots the emulator and builds the app without the task.

To start over, stop the Dev Container and remove the three volumes from the host with `docker volume rm`. Compose prefixes each name with the project, so `docker volume ls` lists them as `<project>_android-sdk`, `<project>_android-user-home`, and `<project>_gradle-user-home`. The next rebuild creates them empty, and `task mobile:android-install` downloads everything again.

| Variable | Meaning |
| --- | --- |
| `ANDROID_HOME` | Where the SDK is installed and read from. `~/Android/Sdk` when unset |
| `PUBLIRA_MOBILE_AVD_NAME` | The AVD to create and boot. `publira-pixel-7` when unset |
| `PUBLIRA_MOBILE_AVD_DEVICE` | The hardware profile `task mobile:android-install` creates the AVD with, as `avdmanager list device` names it. `pixel_7` when unset; an AVD that already exists keeps the profile it was created with |

### Linux desktop in the Dev Container

Where the host passes no `/dev/kvm` through, no emulator can boot, and the integration tests run on the app's Linux desktop build instead (see [Integration tests](#integration-tests) for what that proves). Flutter already finds the Linux toolchain in the Dev Container; the rest is installed on demand:

```bash
task mobile:linux-install   # once per container; uses sudo
```

`task mobile:linux-install` runs `scripts/linux-install.sh`, which installs only what is missing from Debian's archive:

- `xvfb` and `xauth`, the X server the build draws into with no display attached
- `dbus-daemon`, for the D-Bus session the build runs in
- `gnome-keyring`, the Secret Service that holds the session store's keychain
- `libsecret-1-dev`, which `flutter_secure_storage_linux` compiles against

### Local machine (outside the Dev Container)

After installing the Flutter SDK:

```bash
cd mobile
flutter pub get
```

Alternatively, run `task mobile:deps` or `task setup` from the repository root.

## Development

```bash
# Run on an iOS simulator
flutter run -d ios

# Run on an Android emulator
flutter run -d android

# Run on the web (Chrome)
flutter run -d chrome
```

`task mobile:run -- <flutter run arguments>` runs the same thing against the worktree's own stack, with the connection settings of [Connecting to the public API](#connecting-to-the-public-api) taken from the selected development profile.

## Build flavors

The app builds in two flavors, so a development build and a production build can sit on one device at the same time.

| Flavor | Android application ID | iOS bundle identifier | Launcher name | Icon set |
| --- | --- | --- | --- | --- |
| `dev` | `<android.applicationId>.dev` | `<ios.bundleIdentifier>.dev` | `<app.name> Dev` | `AppIcon-dev` / `android/app/src/dev/res` |
| `production` | `<android.applicationId>` | `<ios.bundleIdentifier>` | `<app.name>` | `AppIcon` / `android/app/src/main/res` |

`<android.applicationId>`, `<ios.bundleIdentifier>`, and `<app.name>` come from the [app manifest](#app-manifest) the build configuration was generated from: `dev.publira.app`, `dev.publira.app`, and Publira for Publira's own.

Both icon sets still hold the same placeholder art, so today the two builds are told apart by their launcher name. Give the development build its own icon by replacing the images in `ios/Runner/Assets.xcassets/AppIcon-dev.appiconset/` and adding `android/app/src/dev/res/mipmap-*/ic_launcher.png`; nothing else has to change, because both platforms already read the flavor's own icon.

`default-flavor: dev` in `pubspec.yaml` makes every `flutter` command without a `--flavor` build the development app, so `flutter run` and `flutter test integration_test` both target the development app, and so does CI's `Test / Mobile E2E` through `task mobile:test-integration`. `Test / Mobile` builds no app at all — `dart format`, `flutter analyze`, and `flutter test` run on the host — so no flavor reaches it. A store build is the other one, which [`task mobile:build`](#building-a-tenants-app) makes unless told otherwise.

A flavor decides identity — application ID, launcher name, icon, and the associated domain Universal Links claim. Where the app connects stays with `--dart-define` (see [Connecting to the public API](#connecting-to-the-public-api)), because the same development build points at a local `task dev` stack, an emulator loopback to the host, or an E2E stack depending on who runs it.

Android takes the flavor from `productFlavors` in `android/app/build.gradle.kts`, which reads the application ID, launcher name, and App Links host from the generated build configuration, and `dev` overrides from `android/app/src/dev/res/` whatever else it wants to differ. A production Android build refuses a `PUBLIRA_TENANT_HOST` other than the manifest's `tenant.host`. The source namespace, `dev.publira.app`, is Publira's own and does not follow the application ID. iOS takes it from the `dev` and `production` Xcode schemes, whose `Debug-`, `Release-`, and `Profile-` configurations derive `PRODUCT_BUNDLE_IDENTIFIER` and `APP_DISPLAY_NAME` (which `Info.plist` reads as `CFBundleDisplayName`) from the generated `PUBLIRA_BUNDLE_IDENTIFIER` and `PUBLIRA_APP_NAME`, and choose `ASSETCATALOG_COMPILER_APPICON_NAME`; the entitlements claim the generated `PUBLIRA_ASSOCIATED_DOMAIN`. A production iOS build refuses a `PUBLIRA_TENANT_HOST` other than the manifest's `tenant.host` as well. A new flavor has to appear on both platforms under one name, because `default-flavor` and `--flavor` name a single flavor for whichever platform is being built.

## App manifest

Each tenant builds and publishes the app under its own identity, which an app manifest states in YAML. [The app manifest](../docs/en/5-mobile-app/1-app-manifest.md) describes its fields and how a tenant writes one.

| File | What it is |
| --- | --- |
| `config/app.schema.v1.json` | The format as a JSON Schema, for an editor to validate against |
| `config/app.default.yaml` | Publira's own identity, which development, tests, and CI build with |
| `config/app.example.yaml` | The manifest a tenant copies out of the repository and fills in with its own values |
| `.generated/` | Build configuration generated from a manifest; ignored by Git |

Check a manifest before building with it; every problem is listed at once, and the command exits non-zero when there is one. `--generate` then writes the build configuration a platform build reads, and writes nothing for a manifest with a problem:

```bash
cd mobile
dart run scripts/app_manifest.dart path/to/app.yaml
dart run scripts/app_manifest.dart   # config/app.default.yaml
dart run scripts/app_manifest.dart --generate path/to/app.yaml
```

| Generated file | Read by |
| --- | --- |
| `app.properties` | `android/app/build.gradle.kts`, which stops with the command to run when the file is missing |
| `App.xcconfig` | `ios/Flutter/Debug.xcconfig` and `ios/Flutter/Release.xcconfig`, which include it, with the team `PUBLIRA_IOS_DEVELOPMENT_TEAM` names; the Runner target's first build phase, `scripts/ios-check-app-config.sh`, stops with the command to run when it is missing |

The files go into `.generated/`, or into the directory `PUBLIRA_MOBILE_GENERATED_DIR` names (relative to `mobile/`); builds for two tenants running at once each name their own. Gradle reads the directory the variable names, but Xcode reads `.generated/` only, and an iOS build stops when the variable names another directory. `task mobile:deps` generates Publira's own, and so do `task mobile:run`, `task mobile:screenshot`, and `task mobile:test-integration` before every build, replacing whatever another manifest generated. Development, screenshots, the integration tests, and CI therefore build as Publira without anyone writing a manifest; only a tenant's build names one.

## Building a tenant's app

`task mobile:build` builds the app a tenant publishes from its own manifest. [Building and signing](../docs/en/5-mobile-app/2-building.md) is the procedure, from the inputs a release needs to the files uploaded to the stores.

```bash
# From the repository root; a relative manifest path is read from where the task starts
task mobile:build -- <manifest> <target> [flutter build arguments]
```

The command checks the manifest and the arguments, reports every problem before starting Flutter, generates the build configuration from the manifest, and runs `flutter build <target>` in `mobile/`:

| Input | What the command does with it |
| --- | --- |
| `<manifest>` | Checked and generated into `.generated/`, or into `PUBLIRA_MOBILE_GENERATED_DIR`, which an `ios` or `ipa` build refuses |
| `<target>` | One of `apk`, `appbundle`, `ios`, and `ipa` |
| `ios.googleSignInClientId` | Passed as `--dart-define=PUBLIRA_GOOGLE_IOS_CLIENT_ID` when the manifest names one; giving the define as well is refused |
| `--flavor` | `production` when no flavor is named; `--flavor dev` builds the development app under the same manifest |
| `tenant.host` | Passed as `--dart-define=PUBLIRA_TENANT_HOST`, so the app asks the API about the tenant whose links it claims. Giving the define as well is refused |
| `PUBLIRA_BASE_URL` | Passed as the define of the same name. A production build requires it, as an `https://` origin with no path, query, or fragment; a development build without it keeps the defaults of [Connecting to the public API](#connecting-to-the-public-api). Giving the defines as well is refused |
| `PUBLIRA_ANDROID_KEYSTORE` | Resolved from where the task starts and passed on to Gradle |
| `PUBLIRA_IOS_DEVELOPMENT_TEAM` | Checked as a Team ID and generated into `App.xcconfig` |
| Any other argument | Passed on to `flutter build` after the command's own, such as the [Firebase configuration](#firebase-configuration) defines, `--build-name`, and `--build-number` |

The build fails when it leaves a change behind in a file Git tracks or does not ignore: a tenant's identity lives only in the generated files, so every tenant builds from the same unmodified checkout.

### Signing a tenant's app

A production release is signed with the tenant's own keys, which the environment names so that neither the keys nor their passwords reach the app manifest or the repository. Every other build — the `dev` flavor, and debug and profile builds of either flavor — signs as Flutter does by default, so development, screenshots, the integration tests, and CI need no signing input.

| Variable | What it is |
| --- | --- |
| `PUBLIRA_ANDROID_KEYSTORE` | The upload keystore. A relative path is read from `mobile/` by a direct `flutter build`, and from where the task starts by `task mobile:build` |
| `PUBLIRA_ANDROID_KEYSTORE_PASSWORD` | The keystore's password |
| `PUBLIRA_ANDROID_KEY_ALIAS` | The alias of the upload key in the keystore |
| `PUBLIRA_ANDROID_KEY_PASSWORD` | The upload key's password |
| `PUBLIRA_IOS_DEVELOPMENT_TEAM` | The ten-character Team ID of the Apple Developer account the app is published under |

Android reads its four variables while Gradle configures the build. A `production` `release` build — `flutter build apk` or `appbundle` — stops before compiling when any of them is missing or the keystore is not a file, rather than falling back to the debug keys Google Play refuses.

iOS takes the team through the generated build configuration, which `task mobile:build` and `dart run scripts/app_manifest.dart --generate` write it into as the `DEVELOPMENT_TEAM` of the `Release-production` configuration alone, so `project.pbxproj` never names one and every other build keeps signing as Flutter does by default. The Runner target keeps automatic signing. A `Release-production` build for a device stops in the Runner target's first build phase when the configuration was generated without a team, rather than letting Flutter sign under whichever team it finds in the keychain.

## Quality gates (format / analyze / test)

Run these commands from the repository root to reproduce the same checks as CI.

```bash
# Resolve dependencies (after cloning or changing pubspec)
task mobile:deps

# Format check + analyze (including info) + flutter test
task mobile:check
```

To run them separately:

```bash
task mobile:format    # dart format --output=none --set-exit-if-changed .
task mobile:analyze   # flutter analyze --fatal-infos
task mobile:test      # flutter test (unit / widget / HTTP fixture)
```

To use Flutter directly under `mobile/`:

```bash
cd mobile
flutter pub get
dart format --output=none --set-exit-if-changed .
flutter analyze --fatal-infos
flutter test
```

When a PR changes `mobile/**`, CI's `Test / Mobile` job runs the same gates. `Test / Mobile E2E (device)` and `Test / Mobile E2E (live)` run the [integration tests](#integration-tests) on Android emulators, and `Test / Mobile Android` builds a tenant's production APK from `config/app.example.yaml` through `task mobile:build`, signed with a throwaway upload key.

`Test / Mobile iOS` builds the iOS app with Xcode on macOS through `task mobile:test-ios-build`, which needs a Mac with Xcode and `task mobile:deps` run first. It builds the `dev` flavor for the simulator from Publira's own manifest and the `production` flavor, unsigned, from a tenant manifest, reads `CFBundleIdentifier`, `CFBundleDisplayName`, and the associated domains back out of each built app — for the unsigned store build, which carries no entitlements, the associated domains of the entitlements file Xcode resolves for it — confirms that a production build for another tenant host is refused, and fails when the builds leave the working tree changed.

For the full CI job layout, path filters, and triage, see [.github/workflows/README.md](../.github/workflows/README.md).

## Directory layout

```
mobile/
├── lib/
│   ├── main.dart                 # Entry point
│   ├── app.dart                  # MaterialApp.router + AuthScope + CatalogScope
│   ├── router.dart               # go_router definition: every route, and the tab that holds it
│   ├── config.dart               # --dart-define API / image / tenant configuration
│   ├── api/                      # Connect client and its generated messages (gen/), tenant lookup, page fetch and decryption
│   ├── auth/                     # Session, secure storage, AuthController: sign-in with a password, Apple, Google, or a passkey, sign-up, password reset, and the account icon
│   ├── announcements/            # AnnouncementBoard: the tenant's announcements and the pinned banner
│   ├── catalog/                  # CatalogRepository, the shelves above the catalog list, eye-catch rendition choice and cover widget
│   ├── comments/                 # CommentRepository, tenant comment mode, own-comment merge
│   ├── contact/                  # ContactRepository: a reader's message to the tenant's staff
│   ├── content_views/            # ContentViewRepository: the views the tenant's rankings and content statistics count
│   ├── crypto/                   # HMAC-SHA256 keystream shared by delivery and storage
│   ├── follow/                   # FollowRepository and the control a series or an author is followed with
│   ├── forms/                    # Input shapes the forms share, such as what an email address looks like
│   ├── l10n/                     # Locale resolution, delegates, and the catalog compiled into gen/
│   ├── library/                  # The library's lists: continue reading, follows, and downloads
│   ├── links/                    # Tenant-site URL parsing, where a link a tenant wrote leads, incoming App Links, the share sheet, and the browser
│   ├── navigation/               # The bottom navigation bar, its tabs, and navigation onto a tab's stack
│   ├── offline/                  # Encrypted library of saved catalog, episodes, and pages
│   ├── pages/                    # PageRepository: the tenant's published pages
│   ├── models/                   # Series / author / label / episode body / episode comment / follow / inbox notification / announcement
│   ├── notifications/            # NotificationInbox: the inbox, its unread count, and what a row says and opens
│   ├── purchase/                 # A paid episode bought through the web checkout in the browser or the store's in-app purchase
│   ├── push/                     # PushController: Firebase Cloud Messaging, device registration, notification routing
│   ├── screens/                  # Catalog / search / library / series / author / label / viewer / comments / sign-in / sign-up / email confirmation / password reset / account / linked accounts / passkeys / notifications / contact / announcements / published page
│   ├── settings/                 # Local preferences, including the age-rating confirmation
│   ├── tenant/                   # The tenant's brand and theme, the controller that loads them, and whether the API serves the tenant
│   ├── viewer/                   # Paged reader: page images, the reading position, and the end of an episode
│   └── wait_free/                # WaitFreeRepository and the wait-for-free ticket offered on a locked episode
├── test/                         # Widget / HTTP fixtures
├── integration_test/             # On-device navigation
├── config/                       # App manifest schema, Publira's default manifest, and an example
├── scripts/                      # Mobile E2E lifecycle, running, photographing, or building the app, and the app manifest
├── android/                      # Android-specific files
├── ios/                          # iOS-specific files
├── linux/                        # Linux desktop runner, for the integration tests where no emulator boots
├── web/                          # Web-specific files
├── pubspec.yaml
└── analysis_options.yaml
```

What a module does for the reader is documented on its types. `dart doc` in `mobile/` renders it into `doc/api/`, which Git ignores.

## Localization

Every string the app shows comes from the shared catalogs in `locales/`, and `resolveAppLocale` in `lib/l10n/locale_negotiation.dart` picks the language it renders in among those the tenant offers.

`scripts/generate-locale-registry.ts` compiles the `mobile` and `errors` namespaces of `locales/*.json` into `lib/l10n/gen/app_messages.dart`: one `AppMessages` getter or method per key, and the MessageFormat 2 source of every message in every locale. A member formats its source at runtime with [`package:messageformat`](https://pub.dev/packages/messageformat), through `formatCatalogMessage` in `lib/l10n/message_format.dart`, in the catalog's `intl` locale; the app reads no JSON at runtime. Each variable of a message becomes a required named parameter, so the compiler is what checks that a screen passes every value a message takes, and a key present in one catalog but not another fails `pnpm locales:generate` rather than a screen.

`pnpm locales:check` fails when the generated file is behind the catalogs, and `task mobile:check` formats and analyzes it like any other source. A screen reads the catalog with `AppMessages.of(context)`. A variable that a numeric function such as `:integer` takes is a `num` parameter, and the screen passes the number itself; any other variable is a `String`, and a number for it is formatted first with `formatInteger` from `lib/l10n/formatting.dart`.

To add copy, add the key under `mobile.<screen>` to every `locales/*.json`, run `pnpm locales:generate`, and use the new member. Reuse an `errors.*` key when the copy is the classification the web apps show for the same failure, such as `errors.rpc.unavailable` for a request that could not reach the API.

## Firebase configuration

The Firebase project is configured with `--dart-define`, the way every other connection setting is, rather than with a `google-services.json` / `GoogleService-Info.plist` in the repository: a build serves one tenant and one Firebase project, and which project that is belongs to whoever builds it. The values are the ones the Firebase console shows for the project's Android and iOS apps.

| Definition | Meaning |
| --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | Firebase project id |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | The project's sender id |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` / `PUBLIRA_FIREBASE_ANDROID_APP_ID` | The Android app in that project |
| `PUBLIRA_FIREBASE_IOS_API_KEY` / `PUBLIRA_FIREBASE_IOS_APP_ID` / `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` | The iOS app in that project |

A build given none of them starts with no Firebase project, so push is off and the account screen leaves the switch out. That is what `flutter test`, the integration tests, and a local `task dev` stack run as.

FCM does not deliver to the iOS simulator, so verifying push on iOS needs a physical device. The push capability itself is in the repository: `ios/Runner/Runner.entitlements` carries the development APNs environment for the Debug and Profile configurations, and `ios/Runner/RunnerRelease.entitlements` the production one for Release. The APNs auth key the Firebase project relays through is uploaded as [Push notifications](../docs/en/5-mobile-app/3-push-notifications.md) describes.

## API client

The app calls the public API's `publira.v1` services through the messages and the `*ServiceApi` stubs `buf generate` writes into `lib/api/gen/` from `proto/`, the way the web apps call it through `packages/api-client/src/gen`. `ConnectClient` in `lib/api/connect_client.dart` is the transport the stubs are given: it posts each request to `/rpc/publira.v1.<Service>/<Method>` in the Connect protocol's binary protobuf codec (`application/proto`) and decodes the answer into the generated response message. A refusal comes back as the Connect protocol's JSON error envelope whichever codec the request used.

The generated directory is checked in and holds nothing but `buf` output. After a change under `proto/`, regenerate it from the repository root together with the server's Go and the web apps' TypeScript:

```bash
task gen
```

CI's `Check` job runs the same `buf generate` and fails when `lib/api/gen/` differs from what it writes. A field renamed or retyped in `proto/` is then a compile error in the repository that reads it, reported by `flutter analyze`.

## Connecting to the public API

Use `--dart-define` to switch the test API and tenant host.

| Definition | Default | Meaning |
| --- | --- | --- |
| `PUBLIRA_BASE_URL` | `http://127.0.0.1:8000` | The origin the app asks for the public API under `/rpc` and for images under `/images`: the tenant's site, or `publira server` itself, on its one port |
| `PUBLIRA_TENANT_HOST` | `localhost:3080` | Host passed to `GetTenantByDomain`; the development seed stores `localhost` on the edge port, `3080` in the Dev Container. Sent with the image requests as `X-Forwarded-Host`. A production build must pass the manifest's `tenant.host` |
| `PUBLIRA_GOOGLE_IOS_CLIENT_ID` | Unset | The Google iOS client whose URL scheme the build registered; `task mobile:build` passes the manifest's `ios.googleSignInClientId` |
| `PUBLIRA_LIVE_API` | Unset | Whether integration tests run their live group against the actual API |

The Debug and Profile entitlements append `?mode=developer` so a locally hosted association file can be tried; Release does not.

The defaults are the shared default stack's ports. A worktree that has selected a development profile (`task dev-env:start`) does not listen on them: that profile holds a port block of its own, and `task mobile:run` reads the two values out of it.

```bash
# Local server (task dev / E2E stack)
flutter run --dart-define=PUBLIRA_BASE_URL=http://127.0.0.1:8000 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost:3080

# The host's server from an Android emulator
flutter run -d android \
  --dart-define=PUBLIRA_BASE_URL=http://10.0.2.2:8000 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost:3080

# The worktree's selected development profile, on its own ports
task mobile:run -- -d android
```

It addresses that profile's `publira server` itself rather than its edge, and reaches it at `10.0.2.2` from an Android emulator and through `adb reverse` from a device on a cable. A value already exported is left as it is, which is how a stack of another kind is named without editing anything. `PUBLIRA_MOBILE_DEVICE` names the device the address is resolved for when several are attached.

## Screenshots

A pull request that changes a screen carries a picture of it, and the picture is taken against the worktree's selected development profile so that the eye-catches on it are the seeded covers. The widget-test fixtures address `http://images.test/…`, a name reserved to resolve nowhere, so anything that renders those for a person draws `EyeCatchCover`'s placeholder in every row instead.

```bash
task dev-env:start
task mobile:screenshot
task mobile:screenshot -- /series/SeedSERSAAA1 /series/SeedSERSAAA1/episodes/SeedEPSDAAA1
```

Every route named on the command line becomes one PNG under `.run/screenshots/`; with no route named, the catalog the app opens on.

The screens are taken on an attached device or emulator, which the app is built and installed on; in the Dev Container that is the one [`task mobile:emulator-start`](#android-emulator-in-the-dev-container) boots. With none attached, the same app is built for the web instead, served by `scripts/web_app_server.dart`, and photographed at the viewport and pixel ratio of a Pixel 7 by the browser `e2e/` already depends on; such a picture carries no status bar and no system navigation.

Every screen is taken signed in as a development-seed reader, the seeded member unless another one is named, so the account settings, the library's lists, and the notification inbox show themselves rather than the signed-out notice. The command signs the reader in against the profile's public API and builds the token into the app as `--dart-define=PUBLIRA_SESSION_TOKEN`, which the app holds in memory rather than in the credential store. A run taken signed out passes the define empty, so a session the device already keeps is not shown either. `task mobile:build` refuses the define.

```bash
task mobile:screenshot -- /account/delete
PUBLIRA_MOBILE_SCREENSHOT_READER=admin@example.com task mobile:screenshot -- /account
PUBLIRA_MOBILE_SCREENSHOT_READER= task mobile:screenshot -- /sign-in
```

| Variable | Meaning |
| --- | --- |
| `PUBLIRA_MOBILE_DEVICE` | The device to build, install, and photograph on. The first attached one when unset |
| `PUBLIRA_MOBILE_SCREENSHOT_WAIT_MS` | How long a screen is given to finish arriving before the shutter. `8000` when unset |
| `PUBLIRA_MOBILE_SCREENSHOT_DEVICE` | The Playwright device the browser fallback emulates. `Pixel 7` when unset |
| `PUBLIRA_MOBILE_SCREENSHOT_READER` | The email address of the reader the screens are taken signed in as. `member@example.com` when unset; set to empty, the screens are taken signed out |
| `PUBLIRA_MOBILE_SCREENSHOT_PASSWORD` | That reader's password. The address's local part followed by `pass`, the password of every account the development seed holds, when unset |

## Integration tests

`integration_test/` repeatedly checks the following:

- App launch and initial catalog display
- The ranking and new-arrival shelves above the catalog list
- List → detail → back
- A keyword reaching a series, an author, and a label, and the series the author and the label list
- Viewer display and paging for a free episode
- Locked display for an unpurchased paid episode
- Sign-in unlocking that paid episode, and sign-out locking it again
- Rejected credentials staying on the sign-in form
- A sign-up, the confirmation link arriving as an App Link, and the resulting account signing in
- An unconfirmed address asking for a fresh confirmation link, and sign-in refusing it until then
- A password reset requested from the sign-in form, the reset link arriving as an App Link, and the member signing in with the new password
- An expired reset link leading back to a fresh request
- A purchase completed in the browser, with a stubbed launcher, opening the paid episode. The store's in-app purchase needs a store account, so its tests are the widget tests over a fake `InAppPurchasePlatform`
- A session written to and read back from the platform keychain
- A series that does not exist
- An empty catalog
- An unreachable API
- A free episode read online turning again once the API is gone, and the catalog opening from the device
- An episode the device never saved saying so instead of failing blankly
- A paid episode saved by a member closing again once they sign out, and leaving the device once the API takes the grant back
- An episode opening on the page the API already held for the member, and the page they turn to reaching the API
- An episode reopening on its saved page once the API is gone
- A notification and an announcement opened by the seed member, and the read mark each sends reaching the API
- Every page the storefront's footer lists opening from the account screen
- An icon uploaded, replaced, and removed from the account screen
- A preset icon picked from the account screen of a tenant that offers presets in place of an upload

`integration_test/reader_parity.json` is the public-reader parity matrix: every capability `web-storefront` serves a reader, with the app route and call that do the same, or an exception saying why the app has none. `pnpm reader-parity:check` fails when a `web-storefront` page, route handler, or public API call is not in it, and `test/reader_parity_test.dart` resolves every app route it names against the router. An entry whose record both surfaces read (`sharedRecord`) names the tests here that cover it.

By default, it uses an on-device Connect fixture server. When `PUBLIRA_LIVE_API=true`, it also runs against the public API for the development seed (`Seed Series 001` / `SeedSERSAAA1`), signing in as `member@example.com`, who holds a seeded access ticket for the paid episode. The live group also reads the unread announcement and notification `db/seeds/scenarios/310_mobile_reader_records.sql` gives that member, which `scripts/e2e-db-setup.sh` applies after the stack's own setup; apply it again before re-running against a stack that is already up.

```bash
# In the Dev Container, boot the emulator first (see "Android emulator in the Dev Container")
task mobile:emulator-start

# Start stack + integration tests + teardown (requires an emulator or device)
task mobile:e2e

# When the API and device are already available
task mobile:test-integration

# The address and port forwarding each kind of device is given (no device)
task mobile:test-device-ports
```

The app lays itself out for a tablet from a window 600 dp wide. To run the suite at a tablet's width, create a tablet AVD beside the phone one, under a name of its own, and boot it instead:

```bash
PUBLIRA_MOBILE_AVD_NAME=publira-pixel-tablet PUBLIRA_MOBILE_AVD_DEVICE=pixel_tablet task mobile:android-install
PUBLIRA_MOBILE_AVD_NAME=publira-pixel-tablet task mobile:emulator-start
task mobile:test-integration
```

### On the Linux desktop

Where no emulator can boot — a Dev Container whose host passes no `/dev/kvm` through — the same suite runs on the app's Linux desktop build, after [`task mobile:linux-install`](#linux-desktop-in-the-dev-container):

```bash
# Start stack + integration tests on the Linux desktop + teardown
task mobile:e2e-linux

# When the API is already available
PUBLIRA_E2E_MOBILE_DEVICE=linux task mobile:test-integration
```

The build runs under Xvfb, inside a D-Bus session of its own whose keyring and application data start empty and are removed afterwards, in a window the size of a Pixel 7 in portrait. It reaches the stack at `127.0.0.1`, as any build running on this machine does. `task mobile:test-integration` never chooses the Linux desktop on its own; it has to be named.

What it proves is the app's own logic: navigation, the reader, sign-in, the fixture and live groups' calls to the API and the image routes, offline reading, and a session surviving in a real Secret Service. It does not prove the Android build. The renderer and every plugin take their Linux implementation — the keychain is libsecret rather than the Android Keystore, and `path_provider`, `app_links`, and `url_launcher` are the desktop ones — while the suite already stands fakes in for incoming links, the browser, and the store. Push notifications and screenshot notices have no Linux implementation and stay off, as in a build with no Firebase project. Use the emulator whenever one can boot, and always for a change to `android/`, a plugin, or anything that depends on the platform rather than the app; CI's `Test / Mobile E2E` runs on the emulator only.

On failure, the screenshots the tests take are left in `mobile/.run/artifacts/screenshots/`.

On failure, logcat and screenshots are left in `mobile/.run/artifacts/`.

CI runs the suite as two jobs, `Test / Mobile E2E (device)` and `Test / Mobile E2E (live)`, each on an emulator and a runner of its own:

| Job | What it runs | Stack |
| --- | --- | --- |
| `device` | Every group but the live one, with `PUBLIRA_LIVE_API=false`, which leaves the live group skipped | None: the groups answer themselves on the device |
| `live` | The live group alone, `task mobile:test-integration -- --plain-name 'live public API'` | `scripts/e2e-up.sh`: postgres, redis, rustfs, and mailpit, the database and storage as `scripts/e2e-db-setup.sh` leaves them, and the server and the worker that `Test / Mobile E2E Build` built from the same commit |

Each job uploads `mobile-e2e-artifacts-device` or `mobile-e2e-artifacts-live` on failure. The server's image routes matter to the live job because every seeded episode carries a body, so its reader fetches pages as soon as it opens one.

`task mobile:test-integration` passes its arguments on to `flutter test`, and `task mobile:e2e` passes them on to it, so either can run one group: `task mobile:e2e -- --plain-name 'live public API'`. `scripts/e2e-up.sh` starts the stack from a `server/bin` that is already built; `task mobile:e2e` builds it first.
