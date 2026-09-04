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

## Build flavors

The app builds in two flavors, so a development build and a production build can sit on one device at the same time.

| Flavor | Application ID / bundle identifier | Launcher name | Icon set |
| --- | --- | --- | --- |
| `dev` | `com.publira.publira.dev` | Publira Dev | `AppIcon-dev` / `android/app/src/dev/res` |
| `production` | `com.publira.publira` | Publira | `AppIcon` / `android/app/src/main/res` |

Both icon sets still hold the same placeholder art, so today the two builds are told apart by their launcher name. Give the development build its own icon by replacing the images in `ios/Runner/Assets.xcassets/AppIcon-dev.appiconset/` and adding `android/app/src/dev/res/mipmap-*/ic_launcher.png`; nothing else has to change, because both platforms already read the flavor's own icon.

`default-flavor: dev` in `pubspec.yaml` makes every command without a `--flavor` build the development app, so `flutter run` and `flutter test integration_test` both target `com.publira.publira.dev`, and so does CI's `Test / Mobile E2E` through `task mobile:test-integration`. `Test / Mobile` builds no app at all — `dart format`, `flutter analyze`, and `flutter test` run on the host — so no flavor reaches it. A store build asks for the other one:

```bash
flutter build appbundle --flavor production
flutter build ipa --flavor production
```

A flavor decides identity only — application ID, launcher name, and icon. Where the app connects stays with `--dart-define` (see [Connecting to the public API](#connecting-to-the-public-api)), because the same development build points at a local `task dev` stack, an emulator loopback to the host, or an E2E stack depending on who runs it.

Android takes the flavor from `productFlavors` in `android/app/build.gradle.kts`, and `dev` overrides from `android/app/src/dev/res/` whatever it wants to differ; what `android/app/src/main/res/` holds is the production identity. iOS takes it from the `dev` and `production` Xcode schemes, whose `Debug-`, `Release-`, and `Profile-` configurations carry `PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME` (which `Info.plist` reads as `CFBundleDisplayName`), and `ASSETCATALOG_COMPILER_APPICON_NAME`. A new flavor has to appear on both platforms under one name, because `default-flavor` and `--flavor` name a single flavor for whichever platform is being built.

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

When a PR changes `mobile/**`, CI's `Test / Mobile` job runs the same gates. `Test / Mobile E2E` runs integration tests on an Android emulator (`PUBLIRA_LIVE_API=true task mobile:test-integration`). The CI job starts and stops the public API and development seeds.

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
│   ├── catalog/                  # CatalogRepository
│   ├── crypto/                   # HMAC-SHA256 keystream shared by delivery and storage
│   ├── offline/                  # Encrypted library of saved catalog, episodes, and pages
│   ├── models/                   # Series / episode body
│   ├── screens/                  # Catalog / series detail / viewer / sign-in / account
│   └── viewer/                   # Paged reader
├── test/                         # Widget / HTTP fixtures
├── integration_test/             # On-device navigation
├── scripts/                      # Mobile E2E lifecycle
├── android/                      # Android-specific files
├── ios/                          # iOS-specific files
├── web/                          # Web-specific files
├── pubspec.yaml
└── analysis_options.yaml
```

## Navigation

The following routes are defined with `go_router`. The catalog reads from the public API (Connect JSON).

| Path                                    | Screen                        |
| --------------------------------------- | ----------------------------- |
| `/`                                     | Catalog list                  |
| `/sign-in`                              | Sign-in form                  |
| `/account`                              | Signed-in reader and sign-out |
| `/series/:seriesId`                     | Series details                |
| `/series/:seriesId/episodes/:episodeId` | Episode viewer                |

The list displays loading, empty, and network-error-with-retry states. Details display loading, not-found, and network-error states. In addition, the viewer displays guidance for both locked paid episodes (`EPISODE_ACCESS_LOCKED`) and episodes without pages.

The catalog's app bar carries the account entry point, which opens `/sign-in` for a signed-out reader and `/account` for a signed-in one.

## Viewer

The viewer displays the images returned by `GetEpisodeDetail` as episode content, paging from right to left (the same reading direction as the `web-host` reader).

- One page per screen. Tap the left half, swipe left, or use the `Next page` button to advance
- The page container reserves space from the API's `width` / `height` before the image arrives, so the layout does not shift. Images without dimensions use the entire viewport as a provisional container
- Each page has its own loading and failure-with-retry state, so one failed page does not fail the entire episode body
- Images come from image-server. The tenant is sent in `X-Forwarded-Host` and the reader in `Authorization: Bearer`, using the token of whoever is signed in. Preserve the media token the API adds to an episode image URL: a paid body's names the reader, a free body's names the episode
- A body page arrives encrypted whether it is free or paid: `application/octet-stream` plus `X-Publira-Image-Encryption`, `X-Publira-Image-Content-Type`, and `X-Publira-Image-Key-Id`. The app reverses that stream before decoding the page. Its content key is derived from material the request itself carried, so image-server never sends a key: read the `Authorization` bearer first and the media token in the URL only when there is no header, the order image-server resolves the two in
- A signed-out reader sends no header, so a free page's key comes from the media token on its own URL. The API issues that one for the episode and a 24-hour rotation window rather than for a reader, so every reader of the episode inside one window is handed the same token, and it stops decoding after at most two days. A signed-in reader's free page still decrypts with the bearer, the material image-server resolves first
- A response without `X-Publira-Image-Encryption` is decoded as it arrives, which is what keeps the reader working while image-server runs with `PUBLIRA_IMAGE_ENCRYPTION` off. A page whose stream cannot be reversed fails on its own and offers a retry, the same way a failed fetch does
- Pages are requested with an `Accept` that offers WebP and leaves AVIF out, because image-server's converter negotiates the rendition from that header and Flutter has no AVIF codec
- Leaving the reader evicts the episode's pages from the shared image cache, so a body's decoded pixels are not left behind whatever is read next

## Offline reading

Everything the reader opens is kept on the device, so the same screens open again without a network. Nothing is downloaded ahead of time and there is no save button: an episode is on the device because it was read.

- The catalog list, the series screens behind it, and every episode body that loaded are saved as they load. A body page is saved once it has been turned into displayable bytes, which is also what the viewer draws
- The API decides. Every read goes to it first, and only its answer refreshes what the device holds; the saved copy is reached only when the API cannot be. A body that comes back locked, or that the API no longer has, is taken off the device along with its pages, and a series the API no longer publishes takes every episode saved under it
- A body that needed a purchase or a ticket is saved against the reader it was granted to, so it stays closed to a signed-out device and to a second reader on the same phone. It also stops opening once **7 days** have passed without the API confirming the grant, because the device cannot see a purchase lapse on its own. That window is measured against the device's own clock: a confirmation dated in the future is refused rather than trusted, but a reader who holds their clock back keeps reading, which is the same boundary the delivery stream draws — not DRM
- Saved episodes are marked on the series screen, so a reader can tell before they lose their connection what they will still be able to open
- The device keeps up to **512 MB** of pages. Over that, the least recently confirmed episodes are dropped whole, and page files no episode claims any more go with them

Everything is written under the app-private directory `path_provider` resolves (`getApplicationSupportDirectory()`), encrypted with a random 32-byte key this install mints on first use and keeps in the OS keychain / Keystore. The stream is the one `lib/api/image_cipher.dart` speaks, under its own domain separator and a per-file key. Like the delivery stream, it protects the files on the device rather than the reader's own access: whoever may open the episode necessarily holds the key that recovers it.

Every write carries a fresh random nonce in front of its ciphertext, and the nonce goes into the key derivation. Without it two versions of `index.json` would be encrypted under the same keystream, and whoever held both copies could XOR them together and read the difference — which, for a document of known JSON shape, means the saved episode ids and grants. The index is also written through a temporary file and a rename, so an interrupted write cannot leave a half-file the app can only answer by wiping itself.

The pages image-server delivers cannot be saved as they arrive: their content key is derived from the JWT the request carried, and that token is gone in a day. The app saves what it decoded, re-encrypted under the device key, under an address the media token is stripped from — so a free page saved under one rotation window still opens under the next, and neither the reader's bearer token nor the media token in a page's URL is written down.

Nothing here fails a screen. A platform with no app-private directory, or with no credential store to hold the key, reads online only; a file this build cannot decrypt is treated as one the device does not have.

## Sign-in

A reader signs in with an email address and a password, which `AuthService/Login` answers with a public-audience JWT (24-hour TTL, revoked by `credentials_version`). Every API and image-server request carries that token, so a purchased or ticketed paid episode reads on the device the same way it does in `web-host`.

- The session lives in the OS keychain / Keystore through `flutter_secure_storage`, never in `shared_preferences`, and is restored at launch
- The launch confirms a restored token with `AuthService/GetMe`. A rejected token is dropped and the reader is told, with the sign-in screen one tap away; an unreachable API leaves the session alone, so a launch without a network still opens signed in
- Nothing signs the reader back in on its own. Once the 24-hour token is gone, the reader signs in again
- Signing out drops the stored session, and a paid episode goes back to its locked state
- Creating an account and resetting a password stay on the website

`web-host` holds its own session in the `@publira/web-session` JWE cookie. The app has no cookie jar, which is why the token lives in the platform credential store instead.

## Connecting to the public API

Use `--dart-define` to switch the test API and tenant host.

| Definition | Default | Meaning |
| --- | --- | --- |
| `PUBLIRA_API_BASE_URL` | `http://127.0.0.1:8000` | Public API Connect HTTP (`api-server` port 8000, not gRPC port 8100) |
| `PUBLIRA_IMAGE_BASE_URL` | `http://127.0.0.1:8200` | `image-server`, which returns episode-body images |
| `PUBLIRA_TENANT_HOST` | `localhost` | Host passed to `GetTenantByDomain`; development seeds use `localhost`. Sent to image-server as `X-Forwarded-Host` |
| `PUBLIRA_LIVE_API` | Unset | Whether integration tests run their live group against the actual API |

```bash
# Local api-server (task dev / E2E stack)
flutter run --dart-define=PUBLIRA_API_BASE_URL=http://127.0.0.1:8000 \
  --dart-define=PUBLIRA_IMAGE_BASE_URL=http://127.0.0.1:8200 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost

# Host api-server from an Android emulator
flutter run -d android \
  --dart-define=PUBLIRA_API_BASE_URL=http://10.0.2.2:8000 \
  --dart-define=PUBLIRA_IMAGE_BASE_URL=http://10.0.2.2:8200 \
  --dart-define=PUBLIRA_TENANT_HOST=localhost
```

## Integration tests

`integration_test/` repeatedly checks the following:

- App launch and initial catalog display
- List → detail → back
- Viewer display and paging for a free episode
- Locked display for an unpurchased paid episode
- Sign-in unlocking that paid episode, and sign-out locking it again
- Rejected credentials staying on the sign-in form
- A session written to and read back from the platform keychain
- A series that does not exist
- An empty catalog
- An unreachable API
- A free episode read online turning again once the API is gone, and the catalog opening from the device
- An episode the device never saved saying so instead of failing blankly
- A paid episode saved by a member closing again once they sign out, and leaving the device once the API takes the grant back

By default, it uses an on-device Connect fixture server. When `PUBLIRA_LIVE_API=true`, it also runs against the public API for the development seed (`Seed Series 001` / `SeedSERSAAA1`), signing in as `member@example.com`, who holds a seeded access ticket for the paid episode.

```bash
# Start stack + integration tests + teardown (requires an emulator or device)
task mobile:e2e

# When the API and device are already available
task mobile:test-integration
```

On failure, logcat and screenshots are left in `mobile/.run/artifacts/`. CI's `Test / Mobile E2E` starts the public API and development seeds, then runs `PUBLIRA_LIVE_API=true task mobile:test-integration` on an Android emulator and uploads the `mobile-e2e-artifacts` artifact on failure.
