# mobile

The end-user mobile app for iOS and Android, built with Flutter.

## Role

- Provide a mobile reading experience equivalent to `web-host`
- Reflect each tenant's theme and brand in the mobile UI
- Keep APIs aligned with the schema generated in `packages/api-client/`
- Keep what the reader has read on the device, so an episode opens without a network

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.41 or later)
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
task mobile:android-install   # once per container; asks you to accept the Android SDK license
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

| Variable | Meaning |
| --- | --- |
| `ANDROID_HOME` | Where the SDK is installed and read from. `~/Android/Sdk` when unset |
| `PUBLIRA_MOBILE_AVD_NAME` | The AVD to create and boot. `publira-pixel-7` when unset |

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

Each tenant builds and publishes the app under its own identity, which an app manifest states in YAML:

```yaml
schemaVersion: 1

app:
  name: Example Reader # the launcher name

tenant:
  host: reader.example.com # the one tenant the app serves, which its links are verified against

android:
  applicationId: com.example.reader # the production application ID

ios:
  bundleIdentifier: com.example.reader # the production bundle identifier
```

Every field is required, and a field the format does not define is an error. Android and iOS take separate identifiers, so an app that already has a store listing under different ones keeps both. `schemaVersion` names the format, and a manifest of a version the tooling does not read is refused rather than half-applied.

| File | What it is |
| --- | --- |
| `config/app.schema.json` | The format as a JSON Schema, for an editor to validate against |
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
| `App.xcconfig` | `ios/Flutter/Debug.xcconfig` and `ios/Flutter/Release.xcconfig`, which include it; the Runner target's first build phase, `scripts/ios-check-app-config.sh`, stops with the command to run when it is missing |

The files go into `.generated/`, or into the directory `PUBLIRA_MOBILE_GENERATED_DIR` names (relative to `mobile/`); builds for two tenants running at once each name their own. Gradle reads the directory the variable names, but Xcode reads `.generated/` only, and an iOS build stops when the variable names another directory. `task mobile:deps` generates Publira's own, and so do `task mobile:run`, `task mobile:screenshot`, and `task mobile:test-integration` before every build, replacing whatever another manifest generated. Development, screenshots, the integration tests, and CI therefore build as Publira without anyone writing a manifest; only a tenant's build names one.

## Building a tenant's app

A tenant builds the app it publishes from its own manifest:

1. Copy `config/app.example.yaml` out of the repository and replace every value with the tenant's. The identifiers are what the stores know the app by, so they stay the same for every later release.
2. Export the origin the app connects to, which a production build requires and the app manifest does not carry.
3. Run `task mobile:build` with the manifest and the `flutter build` target.
4. Once the stores list the app, enter its identities in the tenant console, as [Linking a tenant's app to its site](#linking-a-tenants-app-to-its-site) describes, so the tenant's links open it.

```bash
# From the repository root; a relative manifest path is read from where the task starts
export PUBLIRA_BASE_URL=https://reader.example.com

task mobile:build -- ../tenant/app.yaml appbundle
task mobile:build -- ../tenant/app.yaml ipa
```

The command checks the manifest and the arguments, reports every problem before starting Flutter, generates the build configuration from the manifest, and runs `flutter build <target>` in `mobile/`:

| Input | What the command does with it |
| --- | --- |
| `<manifest>` | Checked and generated into `.generated/`, or into `PUBLIRA_MOBILE_GENERATED_DIR`, which an `ios` or `ipa` build refuses |
| `<target>` | One of `apk`, `appbundle`, `ios`, and `ipa` |
| `--flavor` | `production` when no flavor is named; `--flavor dev` builds the development app under the same manifest |
| `tenant.host` | Passed as `--dart-define=PUBLIRA_TENANT_HOST`, so the app asks the API about the tenant whose links it claims. Giving the define as well is refused |
| `PUBLIRA_BASE_URL` | Passed as the define of the same name. A production build requires it, as an `https://` origin with no path, query, or fragment; a development build without it keeps the defaults of [Connecting to the public API](#connecting-to-the-public-api). Giving the defines as well is refused |
| Any other argument | Passed on to `flutter build` after the command's own, such as the [Firebase configuration](#firebase-configuration) defines, `--build-name`, and `--build-number` |

The build fails when it leaves a change behind in a file Git tracks or does not ignore: a tenant's identity lives only in the generated files, so every tenant builds from the same unmodified checkout.

## Linking a tenant's app to its site

A link on the tenant host opens the published app only once Android and iOS have verified the app against `https://<tenant.host>/.well-known/assetlinks.json` and `https://<tenant.host>/.well-known/apple-app-site-association`. The public site builds both documents from what a tenant administrator saves under **Integrations** → **App links** in the tenant console, and answers 404 for a platform left unticked; a tenant without apps ticks neither.

The values are those of the app the stores distribute: the `production` flavor `task mobile:build` made from the tenant's manifest. The `dev` flavor's `.dev` identifiers are never entered, and a value that differs from the published app by a single character leaves the links opening in the browser.

| App links field | Where the value comes from |
| --- | --- |
| **Application ID** | `android.applicationId` in the manifest. Google Play shows the same value as the `id=` of the app's store address |
| **SHA-256 signing certificate fingerprints** | The certificate the installed app is signed with, which the manifest does not hold. With Play App Signing, it is the SHA-256 fingerprint of the app signing key certificate on the app's **App signing** page in Play Console; the upload key does not sign what Play delivers. Without it, it is the `SHA256:` line `keytool -list -v -keystore <release keystore> -alias <key alias>` prints. One per line, up to ten, so an upload-key build installed outside Play, or a key being rotated in, can be listed beside it |
| **Apple Team ID** | The ten-character Team ID in the membership details of the Apple Developer account the app is published under, which the manifest does not hold |
| **Bundle identifier** | `ios.bundleIdentifier` in the manifest. App Store Connect shows the same value as the Bundle ID under **App Information** |

Checking the manifest prints both identifiers as the build used them, so they are copied from its output rather than retyped:

```console
$ dart run scripts/app_manifest.dart ../tenant/app.yaml
../tenant/app.yaml: Example Reader for reader.example.com (Android com.example.reader, iOS com.example.reader)
```

The manifest's `tenant.host` has no field of its own: it has to be a host the tenant's site is served on, because that is where Android and iOS fetch the documents.

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

When a PR changes `mobile/**`, CI's `Test / Mobile` job runs the same gates. `Test / Mobile E2E` runs integration tests on an Android emulator (`PUBLIRA_LIVE_API=true task mobile:test-integration`). The CI job starts and stops the server (the public API and the images) and development seeds.

For the full CI job layout, path filters, and triage, see [.github/workflows/README.md](../.github/workflows/README.md).

## Directory layout

```
mobile/
├── lib/
│   ├── main.dart                 # Entry point
│   ├── app.dart                  # MaterialApp.router + AuthScope + CatalogScope
│   ├── router.dart               # go_router definition
│   ├── config.dart               # --dart-define API / image / tenant configuration
│   ├── api/                      # Connect JSON client, tenant lookup, page fetch and decryption
│   ├── auth/                     # Session, secure storage, AuthController
│   ├── announcements/            # AnnouncementBoard: the tenant's announcements and the pinned banner
│   ├── catalog/                  # CatalogRepository, eye-catch rendition choice and cover widget
│   ├── comments/                 # CommentRepository, tenant comment mode, own-comment merge
│   ├── contact/                  # ContactRepository: a reader's message to the tenant's staff
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
│   ├── purchase/                 # Web checkout of a paid episode, and the browser it is opened in
│   ├── push/                     # Firebase Cloud Messaging, device registration, notification routing
│   ├── screens/                  # Catalog / search / library / series / author / label / viewer / comments / sign-in / sign-up / email confirmation / password reset / account / notifications / contact / announcements / published page
│   ├── settings/                 # Local preferences, including the age-rating confirmation
│   └── viewer/                   # Paged reader
├── test/                         # Widget / HTTP fixtures
├── integration_test/             # On-device navigation
├── config/                       # App manifest schema, Publira's default manifest, and an example
├── scripts/                      # Mobile E2E lifecycle, running, photographing, or building the app, and the app manifest
├── android/                      # Android-specific files
├── ios/                          # iOS-specific files
├── web/                          # Web-specific files
├── pubspec.yaml
└── analysis_options.yaml
```

## Navigation

Every screen but the episode viewer carries a bottom navigation bar of five tabs, each with a navigation stack of its own. Switching tabs keeps each one's screens and scroll positions, and tapping the tab on screen takes it back to its root.

| Tab | Root | Screen |
| --- | --- | --- |
| Home | `/` | Catalog list |
| Search | `/search` | Search, with the keyword field focused while it is empty |
| Library | `/library` | Continue reading, follows, and downloads |
| Notifications | `/notifications` | The reader's notification inbox, badged with the unread count |
| Account | `/account` | Signed-in reader, their date of birth, the way to each account setting, and sign-out |

Every tab holds the catalog's routes and the sign-in forms under its own root, so a series, an author, a label, an episode, or an announcement opened from a tab is pushed onto that tab's stack: `/series/:seriesId` on the home tab is `/search/series/:seriesId` on the search tab.

| Path under a tab's root | Screen |
| --- | --- |
| `/sign-in` | Sign-in form |
| `/sign-up` | Sign-up form, and the state that waits for the address to be confirmed |
| `/resend-verification` | Asks for a fresh confirmation link |
| `/reset-password` | Asks for a password reset link; the site's own path, claimed as an App Link |
| `/announcements` | The tenant's announcements; the site's own path, claimed as an App Link |
| `/announcements/:announcementId` | One announcement |
| `/page/:pageSlug` | A page the tenant published, its slug one encoded segment (`/page/legal%2Fterms`) |
| `/series/:seriesId` | Series details |
| `/creators/:creatorId` | An author and the published series credited to them |
| `/labels/:labelId` | A label and its published series |
| `/series/:seriesId/episodes/:episodeId` | Episode viewer, which hides the bar |
| `/series/:seriesId/episodes/:episodeId/comments` | Episode comments |

The routes only one tab holds:

| Path | Tab | Screen |
| --- | --- | --- |
| `/checkout/return` | Home | A checkout the browser hands back; it opens the episode it was started for |
| `/account/name` | Account | Renames the account (`AuthService/UpdateMe`) |
| `/account/email` | Account | Asks to move the account to another address (`AuthService/RequestEmailChange`) |
| `/account/password` | Account | Replaces the password and keeps this device signed in on the token handed back (`AuthService/ChangePassword`) |
| `/account/delete` | Account | Deletes the account after the password and a second confirmation, then signs out (`AuthService/DeleteMe`) |
| `/account/contact` | Account | A message to the tenant's staff |
| `/verify` | Account | Where a confirmation link is spent; the site's own path, claimed as an App Link |
| `/confirm-password` | Account | Where a password reset link sets the new password; the site's own path, claimed as an App Link |
| `/confirm-email` | Account | Where either link of an email change is confirmed; the site's own path, claimed as an App Link |

An incoming App Link, a push-notification tap, and a checkout return open on the tab their path belongs to — the home tab for a site path under none of the other roots — and leave the other tabs as they were. A session the API stopped accepting offers sign-in on the account tab.

Details display loading, not-found, and network-error states. In addition, the viewer displays guidance for both locked paid episodes (`EPISODE_ACCESS_LOCKED`) and episodes without pages.

The catalog's app bar carries the way to the announcements.

### Tenant links and sharing

A link to a series, an episode, the announcements, a checkout return, an email confirmation, a password reset, or an email change on the tenant host opens the app when it is installed, rather than the browser. iOS claims the manifest's `tenant.host` through `com.apple.developer.associated-domains`, from the generated `PUBLIRA_ASSOCIATED_DOMAIN` build setting. Android claims the same host as an App Link (`autoVerify`) for `/series/…`, `/announcements`, `/checkout/return`, `/verify`, `/reset-password`, `/confirm-password`, and `/confirm-email`, including a locale prefix. `assetlinks.json` and `apple-app-site-association` are served by the public site from tenant configuration, not by this app; see [Linking a tenant's app to its site](#linking-a-tenants-app-to-its-site).

`app_links` receives the URL on a cold or warm start. The host must be `PUBLIRA_TENANT_HOST`; a locale prefix the catalogs know is stripped, and the remainder is an in-app path `go_router` already has. Flutter's own deep linking is off, because the raw `https://…` location would match none of those paths.

The series screen and the viewer carry a share action. It hands the platform share sheet the canonical site URL of that page — `https://` and the tenant host, with a locale prefix only when the reader's language is not the tenant's default — and the wording the catalog uses for the work and who is credited on it.

### The catalog screen

The catalog is four sections, top to bottom. Each reads its own page of `CatalogRepository` and owns its loading, failure-with-retry, and empty states, so a section the API could not answer offers its retry where it stands and leaves the others alone.

| Section | Read | Standing |
| --- | --- | --- |
| Continue reading | `ListMyRecentSeries` | A signed-in reader in the middle of something. Each card opens the episode the API names for its series |
| Top 10 this week | `ListRankedSeries`, weekly | A tenant the ranking batch has written a snapshot for. Cards carry the snapshot's own positions, so a series unpublished since leaves a gap |
| New arrivals | `ListPublishedSeries`, newest first | A tenant with a published series |
| All series | `ListPublishedSeries`, by title | The whole catalog, as the list the screen ends in |

The first three are horizontal shelves, and a shelf answered with nothing takes its heading with it: a reader in the middle of nothing and a tenant with no chart are offered no row rather than an empty one. The whole-catalog list is ordered by title because the newest of it already stands above it as a shelf of its own.

Only the whole-catalog list is kept for reading without a network. The shelves above it are another order over the same series, a chart of a window that has closed, and one reader's own history — none of which the device can answer on its own, so each reports that it could not reach the API.

### The search screen

`/search` is a keyword and the three groups the site's search answers it with: the published series `SearchPublishedSeries` matches, the authors `SearchPublishedCreators` matches, and the labels `SearchPublishedLabels` matches. The field — the app bar's title — is the only place the keyword is held.

The field is searched for once it has stood still for a moment, so a word typed letter by letter costs one request per group, and it is limited to the 100 code points the API accepts. Emptying it puts the screen back to asking for a keyword rather than searching for nothing.

Each group is read, fails, and retries on its own, so a name that matches no title still brings back its author, and a keyword a group has nothing for says so in that group. The overview shows the first five rows of each and offers the rest of a group only when there is more of it. The chips under the field open one group on its own: its whole list, one cursor page at a time, the next asked for as the reader nears the end of the rows already there. A series row opens its series, an author row the author, and a label row the label.

Search is answered by the API alone. Matching a keyword against every published title, synopsis, and name is a read of the whole catalog, and what the device keeps is one page of it.

### The author and label screens

`/creators/:creatorId` reads `GetPublishedCreatorDetail`: the author's portrait, name, profile, and a follow control, above the published series credited to them. `/labels/:labelId` reads `GetPublishedLabelDetail`: the label's artwork and name above its published series. Both lists are in title order, one cursor page at a time, and both screens say so when what they belong to does not exist, offer a retry when the API could not answer, and are answered by the API alone.

A reader reaches an author from the search screen, from a name in the credit line and an author row on the series screen, and from an author row of what they follow; a label, from the search screen and from the label on a row of the catalog list.

### The library

`/library` is what the reader reads, as three tabs of one screen, each a list that pages and scrolls on its own:

| Tab | Read | A guest sees |
| --- | --- | --- |
| Continue reading | `ListMyRecentSeries`, one cursor page at a time; a row opens the episode the API names for its series | The way to sign in |
| Follows | `ListMyFollows`, as [Follows](#follows) describes | The way to sign in |
| Downloads | What the device keeps, as [Offline reading](#offline-reading) describes | The same list |

A build carrying no follow repository or no offline library leaves that tab out.

## Localization

Every string the app shows comes from the shared catalogs in `locales/`, and the app renders in the language the device asks for.

### Copy

`scripts/generate-locale-registry.ts` compiles the `mobile` and `errors` namespaces of `locales/*.json` into `lib/l10n/gen/app_messages.dart`: one `AppMessages` getter or method per key, and one subclass per locale. A `{$name}` placeholder becomes a required named parameter, so the compiler is what checks that a screen passes every value a message takes, and a key present in one catalog but not another fails `pnpm locales:generate` rather than a screen. The messages are parsed during generation by `messageformat`, the MessageFormat 2 implementation `@publira/i18n` already uses, so the app holds no message syntax of its own and reads no JSON at runtime; pub.dev offers no MessageFormat 2 implementation, and the app does not need one.

`pnpm locales:check` fails when the generated file is behind the catalogs, and `task mobile:check` formats and analyzes it like any other source. A screen reads the catalog with `AppMessages.of(context)`, and formats a number with `formatInteger` from `lib/l10n/formatting.dart` before handing it to a message, because the catalog's placeholders take strings.

To add copy, add the key under `mobile.<screen>` to every `locales/*.json`, run `pnpm locales:generate`, and use the new member. Reuse an `errors.*` key when the copy is the classification the web apps show for the same failure, such as `errors.rpc.unavailable` for a request that could not reach the API.

### Locale

`PubliraApp` resolves the locale the way `web-host` does, with the device standing in for the browser. The first device language that names a catalog wins, whether by its whole tag, by the script that tag is written in, or by its language alone. A device set to none of them takes the tenant's `default_locale`, which `GetTenantByDomain` returns and `TenantResolver` keeps; until that answer arrives, and for good when it cannot, on a launch without a network, the app opens in English, the same decision `@publira/i18n` makes for a browser with no usable preference. `MaterialApp.localizationsDelegates` carries the app's own delegate alongside the `flutter_localizations` ones, so Material's own strings follow the same locale.

There is no in-app switcher: the device setting is the switch, and changing it while the app runs re-renders every screen.

## Viewer

The viewer displays the images returned by `GetEpisodeDetail` as episode content, paging from right to left (the same reading direction as the `web-host` reader).

- The page container reserves space from the API's `width` / `height` before the image arrives, so the layout does not shift. Images without dimensions use the entire viewport as a provisional container
- Each page has its own loading and failure-with-retry state, so one failed page does not fail the entire episode body
- Images come from the server's `/images` routes. The tenant is sent in `X-Forwarded-Host` and the reader in `Authorization: Bearer`, using the token of whoever is signed in. Preserve the media token the API adds to an episode image URL: a paid body's names the reader, a free body's names the episode
- A body page arrives encrypted whether it is free or paid: `application/octet-stream` plus `X-Publira-Image-Encryption`, `X-Publira-Image-Content-Type`, and `X-Publira-Image-Key-Id`. The app reverses that stream before decoding the page. Its content key is derived from material the request itself carried, so the server never sends a key: read the `Authorization` bearer first and the media token in the URL only when there is no header, the order the server resolves the two in
- A signed-out reader sends no header, so a free page's key comes from the media token on its own URL. The API issues that one for the episode and a 24-hour rotation window rather than for a reader, so every reader of the episode inside one window is handed the same token, and it stops decoding after at most two days. A signed-in reader's free page still decrypts with the bearer, the material the server resolves first
- A response without `X-Publira-Image-Encryption` is decoded as it arrives, which is what keeps the reader working when a rolling deploy answers them from a server instance it has not replaced yet. A page whose stream cannot be reversed fails on its own and offers a retry, the same way a failed fetch does
- Pages are requested with an `Accept` that offers WebP and leaves AVIF out, because the server's image converter negotiates the rendition from that header and Flutter has no AVIF codec
- Leaving the reader evicts the episode's pages from the shared image cache, so a body's decoded pixels are not left behind whatever is read next
- A signed-in reader opens the episode on the page `GetMyReadingPosition` answers with, which is the same position `web-host` writes, and the page they rest on is recorded with `SaveReadingPosition`. A guest has no position and opens on the first page
- The screen after the last page ends the episode: it offers the next one `GetEpisodeDetail` names, with what it costs, and leads back to the series; the last published episode of a series says so instead. The bottom bar carries the episodes either side of this one beside the page controls, and taking either of them replaces the reader rather than stacking a second one on it

## Comments

The comments on an episode are offered at the end of it and nowhere else: what a reader has to say about an episode comes after they have read it, so the way to them is on the screen past the last page rather than beside the pages. It opens `/series/:seriesId/episodes/:episodeId/comments`, which lists the published comments newest first, twenty to a page, and pages with the cursor token every list RPC shares.

- The tenant's comment mode, which `GetTenant` answers, decides whether any of this is offered. Under `disabled` the end of the episode offers nothing, and a link kept from before the setting changed lands on a screen saying the site takes no comments; under `approval_required` the screen says a comment appears once a moderator has approved it. A lookup that could not reach the API is not the tenant saying no: the offer stays, and the screen behind it reports the failure
- A signed-in reader writes one in the box above the list, and a reader who is signed out is offered the way to sign in instead of the box. The body is measured against the API's limit — 1000 Unicode code points rather than UTF-16 units — before the request, so an emoji-heavy comment is measured the way the server measures it
- `ListMyEpisodeComments` is read beside the public page, and its rows are placed among it by date, which is what shows an author the comment of theirs that is still waiting for approval. A comment staff removed keeps rendering to its author exactly as it did before — never marked, moved, or repeated — because a removal the platform makes must not become visible through the way its author's screen changes
- A reader takes their own comment down, and reports somebody else's. Reporting asks for one of four reasons and an optional sentence in a dialog, and a repeat report is answered exactly as a first one is
- Comments are online only, and are no part of what the device keeps for reading without a network. A list that cannot reach the API says so and offers a retry, and a comment written without a connection fails with the same wording rather than being queued; what the reader wrote stays in the box for them to send again
- A comment's time is rendered in the zone the device is set to, where the site renders it in the tenant's: every other time on a phone reads in the zone its holder chose

## Follows

A reader follows a series, and each author credited on it, from the series screen, and reads back what they follow in the library. A follow is what a new-episode notification is delivered by, and it is the same list the site writes: `FollowService` holds it, and nothing of it is written to the device.

- The series screen carries one control for the series and one for each author credited on it, beside the row that opens the author. The author screen carries the same control
- What a reader follows is theirs, and the API answers a request without a session `unauthenticated`, so a guest is offered the way to sign in rather than a control that cannot act
- A state the API could not answer leaves the control offering to follow, which is the request the API takes the same way whether or not the follow is already there. A follow the reader asked for that did not happen says why
- The library's Follows tab lists what they follow, newest follow first, one cursor page at a time, the next asked for as the reader nears the end of the rows already there. `ListMyFollows` answers with public ids alone, so each row's name is a catalog read of its own — one that leaves the device alone, because a reader who follows a series has not opened it — and a row whose name could not be read is named by its public id. A row opens its series or its author; every row unfollows without asking the API what it already knows
- The API lists only targets that are still public, so a series taken down leaves the list rather than standing in it as a row nothing names

## Notification inbox

`/notifications` is the reader's record of what they were notified of, read from `NotificationService` whether or not a push ever reached the device. It is online only, and nothing of it is written to the device.

- The list is newest first, twenty to a page, the next asked for as the reader nears the end of the rows already there. A row's title and description are assembled from its `notification_type` and payload with the same catalog wording the site uses; a type this build does not know stays as a generic row
- A row opens what it is about: a new episode opens its viewer, a comment notification the comments of its episode, and a payload naming only a series opens the series. An announcement opens `/announcements`, since its payload names no announcement, and a payload naming nothing the app can open lands on the catalog
- Opening an unread row marks it read on the way, and each unread row carries its own mark; the app bar marks every notification read
- The unread count badges the Notifications tab. It is read back from `CountUnreadNotifications` after every read mark, when the inbox opens, when the app returns to the foreground, and when a push arrives in front, so it is the server's count rather than one the device worked out

## Announcements

`/announcements` lists the tenant's announcements from the announcement RPCs of `AuthService`, the same list the site shows at its own `/announcements`, and `/announcements/:announcementId` shows one. Both are read without a session; a signed-in reader's session adds read state and the marks that set it. The pinned announcement (`GetPinnedAnnouncement`) is a banner at the top of the catalog. The announcements are online only, and the one thing written to the device is the id of the banner the reader closed, which `DismissedAnnouncementStore` keeps as the site's cookie does.

## Published pages

`/page/:pageSlug` sets a page the tenant published — its terms of service, its privacy policy, or anything else — from the Markdown `PublicPagesService/GetPublishedPage` answers with, in the app rather than in a browser. The page is online only.

A link in an announcement or in a page body goes to a screen of the app when the app has one. A path on the tenant site it has none for opens the page screen when `ListPublishedPageSlugs` names it, and the site in the system browser otherwise; a URL on another site opens in the browser. Anything else, a `javascript:` or `file:` URL among them, does nothing. An image in a page is fetched only from an `https` address.

## Offline reading

Everything the reader opens is kept on the device, so the same screens open again without a network. An episode is on the device because it was read, or because the reader saved it from its row on the series screen, which fetches every page at once.

- The catalog list, the series screens behind it, and every episode body that loaded are saved as they load. A body page is saved once it has been turned into displayable bytes, which is also what the viewer draws
- The API decides. Every read goes to it first, and only its answer refreshes what the device holds; the saved copy is reached only when the API cannot be. A body that comes back locked, or that the API no longer has, is taken off the device along with its pages, and a series the API no longer publishes takes every episode saved under it
- A body that needed a purchase or a ticket is saved against the reader it was granted to, so it stays closed to a signed-out device and to a second reader on the same phone. It also stops opening once **7 days** have passed without the API confirming the grant, because the device cannot see a purchase lapse on its own. That window is measured against the device's own clock: a confirmation dated in the future is refused rather than trusted, but a reader who holds their clock back keeps reading, which is the same boundary the delivery stream draws — not DRM
- Saved episodes are marked on the series screen and on the offer that ends an episode, so a reader can tell before they lose their connection what they will still be able to open
- The page the reader stopped on is kept beside the episode, against the member it belongs to, so an episode read without a network opens where they left it. The API wins over it wherever it holds a position of its own, which is what carries a page saved on the website into the app
- The device keeps up to **512 MB** of pages. Over that, the least recently confirmed episodes are dropped whole, and page files no episode claims any more go with them
- The library's Downloads tab shows the bytes used against that cap and the saved episodes by series, with when each was saved and, for a body that needed an entitlement, until when it opens offline. It deletes one episode or everything. An episode saved for another account counts towards the bytes and goes with "Clear all", but is not listed

Everything is written under the app-private directory `path_provider` resolves (`getApplicationSupportDirectory()`), encrypted with a random 32-byte key this install mints on first use and keeps in the OS keychain / Keystore. The stream is the one `lib/api/image_cipher.dart` speaks, under its own domain separator and a per-file key. Like the delivery stream, it protects the files on the device rather than the reader's own access: whoever may open the episode necessarily holds the key that recovers it.

Every write carries a fresh random nonce in front of its ciphertext, and the nonce goes into the key derivation. Without it two versions of `index.json` would be encrypted under the same keystream, and whoever held both copies could XOR them together and read the difference — which, for a document of known JSON shape, means the saved episode ids and grants. The index is also written through a temporary file and a rename, so an interrupted write cannot leave a half-file the app can only answer by wiping itself.

The pages the server delivers cannot be saved as they arrive: their content key is derived from the JWT the request carried, and that token is gone in a day. The app saves what it decoded, re-encrypted under the device key, under an address the media token is stripped from — so a free page saved under one rotation window still opens under the next, and neither the reader's bearer token nor the media token in a page's URL is written down.

Nothing here fails a screen. A platform with no app-private directory, or with no credential store to hold the key, reads online only; a file this build cannot decrypt is treated as one the device does not have.

## Purchases

A paid episode is bought through the public site's Stripe Checkout in the system browser, never in an in-app web view, and the app takes no store in-app purchase.

- A locked episode, in the viewer and on its row of the series screen, offers "Buy for ¥N" when `GetTenant` answers `accepts_payments`. A row offers it only where `GetSeriesEpisodeAccess` answers the episode locked for the reader, so an episode they bought, hold a ticket for, or can read inside a free window is offered nothing
- A guest who takes the offer signs in first and lands on the episode
- The button calls `StartEpisodeCheckout` with `client: CLIENT_MOBILE` and opens the page it answers with `url_launcher` in external application mode. A reader who already holds the episode is shown it instead
- Checkout returns to `/{locale}/checkout/return?episode=…&status=success|cancelled` on the tenant host, which the app claims as a link. The app finds the episode's series and opens the viewer, which reads `GetEpisodeDetail` again. A body still locked after a success is read twice more, each after a longer wait, and then the viewer says the purchase is being confirmed and offers to check again

## Sign-in

A reader signs in with an email address and a password, which `AuthService/Login` answers with a public-audience JWT (24-hour TTL, revoked by `credentials_version`). Every API and image request carries that token, so a purchased or ticketed paid episode reads on the device the same way it does in `web-host`.

- The session lives in the OS keychain / Keystore through `flutter_secure_storage`, never in `shared_preferences`, and is restored at launch
- The launch confirms a restored token with `AuthService/GetMe`. A rejected token is dropped and the reader is told, with the sign-in screen one tap away; an unreachable API leaves the session alone, so a launch without a network still opens signed in
- Nothing signs the reader back in on its own. Once the 24-hour token is gone, the reader signs in again
- Signing out drops the stored session, and a paid episode goes back to its locked state

`web-host` holds its own session in the `@publira/web-session` JWE cookie. The app has no cookie jar, which is why the token lives in the platform credential store instead.

## Sign-up

A reader opens an account here rather than on the website. `AuthService/CreateUser` takes a name, an address, a password, an optional birth date where the tenant checks ages, and consent to the terms of service and privacy policy where the tenant names them, and answers by mailing a confirmation link. Both come from one `GetTenant` read, and the form requires the consent before it sends anything, with each page opening on the `/page/:pageSlug` screen above it.

- Every accepted sign-up ends on the same screen, whether the address was free or already had an account, because that is all the API reports. It names the address the link went to and offers another one
- `AuthService/Login` refuses an account whose address is unconfirmed, and the form then offers a fresh link for the address it was given. `/resend-verification` asks for one from scratch, for a reader who arrived with nothing typed
- The link in the mail addresses the tenant site's `/verify`, so a tap on it opens this app and spends the token through `AuthService/VerifyUserEmail`. A link the API never issued, or one whose time has run out, leads to `/resend-verification`; a link that could not be spent because the API was unreachable is spent again on the same screen

## Password reset

A reader who has forgotten their password recovers the account here rather than on the website. The sign-in form leads to `/reset-password`, which sends `AuthService/RequestPasswordReset` for the address typed so far and ends on the same screen whether or not that address has an account.

- The link in the mail addresses the tenant site's `/confirm-password`, so a tap on it opens this app, which takes the new password and spends the token through `AuthService/ConfirmPasswordReset`. A link the API never issued, or one whose time has run out, leads back to `/reset-password`; a reset the API could not be reached for keeps the form to submit again
- The reset ends every session of the account. A session this device holds is checked with `AuthService/GetMe` afterwards and dropped once the API refuses it, without the expiry notice, because the reader has just replaced the password it was signed in with. A session of another account is kept

## Push notifications

A member is told on the device when a tenant publishes a new episode, and a tap opens that episode's viewer with the series behind it. The message comes from the server through Firebase Cloud Messaging, which relays to APNs for iOS, so one integration carries both platforms.

- Permission is never asked for at launch. The account screen carries a switch for new-episode notifications, and the OS prompt — iOS authorization, and `POST_NOTIFICATIONS` on Android 13 and later — is requested the first time a reader turns it on. A reader who denies it sees the switch settle back to off with a line pointing at system settings, and the app does not ask again on its own
- Turning the switch on registers the device's FCM token against the signed-in reader with `RegisterPushDevice`, and the app re-registers on every token refresh. The token is the identity on the server, so registering one another reader left on the same phone moves it rather than adding a second registration
- Signing out unregisters, and stops this install's token, so a message already on its way finds nothing to deliver to
- A message that arrives while the app is in front is drawn by the app, because FCM does not display one then. A payload naming no route the app can open sends the reader to the catalog

FCM does not deliver to the iOS simulator, so verifying iOS needs a physical device.

### Firebase configuration

The Firebase project is configured with `--dart-define`, the way every other connection setting is, rather than with a `google-services.json` / `GoogleService-Info.plist` in the repository: a build serves one tenant and one Firebase project, and which project that is belongs to whoever builds it. The values are the ones the Firebase console shows for the project's Android and iOS apps.

| Definition | Meaning |
| --- | --- |
| `PUBLIRA_FIREBASE_PROJECT_ID` | Firebase project id |
| `PUBLIRA_FIREBASE_MESSAGING_SENDER_ID` | The project's sender id |
| `PUBLIRA_FIREBASE_ANDROID_API_KEY` / `PUBLIRA_FIREBASE_ANDROID_APP_ID` | The Android app in that project |
| `PUBLIRA_FIREBASE_IOS_API_KEY` / `PUBLIRA_FIREBASE_IOS_APP_ID` / `PUBLIRA_FIREBASE_IOS_BUNDLE_ID` | The iOS app in that project |

A build given none of them starts with no Firebase project, so push is off and the account screen leaves the switch out. That is what `flutter test`, the integration tests, and a local `task dev` stack run as.

An iOS build also needs the APNs auth key uploaded to the Firebase project; without it Firebase has nothing to relay through. The push capability itself is in the repository: `ios/Runner/Runner.entitlements` carries the development APNs environment for the Debug and Profile configurations, and `ios/Runner/RunnerRelease.entitlements` the production one for Release.

## Connecting to the public API

Use `--dart-define` to switch the test API and tenant host.

| Definition | Default | Meaning |
| --- | --- | --- |
| `PUBLIRA_BASE_URL` | `http://127.0.0.1:8000` | The origin the app asks for the public API under `/api` and for images under `/images`: the tenant's site, or the edge listener of `publira server` itself (port 8000, not gRPC port 8100) |
| `PUBLIRA_TENANT_HOST` | `localhost` | Host passed to `GetTenantByDomain`; development seeds use `localhost`. Sent with the image requests as `X-Forwarded-Host`. A production build must pass the manifest's `tenant.host` |
| `PUBLIRA_LIVE_API` | Unset | Whether integration tests run their live group against the actual API |

The Debug and Profile entitlements append `?mode=developer` so a locally hosted association file can be tried; Release does not.

The defaults are the shared default stack's ports. A worktree that has selected a development profile (`task dev-env:start`) does not listen on them: that profile holds a port block of its own, and `task mobile:run` reads the two values out of it.

```bash
# Local server (task dev / E2E stack)
flutter run --dart-define=PUBLIRA_BASE_URL=http://127.0.0.1:8000 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost

# The host's server from an Android emulator
flutter run -d android \
  --dart-define=PUBLIRA_BASE_URL=http://10.0.2.2:8000 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost

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

| Variable | Meaning |
| --- | --- |
| `PUBLIRA_MOBILE_DEVICE` | The device to build, install, and photograph on. The first attached one when unset |
| `PUBLIRA_MOBILE_SCREENSHOT_WAIT_MS` | How long a screen is given to finish arriving before the shutter. `8000` when unset |
| `PUBLIRA_MOBILE_SCREENSHOT_DEVICE` | The Playwright device the browser fallback emulates. `Pixel 7` when unset |

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
- A purchase completed in the browser, with a stubbed launcher, opening the paid episode
- A session written to and read back from the platform keychain
- A series that does not exist
- An empty catalog
- An unreachable API
- A free episode read online turning again once the API is gone, and the catalog opening from the device
- An episode the device never saved saying so instead of failing blankly
- A paid episode saved by a member closing again once they sign out, and leaving the device once the API takes the grant back
- An episode opening on the page the API already held for the member, and the page they turn to reaching the API
- An episode reopening on its saved page once the API is gone

By default, it uses an on-device Connect fixture server. When `PUBLIRA_LIVE_API=true`, it also runs against the public API for the development seed (`Seed Series 001` / `SeedSERSAAA1`), signing in as `member@example.com`, who holds a seeded access ticket for the paid episode.

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

On failure, logcat and screenshots are left in `mobile/.run/artifacts/`. CI's `Test / Mobile E2E` starts the server and the development seeds, then runs `PUBLIRA_LIVE_API=true task mobile:test-integration` on an Android emulator and uploads the `mobile-e2e-artifacts` artifact on failure. The server's image routes matter here because every seeded episode carries a body, so the live group's reader fetches pages as soon as it opens one.
