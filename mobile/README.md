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

`task mobile:run -- <flutter run arguments>` runs the same thing against the worktree's own stack, with the connection settings of [Connecting to the public API](#connecting-to-the-public-api) taken from the selected development profile.

## Build flavors

The app builds in two flavors, so a development build and a production build can sit on one device at the same time.

| Flavor | Application ID / bundle identifier | Launcher name | Icon set |
| --- | --- | --- | --- |
| `dev` | `com.publira.publira.dev` | Publira Dev | `AppIcon-dev` / `android/app/src/dev/res` |
| `production` | `com.publira.publira` | Publira | `AppIcon` / `android/app/src/main/res` |

Both icon sets still hold the same placeholder art, so today the two builds are told apart by their launcher name. Give the development build its own icon by replacing the images in `ios/Runner/Assets.xcassets/AppIcon-dev.appiconset/` and adding `android/app/src/dev/res/mipmap-*/ic_launcher.png`; nothing else has to change, because both platforms already read the flavor's own icon.

`default-flavor: dev` in `pubspec.yaml` makes every command without a `--flavor` build the development app, so `flutter run` and `flutter test integration_test` both target `com.publira.publira.dev`, and so does CI's `Test / Mobile E2E` through `task mobile:test-integration`. `Test / Mobile` builds no app at all — `dart format`, `flutter analyze`, and `flutter test` run on the host — so no flavor reaches it. A store build asks for the other one:

```bash
flutter build appbundle --flavor production \\
  --dart-define=PUBLIRA_TENANT_HOST=tenant.example
PUBLIRA_ASSOCIATED_DOMAIN=tenant.example \\
  flutter build ipa --flavor production \\
    --dart-define=PUBLIRA_TENANT_HOST=tenant.example
```

A flavor decides identity — application ID, launcher name, icon, and the associated domain Universal Links claim. Where the app connects stays with `--dart-define` (see [Connecting to the public API](#connecting-to-the-public-api)), because the same development build points at a local `task dev` stack, an emulator loopback to the host, or an E2E stack depending on who runs it.

Android takes the flavor from `productFlavors` in `android/app/build.gradle.kts`, and `dev` overrides from `android/app/src/dev/res/` whatever it wants to differ; what `android/app/src/main/res/` holds is the production identity. iOS takes it from the `dev` and `production` Xcode schemes, whose `Debug-`, `Release-`, and `Profile-` configurations carry `PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME` (which `Info.plist` reads as `CFBundleDisplayName`), `ASSETCATALOG_COMPILER_APPICON_NAME`, and `PUBLIRA_ASSOCIATED_DOMAIN`. A new flavor has to appear on both platforms under one name, because `default-flavor` and `--flavor` name a single flavor for whichever platform is being built.

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

When a PR changes `mobile/**`, CI's `Test / Mobile` job runs the same gates. `Test / Mobile E2E` runs integration tests on an Android emulator (`PUBLIRA_LIVE_API=true task mobile:test-integration`). The CI job starts and stops the public API, image-server, and development seeds.

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
│   ├── catalog/                  # CatalogRepository, eye-catch rendition choice and cover widget
│   ├── comments/                 # CommentRepository, tenant comment mode, own-comment merge
│   ├── crypto/                   # HMAC-SHA256 keystream shared by delivery and storage
│   ├── follow/                   # FollowRepository and the control a series or an author is followed with
│   ├── l10n/                     # Locale resolution, delegates, and the catalog compiled into gen/
│   ├── links/                    # Tenant-site URL parsing, incoming App Links, and the share sheet
│   ├── offline/                  # Encrypted library of saved catalog, episodes, and pages
│   ├── models/                   # Series / author / label / episode body / episode comment / follow
│   ├── purchase/                 # Web checkout of a paid episode, and the browser it is opened in
│   ├── push/                     # Firebase Cloud Messaging, device registration, notification routing
│   ├── screens/                  # Catalog / search / series / author / label / viewer / comments / sign-in / account / follows / downloads
│   ├── settings/                 # Local preferences, including the age-rating confirmation
│   └── viewer/                   # Paged reader
├── test/                         # Widget / HTTP fixtures
├── integration_test/             # On-device navigation
├── scripts/                      # Mobile E2E lifecycle, and running or photographing the app
├── android/                      # Android-specific files
├── ios/                          # iOS-specific files
├── web/                          # Web-specific files
├── pubspec.yaml
└── analysis_options.yaml
```

## Navigation

The following routes are defined with `go_router`. The catalog reads from the public API (Connect JSON).

| Path | Screen |
| --- | --- |
| `/` | Catalog list |
| `/search` | Search results |
| `/sign-in` | Sign-in form |
| `/account` | Signed-in reader, their date of birth, and sign-out |
| `/account/follows` | The series and authors the reader follows |
| `/account/downloads` | What the device keeps for reading offline |
| `/series/:seriesId` | Series details |
| `/creators/:creatorId` | An author and the published series credited to them |
| `/labels/:labelId` | A label and its published series |
| `/series/:seriesId/episodes/:episodeId` | Episode viewer |
| `/series/:seriesId/episodes/:episodeId/comments` | Episode comments |
| `/checkout/return` | A checkout the browser hands back; it opens the episode it was started for |

Details display loading, not-found, and network-error states. In addition, the viewer displays guidance for both locked paid episodes (`EPISODE_ACCESS_LOCKED`) and episodes without pages.

The catalog's app bar carries the account entry point, which opens `/sign-in` for a signed-out reader and `/account` for a signed-in one, and under the title a search field, which opens `/search`.

### Tenant links and sharing

A link to a series, an episode, or a checkout return on the tenant host opens the app when it is installed, rather than the browser. iOS claims the host through `com.apple.developer.associated-domains`; a production archive receives it as the `PUBLIRA_ASSOCIATED_DOMAIN` build setting. Android claims the same `PUBLIRA_TENANT_HOST` as an App Link (`autoVerify`) for `/series/…` and `/checkout/return`, including a locale prefix. `assetlinks.json` and `apple-app-site-association` are served by the public site from tenant configuration, not by this app.

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

`/search` is a keyword and the three groups the site's search answers it with: the published series `SearchPublishedSeries` matches, the authors `SearchPublishedCreators` matches, and the labels `SearchPublishedLabels` matches. The field in the catalog's app bar cannot be typed into: it opens this screen, and the field here — the app bar's title — is the only place the keyword is held.

The field is searched for once it has stood still for a moment, so a word typed letter by letter costs one request per group, and it is limited to the 100 code points the API accepts. Emptying it puts the screen back to asking for a keyword rather than searching for nothing, and the catalog stands behind the screen, so a reader who cleared it leaves by going back.

Each group is read, fails, and retries on its own, so a name that matches no title still brings back its author, and a keyword a group has nothing for says so in that group. The overview shows the first five rows of each and offers the rest of a group only when there is more of it. The chips under the field open one group on its own: its whole list, one cursor page at a time, the next asked for as the reader nears the end of the rows already there. A series row opens its series, an author row the author, and a label row the label.

Search is answered by the API alone. Matching a keyword against every published title, synopsis, and name is a read of the whole catalog, and what the device keeps is one page of it.

### The author and label screens

`/creators/:creatorId` reads `GetPublishedCreatorDetail`: the author's portrait, name, profile, and a follow control, above the published series credited to them. `/labels/:labelId` reads `GetPublishedLabelDetail`: the label's artwork and name above its published series. Both lists are in title order, one cursor page at a time, and both screens say so when what they belong to does not exist, offer a retry when the API could not answer, and are answered by the API alone.

A reader reaches an author from the search screen, from a name in the credit line and an author row on the series screen, and from an author row of what they follow; a label, from the search screen and from the label on a row of the catalog list.

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
- Images come from image-server. The tenant is sent in `X-Forwarded-Host` and the reader in `Authorization: Bearer`, using the token of whoever is signed in. Preserve the media token the API adds to an episode image URL: a paid body's names the reader, a free body's names the episode
- A body page arrives encrypted whether it is free or paid: `application/octet-stream` plus `X-Publira-Image-Encryption`, `X-Publira-Image-Content-Type`, and `X-Publira-Image-Key-Id`. The app reverses that stream before decoding the page. Its content key is derived from material the request itself carried, so image-server never sends a key: read the `Authorization` bearer first and the media token in the URL only when there is no header, the order image-server resolves the two in
- A signed-out reader sends no header, so a free page's key comes from the media token on its own URL. The API issues that one for the episode and a 24-hour rotation window rather than for a reader, so every reader of the episode inside one window is handed the same token, and it stops decoding after at most two days. A signed-in reader's free page still decrypts with the bearer, the material image-server resolves first
- A response without `X-Publira-Image-Encryption` is decoded as it arrives, which is what keeps the reader working when a rolling deploy answers them from an image-server instance it has not replaced yet. A page whose stream cannot be reversed fails on its own and offers a retry, the same way a failed fetch does
- Pages are requested with an `Accept` that offers WebP and leaves AVIF out, because image-server's converter negotiates the rendition from that header and Flutter has no AVIF codec
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

A reader follows a series, and each author credited on it, from the series screen, and reads back what they follow from the account screen. A follow is what a new-episode notification is delivered by, and it is the same list the site writes: `FollowService` holds it, and nothing of it is written to the device.

- The series screen carries one control for the series and one for each author credited on it, beside the row that opens the author. The author screen carries the same control
- What a reader follows is theirs, and the API answers a request without a session `unauthenticated`, so a guest is offered the way to sign in rather than a control that cannot act
- A state the API could not answer leaves the control offering to follow, which is the request the API takes the same way whether or not the follow is already there. A follow the reader asked for that did not happen says why
- `/account/follows` lists what they follow, newest follow first, one cursor page at a time, the next asked for as the reader nears the end of the rows already there. `ListMyFollows` answers with public ids alone, so each row's name is a catalog read of its own — one that leaves the device alone, because a reader who follows a series has not opened it — and a row whose name could not be read is named by its public id. A row opens its series or its author; every row unfollows without asking the API what it already knows
- The API lists only targets that are still public, so a series taken down leaves the list rather than standing in it as a row nothing names

## Offline reading

Everything the reader opens is kept on the device, so the same screens open again without a network. An episode is on the device because it was read, or because the reader saved it from its row on the series screen, which fetches every page at once.

- The catalog list, the series screens behind it, and every episode body that loaded are saved as they load. A body page is saved once it has been turned into displayable bytes, which is also what the viewer draws
- The API decides. Every read goes to it first, and only its answer refreshes what the device holds; the saved copy is reached only when the API cannot be. A body that comes back locked, or that the API no longer has, is taken off the device along with its pages, and a series the API no longer publishes takes every episode saved under it
- A body that needed a purchase or a ticket is saved against the reader it was granted to, so it stays closed to a signed-out device and to a second reader on the same phone. It also stops opening once **7 days** have passed without the API confirming the grant, because the device cannot see a purchase lapse on its own. That window is measured against the device's own clock: a confirmation dated in the future is refused rather than trusted, but a reader who holds their clock back keeps reading, which is the same boundary the delivery stream draws — not DRM
- Saved episodes are marked on the series screen and on the offer that ends an episode, so a reader can tell before they lose their connection what they will still be able to open
- The page the reader stopped on is kept beside the episode, against the member it belongs to, so an episode read without a network opens where they left it. The API wins over it wherever it holds a position of its own, which is what carries a page saved on the website into the app
- The device keeps up to **512 MB** of pages. Over that, the least recently confirmed episodes are dropped whole, and page files no episode claims any more go with them
- The downloads screen, reached from the account screen, shows the bytes used against that cap and the saved episodes by series, with when each was saved and, for a body that needed an entitlement, until when it opens offline. It deletes one episode or everything. An episode saved for another account counts towards the bytes and goes with "Clear all", but is not listed

Everything is written under the app-private directory `path_provider` resolves (`getApplicationSupportDirectory()`), encrypted with a random 32-byte key this install mints on first use and keeps in the OS keychain / Keystore. The stream is the one `lib/api/image_cipher.dart` speaks, under its own domain separator and a per-file key. Like the delivery stream, it protects the files on the device rather than the reader's own access: whoever may open the episode necessarily holds the key that recovers it.

Every write carries a fresh random nonce in front of its ciphertext, and the nonce goes into the key derivation. Without it two versions of `index.json` would be encrypted under the same keystream, and whoever held both copies could XOR them together and read the difference — which, for a document of known JSON shape, means the saved episode ids and grants. The index is also written through a temporary file and a rename, so an interrupted write cannot leave a half-file the app can only answer by wiping itself.

The pages image-server delivers cannot be saved as they arrive: their content key is derived from the JWT the request carried, and that token is gone in a day. The app saves what it decoded, re-encrypted under the device key, under an address the media token is stripped from — so a free page saved under one rotation window still opens under the next, and neither the reader's bearer token nor the media token in a page's URL is written down.

Nothing here fails a screen. A platform with no app-private directory, or with no credential store to hold the key, reads online only; a file this build cannot decrypt is treated as one the device does not have.

## Purchases

A paid episode is bought through the public site's Stripe Checkout in the system browser, never in an in-app web view, and the app takes no store in-app purchase.

- A locked episode, in the viewer and on its row of the series screen, offers "Buy for ¥N" when `GetTenant` answers `accepts_payments`. A row offers it only where `GetSeriesEpisodeAccess` answers the episode locked for the reader, so an episode they bought, hold a ticket for, or can read inside a free window is offered nothing
- A guest who takes the offer signs in first and lands on the episode
- The button calls `StartEpisodeCheckout` with `client: CLIENT_MOBILE` and opens the page it answers with `url_launcher` in external application mode. A reader who already holds the episode is shown it instead
- Checkout returns to `/{locale}/checkout/return?episode=…&status=success|cancelled` on the tenant host, which the app claims as a link. The app finds the episode's series and opens the viewer, which reads `GetEpisodeDetail` again. A body still locked after a success is read twice more, each after a longer wait, and then the viewer says the purchase is being confirmed and offers to check again

## Sign-in

A reader signs in with an email address and a password, which `AuthService/Login` answers with a public-audience JWT (24-hour TTL, revoked by `credentials_version`). Every API and image-server request carries that token, so a purchased or ticketed paid episode reads on the device the same way it does in `web-host`.

- The session lives in the OS keychain / Keystore through `flutter_secure_storage`, never in `shared_preferences`, and is restored at launch
- The launch confirms a restored token with `AuthService/GetMe`. A rejected token is dropped and the reader is told, with the sign-in screen one tap away; an unreachable API leaves the session alone, so a launch without a network still opens signed in
- Nothing signs the reader back in on its own. Once the 24-hour token is gone, the reader signs in again
- Signing out drops the stored session, and a paid episode goes back to its locked state
- Creating an account and resetting a password stay on the website

`web-host` holds its own session in the `@publira/web-session` JWE cookie. The app has no cookie jar, which is why the token lives in the platform credential store instead.

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
| `PUBLIRA_API_BASE_URL` | `http://127.0.0.1:8000` | Public API Connect HTTP (`api-server` port 8000, not gRPC port 8100) |
| `PUBLIRA_IMAGE_BASE_URL` | `http://127.0.0.1:8200` | `image-server`, which returns episode-body images |
| `PUBLIRA_TENANT_HOST` | `localhost` | Host passed to `GetTenantByDomain`; development seeds use `localhost`. Sent to image-server as `X-Forwarded-Host`. Android App Links claim this host at build time |
| `PUBLIRA_LIVE_API` | Unset | Whether integration tests run their live group against the actual API |

A store build passes the same host as the iOS `PUBLIRA_ASSOCIATED_DOMAIN` build setting, so Universal Links claim the tenant the binary is pinned to. The Debug and Profile entitlements append `?mode=developer` so a locally hosted association file can be tried; Release does not.

The defaults are the shared default stack's ports. A worktree that has selected a development profile (`task dev-env:start`) does not listen on them: that profile holds a port block of its own, and `task mobile:run` reads the three values out of it.

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

# The worktree's selected development profile, on its own ports
task mobile:run -- -d android
```

It addresses that profile's `api-server` and `image-server` themselves rather than its edge, and reaches them at `10.0.2.2` from an Android emulator and through `adb reverse` from a device on a cable. A value already exported is left as it is, which is how a stack of another kind is named without editing anything. `MOBILE_DEVICE` names the device the addresses are resolved for when several are attached.

## Screenshots

A pull request that changes a screen carries a picture of it, and the picture is taken against the worktree's selected development profile so that the eye-catches on it are the seeded covers. The widget-test fixtures address `http://images.test/…`, a name reserved to resolve nowhere, so anything that renders those for a person draws `EyeCatchCover`'s placeholder in every row instead.

```bash
task dev-env:start
task mobile:screenshot
task mobile:screenshot -- /series/SeedSERSAAA1 /series/SeedSERSAAA1/episodes/SeedEPSDAAA1
```

Every route named on the command line becomes one PNG under `.run/screenshots/`; with no route named, the catalog the app opens on.

The screens are taken on an attached device or emulator, which the app is built and installed on. With none attached — the Dev Container image ships no Android SDK ([#2148](https://github.com/publira/publira/issues/2148)) — the same app is built for the web instead, served by `scripts/web_app_server.dart`, and photographed at the viewport and pixel ratio of a Pixel 7 by the browser `e2e/` already depends on; such a picture carries no status bar and no system navigation.

| Variable | Meaning |
| --- | --- |
| `MOBILE_DEVICE` | The device to build, install, and photograph on. The first attached one when unset |
| `MOBILE_SCREENSHOT_WAIT_MS` | How long a screen is given to finish arriving before the shutter. `8000` when unset |
| `MOBILE_SCREENSHOT_DEVICE` | The Playwright device the browser fallback emulates. `Pixel 7` when unset |

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
# Start stack + integration tests + teardown (requires an emulator or device)
task mobile:e2e

# When the API and device are already available
task mobile:test-integration
```

On failure, logcat and screenshots are left in `mobile/.run/artifacts/`. CI's `Test / Mobile E2E` starts the public API, image-server, and development seeds, then runs `PUBLIRA_LIVE_API=true task mobile:test-integration` on an Android emulator and uploads the `mobile-e2e-artifacts` artifact on failure. image-server is part of the stack because every seeded episode carries a body, so the live group's reader fetches pages as soon as it opens one.
