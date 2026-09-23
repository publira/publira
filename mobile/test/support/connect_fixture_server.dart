import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:publira/api/image_cipher.dart';
import 'package:publira/auth/reader_age.dart';

/// In-process Connect JSON server that speaks the public catalog/domain RPCs.
///
/// Used by widget-adjacent HTTP tests and by `integration_test` so both
/// exercise the same client against a repeatable fixture.
class ConnectFixtureServer {
  ConnectFixtureServer({
    this.tenantId = defaultTenantId,
    this.tenantHost = 'localhost',
    this.defaultLocale = defaultTenantLocale,
    this.series = const [],
    this.seriesPageSize = 0,
    this.seriesAvailability = const {},
    this.rankedSeries = const [],
    this.details = const {},
    this.episodes = const {},
    this.entitledEpisodes = const {},
    this.readingPositions = const {},
    this.recentSeries = const [],
    this.commentMode = 'COMMENT_MODE_IMMEDIATE',
    this.episodeComments = const {},
    this.myEpisodeComments = const {},
    this.myFollows = const [],
    this.followsPageSize = 0,
    this.myPurchases = const [],
    this.purchasesPageSize = 0,
    this.notifications = const [],
    this.notificationsPageSize = 0,
    this.announcements = const [],
    this.announcementsPageSize = 0,
    this.pinnedAnnouncementId,
    this.announcementStatus = HttpStatus.ok,
    this.listStatus = HttpStatus.ok,
    this.searchStatus = HttpStatus.ok,
    this.rankedStatus = HttpStatus.ok,
    this.detailStatus = HttpStatus.ok,
    this.episodeStatus = HttpStatus.ok,
    this.tenantStatus = HttpStatus.ok,
    this.pushDeviceStatus = HttpStatus.ok,
    this.commentStatus = HttpStatus.ok,
    this.followStatus = HttpStatus.ok,
    this.notificationStatus = HttpStatus.ok,
    this.contactStatus = HttpStatus.ok,
    this.contactErrorCode = 'unavailable',
    this.pageStatus = HttpStatus.ok,
    Map<String, ({String title, String contentMarkdown})>? publishedPages,
    this.signupStatus = HttpStatus.ok,
    this.signupErrorCode = 'unavailable',
    this.verificationRequestStatus = HttpStatus.ok,
    this.verificationRequestErrorCode = 'unavailable',
    this.passwordResetRequestStatus = HttpStatus.ok,
    this.passwordResetRequestErrorCode = 'unavailable',
    this.acceptsPayments = false,
    this.checkoutStatus = HttpStatus.ok,
    this.activeAccessToken = memberAccessToken,
    this.memberBirthDate = '',
    this.ageVerification = 'AGE_VERIFICATION_R18',
    this.tenantTimeZone = 'UTC',
    this.tenantName = seedTenantName,
    this.tenantTheme,
    this.encryptImages = true,
    this.listResponse,
    this.detailResponse,
    this.episodeResponse,
    this.tenantResponse,
  }) : publishedPages = publishedPages ?? {};

  static const defaultTenantId = '018f0e6a-1000-7000-8000-000000000001';

  /// What the development seed (`db/seeds/dev/001_tenant_users.sql`) stores
  /// as the tenant's default locale.
  static const defaultTenantLocale = 'en';

  /// What the development seed stores as the tenant's name.
  static const seedTenantName = 'Seed Tenant';
  static const seedSeriesId = 'SeedSERSAAA1';
  static const seedSeriesTitle = 'Seed Series 001';
  static const seedSeriesSynopsis = 'Seed series synopsis for Seed Series 001';

  /// The stored eye-catch image the seed series' cover URLs address.
  static const seedSeriesImageId = '018f0e6a-2000-7000-8000-000000000001';
  static const seedEpisodeId = 'SeedEPSDAAA1';
  static const seedEpisodeTitle = 'Seed Episode 001-01';
  static const seedEpisodePageCount = 3;
  static const paidEpisodeId = 'SeedEPSDAA1A';

  /// The one member `AuthService/Login` accepts here, mirroring the
  /// development seed (`db/seeds/dev/001_tenant_users.sql`), which also holds
  /// an access ticket for [paidEpisodeId].
  static const memberEmail = 'member@example.com';
  static const memberPassword = 'memberpass';
  static const memberName = 'Sample Member';
  static const memberPublicId = 'SeedMMBRAAA1';

  /// The member's purchases of [paidEpisodeId] in the development seed
  /// (`db/seeds/dev/080_purchases.sql`): one that does not expire, and a
  /// rental that has run out.
  static const memberReadablePurchaseId =
      '018f0e8f-1000-7000-8000-000000000001';
  static const memberExpiredPurchaseId = '018f0e8f-1000-7000-8000-000000000002';

  /// The unread announcement and notification the mobile E2E stack gives the
  /// member (`db/seeds/scenarios/310_mobile_reader_records.sql`).
  static const memberAnnouncementId = '018f1010-0001-7000-8000-000000000001';
  static const memberNotificationId = '018f1010-0001-7000-8000-000000000002';

  /// Unsigned JWT whose `sub` is [memberPublicId]. It is shaped like the real
  /// public-audience token because image-server derives a page's content key
  /// from the token itself, so a fixture that is not a JWT could not be
  /// decrypted by the reader.
  static const memberAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJTZWVkTU1CUkFBQTEifQ'
      '.fixture-signature';

  /// The account `CreateUser` opens here, and the session `Login` issues for
  /// it once its address has been confirmed. The seed member is the reader
  /// who was already registered; this one is the reader a test signs up.
  static const signedUpPublicId = 'SeedMMBRBBB2';
  static const signedUpAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJTZWVkTU1CUkJCQjIifQ'
      '.fixture-signature';

  /// The confirmation token `CreateUser` issues, standing in for the one the
  /// API would put in the mail it sends.
  static const verificationToken = 'fixture-verification-token';

  /// A token `VerifyUserEmail` answers as one whose time has run out, so a
  /// test can reach the state a reader finds an old link in.
  static const expiredVerificationToken = 'fixture-expired-verification-token';

  /// The token a password reset link for the member carries, standing in for
  /// the one the API would put in the mail `RequestPasswordReset` sends.
  static const passwordResetToken = 'fixture-password-reset-token';

  /// A reset token `ConfirmPasswordReset` answers as one whose time has run
  /// out.
  static const expiredPasswordResetToken = 'fixture-expired-reset-token';

  /// The token `ChangePassword` hands back, which is then the only one the
  /// member's requests are accepted with.
  static const changedPasswordAccessToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJTZWVkTU1CUkFBQTEiLCJ2IjoyfQ'
      '.fixture-signature';

  /// An address another account holds, which `RequestEmailChange` refuses to
  /// move the member to.
  static const takenEmail = 'taken@example.com';

  /// The tokens an email change's two links carry. `ConfirmEmailChange`
  /// answers the first as the link that completes the change, the second as
  /// one opened while the link to the current address is still waited on,
  /// and the third as one whose time has run out.
  static const emailChangeToken = 'fixture-email-change-token';
  static const pendingEmailChangeToken = 'fixture-pending-email-change-token';
  static const expiredEmailChangeToken = 'fixture-expired-email-change-token';

  /// A link opened after another account took the new address, which
  /// `ConfirmEmailChange` refuses as `already_exists`.
  static const conflictingEmailChangeToken =
      'fixture-conflicting-email-change-token';

  /// Unsigned JWT whose `sub` is the synthetic subject a free body's media
  /// token carries (`server/internal/auth`.`FreeEpisodeMediaSubject`). The API
  /// puts one of these on every free page's URL, and it is the whole of the
  /// material a signed-out reader decrypts with.
  static const freeEpisodeMediaToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJhbm9ueW1vdXMtZnJlZS1lcGlzb2RlIn0'
      '.fixture-signature';

  /// Another token for the same subject, standing in for the one image-server
  /// recomputes for the current rotation window. It is never handed out, so a
  /// page encrypted under it is a page the request cannot read.
  static const _currentWindowMediaToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
      '.eyJzdWIiOiJhbm9ueW1vdXMtZnJlZS1lcGlzb2RlIiwiaWF0IjoxfQ'
      '.fixture-signature';

  /// Subject both free-path tokens carry
  /// (`server/internal/auth`.`FreeEpisodeMediaSubject`).
  static const freeEpisodeMediaSubject = 'anonymous-free-episode';

  /// Key id the fixture reports for an encrypted page, standing in for
  /// image-server's per-rendition cache key.
  static const imageKeyId = 'fixture-image-key';

  /// 1x1 transparent PNG, enough for `Image.network` to decode a real page on
  /// a device.
  static final pageBytes = base64Decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAC'
    'hwGA60e6kgAAAABJRU5ErkJggg==',
  );

  /// Cover renditions of the seed series, in the shape
  /// `SeriesEyeCatchVariant` arrives in: a host-relative URL the app resolves
  /// against its image base.
  static List<Map<String, Object?>> seedEyeCatchVariants() {
    return [
      for (final width in [400, 800, 1200])
        {
          'label': 'portrait_${width}w',
          'variantType': 'portrait',
          'url': '/images/series/$seedSeriesImageId/portrait/$width',
          'contentType': 'image/webp',
          'width': width,
          'height': width * 4 ~/ 3,
        },
      for (final width in [800, 1600])
        {
          'label': 'landscape_${width}w',
          'variantType': 'landscape',
          'url': '/images/series/$seedSeriesImageId/landscape/$width',
          'contentType': 'image/webp',
          'width': width,
          'height': width * 9 ~/ 16,
        },
    ];
  }

  /// Credits of the seed series, in the shape `Creator` arrives in and in the
  /// tenant's role priority order.
  static List<Map<String, Object?>> seedCreators() {
    return [
      for (final (index, role) in [(1, 'Story'), (2, 'Art'), (3, 'Art')])
        {
          'publicId': 'SeedAUTHAAA$index',
          'name': 'Seed Author 00$index',
          'role': {'publicId': 'SeedROLEAAA$index', 'name': role},
          'profileText': 'Profile text for Seed Author 00$index',
        },
    ];
  }

  /// Classification of the seed series, in the shape `Series` arrives in.
  static List<Map<String, Object?>> seedGenres() {
    return [
      {'publicId': 'SeedGENRAAA1', 'name': 'Fantasy', 'slug': 'fantasy'},
    ];
  }

  static List<Map<String, Object?>> populatedSeries() {
    return [
      {
        'publicId': seedSeriesId,
        'title': seedSeriesTitle,
        'synopsis': seedSeriesSynopsis,
        'label': {'name': 'Seed Label 01', 'publicId': 'SeedLABLAAA1'},
        'creators': seedCreators(),
        'eyeCatchImageVariants': seedEyeCatchVariants(),
        'status': 'SERIES_STATUS_ONGOING',
        'scheduleWeekdays': [1, 4],
        'genres': seedGenres(),
      },
      {
        'publicId': 'series-kitchen',
        'title': 'The Little Kitchen',
        'synopsis': 'Everyday cooking, one plate at a time.',
      },
    ];
  }

  /// `GetEpisodeDetail` bodies: the seed episode is free and has pages, the
  /// paid one is locked and has none.
  static Map<String, Map<String, Object?>> populatedEpisodes() {
    return {
      seedEpisodeId: {
        'episode': {
          'publicId': seedEpisodeId,
          'title': seedEpisodeTitle,
          'orderIndex': 1,
          'price': 0,
          'creators': seedCreators(),
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_FREE',
        'images': [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            {
              'id': '$seedEpisodeId-page-$page',
              'imageUrl':
                  '/images/episodes/$seedEpisodeId-page-$page'
                  '?$mediaTokenQueryParam=$freeEpisodeMediaToken',
              'contentType': 'image/png',
              'displayOrder': page,
              'width': 800,
              'height': 1200,
            },
        ],
      },
      paidEpisodeId: {
        'episode': {
          'publicId': paidEpisodeId,
          'title': 'Seed Episode 001-10',
          'orderIndex': 10,
          'price': 500,
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_LOCKED',
      },
    };
  }

  /// `GetEpisodeDetail` bodies served instead of [populatedEpisodes] once the
  /// request carries [activeAccessToken]: the paid episode is entitled and has
  /// pages, the way an access ticket makes it read for a signed-in member.
  static Map<String, Map<String, Object?>> populatedEntitledEpisodes() {
    return {
      paidEpisodeId: {
        'episode': {
          'publicId': paidEpisodeId,
          'title': 'Seed Episode 001-10',
          'orderIndex': 10,
          'price': 500,
        },
        'series': {'publicId': seedSeriesId, 'title': seedSeriesTitle},
        'access': 'EPISODE_ACCESS_ENTITLED',
        'images': [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            {
              'id': '$paidEpisodeId-page-$page',
              'imageUrl': '/images/episodes/$paidEpisodeId-page-$page',
              'contentType': 'image/png',
              'displayOrder': page,
              'width': 800,
              'height': 1200,
            },
        ],
      },
    };
  }

  /// A week's chart over [populatedSeries]. The positions run 1 and 3 because
  /// they are a snapshot's own: a series ranked second and unpublished since
  /// leaves the gap behind.
  static List<Map<String, Object?>> populatedRankedSeries() {
    return [
      {
        'rank': 1,
        'series': {
          'publicId': seedSeriesId,
          'title': seedSeriesTitle,
          'synopsis': seedSeriesSynopsis,
          'creators': seedCreators(),
          'eyeCatchImageVariants': seedEyeCatchVariants(),
        },
      },
      {
        'rank': 3,
        'series': {
          'publicId': 'series-kitchen',
          'title': 'The Little Kitchen',
          'synopsis': 'Everyday cooking, one plate at a time.',
        },
      },
    ];
  }

  /// One `RecentSeries`: the seed series, offering the free episode the member
  /// was last reading.
  static List<Map<String, Object?>> populatedRecentSeries() {
    return [
      {
        'series': {
          'publicId': seedSeriesId,
          'title': seedSeriesTitle,
          'synopsis': seedSeriesSynopsis,
          'eyeCatchImageVariants': seedEyeCatchVariants(),
        },
        'episode': {
          'publicId': seedEpisodeId,
          'title': seedEpisodeTitle,
          'orderIndex': 1,
          'price': 0,
        },
        'lastActivityAt': '2026-09-01T00:00:00Z',
      },
    ];
  }

  static List<Map<String, Object?>> populatedEpisodeReads() {
    return [
      {
        'series': {
          'publicId': seedSeriesId,
          'title': seedSeriesTitle,
          'synopsis': seedSeriesSynopsis,
          'eyeCatchImageVariants': seedEyeCatchVariants(),
        },
        'episode': {
          'publicId': seedEpisodeId,
          'title': seedEpisodeTitle,
          'orderIndex': 1,
          'price': 0,
        },
        'readAt': '2026-09-01T00:00:00Z',
      },
    ];
  }

  static Map<String, Map<String, Object?>> populatedDetails() {
    return {
      seedSeriesId: {
        'series': {
          'publicId': seedSeriesId,
          'title': seedSeriesTitle,
          'synopsis': seedSeriesSynopsis,
          'creators': seedCreators(),
          'eyeCatchImageVariants': seedEyeCatchVariants(),
          'status': 'SERIES_STATUS_ONGOING',
          'scheduleWeekdays': [1, 4],
          'genres': seedGenres(),
        },
        'episodes': [
          {
            'publicId': seedEpisodeId,
            'title': seedEpisodeTitle,
            'orderIndex': 1,
            'price': 0,
          },
          {
            'publicId': 'SeedEPSDAA1A',
            'title': 'Seed Episode 001-10',
            'orderIndex': 10,
            'price': 500,
          },
        ],
      },
    };
  }

  final String tenantId;
  final String tenantHost;

  /// The `defaultLocale` `GetTenantByDomain` answers with, which is what the
  /// app renders in when the device asks for no supported language.
  final String defaultLocale;
  List<Map<String, Object?>> series;

  /// How many of [series] one `ListPublishedSeries` page holds. `0` answers
  /// the whole of it at once, which is what every read that is not about
  /// paging expects.
  ///
  /// The token stands in for the server's opaque cursor and is the index of
  /// the page's first row, written out.
  int seriesPageSize;

  /// Where each series may be shown, as the `SurfaceAvailability` name the
  /// console stored, keyed by public id. A series missing here is shown on
  /// both surfaces.
  ///
  /// Every catalog read answers only with what the surface its request names
  /// may show, and a request naming none is answered as the storefront, the
  /// way the API answers it.
  Map<String, String> seriesAvailability;

  /// `RankedSeries` entries `ListRankedSeries` answers with, whichever period
  /// is asked for. Empty acts out a tenant the ranking batch has not run for.
  List<Map<String, Object?>> rankedSeries;

  Map<String, Map<String, Object?>> details;

  /// `GetEpisodeDetail` bodies keyed by episode public id.
  Map<String, Map<String, Object?>> episodes;

  /// The bodies a request carrying [activeAccessToken] gets instead, keyed the
  /// same way. An episode missing here answers from [episodes].
  Map<String, Map<String, Object?>> entitledEpisodes;

  /// Zero-based reading positions of the signed-in member, keyed by episode
  /// public id. `SaveReadingPosition` writes here, so a test can read back
  /// what the viewer recorded.
  Map<String, int> readingPositions;

  /// When the signed-in member first finished each episode, keyed by episode
  /// public id. `MarkEpisodeAsRead` writes here and keeps the first instant.
  final Map<String, String> episodeReads = {};

  /// The Connect code `MarkEpisodeAsRead` fails with, or `null` to record the
  /// finish.
  String? markReadErrorCode;

  /// `RecentSeries` entries `ListMyRecentSeries` answers a signed-in member
  /// with, in the order they are given, at most the request's `limit` to a
  /// page with the token written the way [followsPageSize] writes one.
  List<Map<String, Object?>> recentSeries;

  /// `MyEpisodeRead` entries `ListMyEpisodeReads` answers a signed-in member
  /// with, in the order they are given, at most the request's `limit` to a
  /// page.
  List<Map<String, Object?>> episodeReadHistory = const [];

  /// The tenant's comment policy, as `GetTenant` answers it. Set it to
  /// `COMMENT_MODE_DISABLED` to act out a tenant that takes no comments.
  String commentMode;

  /// Published `EpisodeComment` rows keyed by episode public id, newest first.
  Map<String, List<Map<String, Object?>>> episodeComments;

  /// `MyEpisodeComment` rows the public list omits, keyed the same way.
  /// `PostEpisodeComment` adds to them, so a test can read back what the app
  /// sent and see it in the next list.
  Map<String, List<Map<String, Object?>>> myEpisodeComments;

  /// `MyFollow` rows of the signed-in member, newest follow first. `Follow`
  /// and `Unfollow` write here, so a test can read back what the app sent and
  /// see it in the next list.
  List<Map<String, Object?>> myFollows;

  /// `FollowUpdate` entries `ListMyFollowUpdates` answers a signed-in member
  /// with, in the order they are given, at most the request's `limit` to a
  /// page.
  List<Map<String, Object?>> followUpdates = const [];

  /// How many of [myFollows] one `ListMyFollows` page holds. `0` answers the
  /// whole of it at once, which is what every read that is not about paging
  /// expects.
  ///
  /// The token stands in for the server's opaque cursor and is the index of
  /// the page's first row, written out.
  int followsPageSize;

  /// `MyPurchase` rows of the signed-in member, newest purchase first.
  List<Map<String, Object?>> myPurchases;

  /// How many of [myPurchases] one `ListMyPurchases` page holds, with the
  /// token written the way [followsPageSize] writes one. `0` answers the whole
  /// of it at once.
  int purchasesPageSize;

  /// `NotificationItem` rows of the signed-in member, newest first. The read
  /// RPCs write `isRead` here, so the next list and count agree with what the
  /// app marked.
  List<Map<String, Object?>> notifications;

  /// How many of [notifications] one `ListNotifications` page holds, with the
  /// token written the way [followsPageSize] writes one. `0` answers the whole
  /// of it at once.
  int notificationsPageSize;

  /// `AnnouncementItem` rows of the tenant, newest first, carrying the
  /// signed-in member's read state. A caller with no session the fixture
  /// accepts is answered the rows without it, as the API answers a visitor.
  List<Map<String, Object?>> announcements;

  /// How many of [announcements] one `ListAnnouncements` page holds, with the
  /// token written the way [followsPageSize] writes one. `0` answers the whole
  /// of it at once.
  int announcementsPageSize;

  /// The id among [announcements] that `GetPinnedAnnouncement` answers, and
  /// `null` for a tenant with nothing pinned.
  String? pinnedAnnouncementId;

  /// What every announcement RPC answers with, so a test can act out an API
  /// that cannot be reached.
  int announcementStatus;
  int listStatus;
  int searchStatus;
  int rankedStatus;
  int detailStatus;
  int episodeStatus;
  int tenantStatus;

  /// What `RegisterPushDevice` and `UnregisterPushDevice` answer with, so a
  /// test can act out an API that turns the registration down.
  int pushDeviceStatus;

  /// What every `CommentService` RPC answers with, so a test can act out an
  /// API that will not take a comment.
  int commentStatus;

  /// What every `FollowService` RPC answers with, so a test can act out an API
  /// that cannot be reached.
  int followStatus;

  /// What the inbox RPCs of `NotificationService` answer with, so a test can
  /// act out an API that cannot be reached.
  int notificationStatus;

  /// What `SubmitContactMessage` answers with, and the Connect code of the
  /// error body when that is not 200, so a test can act out an API that
  /// refuses a message for any of its reasons.
  int contactStatus;
  String contactErrorCode;

  /// What every `PublicPagesService` RPC answers with, so a test can act out
  /// an API that cannot be reached.
  int pageStatus;

  /// The tenant's published pages, keyed by slug in storage form.
  Map<String, ({String title, String contentMarkdown})> publishedPages;

  /// What `CreateUser` answers with, and the Connect code of the error body
  /// when that is not 200, so a test can act out an API that refuses a
  /// sign-up for any of its reasons.
  int signupStatus;
  String signupErrorCode;

  /// The same pair for `RequestEmailVerification`, which is charged against
  /// the same mail allowance and refused on its own.
  int verificationRequestStatus;
  String verificationRequestErrorCode;

  /// The same pair for `RequestPasswordReset`, which is charged against the
  /// same mail allowance.
  int passwordResetRequestStatus;
  String passwordResetRequestErrorCode;

  /// The member's password as `Login` checks it, which `ConfirmPasswordReset`
  /// replaces for [passwordResetToken] and `ChangePassword` replaces too.
  String memberCurrentPassword = memberPassword;

  /// The member's name as `GetMe` reports it, which `UpdateMe` replaces.
  String memberCurrentName = memberName;

  /// The addresses `RequestEmailChange` has accepted a move to, in order.
  final requestedEmailChanges = <String>[];

  /// Set once `DeleteMe` has gone through, after which the member can
  /// neither sign in nor use the token they held.
  var memberDeleted = false;

  /// The accounts `CreateUser` has opened here, keyed by address: what
  /// `Login` then accepts, and whether the address has been confirmed.
  final signups = <String, FixtureSignup>{};

  /// The address and sign-up `Login` last issued [signedUpAccessToken] for,
  /// which `GetMe` answers that session with.
  ({String email, FixtureSignup signup})? _signedUpSession;

  /// The bearer `GetMe` accepts and `GetEpisodeDetail` unlocks for. Set it to
  /// another value to act out a token the API has stopped accepting.
  String? activeAccessToken;

  /// The date `GetMe` reports for the member, as `YYYY-MM-DD`. Empty is the
  /// account of a reader who has given none, which is what the API sends when
  /// the column is unset.
  String memberBirthDate;

  /// The tenant's age rule and display zone, as `GetTenant` answers them.
  String ageVerification;
  String tenantTimeZone;

  /// The pages `GetTenant` names as the tenant's terms of service and privacy
  /// policy, as `TenantLegalPage` JSON. `null` is a role named for no page,
  /// which the API omits.
  Map<String, Object?>? termsPage;
  Map<String, Object?>? privacyPage;

  /// The tenant's name and `TenantTheme`, as `GetTenant` answers them. A
  /// `null` theme is a tenant that has stored none, which the API omits.
  String tenantName;
  Map<String, Object?>? tenantTheme;

  /// Whether a page leaves as ciphertext. Set it to false to act out an
  /// image-server instance a rolling deploy has not replaced yet, which the
  /// reader still has to work against for the length of the rollout.
  bool encryptImages;

  /// What `GetTenant` answers for `accepts_payments`.
  bool acceptsPayments;

  /// The status `StartEpisodeCheckout` answers a checkout it would otherwise
  /// start with, so a test can fail one.
  int checkoutStatus;

  /// The Stripe page `StartEpisodeCheckout` answers for [episodePublicId].
  static Uri checkoutUrlFor(String episodePublicId) =>
      Uri.parse('https://checkout.stripe.test/c/pay/$episodePublicId');

  /// Replace the whole body of the matching RPC, whichever status the RPC is
  /// answering with, so a test can send a shape the client is not expecting or
  /// an error code other than the default `unavailable`.
  Object? listResponse;
  Object? detailResponse;
  Object? episodeResponse;

  /// Replaces the whole `GetTenantByDomain` body, so a test can answer with a
  /// shape the client is not expecting.
  Object? tenantResponse;

  /// Headers of the last `GET /images/...` request, so a test can assert what
  /// the reader sends to image-server.
  HttpHeaders? lastImageRequestHeaders;

  /// Every Connect request answered so far, in order. A test reads it to
  /// assert what the client sent, and how many times it sent it.
  final List<RecordedRequest> requests = <RecordedRequest>[];

  /// The recorded requests whose path ends in [procedure], such as
  /// `GetTenantByDomain`.
  Iterable<RecordedRequest> requestsTo(String procedure) =>
      requests.where((request) => request.path.endsWith('/$procedure'));

  HttpServer? _server;

  String get baseUrl {
    final server = _server;
    if (server == null) {
      throw StateError('ConnectFixtureServer.start has not been called');
    }
    return 'http://127.0.0.1:${server.port}';
  }

  Future<void> start() async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    unawaited(_server!.forEach(_handle));
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  Future<void> _handle(HttpRequest request) async {
    final path = request.uri.path;
    if (request.method == 'GET' && path.startsWith('/images/')) {
      lastImageRequestHeaders = request.headers;
      await _writeImage(request);
      return;
    }
    if (request.method != 'POST') {
      request.response.statusCode = HttpStatus.methodNotAllowed;
      await request.response.close();
      return;
    }
    // `publira server` answers the public API under `/api` alone.
    if (!path.startsWith('/api/')) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }

    final body = await _readBody(request);
    requests.add(
      RecordedRequest(
        path: path,
        headers: _snapshotHeaders(request.headers),
        body: body,
      ),
    );

    if (path.endsWith('/GetTenantByDomain')) {
      await _write(
        request,
        tenantStatus,
        tenantResponse ??
            {
              if (tenantStatus == HttpStatus.ok) 'tenantId': tenantId,
              if (tenantStatus == HttpStatus.ok) 'defaultLocale': defaultLocale,
              if (tenantStatus != HttpStatus.ok) 'code': 'not_found',
              if (tenantStatus != HttpStatus.ok) 'message': 'tenant not found',
            },
      );
      return;
    }

    if (path.endsWith('/ListPublishedSeries')) {
      await _write(
        request,
        listStatus,
        listResponse ??
            {
              if (listStatus == HttpStatus.ok)
                ..._seriesPage(_seriesShownTo(body), body['token']),
              if (listStatus != HttpStatus.ok) 'code': 'unavailable',
              if (listStatus != HttpStatus.ok) 'message': 'unavailable',
            },
      );
      return;
    }

    if (path.endsWith('/SearchPublishedSeries')) {
      await _write(request, searchStatus, {
        if (searchStatus == HttpStatus.ok)
          ..._searchPage(_seriesShownTo(body), body['query'], body['token']),
        if (searchStatus != HttpStatus.ok) 'code': 'unavailable',
        if (searchStatus != HttpStatus.ok) 'message': 'unavailable',
      });
      return;
    }

    if (path.endsWith('/ListRankedSeries')) {
      final ranked = [
        for (final entry in rankedSeries)
          if (_shows(body, (entry['series'] as Map?)?['publicId'])) entry,
      ];
      await _write(request, rankedStatus, {
        // protojson omits an empty repeated field, which is how a tenant the
        // ranking batch has not run for is answered.
        if (rankedStatus == HttpStatus.ok && ranked.isNotEmpty)
          'rankedSeries': ranked,
        if (rankedStatus != HttpStatus.ok) 'code': 'unavailable',
        if (rankedStatus != HttpStatus.ok) 'message': 'unavailable',
      });
      return;
    }

    if (path.endsWith('/Login')) {
      await _writeLogin(request, body);
      return;
    }

    if (path.endsWith('/CreateUser')) {
      await _writeCreateUser(request, body);
      return;
    }

    if (path.endsWith('/VerifyUserEmail')) {
      await _writeVerifyUserEmail(request, body);
      return;
    }

    if (path.endsWith('/RequestEmailVerification')) {
      // Every address is answered the same way, the way the API answers one,
      // so nothing here reports whether an account exists.
      await _write(
        request,
        verificationRequestStatus,
        verificationRequestStatus == HttpStatus.ok
            ? const {'requested': true}
            : {
                'code': verificationRequestErrorCode,
                'message': verificationRequestErrorCode,
              },
      );
      return;
    }

    if (path.endsWith('/RequestPasswordReset')) {
      // Every address is answered the same way, the way the API answers one.
      await _write(
        request,
        passwordResetRequestStatus,
        passwordResetRequestStatus == HttpStatus.ok
            ? const {'requested': true}
            : {
                'code': passwordResetRequestErrorCode,
                'message': passwordResetRequestErrorCode,
              },
      );
      return;
    }

    if (path.endsWith('/ConfirmPasswordReset')) {
      await _writeConfirmPasswordReset(request, body);
      return;
    }

    final signedUp = _signedUpSession;
    if (path.endsWith('/GetMe') &&
        signedUp != null &&
        request.headers.value(HttpHeaders.authorizationHeader) ==
            'Bearer $signedUpAccessToken') {
      final birthDate = signedUp.signup.birthDate;
      await _write(request, HttpStatus.ok, {
        'user': {
          'publicId': signedUpPublicId,
          'name': signedUp.signup.name,
          'role': 'member',
          if (birthDate.isNotEmpty) 'birthDate': birthDate,
          'email': signedUp.email,
        },
      });
      return;
    }
    if (path.endsWith('/GetMe')) {
      if (!_isAuthorized(request)) {
        await _write(request, HttpStatus.unauthorized, {
          'code': 'unauthenticated',
          'message': 'invalid token',
        });
        return;
      }
      await _write(request, HttpStatus.ok, {
        'user': {
          'publicId': memberPublicId,
          'name': memberCurrentName,
          'role': 'member',
          // protojson omits an empty string, the way the API does for a
          // reader who has recorded no date.
          if (memberBirthDate.isNotEmpty) 'birthDate': memberBirthDate,
          'email': memberEmail,
        },
      });
      return;
    }

    if (path.endsWith('/GetPublishedPage')) {
      final slug = _trimmed(body['slug']);
      final page = publishedPages[slug];
      if (pageStatus != HttpStatus.ok) {
        await _write(request, pageStatus, {
          'code': 'unavailable',
          'message': 'unavailable',
        });
      } else if (page == null) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'page not found',
        });
      } else {
        await _write(request, HttpStatus.ok, {
          'page': {'slug': slug, 'title': page.title},
          // protojson omits an empty body.
          'version': {
            if (page.contentMarkdown.isNotEmpty)
              'contentMarkdown': page.contentMarkdown,
          },
        });
      }
      return;
    }

    if (path.endsWith('/ListPublishedPageSlugs')) {
      await _write(
        request,
        pageStatus,
        pageStatus == HttpStatus.ok
            ? {'slugs': publishedPages.keys.toList()}
            : {'code': 'unavailable', 'message': 'unavailable'},
      );
      return;
    }

    if (path.endsWith('/SubmitContactMessage')) {
      // A session is optional, and the response deliberately empty.
      await _write(
        request,
        contactStatus,
        contactStatus == HttpStatus.ok
            ? const <String, Object?>{}
            : {'code': contactErrorCode, 'message': contactErrorCode},
      );
      return;
    }

    if (path.endsWith('/UpdateMe')) {
      await _writeUpdateMe(request, body);
      return;
    }

    if (path.endsWith('/ChangePassword')) {
      await _writeChangePassword(request, body);
      return;
    }

    if (path.endsWith('/RequestEmailChange')) {
      await _writeRequestEmailChange(request, body);
      return;
    }

    if (path.endsWith('/ConfirmEmailChange')) {
      await _writeConfirmEmailChange(request, body);
      return;
    }

    if (path.endsWith('/DeleteMe')) {
      await _writeDeleteMe(request, body);
      return;
    }

    if (path.endsWith('/GetSeriesDetail')) {
      if (detailStatus != HttpStatus.ok) {
        await _write(
          request,
          detailStatus,
          detailResponse ??
              const {'code': 'unavailable', 'message': 'unavailable'},
        );
        return;
      }
      final publicId = _publicIdOf(body);
      final detail = _shows(body, publicId) ? details[publicId] : null;
      if (detail == null) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'series not found',
        });
        return;
      }
      await _write(request, HttpStatus.ok, detailResponse ?? detail);
      return;
    }

    if (path.endsWith('/GetEpisodeDetail')) {
      if (episodeStatus != HttpStatus.ok) {
        await _write(
          request,
          episodeStatus,
          episodeResponse ??
              const {'code': 'unavailable', 'message': 'unavailable'},
        );
        return;
      }
      final publicId = _publicIdOf(body);
      final episode = _isAuthorized(request)
          ? entitledEpisodes[publicId] ?? episodes[publicId]
          : episodes[publicId];
      if (episode == null ||
          !_shows(body, (episode['series'] as Map?)?['publicId'])) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'episode not found',
        });
        return;
      }
      await _write(request, HttpStatus.ok, episodeResponse ?? episode);
      return;
    }

    // Every read of the member's own history needs their session, the way the
    // API refuses one without it.
    if (path.endsWith('/GetMyReadingPosition') ||
        path.endsWith('/SaveReadingPosition') ||
        path.endsWith('/MarkEpisodeAsRead') ||
        path.endsWith('/ListMyEpisodeReads') ||
        path.endsWith('/ListMyRecentSeries')) {
      if (!_isAuthorized(request)) {
        await _write(request, HttpStatus.unauthorized, {
          'code': 'unauthenticated',
          'message': 'invalid token',
        });
        return;
      }
      await _writeEpisodeRead(request, path, body);
      return;
    }

    if (path.endsWith('/GetTenant')) {
      await _write(request, tenantStatus, {
        if (tenantStatus == HttpStatus.ok) 'tenantPublicId': tenantId,
        if (tenantStatus == HttpStatus.ok) 'tenantName': tenantName,
        if (tenantStatus == HttpStatus.ok && tenantTheme != null)
          'theme': tenantTheme,
        if (tenantStatus == HttpStatus.ok) 'defaultLocale': defaultLocale,
        if (tenantStatus == HttpStatus.ok) 'commentMode': commentMode,
        if (tenantStatus == HttpStatus.ok) 'ageVerification': ageVerification,
        if (tenantStatus == HttpStatus.ok) 'timezone': tenantTimeZone,
        if (tenantStatus == HttpStatus.ok && termsPage != null)
          'termsPage': termsPage,
        if (tenantStatus == HttpStatus.ok && privacyPage != null)
          'privacyPage': privacyPage,
        // protojson omits a false.
        if (tenantStatus == HttpStatus.ok && acceptsPayments)
          'acceptsPayments': true,
        if (tenantStatus != HttpStatus.ok) 'code': 'unavailable',
        if (tenantStatus != HttpStatus.ok) 'message': 'unavailable',
      });
      return;
    }

    if (path.endsWith('/GetSeriesEpisodeAccess')) {
      await _writeSeriesEpisodeAccess(request, body);
      return;
    }

    if (path.endsWith('/StartEpisodeCheckout')) {
      await _writeCheckout(request, body);
      return;
    }

    if (path.endsWith('/ListMyPurchases')) {
      if (!_isAuthorized(request)) {
        await _write(request, HttpStatus.unauthorized, {
          'code': 'unauthenticated',
          'message': 'invalid token',
        });
        return;
      }
      await _write(request, HttpStatus.ok, _purchasesPage(body['token']));
      return;
    }

    if (path.contains('/publira.v1.CommentService/')) {
      await _writeComment(request, path, body);
      return;
    }

    if (path.contains('/publira.v1.FollowService/')) {
      await _writeFollow(request, path, body);
      return;
    }

    if (path.endsWith('/SearchPublishedCreators') ||
        path.endsWith('/SearchPublishedLabels')) {
      final creators = path.endsWith('/SearchPublishedCreators');
      await _write(request, searchStatus, {
        if (searchStatus == HttpStatus.ok)
          ..._namedPage(
            creators ? 'creators' : 'labels',
            creators
                ? _publishedCreators(
                    _seriesShownTo(body),
                  ).where(_hasPublishedSeries)
                : _publishedLabels(_seriesShownTo(body)),
            body['query'],
            body['token'],
          ),
        if (searchStatus != HttpStatus.ok) 'code': 'unavailable',
        if (searchStatus != HttpStatus.ok) 'message': 'unavailable',
      });
      return;
    }

    if (path.endsWith('/GetPublishedCreatorDetail') ||
        path.endsWith('/GetPublishedLabelDetail')) {
      final creators = path.endsWith('/GetPublishedCreatorDetail');
      final publicId = _publicIdOf(body);
      final shown = _seriesShownTo(body);
      // A label is found among every series, shown or not, because the API
      // answers one with none of its series on this surface as well.
      final target =
          (creators ? _publishedCreators(shown) : _publishedLabels(series))
              .where((item) => item['publicId'] == publicId)
              .firstOrNull;
      if (target == null) {
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': creators ? 'creator not found' : 'label not found',
        });
        return;
      }
      final credited = shown.where((item) {
        if (!creators) {
          return (item['label'] as Map?)?['publicId'] == publicId;
        }
        final credits = item['creators'] as List? ?? const [];
        return credits.any((credit) => (credit as Map)['publicId'] == publicId);
      }).toList();
      await _write(request, HttpStatus.ok, {
        if (creators)
          'creator': target
        else
          'label': {...target, 'publishedSeriesCount': credited.length},
        ..._pageOf('series', credited, body['token']),
      });
      return;
    }

    if (path.endsWith('/ListNotifications') ||
        path.endsWith('/CountUnreadNotifications') ||
        path.endsWith('/MarkNotificationAsRead') ||
        path.endsWith('/MarkAllNotificationsAsRead')) {
      await _writeNotification(request, path, body);
      return;
    }

    if (path.endsWith('/ListAnnouncements') ||
        path.endsWith('/GetAnnouncement') ||
        path.endsWith('/GetPinnedAnnouncement') ||
        path.endsWith('/MarkAnnouncementAsRead') ||
        path.endsWith('/MarkAllAnnouncementsAsRead')) {
      await _writeAnnouncement(request, path, body);
      return;
    }

    if (path.endsWith('/RegisterPushDevice') ||
        path.endsWith('/UnregisterPushDevice')) {
      final registering = path.endsWith('/RegisterPushDevice');
      await _write(request, pushDeviceStatus, {
        if (pushDeviceStatus == HttpStatus.ok && registering)
          'registered': true,
        if (pushDeviceStatus == HttpStatus.ok && !registering)
          'unregistered': true,
        if (pushDeviceStatus != HttpStatus.ok) 'code': 'unavailable',
        if (pushDeviceStatus != HttpStatus.ok) 'message': 'unavailable',
      });
      return;
    }

    // Both rating RPCs answer with the reader's score, which is all a test
    // reads back from them.
    if (path.endsWith('/GetMyEpisodeRating') || path.endsWith('/RateEpisode')) {
      await _write(request, HttpStatus.ok, const {
        'score': 1,
        'ratingCount': '1',
      });
      return;
    }

    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }

  /// The access `GetEpisodeDetail` would answer for each episode the series
  /// detail lists, for whoever the request is.
  Future<void> _writeSeriesEpisodeAccess(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    final seriesPublicId = body['seriesPublicId'];
    final detail = _shows(body, seriesPublicId)
        ? details[seriesPublicId]
        : null;
    if (detail == null) {
      await _write(request, HttpStatus.notFound, {
        'code': 'not_found',
        'message': 'series not found',
      });
      return;
    }
    final authorized = _isAuthorized(request);
    final listed = detail['episodes'];
    await _write(request, HttpStatus.ok, {
      'episodes': [
        if (listed is List)
          for (final episode in listed.whereType<Map<Object?, Object?>>())
            if (episode['publicId'] case final String id)
              {
                'episodePublicId': id,
                'access':
                    (authorized ? entitledEpisodes[id] : null)?['access'] ??
                    episodes[id]?['access'] ??
                    'EPISODE_ACCESS_FREE',
              },
      ],
    });
  }

  /// A checkout for the signed-in member, refused the way the API refuses
  /// one for an episode they already hold.
  Future<void> _writeCheckout(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (!_isAuthorized(request)) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    final episodeId = body['episodePublicId'];
    if (episodeId is! String || episodes[episodeId] == null) {
      await _write(request, HttpStatus.notFound, {
        'code': 'not_found',
        'message': 'episode not found',
      });
      return;
    }
    if (entitledEpisodes[episodeId]?['access'] == 'EPISODE_ACCESS_ENTITLED') {
      await _write(request, HttpStatus.conflict, {
        'code': 'already_exists',
        'message': 'episode is already purchased',
      });
      return;
    }
    if (checkoutStatus != HttpStatus.ok) {
      await _write(request, checkoutStatus, {
        'code': 'unavailable',
        'message': 'failed to start checkout',
      });
      return;
    }
    await _write(request, HttpStatus.ok, {
      'checkoutUrl': checkoutUrlFor(episodeId).toString(),
    });
  }

  /// Whether the surface [body] names may show the series [seriesPublicId].
  bool _shows(Map<String, Object?> body, Object? seriesPublicId) {
    final app = body['surface'] == 'CLIENT_SURFACE_APP';
    return switch (seriesAvailability[seriesPublicId]) {
      'SURFACE_AVAILABILITY_WEB' => !app,
      'SURFACE_AVAILABILITY_APP' => app,
      _ => true,
    };
  }

  /// The [series] the surface [body] names may show.
  List<Map<String, Object?>> _seriesShownTo(Map<String, Object?> body) => [
    for (final item in series)
      if (_shows(body, item['publicId'])) item,
  ];

  /// The page of [series] the request's token asks for, with the token of the
  /// page under it when there is one.
  ///
  /// protojson omits an empty string, so the last page carries no `nextToken`.
  Map<String, Object?> _seriesPage(
    List<Map<String, Object?>> series,
    Object? token,
  ) {
    if (seriesPageSize <= 0) {
      return {'series': series};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + seriesPageSize, series.length);
    return {
      'series': series.sublist(min(start, series.length), end),
      if (end < series.length) 'nextToken': '$end',
    };
  }

  /// The creators credited on [series], once each, in the shape
  /// `PublishedCreator` arrives in, followed by the rest of [seedCreators],
  /// which a follow row can still name with nothing published.
  List<Map<String, Object?>> _publishedCreators(
    List<Map<String, Object?>> series,
  ) {
    final creators = <String, Map<String, Object?>>{};
    final counted = <String>{};
    for (final item in series) {
      for (final credit in item['creators'] as List? ?? const []) {
        final json = credit as Map;
        final publicId = json['publicId'] as String;
        final creator = creators.putIfAbsent(
          publicId,
          () => {
            'publicId': publicId,
            'name': json['name'],
            if (json['profileText'] != null) 'profileText': json['profileText'],
            if (json['iconImageUrl'] != null)
              'iconImageUrl': json['iconImageUrl'],
            'publishedSeriesCount': 0,
          },
        );
        // Credited in two roles on one series is still one series.
        if (counted.add('$publicId/${item['publicId']}')) {
          creator['publishedSeriesCount'] =
              (creator['publishedSeriesCount']! as int) + 1;
        }
      }
    }
    for (final credit in seedCreators()) {
      creators.putIfAbsent(credit['publicId']! as String, () {
        return {
          'publicId': credit['publicId'],
          'name': credit['name'],
          'profileText': credit['profileText'],
        };
      });
    }
    return creators.values.toList();
  }

  /// The labels of [series], once each, in the shape `PublishedLabel` arrives
  /// in. A label is known here only through a series that carries it, so
  /// every one of them holds a published series.
  List<Map<String, Object?>> _publishedLabels(
    List<Map<String, Object?>> series,
  ) {
    final labels = <String, Map<String, Object?>>{};
    for (final item in series) {
      final json = item['label'] as Map?;
      if (json == null) {
        continue;
      }
      final label = labels.putIfAbsent(
        json['publicId'] as String,
        () => {...json.cast<String, Object?>(), 'publishedSeriesCount': 0},
      );
      label['publishedSeriesCount'] =
          (label['publishedSeriesCount']! as int) + 1;
    }
    return labels.values.toList();
  }

  bool _hasPublishedSeries(Map<String, Object?> item) =>
      ((item['publishedSeriesCount'] as int?) ?? 0) > 0;

  /// One page of the [items] whose name contains [query], the
  /// case-insensitive substring match the creator and label searches perform,
  /// in the name order they answer in, under [field].
  Map<String, Object?> _namedPage(
    String field,
    Iterable<Map<String, Object?>> items,
    Object? query,
    Object? token,
  ) {
    final keyword = query is String ? query.trim().toLowerCase() : '';
    final matches =
        items.where((item) {
          return '${item['name'] ?? ''}'.toLowerCase().contains(keyword);
        }).toList()..sort(
          (left, right) =>
              '${left['name'] ?? ''}'.compareTo('${right['name'] ?? ''}'),
        );
    return _pageOf(field, matches, token);
  }

  /// One page of [items] under [field], [seriesPageSize] at a time, with the
  /// token the index of the page's first row written out.
  Map<String, Object?> _pageOf(
    String field,
    List<Map<String, Object?>> items,
    Object? token,
  ) {
    if (seriesPageSize <= 0) {
      return {if (items.isNotEmpty) field: items};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + seriesPageSize, items.length);
    final page = items.sublist(min(start, items.length), end);
    return {
      if (page.isNotEmpty) field: page,
      if (end < items.length) 'nextToken': '$end',
    };
  }

  /// One page of the series whose title or synopsis contains [query], the
  /// case-insensitive substring match `SearchPublishedSeries` performs, in the
  /// title order it answers them in.
  Map<String, Object?> _searchPage(
    List<Map<String, Object?>> series,
    Object? query,
    Object? token,
  ) {
    final keyword = query is String ? query.trim().toLowerCase() : '';
    final matches =
        series.where((item) {
          final title = '${item['title'] ?? ''}'.toLowerCase();
          final synopsis = '${item['synopsis'] ?? ''}'.toLowerCase();
          return title.contains(keyword) || synopsis.contains(keyword);
        }).toList()..sort(
          (left, right) =>
              '${left['title'] ?? ''}'.compareTo('${right['title'] ?? ''}'),
        );
    if (seriesPageSize <= 0) {
      return {'series': matches};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + seriesPageSize, matches.length);
    return {
      'series': matches.sublist(min(start, matches.length), end),
      if (end < matches.length) 'nextToken': '$end',
    };
  }

  /// Answers the reader-facing comment RPCs of one episode.
  ///
  /// Everything but the public list needs the member's session, the way the
  /// API refuses one without it.
  Future<void> _writeComment(
    HttpRequest request,
    String path,
    Map<String, Object?> body,
  ) async {
    if (commentStatus != HttpStatus.ok) {
      await _write(request, commentStatus, const {
        'code': 'unavailable',
        'message': 'unavailable',
      });
      return;
    }
    final episodeId = body['episodePublicId'] as String? ?? '';
    if (path.endsWith('/ListEpisodeComments')) {
      await _write(request, HttpStatus.ok, {
        // protojson omits an empty repeated field, which is what an episode
        // nobody has commented on is answered with.
        'comments': ?episodeComments[episodeId],
      });
      return;
    }

    if (!_isAuthorized(request)) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    if (path.endsWith('/ListMyEpisodeComments')) {
      await _write(request, HttpStatus.ok, {
        'comments': ?myEpisodeComments[episodeId],
      });
      return;
    }
    if (path.endsWith('/PostEpisodeComment')) {
      final comment = {
        'publicId':
            'SeedCMNT${(myEpisodeComments[episodeId]?.length ?? 0) + 1}',
        'body': body['body'],
        'createdAt': DateTime.now().toUtc().toIso8601String(),
        if (commentMode == 'COMMENT_MODE_APPROVAL_REQUIRED')
          'awaitingApproval': true,
      };
      myEpisodeComments = {
        ...myEpisodeComments,
        episodeId: [comment, ...?myEpisodeComments[episodeId]],
      };
      await _write(request, HttpStatus.ok, {'comment': comment});
      return;
    }
    // Withdrawing and reporting are both deliberately empty answers.
    await _write(request, HttpStatus.ok, const {});
  }

  /// Answers the follow RPCs of one member, every one of which needs their
  /// session the way the API refuses one without it.
  Future<void> _writeFollow(
    HttpRequest request,
    String path,
    Map<String, Object?> body,
  ) async {
    if (followStatus != HttpStatus.ok) {
      await _write(request, followStatus, const {
        'code': 'unavailable',
        'message': 'unavailable',
      });
      return;
    }
    if (!_isAuthorized(request)) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    if (path.endsWith('/ListMyFollowUpdates')) {
      await _write(request, HttpStatus.ok, _followUpdatesPage(body));
      return;
    }
    if (path.endsWith('/ListMyFollows')) {
      await _write(request, HttpStatus.ok, _followsPage(body['token']));
      return;
    }

    final target = body['target'];
    final targetType = target is Map ? target['type'] : null;
    final targetPublicId = target is Map ? target['publicId'] : null;
    final followed = myFollows.where((follow) {
      return follow['targetType'] == targetType &&
          follow['targetPublicId'] == targetPublicId;
    });
    if (path.endsWith('/Follow')) {
      if (followed.isEmpty) {
        myFollows = [
          {
            'targetType': targetType,
            'targetPublicId': targetPublicId,
            'followedAt': DateTime.now().toUtc().toIso8601String(),
          },
          ...myFollows,
        ];
      }
      await _write(request, HttpStatus.ok, const {'isFollowing': true});
      return;
    }
    if (path.endsWith('/Unfollow')) {
      myFollows = myFollows.where((follow) {
        return follow['targetType'] != targetType ||
            follow['targetPublicId'] != targetPublicId;
      }).toList();
      // protojson omits a false, which is what every Unfollow answers with.
      await _write(request, HttpStatus.ok, const {});
      return;
    }
    await _write(request, HttpStatus.ok, {
      if (followed.isNotEmpty) 'isFollowing': true,
    });
  }

  /// The page of [followUpdates] the request's limit and token ask for.
  Map<String, Object?> _followUpdatesPage(Map<String, Object?> body) {
    final limit = body['limit'] as int? ?? 0;
    final token = body['token'] as String? ?? '';
    final start = min(
      token.isEmpty ? 0 : int.parse(token),
      followUpdates.length,
    );
    final end = limit <= 0
        ? followUpdates.length
        : min(start + limit, followUpdates.length);
    return {
      // protojson omits an empty repeated field.
      if (end > start) 'updates': followUpdates.sublist(start, end),
      if (end < followUpdates.length) 'nextToken': '$end',
    };
  }

  /// The page of [myFollows] the request's token asks for, with the token of
  /// the page under it when there is one.
  Map<String, Object?> _followsPage(Object? token) {
    if (followsPageSize <= 0) {
      // protojson omits an empty repeated field, which is how a reader who
      // follows nothing is answered.
      return {if (myFollows.isNotEmpty) 'follows': myFollows};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + followsPageSize, myFollows.length);
    final page = myFollows.sublist(min(start, myFollows.length), end);
    return {
      if (page.isNotEmpty) 'follows': page,
      if (end < myFollows.length) 'nextToken': '$end',
    };
  }

  /// The page of [myPurchases] the request's token asks for, with the token of
  /// the page under it when there is one.
  Map<String, Object?> _purchasesPage(Object? token) {
    if (purchasesPageSize <= 0) {
      return {if (myPurchases.isNotEmpty) 'purchases': myPurchases};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + purchasesPageSize, myPurchases.length);
    final page = myPurchases.sublist(min(start, myPurchases.length), end);
    return {
      if (page.isNotEmpty) 'purchases': page,
      if (end < myPurchases.length) 'nextToken': '$end',
    };
  }

  /// Answers the inbox RPCs of one member, every one of which needs their
  /// session the way the API refuses one without it.
  Future<void> _writeNotification(
    HttpRequest request,
    String path,
    Map<String, Object?> body,
  ) async {
    if (notificationStatus != HttpStatus.ok) {
      await _write(request, notificationStatus, const {
        'code': 'unavailable',
        'message': 'unavailable',
      });
      return;
    }
    if (!_isAuthorized(request)) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    if (path.endsWith('/ListNotifications')) {
      await _write(request, HttpStatus.ok, _notificationsPage(body['token']));
      return;
    }
    final unread = notifications.where((item) => item['isRead'] != true);
    if (path.endsWith('/CountUnreadNotifications')) {
      // protojson omits a zero.
      await _write(request, HttpStatus.ok, {
        if (unread.isNotEmpty) 'unreadCount': unread.length,
      });
      return;
    }
    Map<String, Object?> read(Map<String, Object?> item) => {
      ...item,
      'isRead': true,
      'readAt': DateTime.now().toUtc().toIso8601String(),
    };
    if (path.endsWith('/MarkAllNotificationsAsRead')) {
      final marked = unread.length;
      notifications = [
        for (final item in notifications)
          item['isRead'] == true ? item : read(item),
      ];
      await _write(request, HttpStatus.ok, {
        if (marked > 0) 'markedCount': marked,
      });
      return;
    }
    final id = body['notificationId'];
    if (!notifications.any((item) => item['id'] == id)) {
      await _write(request, HttpStatus.notFound, {
        'code': 'not_found',
        'message': 'notification not found',
      });
      return;
    }
    notifications = [
      for (final item in notifications)
        item['id'] == id && item['isRead'] != true ? read(item) : item,
    ];
    await _write(request, HttpStatus.ok, const {'marked': true});
  }

  /// The page of [notifications] the request's token asks for, with the token
  /// of the page under it when there is one.
  Map<String, Object?> _notificationsPage(Object? token) {
    if (notificationsPageSize <= 0) {
      return {if (notifications.isNotEmpty) 'notifications': notifications};
    }
    final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
    final end = min(start + notificationsPageSize, notifications.length);
    final page = notifications.sublist(min(start, notifications.length), end);
    return {
      if (page.isNotEmpty) 'notifications': page,
      if (end < notifications.length) 'nextToken': '$end',
    };
  }

  /// Answers the announcement RPCs. The reads take any caller and answer read
  /// state only to the member's session; the marks need that session.
  Future<void> _writeAnnouncement(
    HttpRequest request,
    String path,
    Map<String, Object?> body,
  ) async {
    if (announcementStatus != HttpStatus.ok) {
      await _write(request, announcementStatus, const {
        'code': 'unavailable',
        'message': 'unavailable',
      });
      return;
    }
    final member = _isAuthorized(request);
    // A token the API rejects is answered as a visitor, the way the API does.
    Map<String, Object?> shown(Map<String, Object?> item) => member
        ? item
        : {
            for (final entry in item.entries)
              if (entry.key != 'isRead' && entry.key != 'readAt')
                entry.key: entry.value,
          };
    if (path.endsWith('/ListAnnouncements')) {
      final all = [for (final item in announcements) shown(item)];
      if (announcementsPageSize <= 0) {
        await _write(request, HttpStatus.ok, {
          if (all.isNotEmpty) 'announcements': all,
        });
        return;
      }
      final token = body['token'];
      final start = token is String && token.isNotEmpty ? int.parse(token) : 0;
      final end = min(start + announcementsPageSize, all.length);
      final page = all.sublist(min(start, all.length), end);
      await _write(request, HttpStatus.ok, {
        if (page.isNotEmpty) 'announcements': page,
        if (end < all.length) 'nextToken': '$end',
      });
      return;
    }
    if (path.endsWith('/GetPinnedAnnouncement')) {
      final pinned = announcements.where(
        (item) => item['id'] == pinnedAnnouncementId,
      );
      await _write(request, HttpStatus.ok, {
        if (pinned.isNotEmpty) 'announcement': shown(pinned.first),
      });
      return;
    }
    final notFound = {'code': 'not_found', 'message': 'announcement not found'};
    if (path.endsWith('/GetAnnouncement')) {
      final found = announcements.where(
        (item) => item['id'] == body['announcementId'],
      );
      if (found.isEmpty) {
        await _write(request, HttpStatus.notFound, notFound);
        return;
      }
      await _write(request, HttpStatus.ok, {
        'announcement': shown(found.first),
      });
      return;
    }
    if (!member) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    Map<String, Object?> read(Map<String, Object?> item) =>
        item['isRead'] == true
        ? item
        : {
            ...item,
            'isRead': true,
            'readAt': DateTime.now().toUtc().toIso8601String(),
          };
    if (path.endsWith('/MarkAllAnnouncementsAsRead')) {
      final marked = announcements.where((item) => item['isRead'] != true);
      final count = marked.length;
      announcements = [for (final item in announcements) read(item)];
      await _write(request, HttpStatus.ok, {
        if (count > 0) 'markedCount': count,
      });
      return;
    }
    final id = body['announcementId'];
    if (!announcements.any((item) => item['id'] == id)) {
      await _write(request, HttpStatus.notFound, notFound);
      return;
    }
    announcements = [
      for (final item in announcements) item['id'] == id ? read(item) : item,
    ];
    await _write(request, HttpStatus.ok, const {'marked': true});
  }

  /// Answers the reading-position, finished-episode, and continue-reading RPCs
  /// of one member.
  Future<void> _writeEpisodeRead(
    HttpRequest request,
    String path,
    Map<String, Object?> body,
  ) async {
    if (path.endsWith('/ListMyRecentSeries')) {
      final limit = body['limit'] as int? ?? 0;
      final token = body['token'] as String? ?? '';
      final start = min(
        token.isEmpty ? 0 : int.parse(token),
        recentSeries.length,
      );
      final end = limit <= 0
          ? recentSeries.length
          : min(start + limit, recentSeries.length);
      await _write(request, HttpStatus.ok, {
        'series': recentSeries.sublist(start, end),
        if (end < recentSeries.length) 'nextToken': '$end',
      });
      return;
    }
    if (path.endsWith('/ListMyEpisodeReads')) {
      final limit = body['limit'] as int? ?? 0;
      final token = body['token'] as String? ?? '';
      final start = min(
        token.isEmpty ? 0 : int.parse(token),
        episodeReadHistory.length,
      );
      final end = limit <= 0
          ? episodeReadHistory.length
          : min(start + limit, episodeReadHistory.length);
      await _write(request, HttpStatus.ok, {
        // protojson omits an empty repeated field.
        if (end > start) 'reads': episodeReadHistory.sublist(start, end),
        if (end < episodeReadHistory.length) 'nextToken': '$end',
      });
      return;
    }
    final episodeId = body['episodePublicId'] as String? ?? '';
    if (path.endsWith('/MarkEpisodeAsRead')) {
      final errorCode = markReadErrorCode;
      if (errorCode != null) {
        await _write(request, HttpStatus.badRequest, {
          'code': errorCode,
          'message': errorCode,
        });
        return;
      }
      final readAt = episodeReads.putIfAbsent(
        episodeId,
        () => DateTime.now().toUtc().toIso8601String(),
      );
      await _write(request, HttpStatus.ok, {'readAt': readAt});
      return;
    }
    if (path.endsWith('/SaveReadingPosition')) {
      final pageIndex = body['pageIndex'] as int? ?? 0;
      readingPositions = {...readingPositions, episodeId: pageIndex};
      await _write(request, HttpStatus.ok, {
        'position': _readingPosition(episodeId, pageIndex),
      });
      return;
    }
    final pageIndex = readingPositions[episodeId];
    await _write(request, HttpStatus.ok, {
      // protojson omits an unset message, which is what a member who never
      // opened the episode is answered with.
      if (pageIndex != null) 'position': _readingPosition(episodeId, pageIndex),
    });
  }

  Map<String, Object?> _readingPosition(String episodeId, int pageIndex) {
    return {
      'episodePublicId': episodeId,
      'pageIndex': pageIndex,
      'pageCount': seedEpisodePageCount,
      'updatedAt': DateTime.now().toUtc().toIso8601String(),
    };
  }

  String _publicIdOf(Map<String, Object?> body) {
    return body['publicId'] as String? ?? '';
  }

  Map<String, String> _snapshotHeaders(HttpHeaders headers) {
    final snapshot = <String, String>{};
    headers.forEach((name, values) {
      snapshot[name.toLowerCase()] = values.join(', ');
    });
    return snapshot;
  }

  Future<Map<String, Object?>> _readBody(HttpRequest request) async {
    final raw = await utf8.decoder.bind(request).join();
    if (raw.trim().isEmpty) {
      return const {};
    }
    final decoded = jsonDecode(raw);
    return decoded is Map
        ? decoded.map((key, value) => MapEntry(key.toString(), value))
        : const {};
  }

  /// `Login` for the seed member and for an account a test signed up here.
  ///
  /// An account whose address is still unconfirmed is refused the way the API
  /// refuses one, with `failed_precondition` rather than `unauthenticated`,
  /// because that is what tells the reader to open their mail rather than to
  /// check their password.
  Future<void> _writeLogin(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    final email = _trimmed(body['email']);
    final password = _trimmed(body['password']);
    if (!memberDeleted &&
        email == memberEmail &&
        password == memberCurrentPassword) {
      await _write(request, HttpStatus.ok, {
        'user': {
          'publicId': memberPublicId,
          'name': memberCurrentName,
          'role': 'member',
        },
        'accessToken': _accessToken(memberAccessToken),
      });
      return;
    }
    final signup = signups[email];
    if (signup == null || signup.password != password) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid credentials',
      });
      return;
    }
    if (!signup.verified) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'failed_precondition',
        'message': 'email address is not verified',
      });
      return;
    }
    _signedUpSession = (email: email, signup: signup);
    await _write(request, HttpStatus.ok, {
      'user': {
        'publicId': signedUpPublicId,
        'name': signup.name,
        'role': 'member',
      },
      'accessToken': _accessToken(signedUpAccessToken),
    });
  }

  /// `CreateUser` as the API answers it: an address that is already taken is
  /// accepted exactly like a free one, so nothing here says which it was.
  Future<void> _writeCreateUser(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (signupStatus != HttpStatus.ok) {
      await _write(request, signupStatus, {
        'code': signupErrorCode,
        'message': signupErrorCode,
      });
      return;
    }
    final email = _trimmed(body['email']);
    signups.putIfAbsent(
      email,
      () => FixtureSignup(
        name: _trimmed(body['name']),
        password: _trimmed(body['password']),
        birthDate: _trimmed(body['birthDate']),
        agreedPageVersionIds: [
          for (final id in body['agreedPageVersionIds'] as List? ?? const [])
            '$id',
        ],
      ),
    );
    await _write(request, HttpStatus.ok, {'accepted': true});
  }

  /// `VerifyUserEmail` for the one token [verificationToken] a sign-up here
  /// is confirmed with. Everything else is the dead end the API answers with:
  /// an expired link on [expiredVerificationToken], and a token it never
  /// issued on anything else.
  Future<void> _writeVerifyUserEmail(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    final token = _trimmed(body['token']);
    if (token == expiredVerificationToken) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'failed_precondition',
        'message': 'verification token expired',
      });
      return;
    }
    if (token != verificationToken || signups.isEmpty) {
      await _write(request, HttpStatus.notFound, {
        'code': 'not_found',
        'message': 'verification token not found',
      });
      return;
    }
    for (final signup in signups.values) {
      signup.verified = true;
    }
    await _write(request, HttpStatus.ok, {'verified': true});
  }

  /// `ConfirmPasswordReset` for the member's [passwordResetToken]. Everything
  /// else is the dead end the API answers with: an expired link on
  /// [expiredPasswordResetToken], and a token it never issued on anything
  /// else.
  Future<void> _writeConfirmPasswordReset(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    final token = _trimmed(body['token']);
    final newPassword = _trimmed(body['newPassword']);
    if (token.isEmpty || newPassword.isEmpty) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'invalid_argument',
        'message': 'token and new_password are required',
      });
      return;
    }
    if (token == expiredPasswordResetToken) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'failed_precondition',
        'message': 'password reset token expired',
      });
      return;
    }
    if (token != passwordResetToken) {
      await _write(request, HttpStatus.notFound, {
        'code': 'not_found',
        'message': 'password reset token not found',
      });
      return;
    }
    memberCurrentPassword = newPassword;
    await _write(request, HttpStatus.ok, {'confirmed': true});
  }

  Map<String, Object?> _accessToken(String token) => {
    'token': token,
    'expiresAt': DateTime.now()
        .toUtc()
        .add(const Duration(hours: 24))
        .toIso8601String(),
  };

  String _trimmed(Object? value) => value is String ? value.trim() : '';

  /// `UpdateMe` as the API applies a birth date: once, and only as a calendar
  /// date the tenant has reached and no more than 130 years back.
  Future<void> _writeUpdateMe(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (!_isAuthorized(request)) {
      await _write(request, HttpStatus.unauthorized, {
        'code': 'unauthenticated',
        'message': 'invalid token',
      });
      return;
    }
    final name = _trimmed(body['name']);
    if (name.isEmpty || name.runes.length > 100) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'invalid_argument',
        'message': 'name is required',
      });
      return;
    }
    final birthDate = body['birthDate'];
    // A date is sent beside the name the account already holds, so a form
    // recording one that sent any other name has lost track of the account.
    if (birthDate is String &&
        birthDate.isNotEmpty &&
        name != memberCurrentName) {
      await _write(request, HttpStatus.badRequest, {
        'code': 'invalid_argument',
        'message': 'unexpected name beside a birth date',
      });
      return;
    }
    if (birthDate is String && birthDate.isNotEmpty) {
      if (memberBirthDate.isNotEmpty) {
        await _write(request, HttpStatus.badRequest, {
          'code': 'failed_precondition',
          'message': 'birth date is already set',
        });
        return;
      }
      final born = parseBirthDate(birthDate);
      final today = calendarDayIn(tenantTimeZone, DateTime.now())!;
      if (born == null || born.isAfter(today) || ageOn(born, today) > 130) {
        await _write(request, HttpStatus.badRequest, {
          'code': 'invalid_argument',
          'message': 'invalid birth date',
        });
        return;
      }
      memberBirthDate = birthDate;
    }
    memberCurrentName = name;
    await _write(request, HttpStatus.ok, {
      'user': {
        'publicId': memberPublicId,
        'name': memberCurrentName,
        'role': 'member',
        if (memberBirthDate.isNotEmpty) 'birthDate': memberBirthDate,
      },
    });
  }

  /// `ChangePassword` as the API answers it: the current password has to be
  /// the member's, the new one has to differ, and the token the request came
  /// with is replaced by the one handed back.
  Future<void> _writeChangePassword(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final current = _trimmed(body['currentPassword']);
    final next = _trimmed(body['newPassword']);
    if (current != memberCurrentPassword || next.isEmpty || next == current) {
      await _writeInvalidArgument(request, 'invalid password change');
      return;
    }
    memberCurrentPassword = next;
    activeAccessToken = changedPasswordAccessToken;
    await _write(request, HttpStatus.ok, {
      'accessToken': _accessToken(changedPasswordAccessToken),
    });
  }

  /// `RequestEmailChange` as the API answers it: the current address and
  /// password have to be the member's, and an address another account holds
  /// is refused as `already_exists`.
  Future<void> _writeRequestEmailChange(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final current = _trimmed(body['currentEmail']);
    final next = _trimmed(body['newEmail']);
    if (current != memberEmail ||
        next.isEmpty ||
        next == current ||
        _trimmed(body['currentPassword']) != memberCurrentPassword) {
      await _writeInvalidArgument(request, 'invalid email change');
      return;
    }
    if (next == takenEmail) {
      await _write(request, HttpStatus.conflict, {
        'code': 'already_exists',
        'message': 'email already exists',
      });
      return;
    }
    requestedEmailChanges.add(next);
    await _write(request, HttpStatus.ok, {'requested': true});
  }

  /// `ConfirmEmailChange` for the tokens this fixture names, which needs no
  /// session the way the API needs none.
  Future<void> _writeConfirmEmailChange(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    switch (_trimmed(body['token'])) {
      case emailChangeToken:
        await _write(request, HttpStatus.ok, {
          'confirmed': true,
          'changed': true,
        });
      case pendingEmailChangeToken:
        // protojson omits `changed` while it is false.
        await _write(request, HttpStatus.ok, {
          'confirmed': true,
          'pendingConfirmationFor': 'current_email',
        });
      case conflictingEmailChangeToken:
        await _write(request, HttpStatus.conflict, {
          'code': 'already_exists',
          'message': 'email already exists',
        });
      case expiredEmailChangeToken:
        await _write(request, HttpStatus.badRequest, {
          'code': 'failed_precondition',
          'message': 'email change token expired',
        });
      default:
        await _write(request, HttpStatus.notFound, {
          'code': 'not_found',
          'message': 'email change token not found',
        });
    }
  }

  /// `DeleteMe` as the API answers it: the password has to be the member's,
  /// and the account is then gone along with every token it held.
  Future<void> _writeDeleteMe(
    HttpRequest request,
    Map<String, Object?> body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (_trimmed(body['password']) != memberCurrentPassword) {
      await _writeInvalidArgument(request, 'invalid password');
      return;
    }
    memberDeleted = true;
    activeAccessToken = null;
    await _write(request, HttpStatus.ok, const <String, Object?>{});
  }

  /// Answers `unauthenticated` for a request without the active token, and
  /// reports whether the request may go on.
  Future<bool> _writeUnlessAuthorized(HttpRequest request) async {
    if (_isAuthorized(request)) {
      return true;
    }
    await _write(request, HttpStatus.unauthorized, {
      'code': 'unauthenticated',
      'message': 'invalid token',
    });
    return false;
  }

  Future<void> _writeInvalidArgument(HttpRequest request, String message) {
    return _write(request, HttpStatus.badRequest, {
      'code': 'invalid_argument',
      'message': message,
    });
  }

  bool _isAuthorized(HttpRequest request) {
    final token = activeAccessToken;
    if (token == null || token.isEmpty) {
      return false;
    }
    return request.headers.value(HttpHeaders.authorizationHeader) ==
        'Bearer $token';
  }

  /// Answers a page the way image-server does.
  ///
  /// With [encryptImages] on, a page always leaves as ciphertext; only the
  /// material it is keyed to depends on the request. The PNG itself is what
  /// the flag being off looks like, and nothing else produces it.
  Future<void> _writeImage(HttpRequest request) async {
    request.response.statusCode = HttpStatus.ok;
    if (!encryptImages) {
      request.response.headers.contentType = ContentType('image', 'png');
      request.response.add(pageBytes);
      await request.response.close();
      return;
    }
    final (token, subject) = _imageCipherMaterial(request);

    request.response.headers
      ..contentType = ContentType('application', 'octet-stream')
      ..set(imageEncryptionHeader, imageEncryptionAlgorithm)
      ..set(imageContentTypeHeader, 'image/png')
      ..set(imageKeyIdHeader, imageKeyId);
    // The stream is its own inverse, so encrypting is the same call the
    // reader makes to decrypt.
    request.response.add(
      decryptImageBytes(
        ciphertext: pageBytes,
        keyId: imageKeyId,
        subject: subject,
        token: token,
      ),
    );
    await request.response.close();
  }

  /// The token and subject image-server would derive this page's key from.
  ///
  /// The request's own material is resolved in the server's order — the
  /// `Authorization` bearer first, then the media token on the URL, which is
  /// what a free page hands a reader with no session — and a value the server
  /// could not read is not material, so it falls through. Presenting nothing
  /// readable is not a way to be sent a plaintext page: the response is keyed
  /// to the window token instead, which this request was never handed.
  (String, String) _imageCipherMaterial(HttpRequest request) {
    final authorization =
        request.headers.value(HttpHeaders.authorizationHeader) ?? '';
    if (authorization.startsWith('Bearer ')) {
      final bearer = authorization.substring('Bearer '.length).trim();
      final subject = subjectFromJwt(bearer);
      if (subject != null) {
        return (bearer, subject);
      }
    }
    final mediaToken =
        request.uri.queryParameters[mediaTokenQueryParam]?.trim() ?? '';
    final subject = subjectFromJwt(mediaToken);
    if (subject != null) {
      return (mediaToken, subject);
    }
    return (_currentWindowMediaToken, freeEpisodeMediaSubject);
  }

  Future<void> _write(HttpRequest request, int status, Object body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }
}

/// One account `CreateUser` opened on [ConnectFixtureServer].
class FixtureSignup {
  FixtureSignup({
    required this.name,
    required this.password,
    required this.birthDate,
    this.agreedPageVersionIds = const [],
  });

  final String name;
  final String password;

  /// `YYYY-MM-DD`, empty from a form that did not ask for one.
  final String birthDate;

  /// The page versions the sign-up agreed to.
  final List<String> agreedPageVersionIds;

  /// Whether a confirmation link has been opened for this address, which is
  /// what `Login` stops refusing it for.
  var verified = false;
}

/// One Connect request [ConnectFixtureServer] answered, kept so a test can
/// assert what the client sent and not only what it did with the answer.
class RecordedRequest {
  const RecordedRequest({
    required this.path,
    required this.headers,
    required this.body,
  });

  /// Request path, ending in the Connect procedure name.
  final String path;

  /// Request headers, under lower-cased names.
  final Map<String, String> headers;

  /// Decoded JSON request body, empty when the request carried none.
  final Map<String, Object?> body;
}
