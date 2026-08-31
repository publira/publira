# mobile

The end-user mobile app for iOS and Android, built with Flutter.

## Role

- Provide a mobile reading experience equivalent to `web-host`
- Reflect each tenant's theme and brand in the mobile UI
- Keep APIs aligned with the schema generated in `packages/api-client/`

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
│   ├── api/                      # Connect JSON client and tenant lookup
│   ├── auth/                     # Session, secure storage, AuthController
│   ├── catalog/                  # CatalogRepository
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

| Path                                    | Screen         |
| --------------------------------------- | -------------- |
| `/`                                     | Catalog list   |
| `/sign-in`                              | Sign-in form   |
| `/account`                              | Signed-in reader and sign-out |
| `/series/:seriesId`                     | Series details |
| `/series/:seriesId/episodes/:episodeId` | Episode viewer |

The list displays loading, empty, and network-error-with-retry states. Details display loading, not-found, and network-error states. In addition, the viewer displays guidance for both locked paid episodes (`EPISODE_ACCESS_LOCKED`) and episodes without pages.

The catalog's app bar carries the account entry point, which opens `/sign-in` for a signed-out reader and `/account` for a signed-in one.

## Viewer

The viewer displays the images returned by `GetEpisodeDetail` as episode content, paging from right to left (the same reading direction as the `web-host` reader).

- One page per screen. Tap the left half, swipe left, or use the `Next page` button to advance
- The page container reserves space from the API's `width` / `height` before the image arrives, so the layout does not shift. Images without dimensions use the entire viewport as a provisional container
- Each page has its own loading and failure-with-retry state, so one failed page does not fail the entire episode body
- Images come from image-server. The tenant is sent in `X-Forwarded-Host` and the reader in `Authorization: Bearer`, using the token of whoever is signed in. Preserve the media token that the API adds to a paid episode image URL

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

By default, it uses an on-device Connect fixture server. When `PUBLIRA_LIVE_API=true`, it also runs against the public API for the development seed (`Seed Series 001` / `SeedSERSAAA1`), signing in as `member@example.com`, who holds a seeded access ticket for the paid episode.

```bash
# Start stack + integration tests + teardown (requires an emulator or device)
task mobile:e2e

# When the API and device are already available
task mobile:test-integration
```

On failure, logcat and screenshots are left in `mobile/.run/artifacts/`. CI's `Test / Mobile E2E` starts the public API and development seeds, then runs `PUBLIRA_LIVE_API=true task mobile:test-integration` on an Android emulator and uploads the `mobile-e2e-artifacts` artifact on failure.
