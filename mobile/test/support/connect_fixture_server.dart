import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:fixnum/fixnum.dart';
import 'package:protobuf/protobuf.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/auth.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/comment.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/contact.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/domain.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/notification.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/page.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/tenant.pb.dart' as pb;
import 'package:publira/api/image_cipher.dart';
import 'package:publira/auth/reader_age.dart';

/// In-process Connect server that speaks the public catalog/domain RPCs in
/// the binary protobuf codec, as the app does.
///
/// Used by widget-adjacent HTTP tests and by `integration_test` so both
/// exercise the same client against a repeatable fixture.
///
/// What it stores and answers are the messages `buf generate` writes from
/// `proto/`, so a fixture that no longer matches the API fails to compile.
/// Every request is decoded strictly into its generated message: a body in
/// another codec, or a field the proto does not define, is answered
/// `invalid_argument` and fails the test.
class ConnectFixtureServer {
  ConnectFixtureServer({
    this.tenantId = defaultTenantId,
    this.tenantHost = 'localhost',
    this.defaultLocale = defaultTenantLocale,
    this.series = const [],
    this.seriesPageSize = 0,
    this.seriesAvailability = const {},
    this.rankedSeries = const [],
    this.genreRankedSeries = const {},
    this.rankedSeriesPageSize = 0,
    this.relatedSeries = const {},
    this.genres = const [],
    this.details = const {},
    this.episodes = const {},
    this.entitledEpisodes = const {},
    this.readingPositions = const {},
    this.recentSeries = const [],
    this.recommendedSeries = const [],
    this.myRecommendedSeries = const [],
    this.seriesProgress = const {},
    this.seriesRatings = const {},
    this.commentMode = pb.CommentMode.COMMENT_MODE_IMMEDIATE,
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
    this.directoryStatus = HttpStatus.ok,
    this.rankedStatus = HttpStatus.ok,
    this.relatedStatus = HttpStatus.ok,
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
    Map<String, ({String title, String contentMarkdown, String locale})>?
    publishedPages,
    this.signupStatus = HttpStatus.ok,
    this.signupErrorCode = 'unavailable',
    this.verificationRequestStatus = HttpStatus.ok,
    this.verificationRequestErrorCode = 'unavailable',
    this.passwordResetRequestStatus = HttpStatus.ok,
    this.passwordResetRequestErrorCode = 'unavailable',
    this.acceptsPayments = false,
    this.currency = 'JPY',
    this.appPurchaseRoute =
        pb.AppPurchaseRoute.APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT,
    this.acceptsAppStorePayments = false,
    this.acceptsGooglePlayPayments = false,
    this.checkoutStatus = HttpStatus.ok,
    this.activeAccessToken = memberAccessToken,
    this.memberBirthDate = '',
    this.ageVerification = pb.AgeVerification.AGE_VERIFICATION_R18,
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

  /// The content type of the binary protobuf codec, which every request
  /// names and every success answers with.
  static const protoContentType = 'application/proto';

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

  /// The internal id this server answers a record with beside its public id
  /// [publicId]. Derived rather than stored, so every record whose message
  /// has an `id` carries one.
  static String internalIdOf(String publicId) => 'internal-$publicId';

  /// The public id of the record [internalId] names, or an empty string for
  /// an id this server never gave out.
  static String publicIdOf(Object? internalId) =>
      internalId is String && internalId.startsWith('internal-')
      ? internalId.substring('internal-'.length)
      : '';
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

  /// Cover renditions of the seed series, as `SeriesEyeCatchVariant`
  /// messages: a host-relative URL the app resolves against its image base.
  static List<pb.SeriesEyeCatchVariant> seedEyeCatchVariants() {
    return [
      for (final width in [400, 800, 1200])
        pb.SeriesEyeCatchVariant(
          label: 'portrait_${width}w',
          variantType: 'portrait',
          url: '/images/series/$seedSeriesImageId/portrait/$width',
          contentType: 'image/webp',
          width: width,
          height: width * 4 ~/ 3,
        ),
      for (final width in [800, 1600])
        pb.SeriesEyeCatchVariant(
          label: 'landscape_${width}w',
          variantType: 'landscape',
          url: '/images/series/$seedSeriesImageId/landscape/$width',
          contentType: 'image/webp',
          width: width,
          height: width * 9 ~/ 16,
        ),
    ];
  }

  /// Credits of the seed series, as `Creator` messages in the tenant's role
  /// priority order.
  static List<pb.Creator> seedCreators() {
    return [
      for (final (index, role) in [(1, 'Story'), (2, 'Art'), (3, 'Art')])
        pb.Creator(
          publicId: 'SeedAUTHAAA$index',
          name: 'Seed Author 00$index',
          role: pb.CreatorRole(publicId: 'SeedROLEAAA$index', name: role),
          profileText: 'Profile text for Seed Author 00$index',
        ),
    ];
  }

  /// Classification of the seed series, as the `Genre` messages a `Series`
  /// carries.
  static List<pb.Genre> seedGenres() {
    return [
      pb.Genre(publicId: 'SeedGENRAAA1', name: 'Fantasy', slug: 'fantasy'),
    ];
  }

  /// The tags of the seed series, as the `Tag` messages a `Series` carries.
  static List<pb.Tag> seedTags() {
    return [pb.Tag(name: 'Time travel', slug: 'time-travel')];
  }

  /// The genres the development seed curates first, in its order, as the
  /// `PublishedGenre` messages [genres] holds. The second carries nothing
  /// [populatedSeries] holds, which a genre still listed at zero is.
  static List<pb.PublishedGenre> populatedGenres() {
    return [
      for (final genre in seedGenres())
        pb.PublishedGenre(
          publicId: genre.publicId,
          name: genre.name,
          slug: genre.slug,
        ),
      pb.PublishedGenre(
        publicId: 'SeedGENRAAA2',
        name: 'Romance',
        slug: 'romance',
      ),
    ];
  }

  static List<pb.Series> populatedSeries() {
    return [
      pb.Series(
        publicId: seedSeriesId,
        title: seedSeriesTitle,
        synopsis: seedSeriesSynopsis,
        label: pb.Label(name: 'Seed Label 01', publicId: 'SeedLABLAAA1'),
        creators: seedCreators(),
        eyeCatchImageVariants: seedEyeCatchVariants(),
        status: pb.SeriesStatus.SERIES_STATUS_ONGOING,
        scheduleWeekdays: [1, 4],
        genres: seedGenres(),
        tags: seedTags(),
      ),
      pb.Series(
        publicId: 'series-kitchen',
        title: 'The Little Kitchen',
        synopsis: 'Everyday cooking, one plate at a time.',
      ),
    ];
  }

  /// `GetEpisodeDetail` answers: the seed episode is free and has pages, the
  /// paid one is locked and has none.
  static Map<String, pb.GetEpisodeDetailResponse> populatedEpisodes() {
    return {
      seedEpisodeId: pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: seedEpisodeId,
          title: seedEpisodeTitle,
          orderIndex: 1,
          price: 0,
          creators: seedCreators(),
        ),
        series: pb.Series(publicId: seedSeriesId, title: seedSeriesTitle),
        access: pb.EpisodeAccess.EPISODE_ACCESS_FREE,
        images: [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            pb.EpisodeImage(
              id: '$seedEpisodeId-page-$page',
              imageUrl:
                  '/images/episodes/$seedEpisodeId-page-$page'
                  '?$mediaTokenQueryParam=$freeEpisodeMediaToken',
              contentType: 'image/png',
              displayOrder: page,
              width: 800,
              height: 1200,
            ),
        ],
      ),
      paidEpisodeId: pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: paidEpisodeId,
          title: 'Seed Episode 001-10',
          orderIndex: 10,
          price: 500,
        ),
        series: pb.Series(publicId: seedSeriesId, title: seedSeriesTitle),
        access: pb.EpisodeAccess.EPISODE_ACCESS_LOCKED,
      ),
    };
  }

  /// `GetEpisodeDetail` answers served instead of [populatedEpisodes] once
  /// the request carries [activeAccessToken]: the paid episode is entitled
  /// and has pages, the way an access ticket makes it read for a signed-in
  /// member.
  static Map<String, pb.GetEpisodeDetailResponse> populatedEntitledEpisodes() {
    return {
      paidEpisodeId: pb.GetEpisodeDetailResponse(
        episode: pb.Episode(
          publicId: paidEpisodeId,
          title: 'Seed Episode 001-10',
          orderIndex: 10,
          price: 500,
        ),
        series: pb.Series(publicId: seedSeriesId, title: seedSeriesTitle),
        access: pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED,
        images: [
          for (var page = 1; page <= seedEpisodePageCount; page++)
            pb.EpisodeImage(
              id: '$paidEpisodeId-page-$page',
              imageUrl: '/images/episodes/$paidEpisodeId-page-$page',
              contentType: 'image/png',
              displayOrder: page,
              width: 800,
              height: 1200,
            ),
        ],
      ),
    };
  }

  /// A week's chart over [populatedSeries]. The positions run 1 and 3 because
  /// they are a snapshot's own: a series ranked second and unpublished since
  /// leaves the gap behind.
  static List<pb.RankedSeries> populatedRankedSeries() {
    return [
      pb.RankedSeries(
        rank: 1,
        series: pb.Series(
          publicId: seedSeriesId,
          title: seedSeriesTitle,
          synopsis: seedSeriesSynopsis,
          creators: seedCreators(),
          eyeCatchImageVariants: seedEyeCatchVariants(),
        ),
      ),
      pb.RankedSeries(
        rank: 3,
        series: pb.Series(
          publicId: 'series-kitchen',
          title: 'The Little Kitchen',
          synopsis: 'Everyday cooking, one plate at a time.',
        ),
      ),
    ];
  }

  /// One `RecentSeries`: the seed series, offering the free episode the member
  /// was last reading.
  static List<pb.RecentSeries> populatedRecentSeries() {
    return [
      pb.RecentSeries(
        series: pb.Series(
          publicId: seedSeriesId,
          title: seedSeriesTitle,
          synopsis: seedSeriesSynopsis,
          eyeCatchImageVariants: seedEyeCatchVariants(),
        ),
        episode: pb.Episode(
          publicId: seedEpisodeId,
          title: seedEpisodeTitle,
          orderIndex: 1,
          price: 0,
        ),
        lastActivityAt: '2026-09-01T00:00:00Z',
      ),
    ];
  }

  static List<pb.MyEpisodeRead> populatedEpisodeReads() {
    return [
      pb.MyEpisodeRead(
        series: pb.Series(
          publicId: seedSeriesId,
          title: seedSeriesTitle,
          synopsis: seedSeriesSynopsis,
          eyeCatchImageVariants: seedEyeCatchVariants(),
        ),
        episode: pb.Episode(
          publicId: seedEpisodeId,
          title: seedEpisodeTitle,
          orderIndex: 1,
          price: 0,
        ),
        readAt: '2026-09-01T00:00:00Z',
      ),
    ];
  }

  static Map<String, pb.GetSeriesDetailResponse> populatedDetails() {
    return {
      seedSeriesId: pb.GetSeriesDetailResponse(
        series: pb.Series(
          publicId: seedSeriesId,
          title: seedSeriesTitle,
          synopsis: seedSeriesSynopsis,
          creators: seedCreators(),
          eyeCatchImageVariants: seedEyeCatchVariants(),
          status: pb.SeriesStatus.SERIES_STATUS_ONGOING,
          scheduleWeekdays: [1, 4],
          genres: seedGenres(),
          tags: seedTags(),
        ),
        episodes: [
          pb.Episode(
            publicId: seedEpisodeId,
            title: seedEpisodeTitle,
            orderIndex: 1,
            price: 0,
          ),
          pb.Episode(
            publicId: 'SeedEPSDAA1A',
            title: 'Seed Episode 001-10',
            orderIndex: 10,
            price: 500,
          ),
        ],
      ),
    };
  }

  final String tenantId;
  final String tenantHost;

  /// The `defaultLocale` `GetTenantByDomain` answers with, which is what the
  /// app renders in when the device asks for no supported language.
  final String defaultLocale;
  List<pb.Series> series;

  /// How many of [series] one `ListPublishedSeries` page holds. `0` answers
  /// the whole of it at once, which is what every read that is not about
  /// paging expects.
  ///
  /// The token stands in for the server's opaque cursor and is the index of
  /// the page's first row, written out.
  int seriesPageSize;

  /// Where each series may be shown, as the console stored it, keyed by
  /// public id. A series missing here is shown on both surfaces.
  ///
  /// Every catalog read answers only with what the surface its request names
  /// may show, and a request naming none is answered as the storefront, the
  /// way the API answers it.
  Map<String, pb.SurfaceAvailability> seriesAvailability;

  /// The genres the tenant curates, in the tenant's order.
  /// `ListPublishedGenres` counts each over the series shown, replacing the
  /// `publishedSeriesCount` stored here.
  List<pb.PublishedGenre> genres;

  /// What `ListRankedSeries` answers with, whichever period is asked for.
  /// Empty acts out a tenant the ranking batch has not run for.
  List<pb.RankedSeries> rankedSeries;

  /// What `ListRankedSeries` answers a request naming a genre with, by the
  /// genre's public id. A genre of [genres] missing here is one the batch has
  /// not ranked, and a genre missing from [genres] is answered `not_found`.
  Map<String, List<pb.RankedSeries>> genreRankedSeries;

  /// The most positions one page of `ListRankedSeries` holds, under the
  /// request's own `limit`, with the token written the way [followsPageSize]
  /// writes one. `0` leaves the request's `limit` alone.
  int rankedSeriesPageSize;

  /// The public ids `ListRelatedSeries` answers with, most related first,
  /// keyed by the public id of the series asked about; each is answered as the
  /// entry of [series] it names. A series of [details] missing here is one
  /// with nothing to go on to, and a series missing from [details] is
  /// answered `not_found`.
  Map<String, List<String>> relatedSeries;

  /// `GetSeriesDetail` answers keyed by series public id.
  Map<String, pb.GetSeriesDetailResponse> details;

  /// `GetEpisodeDetail` answers keyed by episode public id.
  Map<String, pb.GetEpisodeDetailResponse> episodes;

  /// The answers a request carrying [activeAccessToken] gets instead, keyed
  /// the same way. An episode missing here answers from [episodes].
  Map<String, pb.GetEpisodeDetailResponse> entitledEpisodes;

  /// What `GetMyTicketState` answers the signed-in member on whichever series
  /// is asked about. Empty is a ticket ready now and none open.
  pb.GetMyTicketStateResponse ticketState = pb.GetMyTicketStateResponse();

  /// The ErrorInfo reason both `WaitFreeService` calls are refused with under
  /// `failed_precondition`, or `null` to answer them.
  String? waitFreeRefusal;

  /// How long a ticket `UseTicket` spends opens its episode for.
  Duration ticketAccess = const Duration(hours: 72);

  /// Episodes `UseTicket` opened, by public id, in order. Each answers the
  /// member as entitled through an access ticket from then on.
  final List<String> ticketsUsed = [];

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

  /// What `ListMyRecentSeries` answers a signed-in member with, in the order
  /// given, at most the request's `limit` to a page with the token written
  /// the way [followsPageSize] writes one.
  List<pb.RecentSeries> recentSeries;

  /// What `ListRecommendedSeries` answers anyone with, in the tenant's
  /// recommendation order, at most the request's `limit` to a page with the
  /// token written the way [followsPageSize] writes one.
  List<pb.Series> recommendedSeries;

  /// What `ListMyRecommendedSeries` answers a signed-in member with, paged the
  /// way [recommendedSeries] is. A request without the active token is
  /// refused `unauthenticated`, as the API refuses one.
  List<pb.Series> myRecommendedSeries;

  /// The progress `GetMySeriesProgress` answers a signed-in member with,
  /// keyed by series public id. A series missing here is one they have opened
  /// nothing of. The finished episodes beside it are the series' episodes
  /// [episodeReads] holds, so a finish the viewer records shows on the next
  /// read.
  Map<String, pb.SeriesProgress> seriesProgress;

  /// What `GetMySeriesRating` answers a signed-in member with, keyed by
  /// series public id. A series missing here is one they have reacted to
  /// nothing of, which the wire format answers with an empty body.
  Map<String, pb.GetMySeriesRatingResponse> seriesRatings;

  /// What `ListMyEpisodeReads` answers a signed-in member with, in the order
  /// given, at most the request's `limit` to a page.
  List<pb.MyEpisodeRead> episodeReadHistory = const [];

  /// The tenant's comment policy, as `GetTenant` answers it. Set it to
  /// `COMMENT_MODE_DISABLED` to act out a tenant that takes no comments.
  pb.CommentMode commentMode;

  /// Published comments keyed by episode public id, newest first.
  Map<String, List<pb.EpisodeComment>> episodeComments;

  /// The member's own comments the public list omits, keyed the same way.
  /// `PostEpisodeComment` adds to them, so a test can read back what the app
  /// sent and see it in the next list.
  Map<String, List<pb.MyEpisodeComment>> myEpisodeComments;

  /// The follows of the signed-in member, newest follow first. `Follow` and
  /// `Unfollow` write here, so a test can read back what the app sent and see
  /// it in the next list.
  List<pb.MyFollow> myFollows;

  /// What `ListMyFollowUpdates` answers a signed-in member with, in the order
  /// given, at most the request's `limit` to a page.
  List<pb.FollowUpdate> followUpdates = const [];

  /// How many of [myFollows] one `ListMyFollows` page holds. `0` answers the
  /// whole of it at once, which is what every read that is not about paging
  /// expects.
  ///
  /// The token stands in for the server's opaque cursor and is the index of
  /// the page's first row, written out.
  int followsPageSize;

  /// The purchases of the signed-in member, newest purchase first.
  List<pb.MyPurchase> myPurchases;

  /// How many of [myPurchases] one `ListMyPurchases` page holds, with the
  /// token written the way [followsPageSize] writes one. `0` answers the whole
  /// of it at once.
  int purchasesPageSize;

  /// The inbox of the signed-in member, newest first. The read RPCs write
  /// `isRead` here, so the next list and count agree with what the app
  /// marked.
  List<pb.NotificationItem> notifications;

  /// How many of [notifications] one `ListNotifications` page holds, with the
  /// token written the way [followsPageSize] writes one. `0` answers the whole
  /// of it at once.
  int notificationsPageSize;

  /// The announcements of the tenant, newest first, carrying the signed-in
  /// member's read state. A caller with no session the fixture accepts is
  /// answered them without it, as the API answers a visitor.
  List<pb.AnnouncementItem> announcements;

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

  /// What `ListPublishedCreators` and `ListPublishedLabels` answer with.
  int directoryStatus;
  int rankedStatus;
  int relatedStatus;
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

  /// The tenant's published pages, keyed by slug in storage form, each in the
  /// one translation `GetPublishedPage` serves whatever locale is asked for.
  /// `ListPublishedPages` lists every one of them, in this order, as pages
  /// the footer shows.
  Map<String, ({String title, String contentMarkdown, String locale})>
  publishedPages;

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

  /// The image-server path of the member's icon, and `null` for an account
  /// that shows none, which the API omits.
  ///
  /// `GetMe`, `UpdateMe`, and `LoginWithIdToken` report it. A password `Login`
  /// does not, the way the API answers it.
  String? memberIconPath;

  /// The icon renditions of the member's own account, which every response
  /// that reports [memberIconPath] carries.
  List<pb.UserIconVariant> get _memberIcon => [
    if (memberIconPath case final iconPath?)
      pb.UserIconVariant(
        label: 'icon',
        url: iconPath,
        contentType: 'image/webp',
        width: 512,
        height: 512,
      ),
  ];

  /// The images `UploadMyIcon` has stored, in order, each as the bytes and
  /// the content type it was sent with.
  final iconUploads = <({List<int> bytes, String contentType})>[];

  /// How many times `DeleteMyIcon` has been answered.
  var iconRemovals = 0;

  /// Whether the install has an object store, without which `UploadMyIcon`
  /// is refused with `STORAGE_NOT_CONFIGURED`.
  var iconStorageConfigured = true;

  /// The tenant's reader icon policy as `GetTenantReaderIconPolicy` answers
  /// it. `UploadMyIcon` is refused with `READER_ICON_NOT_ALLOWED` under any
  /// other than upload, and `SelectMyIcon` under any other than preset.
  var readerIconPolicy = pb.ReaderIconPolicy.READER_ICON_POLICY_UPLOAD;

  /// The presets the tenant offers, which `GetTenantReaderIconPolicy` lists
  /// only under the preset policy.
  var readerIconPresets = <pb.ReaderIconPreset>[];

  /// Answered by `GetTenantReaderIconPolicy` in place of the one built from
  /// [readerIconPolicy] and [readerIconPresets], for a test that needs one
  /// the API could send but no setting here builds.
  pb.GetTenantReaderIconPolicyResponse? readerIconPolicyResponse;

  /// The preset the member's icon is, and `null` for an upload or none.
  String? memberIconPresetId;

  /// The presets `SelectMyIcon` has shown as the member's icon, in order.
  final iconSelections = <String>[];

  /// A preset of the tenant's, whose one rendition is served under
  /// [readerIconPresetPath].
  static pb.ReaderIconPreset readerIconPreset(String id) => pb.ReaderIconPreset(
    id: id,
    createdAt: '2026-10-01T00:00:00Z',
    variants: [
      pb.UserIconVariant(
        label: 'icon',
        url: readerIconPresetPath(id),
        contentType: 'image/webp',
        width: 512,
        height: 512,
      ),
    ],
  );

  /// The image-server path of preset [id]'s image.
  static String readerIconPresetPath(String id) =>
      '/images/reader-icon-presets/$id';

  /// The addresses `RequestEmailChange` has accepted a move to, in order.
  final requestedEmailChanges = <String>[];

  /// What `GetTenant` answers for `apple_sign_in` and `google_sign_in`.
  /// `null` is a provider the tenant has not enabled, which the API omits.
  pb.TenantAppleSignIn? appleSignIn;
  pb.TenantGoogleSignIn? googleSignIn;

  /// The bundle identifier `GetTenantMobileAppAssociation` names for the
  /// tenant's iOS app. `null` is a tenant with no iOS app, which it omits.
  String? iosAppBundleIdentifier;

  /// The application ID `GetTenantMobileAppAssociation` names for the
  /// tenant's Android app. `null` is a tenant with no Android app, which it
  /// omits.
  String? androidApplicationId;

  /// The ID tokens a provider has issued, keyed by the token itself, which
  /// `LoginWithIdToken`, `RequestEmailChange`, and `DeleteMe` accept for the
  /// nonce they carry.
  final idTokens = <String, FixtureIdToken>{};

  /// The provider accounts linked to the member, keyed by provider, as
  /// `ListMyIdentities` reports them.
  final memberIdentities = <pb.IdentityProvider, FixtureIdToken>{};

  /// The subjects of provider accounts that sign in to another reader, which
  /// `LinkIdentity` refuses to link to the member.
  final otherReaderSubjects = <String>{};

  /// Whether the member's account has a password, which an account a
  /// provider sign-in created does not.
  var memberHasPassword = true;

  /// The nonces `LoginWithIdToken` has spent; each is accepted once.
  final spentNonces = <String>{};

  /// Set once `DeleteMe` has gone through, after which the member can
  /// neither sign in nor use the token they held.
  var memberDeleted = false;

  /// Whether the member is the tenant's last active tenant admin, whom
  /// `DeleteMe` refuses.
  var memberIsLastTenantAdmin = false;

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

  /// Whether the member takes notification email, which
  /// `GetNotificationSettings` answers and `UpdateNotificationSettings`
  /// writes. On by default, as the API answers an account that has saved no
  /// setting.
  var memberEmailNotifications = true;

  /// The same setting for the account [signedUpAccessToken] stands for, which
  /// starts on as well.
  var _signedUpEmailNotifications = true;

  /// The tenant's age rule and display zone, as `GetTenant` answers them.
  pb.AgeVerification ageVerification;
  String tenantTimeZone;

  /// The pages `GetTenantLegalPages` names as the tenant's terms of service
  /// and privacy policy. `null` is a role named for no page, which the API
  /// omits.
  pb.TenantLegalPage? termsPage;
  pb.TenantLegalPage? privacyPage;

  /// The pages `GetMyLegalPageAgreements` reports the member owes, until
  /// `AgreeToLegalPages` is sent its version. `null` is a role the member owes
  /// nothing for.
  pb.TenantLegalPage? owedTermsPage;
  pb.TenantLegalPage? owedPrivacyPage;

  /// The versions `AgreeToLegalPages` was sent, one list per call.
  final legalPageAgreements = <List<String>>[];

  /// The tenant's name and theme, as `GetTenant` answers them. A `null` theme
  /// is a tenant that has stored none, which the API omits.
  String tenantName;
  pb.TenantTheme? tenantTheme;

  /// Whether a page leaves as ciphertext. Set it to false to act out a
  /// server instance a rolling deploy has not replaced yet, which the
  /// reader still has to work against for the length of the rollout.
  bool encryptImages;

  /// What `GetTenant` answers for `accepts_payments`.
  bool acceptsPayments;

  /// What `GetTenant` answers for `currency`, and what every purchase it
  /// lists was paid in.
  String currency;

  /// What `GetTenant` answers for the app purchase route and whether each
  /// store can take the app's payment.
  pb.AppPurchaseRoute appPurchaseRoute;
  bool acceptsAppStorePayments;
  bool acceptsGooglePlayPayments;

  /// The status and Connect code `StartStorePurchase` answers an intent it
  /// would otherwise open with, so a test can refuse one.
  int storeStartStatus = HttpStatus.ok;
  String storeStartErrorCode = 'failed_precondition';

  /// The status and Connect code `ConfirmStorePurchase` answers with.
  int storeConfirmStatus = HttpStatus.ok;
  String storeConfirmErrorCode = 'failed_precondition';

  /// The intent `StartStorePurchase` opens and the product it names.
  static const storeIntentId = '018f0e90-1000-7000-8000-000000000001';
  static const storeProductId = 'episode_500';

  /// The status `StartEpisodeCheckout` answers a checkout it would otherwise
  /// start with, so a test can fail one.
  int checkoutStatus;

  /// The Stripe page `StartEpisodeCheckout` answers for [episodePublicId].
  static Uri checkoutUrlFor(String episodePublicId) =>
      Uri.parse('https://checkout.stripe.test/c/pay/$episodePublicId');

  /// Replace the whole body of the matching RPC, whichever status the RPC is
  /// answering with, so a test can send a shape the client is not expecting or
  /// an error code other than the default `unavailable`.
  ///
  /// A hook holds a generated message, sent in the binary codec, for a body
  /// that only replaces the stored one; raw bytes, sent as a binary body, for
  /// one that does not decode; or a `Map`, sent as a Connect error envelope
  /// in JSON, for a refusal worded by the test. Every record in a message
  /// that names a `publicId` is still answered with the internal `id` beside
  /// it.
  Object? listResponse;
  Object? detailResponse;
  Object? episodeResponse;

  /// Replaces the whole `GetTenantByDomain` body, so a test can answer with a
  /// shape the client is not expecting. Raw, as [listResponse] is.
  Object? tenantResponse;

  /// Replaces the whole `GetMyEpisodeRating` body. Raw, as [listResponse]
  /// is.
  Object? episodeRatingResponse;

  /// The error `RateEpisode` answers with in place of a score, as the status
  /// and the Connect error body.
  ({int status, Map<String, Object?> body})? rateEpisodeError;

  /// The status `RecordContentView` answers with.
  int contentViewStatus = HttpStatus.ok;

  /// The `Set-Cookie` value `RecordContentView` answers a caller with when it
  /// sent neither a bearer nor a `publira_aid` cookie, the way the API mints
  /// one. Secure, as the API's is.
  String mintedAnonymousIdCookie =
      'publira_aid=$mintedAnonymousId; Path=/; Max-Age=15552000; HttpOnly; '
      'Secure; SameSite=Lax';

  static const mintedAnonymousId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

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

  /// The recorded requests to the procedure whose request message [create]
  /// makes, each decoded into a fresh one, such as
  /// `requestsOf(pb.ListPublishedSeriesRequest.new)` for every
  /// `ListPublishedSeries` call.
  ///
  /// The procedure is the message's name without its `Request` suffix, which
  /// is how every RPC of the public API names its request.
  Iterable<T> requestsOf<T extends GeneratedMessage>(T Function() create) {
    final name = create().info_.messageName;
    if (!name.endsWith('Request')) {
      throw ArgumentError.value(name, 'create', 'is not a request message');
    }
    return requestsTo(
      name.substring(0, name.length - 'Request'.length),
    ).map((request) => request.decode(create()));
  }

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
    // `publira server` answers the public API under `/rpc`.
    if (!path.startsWith('/rpc/')) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }

    final recorded = RecordedRequest(
      path: path,
      headers: _snapshotHeaders(request.headers),
      body: await _readBody(request),
    );
    requests.add(recorded);
    try {
      // connect-go picks the codec from the content type, and refuses one it
      // has no codec for before any handler runs.
      final contentType = recorded.headers['content-type'] ?? '';
      if (contentType != protoContentType) {
        throw FormatException('request sent as "$contentType"');
      }
      await _answer(request, recorded);
    } on FormatException catch (error, stackTrace) {
      // A request the generated message cannot hold is a client that no
      // longer matches `proto/`. Answer it the way connect-go would, and fail
      // the test that sent it rather than leave it waiting on a timeout.
      await _writeError(
        request,
        HttpStatus.badRequest,
        'invalid_argument',
        error.message,
      );
      Zone.current.handleUncaughtError(error, stackTrace);
    }
  }

  Future<void> _answer(HttpRequest request, RecordedRequest recorded) async {
    final path = recorded.path;

    if (path.endsWith('/GetTenantByDomain')) {
      recorded.decode(pb.GetTenantByDomainRequest());
      if (tenantResponse case final response?) {
        await _writeRaw(request, tenantStatus, response);
      } else if (tenantStatus != HttpStatus.ok) {
        await _writeError(
          request,
          tenantStatus,
          'not_found',
          'tenant not found',
        );
      } else {
        await _writeMessage(
          request,
          pb.GetTenantByDomainResponse(
            tenantId: tenantId,
            defaultLocale: defaultLocale,
          ),
        );
      }
      return;
    }

    if (path.endsWith('/ListPublishedGenres')) {
      final body = recorded.decode(pb.ListPublishedGenresRequest());
      final shown = _seriesShownTo(body.surface);
      final page = _pageOf([
        for (final genre in genres)
          genre.deepCopy()
            ..publishedSeriesCount = shown
                .where(
                  (item) => item.genres.any(
                    (entry) => entry.publicId == genre.publicId,
                  ),
                )
                .length,
      ], body.token);
      await _writeMessage(
        request,
        pb.ListPublishedGenresResponse(
          genres: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListPublishedTags')) {
      final body = recorded.decode(pb.ListPublishedTagsRequest());
      final page = _pageOf(
        _publishedTags(_seriesShownTo(body.surface)),
        body.token,
      );
      await _writeMessage(
        request,
        pb.ListPublishedTagsResponse(
          tags: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListPublishedSeries')) {
      final body = recorded.decode(pb.ListPublishedSeriesRequest());
      final missing = _classifiedMissing(body.genrePublicId, body.tagSlug);
      if (missing != null) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          '$missing not found',
        );
        return;
      }
      if (listResponse case final response?) {
        await _writeRaw(request, listStatus, response);
        return;
      }
      if (listStatus != HttpStatus.ok) {
        await _writeUnavailable(request, listStatus);
        return;
      }
      final page = _pageOf(_classified(body), body.token);
      await _writeMessage(
        request,
        pb.ListPublishedSeriesResponse(
          series: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/SearchPublishedSeries')) {
      final body = recorded.decode(pb.SearchPublishedSeriesRequest());
      if (searchStatus != HttpStatus.ok) {
        await _writeUnavailable(request, searchStatus);
        return;
      }
      final page = _searchPage(
        _seriesShownTo(body.surface),
        body.query,
        body.token,
      );
      await _writeMessage(
        request,
        pb.SearchPublishedSeriesResponse(
          series: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListRankedSeries')) {
      final body = recorded.decode(pb.ListRankedSeriesRequest());
      final genre = body.genrePublicId;
      if (genre.isNotEmpty && !genres.any((item) => item.publicId == genre)) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'genre not found',
        );
        return;
      }
      // A genre is ranked for all ages alone, and the API refuses any other
      // rating beside it rather than answering an empty chart.
      if (genre.isNotEmpty &&
          body.ageRating != pb.SeriesAgeRating.SERIES_AGE_RATING_ALL) {
        await _writeError(
          request,
          HttpStatus.badRequest,
          'invalid_argument',
          'a genre is ranked for all ages alone',
        );
        return;
      }
      final shown = [
        for (final entry
            in genre.isEmpty
                ? rankedSeries
                : genreRankedSeries[genre] ?? const <pb.RankedSeries>[])
          if (_shows(body.surface, entry.series.publicId)) entry,
      ];
      var pageSize = body.limit > 0 ? body.limit : shown.length;
      if (rankedSeriesPageSize > 0) {
        pageSize = min(pageSize, rankedSeriesPageSize);
      }
      final page = _paged(shown, body.token, pageSize);
      if (rankedStatus != HttpStatus.ok) {
        await _writeUnavailable(request, rankedStatus);
        return;
      }
      // The wire format omits an empty repeated field, which is how a tenant
      // the ranking batch has not run for is answered.
      await _writeMessage(
        request,
        pb.ListRankedSeriesResponse(
          rankedSeries: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListRelatedSeries')) {
      final body = recorded.decode(pb.ListRelatedSeriesRequest());
      if (relatedStatus != HttpStatus.ok) {
        await _writeUnavailable(request, relatedStatus);
        return;
      }
      final subject = publicIdOf(body.seriesId);
      if (!_shows(body.surface, subject) || !details.containsKey(subject)) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'series not found',
        );
        return;
      }
      final shown = _seriesShownTo(body.surface);
      final related = [
        for (final id in relatedSeries[subject] ?? const <String>[])
          ...shown.where((item) => item.publicId == id),
      ];
      final page = body.limit > 0 ? related.take(body.limit) : related;
      await _writeMessage(request, pb.ListRelatedSeriesResponse(series: page));
      return;
    }

    if (path.endsWith('/ListRecommendedSeries')) {
      final body = recorded.decode(pb.ListRecommendedSeriesRequest());
      final page = _paged(
        [
          for (final item in recommendedSeries)
            if (_shows(body.surface, item.publicId)) item,
        ],
        body.token,
        body.limit,
      );
      await _writeMessage(
        request,
        pb.ListRecommendedSeriesResponse(
          series: page.items,
          nextToken: page.nextToken,
          source: pb.RecommendationSource.RECOMMENDATION_SOURCE_RANKING,
        ),
      );
      return;
    }

    if (path.endsWith('/ListMyRecommendedSeries')) {
      final body = recorded.decode(pb.ListMyRecommendedSeriesRequest());
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      final page = _paged(
        [
          for (final item in myRecommendedSeries)
            if (_shows(body.surface, item.publicId)) item,
        ],
        body.token,
        body.limit,
      );
      await _writeMessage(
        request,
        pb.ListMyRecommendedSeriesResponse(
          series: page.items,
          nextToken: page.nextToken,
          source: pb.RecommendationSource.RECOMMENDATION_SOURCE_READER_FEATURES,
        ),
      );
      return;
    }

    if (path.endsWith('/Login')) {
      await _writeLogin(request, recorded.decode(pb.LoginRequest()));
      return;
    }

    if (path.endsWith('/CreateUser')) {
      await _writeCreateUser(request, recorded.decode(pb.CreateUserRequest()));
      return;
    }

    if (path.endsWith('/VerifyUserEmail')) {
      await _writeVerifyUserEmail(
        request,
        recorded.decode(pb.VerifyUserEmailRequest()),
      );
      return;
    }

    if (path.endsWith('/RequestEmailVerification')) {
      recorded.decode(pb.RequestEmailVerificationRequest());
      // Every address is answered the same way, the way the API answers one,
      // so nothing here reports whether an account exists.
      if (verificationRequestStatus != HttpStatus.ok) {
        await _writeError(
          request,
          verificationRequestStatus,
          verificationRequestErrorCode,
          verificationRequestErrorCode,
        );
        return;
      }
      await _writeMessage(
        request,
        pb.RequestEmailVerificationResponse(requested: true),
      );
      return;
    }

    if (path.endsWith('/RequestPasswordReset')) {
      recorded.decode(pb.RequestPasswordResetRequest());
      // Every address is answered the same way, the way the API answers one.
      if (passwordResetRequestStatus != HttpStatus.ok) {
        await _writeError(
          request,
          passwordResetRequestStatus,
          passwordResetRequestErrorCode,
          passwordResetRequestErrorCode,
        );
        return;
      }
      await _writeMessage(
        request,
        pb.RequestPasswordResetResponse(requested: true),
      );
      return;
    }

    if (path.endsWith('/ConfirmPasswordReset')) {
      await _writeConfirmPasswordReset(
        request,
        recorded.decode(pb.ConfirmPasswordResetRequest()),
      );
      return;
    }

    if (path.endsWith('/GetMe')) {
      recorded.decode(pb.GetMeRequest());
      if (_signedUpSession case final signedUp?
          when _isSignedUpSession(request)) {
        final birthDate = signedUp.signup.birthDate;
        await _writeMessage(
          request,
          pb.GetMeResponse(
            user: pb.User(
              publicId: signedUpPublicId,
              name: signedUp.signup.name,
              role: 'member',
              birthDate: birthDate.isNotEmpty ? birthDate : null,
              email: signedUp.email,
            ),
          ),
        );
        return;
      }
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      await _writeMessage(
        request,
        pb.GetMeResponse(
          user: pb.User(
            publicId: memberPublicId,
            name: memberCurrentName,
            role: 'member',
            // The wire format omits an empty string, the way the API does for a
            // reader who has recorded no date.
            birthDate: memberBirthDate.isNotEmpty ? memberBirthDate : null,
            email: memberEmail,
            iconImageVariants: _memberIcon,
            iconPresetId: memberIconPresetId,
          ),
        ),
      );
      return;
    }

    if (path.endsWith('/GetMyLegalPageAgreements')) {
      recorded.decode(pb.GetMyLegalPageAgreementsRequest());
      await _writeLegalPageAgreements(request, null);
      return;
    }

    if (path.endsWith('/AgreeToLegalPages')) {
      await _writeLegalPageAgreements(
        request,
        recorded.decode(pb.AgreeToLegalPagesRequest()),
      );
      return;
    }

    if (path.endsWith('/GetPublishedPage')) {
      final body = recorded.decode(pb.GetPublishedPageRequest());
      final slug = body.slug.trim();
      final page = publishedPages[slug];
      if (pageStatus != HttpStatus.ok) {
        await _writeUnavailable(request, pageStatus);
      } else if (page == null) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'page not found',
        );
      } else {
        await _writeMessage(
          request,
          pb.GetPublishedPageResponse(
            page: pb.Page(slug: slug, title: page.title, locale: page.locale),
            // The wire format omits an empty body.
            version: pb.PageVersion(
              contentMarkdown: page.contentMarkdown.isNotEmpty
                  ? page.contentMarkdown
                  : null,
            ),
          ),
        );
      }
      return;
    }

    if (path.endsWith('/ListPublishedPages')) {
      recorded.decode(pb.ListPublishedPagesRequest());
      if (pageStatus != HttpStatus.ok) {
        await _writeUnavailable(request, pageStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.ListPublishedPagesResponse(
          pages: [
            for (final MapEntry(key: slug, value: page)
                in publishedPages.entries)
              pb.Page(
                slug: slug,
                title: page.title,
                locale: page.locale,
                displayInFooter: true,
              ),
          ],
        ),
      );
      return;
    }

    if (path.endsWith('/ListPublishedPageSlugs')) {
      recorded.decode(pb.ListPublishedPageSlugsRequest());
      if (pageStatus != HttpStatus.ok) {
        await _writeUnavailable(request, pageStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.ListPublishedPageSlugsResponse(slugs: publishedPages.keys),
      );
      return;
    }

    if (path.endsWith('/SubmitContactMessage')) {
      recorded.decode(pb.SubmitContactMessageRequest());
      // A session is optional, and the response deliberately empty.
      if (contactStatus != HttpStatus.ok) {
        await _writeError(
          request,
          contactStatus,
          contactErrorCode,
          contactErrorCode,
        );
        return;
      }
      await _writeMessage(request, pb.SubmitContactMessageResponse());
      return;
    }

    if (path.endsWith('/UpdateMe')) {
      await _writeUpdateMe(request, recorded.decode(pb.UpdateMeRequest()));
      return;
    }

    if (path.endsWith('/UploadMyIcon')) {
      await _writeChangeMyIcon(
        request,
        recorded.decode(pb.UploadMyIconRequest()),
      );
      return;
    }

    if (path.endsWith('/DeleteMyIcon')) {
      recorded.decode(pb.DeleteMyIconRequest());
      await _writeChangeMyIcon(request, null);
      return;
    }

    if (path.endsWith('/SelectMyIcon')) {
      await _writeSelectMyIcon(
        request,
        recorded.decode(pb.SelectMyIconRequest()),
      );
      return;
    }

    if (path.endsWith('/GetNotificationSettings') ||
        path.endsWith('/UpdateNotificationSettings')) {
      final update = path.endsWith('/UpdateNotificationSettings')
          ? recorded.decode(pb.UpdateNotificationSettingsRequest())
          : null;
      if (update == null) {
        recorded.decode(pb.GetNotificationSettingsRequest());
      }
      final isSignedUp = _isSignedUpSession(request);
      if (!isSignedUp && !await _writeUnlessAuthorized(request)) {
        return;
      }
      if (update != null) {
        // The wire format omits a false, so an absent field turns the mail off.
        final enabled = update.emailNotificationsEnabled;
        if (isSignedUp) {
          _signedUpEmailNotifications = enabled;
        } else {
          memberEmailNotifications = enabled;
        }
      }
      final enabled = isSignedUp
          ? _signedUpEmailNotifications
          : memberEmailNotifications;
      await _writeMessage(
        request,
        update != null
            ? pb.UpdateNotificationSettingsResponse(
                emailNotificationsEnabled: enabled ? true : null,
              )
            : pb.GetNotificationSettingsResponse(
                emailNotificationsEnabled: enabled ? true : null,
              ),
      );
      return;
    }

    if (path.endsWith('/ChangePassword')) {
      await _writeChangePassword(
        request,
        recorded.decode(pb.ChangePasswordRequest()),
      );
      return;
    }

    if (path.endsWith('/RequestEmailChange')) {
      await _writeRequestEmailChange(
        request,
        recorded.decode(pb.RequestEmailChangeRequest()),
      );
      return;
    }

    if (path.endsWith('/ConfirmEmailChange')) {
      await _writeConfirmEmailChange(
        request,
        recorded.decode(pb.ConfirmEmailChangeRequest()),
      );
      return;
    }

    if (path.endsWith('/DeleteMe')) {
      await _writeDeleteMe(request, recorded.decode(pb.DeleteMeRequest()));
      return;
    }

    if (path.endsWith('/LoginWithIdToken')) {
      await _writeLoginWithIdToken(
        request,
        recorded.decode(pb.LoginWithIdTokenRequest()),
      );
      return;
    }

    if (path.endsWith('/ListMyIdentities')) {
      recorded.decode(pb.ListMyIdentitiesRequest());
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      await _writeMessage(
        request,
        pb.ListMyIdentitiesResponse(
          identities: [
            for (final MapEntry(key: provider, value: token)
                in memberIdentities.entries)
              pb.LinkedIdentity(
                provider: provider,
                email: token.email,
                linkedAt: '2026-01-02T03:04:05Z',
              ),
          ],
          hasPassword: memberHasPassword ? true : null,
        ),
      );
      return;
    }

    if (path.endsWith('/UnlinkIdentity')) {
      final body = recorded.decode(pb.UnlinkIdentityRequest());
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      final provider = body.provider;
      if (!memberIdentities.containsKey(provider)) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'no account of this provider is linked',
        );
        return;
      }
      if (!memberHasPassword && memberIdentities.length == 1) {
        await _writeError(
          request,
          HttpStatus.badRequest,
          'failed_precondition',
          'the account keeps its last linked provider',
        );
        return;
      }
      memberIdentities.remove(provider);
      await _writeMessage(request, pb.UnlinkIdentityResponse());
      return;
    }

    if (path.endsWith('/LinkIdentity')) {
      await _writeLinkIdentity(
        request,
        recorded.decode(pb.LinkIdentityRequest()),
      );
      return;
    }

    if (path.endsWith('/Logout')) {
      recorded.decode(pb.LogoutRequest());
      // The API answers every token alike: it only records the sign-out.
      await _writeMessage(request, pb.LogoutResponse());
      return;
    }

    if (path.endsWith('/GetSeriesDetail')) {
      final body = recorded.decode(pb.GetSeriesDetailRequest());
      if (detailStatus != HttpStatus.ok) {
        await _writeRawOrUnavailable(request, detailStatus, detailResponse);
        return;
      }
      final publicId = body.publicId;
      final detail = _shows(body.surface, publicId) ? details[publicId] : null;
      if (detail == null) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'series not found',
        );
        return;
      }
      await _writeRaw(request, HttpStatus.ok, detailResponse ?? detail);
      return;
    }

    if (path.endsWith('/GetEpisodeDetail')) {
      final body = recorded.decode(pb.GetEpisodeDetailRequest());
      if (episodeStatus != HttpStatus.ok) {
        await _writeRawOrUnavailable(request, episodeStatus, episodeResponse);
        return;
      }
      final publicId = body.publicId;
      final episode = _isAuthorized(request)
          ? entitledEpisodes[publicId] ?? episodes[publicId]
          : episodes[publicId];
      if (episode == null || !_shows(body.surface, episode.series.publicId)) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'episode not found',
        );
        return;
      }
      await _writeRaw(request, HttpStatus.ok, episodeResponse ?? episode);
      return;
    }

    // Every read of the member's own history needs their session, the way the
    // API refuses one without it.
    if (path.endsWith('/GetMyReadingPosition') ||
        path.endsWith('/SaveReadingPosition') ||
        path.endsWith('/MarkEpisodeAsRead') ||
        path.endsWith('/ListMyEpisodeReads') ||
        path.endsWith('/ListMyRecentSeries') ||
        path.endsWith('/GetMySeriesProgress')) {
      await _writeEpisodeRead(request, recorded);
      return;
    }

    if (path.endsWith('/GetTenant')) {
      recorded.decode(pb.GetTenantRequest());
      if (tenantStatus != HttpStatus.ok) {
        await _writeUnavailable(request, tenantStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.GetTenantResponse(
          tenantPublicId: tenantId,
          tenantName: tenantName,
          theme: tenantTheme,
          defaultLocale: defaultLocale,
          commentMode: commentMode,
          ageVerification: ageVerification,
          timezone: tenantTimeZone,
          // The wire format omits a false.
          acceptsPayments: acceptsPayments ? true : null,
          currency: currency,
          appPurchaseRoute: appPurchaseRoute,
          acceptsAppStorePayments: acceptsAppStorePayments ? true : null,
          acceptsGooglePlayPayments: acceptsGooglePlayPayments ? true : null,
          appleSignIn: appleSignIn,
          googleSignIn: googleSignIn,
        ),
      );
      return;
    }

    if (path.endsWith('/GetTenantMobileAppAssociation')) {
      recorded.decode(pb.GetTenantMobileAppAssociationRequest());
      if (tenantStatus != HttpStatus.ok) {
        await _writeUnavailable(request, tenantStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.GetTenantMobileAppAssociationResponse(
          android: androidApplicationId == null
              ? null
              : pb.TenantAndroidAppAssociation(
                  applicationId: androidApplicationId,
                ),
          ios: iosAppBundleIdentifier == null
              ? null
              : pb.TenantIosAppAssociation(
                  teamId: 'ABCDE12345',
                  bundleIdentifier: iosAppBundleIdentifier,
                ),
        ),
      );
      return;
    }

    if (path.endsWith('/GetTenantReaderIconPolicy')) {
      recorded.decode(pb.GetTenantReaderIconPolicyRequest());
      if (tenantStatus != HttpStatus.ok) {
        await _writeUnavailable(request, tenantStatus);
        return;
      }
      await _writeMessage(
        request,
        readerIconPolicyResponse ??
            pb.GetTenantReaderIconPolicyResponse(
              policy: readerIconPolicy,
              presets:
                  readerIconPolicy ==
                      pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET
                  ? readerIconPresets
                  : null,
            ),
      );
      return;
    }

    if (path.endsWith('/GetTenantLegalPages')) {
      recorded.decode(pb.GetTenantLegalPagesRequest());
      if (tenantStatus != HttpStatus.ok) {
        await _writeUnavailable(request, tenantStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.GetTenantLegalPagesResponse(
          termsPage: termsPage,
          privacyPage: privacyPage,
        ),
      );
      return;
    }

    if (path.endsWith('/GetSeriesEpisodeAccess')) {
      await _writeSeriesEpisodeAccess(
        request,
        recorded.decode(pb.GetSeriesEpisodeAccessRequest()),
      );
      return;
    }

    if (path.endsWith('/StartEpisodeCheckout')) {
      await _writeCheckout(
        request,
        recorded.decode(pb.StartEpisodeCheckoutRequest()),
      );
      return;
    }

    if (path.endsWith('/StartStorePurchase')) {
      recorded.decode(pb.StartStorePurchaseRequest());
      await _writeStorePurchase(request, start: true);
      return;
    }

    if (path.endsWith('/ConfirmStorePurchase')) {
      recorded.decode(pb.ConfirmStorePurchaseRequest());
      await _writeStorePurchase(request, start: false);
      return;
    }

    if (path.endsWith('/ListMyPurchases')) {
      final body = recorded.decode(pb.ListMyPurchasesRequest());
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      final page = _paged(
        myPurchases,
        purchasesPageSize > 0 ? body.token : '',
        purchasesPageSize,
      );
      await _writeMessage(
        request,
        pb.ListMyPurchasesResponse(
          purchases: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.contains('/publira.v1.WaitFreeService/')) {
      await _writeWaitFree(request, recorded);
      return;
    }

    if (path.contains('/publira.v1.CommentService/')) {
      await _writeComment(request, recorded);
      return;
    }

    if (path.contains('/publira.v1.FollowService/')) {
      await _writeFollow(request, recorded);
      return;
    }

    if (path.endsWith('/SearchPublishedCreators')) {
      final body = recorded.decode(pb.SearchPublishedCreatorsRequest());
      if (searchStatus != HttpStatus.ok) {
        await _writeUnavailable(request, searchStatus);
        return;
      }
      final page = _namedPage(
        _publishedCreators(
          _seriesShownTo(body.surface),
        ).where((item) => item.publishedSeriesCount > 0),
        (item) => item.name,
        body.query,
        body.token,
      );
      await _writeMessage(
        request,
        pb.SearchPublishedCreatorsResponse(
          creators: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/SearchPublishedLabels')) {
      final body = recorded.decode(pb.SearchPublishedLabelsRequest());
      if (searchStatus != HttpStatus.ok) {
        await _writeUnavailable(request, searchStatus);
        return;
      }
      final page = _namedPage(
        _publishedLabels(_seriesShownTo(body.surface)),
        (item) => item.name,
        body.query,
        body.token,
      );
      await _writeMessage(
        request,
        pb.SearchPublishedLabelsResponse(
          labels: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    // Authors come in name order, which the empty keyword leaves every one
    // of. Labels come newest first, which the fixture has no record of, so
    // they stay in the order the series carry them.
    if (path.endsWith('/ListPublishedCreators')) {
      final body = recorded.decode(pb.ListPublishedCreatorsRequest());
      if (directoryStatus != HttpStatus.ok) {
        await _writeUnavailable(request, directoryStatus);
        return;
      }
      final page = _namedPage(
        _publishedCreators(
          _seriesShownTo(body.surface),
        ).where((item) => item.publishedSeriesCount > 0),
        (item) => item.name,
        '',
        body.token,
      );
      await _writeMessage(
        request,
        pb.ListPublishedCreatorsResponse(
          creators: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListPublishedLabels')) {
      final body = recorded.decode(pb.ListPublishedLabelsRequest());
      if (directoryStatus != HttpStatus.ok) {
        await _writeUnavailable(request, directoryStatus);
        return;
      }
      final page = _pageOf(
        _publishedLabels(_seriesShownTo(body.surface)),
        body.token,
      );
      await _writeMessage(
        request,
        pb.ListPublishedLabelsResponse(
          labels: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/GetPublishedCreatorDetail')) {
      final body = recorded.decode(pb.GetPublishedCreatorDetailRequest());
      final publicId = body.publicId;
      final shown = _seriesShownTo(body.surface);
      final target = _publishedCreators(
        shown,
      ).where((item) => item.publicId == publicId).firstOrNull;
      if (target == null) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'creator not found',
        );
        return;
      }
      final page = _pageOf([
        for (final item in shown)
          if (item.creators.any((credit) => credit.publicId == publicId)) item,
      ], body.token);
      await _writeMessage(
        request,
        pb.GetPublishedCreatorDetailResponse(
          creator: target,
          series: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/GetPublishedLabelDetail')) {
      final body = recorded.decode(pb.GetPublishedLabelDetailRequest());
      final publicId = body.publicId;
      final shown = _seriesShownTo(body.surface);
      // A label is found among every series, shown or not, because the API
      // answers one with none of its series on this surface as well.
      final target = _publishedLabels(
        series,
      ).where((item) => item.publicId == publicId).firstOrNull;
      if (target == null) {
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'label not found',
        );
        return;
      }
      final credited = [
        for (final item in shown)
          if (item.hasLabel() && item.label.publicId == publicId) item,
      ];
      final page = _pageOf(credited, body.token);
      await _writeMessage(
        request,
        pb.GetPublishedLabelDetailResponse(
          label: target..publishedSeriesCount = credited.length,
          series: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }

    if (path.endsWith('/ListNotifications') ||
        path.endsWith('/CountUnreadNotifications') ||
        path.endsWith('/MarkNotificationAsRead') ||
        path.endsWith('/MarkAllNotificationsAsRead')) {
      await _writeNotification(request, recorded);
      return;
    }

    if (path.endsWith('/ListAnnouncements') ||
        path.endsWith('/GetAnnouncement') ||
        path.endsWith('/GetPinnedAnnouncement') ||
        path.endsWith('/MarkAnnouncementAsRead') ||
        path.endsWith('/MarkAllAnnouncementsAsRead')) {
      await _writeAnnouncement(request, recorded);
      return;
    }

    if (path.endsWith('/RegisterPushDevice')) {
      recorded.decode(pb.RegisterPushDeviceRequest());
      if (pushDeviceStatus != HttpStatus.ok) {
        await _writeUnavailable(request, pushDeviceStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.RegisterPushDeviceResponse(registered: true),
      );
      return;
    }

    if (path.endsWith('/UnregisterPushDevice')) {
      recorded.decode(pb.UnregisterPushDeviceRequest());
      if (pushDeviceStatus != HttpStatus.ok) {
        await _writeUnavailable(request, pushDeviceStatus);
        return;
      }
      await _writeMessage(
        request,
        pb.UnregisterPushDeviceResponse(unregistered: true),
      );
      return;
    }

    if (path.endsWith('/RecordContentView')) {
      recorded.decode(pb.RecordContentViewRequest());
      if (contentViewStatus != HttpStatus.ok) {
        await _writeUnavailable(request, contentViewStatus);
        return;
      }
      final identified =
          request.headers.value(HttpHeaders.authorizationHeader) != null ||
          request.cookies.any((cookie) => cookie.name == 'publira_aid');
      if (!identified) {
        request.response.headers.add(
          HttpHeaders.setCookieHeader,
          mintedAnonymousIdCookie,
        );
      }
      await _writeMessage(request, pb.RecordContentViewResponse());
      return;
    }

    if (path.endsWith('/GetMySeriesRating')) {
      final body = recorded.decode(pb.GetMySeriesRatingRequest());
      if (!await _writeUnlessAuthorized(request)) {
        return;
      }
      await _writeMessage(
        request,
        seriesRatings[publicIdOf(body.seriesId)] ??
            pb.GetMySeriesRatingResponse(),
      );
      return;
    }

    // Both rating RPCs answer with the reader's score, which is all a test
    // reads back from them unless it replaces the answer.
    if (path.endsWith('/RateEpisode')) {
      recorded.decode(pb.RateEpisodeRequest());
      if (rateEpisodeError case final error?) {
        await _writeJson(request, error.status, error.body);
        return;
      }
      await _writeMessage(
        request,
        pb.RateEpisodeResponse(score: 1, ratingCount: Int64.ONE),
      );
      return;
    }

    if (path.endsWith('/GetMyEpisodeRating')) {
      recorded.decode(pb.GetMyEpisodeRatingRequest());
      await _writeRaw(
        request,
        HttpStatus.ok,
        episodeRatingResponse ??
            pb.GetMyEpisodeRatingResponse(score: 1, ratingCount: Int64.ONE),
      );
      return;
    }

    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }

  /// The access `GetEpisodeDetail` would answer for each episode the series
  /// detail lists, for whoever the request is.
  Future<void> _writeSeriesEpisodeAccess(
    HttpRequest request,
    pb.GetSeriesEpisodeAccessRequest body,
  ) async {
    final seriesPublicId = publicIdOf(body.seriesId);
    final detail = _shows(body.surface, seriesPublicId)
        ? details[seriesPublicId]
        : null;
    if (detail == null) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'series not found',
      );
      return;
    }
    final authorized = _isAuthorized(request);
    pb.EpisodeAccess? accessOf(pb.GetEpisodeDetailResponse? episode) =>
        episode != null && episode.hasAccess() ? episode.access : null;
    await _writeMessage(
      request,
      pb.GetSeriesEpisodeAccessResponse(
        episodes: [
          for (final episode in detail.episodes)
            if (episode.hasPublicId())
              pb.SeriesEpisodeAccess(
                episodeId: internalIdOf(episode.publicId),
                episodePublicId: episode.publicId,
                access:
                    accessOf(
                      authorized ? entitledEpisodes[episode.publicId] : null,
                    ) ??
                    accessOf(episodes[episode.publicId]) ??
                    pb.EpisodeAccess.EPISODE_ACCESS_FREE,
              ),
        ],
      ),
    );
  }

  /// A checkout for the signed-in member, refused the way the API refuses
  /// one for an episode they already hold.
  Future<void> _writeCheckout(
    HttpRequest request,
    pb.StartEpisodeCheckoutRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final episodeId = publicIdOf(body.episodeId);
    if (episodes[episodeId] == null) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'episode not found',
      );
      return;
    }
    if (entitledEpisodes[episodeId]?.access ==
        pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED) {
      await _writeError(
        request,
        HttpStatus.conflict,
        'already_exists',
        'episode is already purchased',
      );
      return;
    }
    if (checkoutStatus != HttpStatus.ok) {
      await _writeError(
        request,
        checkoutStatus,
        'unavailable',
        'failed to start checkout',
      );
      return;
    }
    await _writeMessage(
      request,
      pb.StartEpisodeCheckoutResponse(
        checkoutUrl: checkoutUrlFor(episodeId).toString(),
      ),
    );
  }

  /// `GetMyTicketState` and `UseTicket` for the signed-in member. A ticket
  /// spent opens its episode with the pages [populatedEntitledEpisodes] gives
  /// the paid seed episode, and sets the next one [ticketState] answers a day
  /// away.
  Future<void> _writeWaitFree(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final use = recorded.path.endsWith('/UseTicket')
        ? recorded.decode(pb.UseTicketRequest())
        : null;
    if (use == null) {
      recorded.decode(pb.GetMyTicketStateRequest());
    }
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (waitFreeRefusal case final reason?) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        reason,
        details: [errorInfoDetail(reason)],
      );
      return;
    }
    if (use == null) {
      await _writeMessage(request, ticketState);
      return;
    }
    final episodeId = publicIdOf(use.episodeId);
    final episode = episodes[episodeId];
    if (episode == null) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'episode not found',
      );
      return;
    }
    if (entitledEpisodes[episodeId]?.access ==
        pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED) {
      await _writeError(
        request,
        HttpStatus.conflict,
        'already_exists',
        'episode is already open',
      );
      return;
    }
    final now = DateTime.now().toUtc();
    final ticket = pb.WaitFreeTicket(
      episodeId: internalIdOf(episodeId),
      expiresAt: now.add(ticketAccess).toIso8601String(),
    );
    final nextAvailableAt = now
        .add(const Duration(hours: 23))
        .toIso8601String();
    ticketsUsed.add(episodeId);
    entitledEpisodes = {
      ...entitledEpisodes,
      episodeId: episode.deepCopy()
        ..access = pb.EpisodeAccess.EPISODE_ACCESS_ENTITLED
        ..entitlementSource =
            pb.EpisodeEntitlementSource.EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET
        ..images.clear()
        ..images.addAll(populatedEntitledEpisodes()[paidEpisodeId]!.images),
    };
    ticketState = pb.GetMyTicketStateResponse(
      nextAvailableAt: nextAvailableAt,
      openTickets: [ticket],
    );
    await _writeMessage(
      request,
      pb.UseTicketResponse(ticket: ticket, nextAvailableAt: nextAvailableAt),
    );
  }

  /// An intent, or the confirmation of a transaction, for the signed-in
  /// member.
  Future<void> _writeStorePurchase(
    HttpRequest request, {
    required bool start,
  }) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final status = start ? storeStartStatus : storeConfirmStatus;
    if (status != HttpStatus.ok) {
      await _writeError(
        request,
        status,
        start ? storeStartErrorCode : storeConfirmErrorCode,
        'refused',
      );
      return;
    }
    await _writeMessage(
      request,
      start
          ? pb.StartStorePurchaseResponse(
              intentId: storeIntentId,
              productId: storeProductId,
            )
          : pb.ConfirmStorePurchaseResponse(purchase: pb.MyPurchase()),
    );
  }

  /// Whether [surface] may show the series [seriesPublicId].
  bool _shows(pb.ClientSurface surface, String seriesPublicId) {
    final app = surface == pb.ClientSurface.CLIENT_SURFACE_APP;
    return switch (seriesAvailability[seriesPublicId]) {
      pb.SurfaceAvailability.SURFACE_AVAILABILITY_WEB => !app,
      pb.SurfaceAvailability.SURFACE_AVAILABILITY_APP => app,
      _ => true,
    };
  }

  /// The genre or tag a `ListPublishedSeries` request narrows to when the
  /// tenant has no such one, which the API answers `not_found`; `null` when it
  /// narrows to nothing or to one that exists.
  String? _classifiedMissing(String genre, String tag) {
    if (genre.isNotEmpty && !genres.any((item) => item.publicId == genre)) {
      return 'genre';
    }
    if (tag.isNotEmpty &&
        !series.any((item) => item.tags.any((entry) => entry.slug == tag))) {
      return 'tag';
    }
    return null;
  }

  /// The series shown to [body], narrowed by the genre, tag, and status it
  /// names. The order and the free-to-start filter are left to the API.
  List<pb.Series> _classified(pb.ListPublishedSeriesRequest body) {
    final genre = body.genrePublicId;
    final tag = body.tagSlug;
    return [
      for (final item in _seriesShownTo(body.surface))
        if ((genre.isEmpty ||
                item.genres.any((entry) => entry.publicId == genre)) &&
            (tag.isEmpty || item.tags.any((entry) => entry.slug == tag)) &&
            (!body.hasStatus() ||
                (item.hasStatus() && item.status == body.status)))
          item,
    ];
  }

  /// The tags [series] carry, counted, most carried first and then by slug,
  /// the way `ListPublishedTags` orders them.
  List<pb.PublishedTag> _publishedTags(List<pb.Series> series) {
    final tags = <String, pb.PublishedTag>{};
    for (final item in series) {
      for (final tag in item.tags) {
        tags
            .putIfAbsent(
              tag.slug,
              () => pb.PublishedTag(
                name: tag.name,
                slug: tag.slug,
                publishedSeriesCount: 0,
              ),
            )
            .publishedSeriesCount++;
      }
    }
    return tags.values.toList()..sort((a, b) {
      final byCount = b.publishedSeriesCount.compareTo(a.publishedSeriesCount);
      return byCount != 0 ? byCount : a.slug.compareTo(b.slug);
    });
  }

  /// The [series] [surface] may show.
  List<pb.Series> _seriesShownTo(pb.ClientSurface surface) => [
    for (final item in series)
      if (_shows(surface, item.publicId)) item,
  ];

  /// The creators credited on [series], once each, followed by the rest of
  /// [seedCreators], which a follow row can still name with nothing
  /// published.
  List<pb.PublishedCreator> _publishedCreators(List<pb.Series> series) {
    final creators = <String, pb.PublishedCreator>{};
    final counted = <String>{};
    for (final item in series) {
      for (final credit in item.creators) {
        final creator = creators.putIfAbsent(
          credit.publicId,
          () => pb.PublishedCreator(
            publicId: credit.publicId,
            name: credit.name,
            profileText: credit.hasProfileText() ? credit.profileText : null,
            iconImageUrl: credit.hasIconImageUrl() ? credit.iconImageUrl : null,
            publishedSeriesCount: 0,
          ),
        );
        // Credited in two roles on one series is still one series.
        if (counted.add('${credit.publicId}/${item.publicId}')) {
          creator.publishedSeriesCount++;
        }
      }
    }
    for (final credit in seedCreators()) {
      creators.putIfAbsent(
        credit.publicId,
        () => pb.PublishedCreator(
          publicId: credit.publicId,
          name: credit.name,
          profileText: credit.profileText,
        ),
      );
    }
    return creators.values.toList();
  }

  /// The labels of [series], once each. A label is known here only through a
  /// series that carries it, so every one of them holds a published series.
  List<pb.PublishedLabel> _publishedLabels(List<pb.Series> series) {
    final labels = <String, pb.PublishedLabel>{};
    for (final item in series) {
      if (!item.hasLabel()) {
        continue;
      }
      final label = item.label;
      labels
          .putIfAbsent(
            label.publicId,
            () => pb.PublishedLabel(
              publicId: label.hasPublicId() ? label.publicId : null,
              name: label.hasName() ? label.name : null,
              eyeCatchImageUpdatedAt: label.hasEyeCatchImageUpdatedAt()
                  ? label.eyeCatchImageUpdatedAt
                  : null,
              eyeCatchImageVariants: label.eyeCatchImageVariants,
              publishedSeriesCount: 0,
            ),
          )
          .publishedSeriesCount++;
    }
    return labels.values.toList();
  }

  /// One page of the [items] whose name contains [query], the
  /// case-insensitive substring match the creator and label searches perform,
  /// in the name order they answer in.
  ({List<T> items, String? nextToken}) _namedPage<T>(
    Iterable<T> items,
    String Function(T item) name,
    String query,
    String token,
  ) {
    final keyword = query.trim().toLowerCase();
    final matches =
        items
            .where((item) => name(item).toLowerCase().contains(keyword))
            .toList()
          ..sort((left, right) => name(left).compareTo(name(right)));
    return _pageOf(matches, token);
  }

  /// One page of [items], [seriesPageSize] at a time, with the token the
  /// index of the page's first row written out.
  ({List<T> items, String? nextToken}) _pageOf<T>(
    List<T> items,
    String token,
  ) => _paged(items, seriesPageSize > 0 ? token : '', seriesPageSize);

  /// The page of [items] starting at the row [token] names, at most [size]
  /// rows long, or every row from there for a [size] of zero, with the token
  /// of the page under it when there is one.
  ///
  /// The wire format omits an empty string, so the last page carries no
  /// `nextToken`.
  static ({List<T> items, String? nextToken}) _paged<T>(
    List<T> items,
    String token,
    int size,
  ) {
    final start = min(token.isEmpty ? 0 : int.parse(token), items.length);
    final end = size <= 0 ? items.length : min(start + size, items.length);
    return (
      items: items.sublist(start, end),
      nextToken: end < items.length ? '$end' : null,
    );
  }

  /// One page of the series whose title or synopsis contains [query], the
  /// case-insensitive substring match `SearchPublishedSeries` performs, in the
  /// title order it answers them in.
  ({List<pb.Series> items, String? nextToken}) _searchPage(
    List<pb.Series> series,
    String query,
    String token,
  ) {
    final keyword = query.trim().toLowerCase();
    final matches = series.where((item) {
      return item.title.toLowerCase().contains(keyword) ||
          item.synopsis.toLowerCase().contains(keyword);
    }).toList()..sort((left, right) => left.title.compareTo(right.title));
    return _pageOf(matches, token);
  }

  /// Answers the reader-facing comment RPCs of one episode.
  ///
  /// Everything but the public list needs the member's session, the way the
  /// API refuses one without it.
  Future<void> _writeComment(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final path = recorded.path;
    final list = path.endsWith('/ListEpisodeComments')
        ? recorded.decode(pb.ListEpisodeCommentsRequest())
        : null;
    final listMine = path.endsWith('/ListMyEpisodeComments')
        ? recorded.decode(pb.ListMyEpisodeCommentsRequest())
        : null;
    final post = path.endsWith('/PostEpisodeComment')
        ? recorded.decode(pb.PostEpisodeCommentRequest())
        : null;
    if (path.endsWith('/WithdrawEpisodeComment')) {
      recorded.decode(pb.WithdrawEpisodeCommentRequest());
    }
    if (path.endsWith('/ReportEpisodeComment')) {
      recorded.decode(pb.ReportEpisodeCommentRequest());
    }
    if (commentStatus != HttpStatus.ok) {
      await _writeUnavailable(request, commentStatus);
      return;
    }
    if (list != null) {
      // The wire format omits an empty repeated field, which is what an episode
      // nobody has commented on is answered with.
      await _writeMessage(
        request,
        pb.ListEpisodeCommentsResponse(
          comments: episodeComments[publicIdOf(list.episodeId)],
        ),
      );
      return;
    }

    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (listMine != null) {
      await _writeMessage(
        request,
        pb.ListMyEpisodeCommentsResponse(
          comments: myEpisodeComments[publicIdOf(listMine.episodeId)],
        ),
      );
      return;
    }
    if (post != null) {
      final episodeId = publicIdOf(post.episodeId);
      // The API refuses a body the reader has just posted on the same episode;
      // a body already among their own comments here stands in for one still
      // inside the duplicate comment window.
      final repeated = (myEpisodeComments[episodeId] ?? const []).any(
        (comment) => comment.body == post.body,
      );
      if (repeated) {
        await _writeError(
          request,
          HttpStatus.conflict,
          'already_exists',
          'the same comment was posted a moment ago',
        );
        return;
      }
      final comment = pb.MyEpisodeComment(
        publicId: 'SeedCMNT${(myEpisodeComments[episodeId]?.length ?? 0) + 1}',
        body: post.body,
        createdAt: DateTime.now().toUtc().toIso8601String(),
        awaitingApproval:
            commentMode == pb.CommentMode.COMMENT_MODE_APPROVAL_REQUIRED
            ? true
            : null,
      );
      myEpisodeComments = {
        ...myEpisodeComments,
        episodeId: [comment, ...?myEpisodeComments[episodeId]],
      };
      await _writeMessage(
        request,
        pb.PostEpisodeCommentResponse(comment: comment),
      );
      return;
    }
    // Withdrawing and reporting are both deliberately empty answers.
    await _writeMessage(
      request,
      path.endsWith('/WithdrawEpisodeComment')
          ? pb.WithdrawEpisodeCommentResponse()
          : pb.ReportEpisodeCommentResponse(),
    );
  }

  /// Answers the follow RPCs of one member, every one of which needs their
  /// session the way the API refuses one without it.
  Future<void> _writeFollow(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final path = recorded.path;
    final updates = path.endsWith('/ListMyFollowUpdates')
        ? recorded.decode(pb.ListMyFollowUpdatesRequest())
        : null;
    final follows = path.endsWith('/ListMyFollows')
        ? recorded.decode(pb.ListMyFollowsRequest())
        : null;
    final target = switch (path) {
      _ when path.endsWith('/Follow') =>
        recorded.decode(pb.FollowRequest()).target,
      _ when path.endsWith('/Unfollow') =>
        recorded.decode(pb.UnfollowRequest()).target,
      _ when path.endsWith('/GetMyFollowStatus') =>
        recorded.decode(pb.GetMyFollowStatusRequest()).target,
      _ => null,
    };
    if (followStatus != HttpStatus.ok) {
      await _writeUnavailable(request, followStatus);
      return;
    }
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (updates != null) {
      final page = _paged(followUpdates, updates.token, updates.limit);
      // The wire format omits an empty repeated field.
      await _writeMessage(
        request,
        pb.ListMyFollowUpdatesResponse(
          updates: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    if (follows != null) {
      // The wire format omits an empty repeated field, which is how a reader
      // who follows nothing is answered.
      final page = _paged(
        myFollows,
        followsPageSize > 0 ? follows.token : '',
        followsPageSize,
      );
      await _writeMessage(
        request,
        pb.ListMyFollowsResponse(
          follows: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    if (target == null) {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }

    final targetType = target.type;
    final targetPublicId = publicIdOf(target.id);
    bool isTarget(pb.MyFollow follow) =>
        follow.targetType == targetType &&
        follow.targetPublicId == targetPublicId;
    if (path.endsWith('/Follow')) {
      if (!myFollows.any(isTarget)) {
        myFollows = [
          pb.MyFollow(
            targetType: targetType,
            targetPublicId: targetPublicId,
            followedAt: DateTime.now().toUtc().toIso8601String(),
          ),
          ...myFollows,
        ];
      }
      await _writeMessage(request, pb.FollowResponse(isFollowing: true));
      return;
    }
    if (path.endsWith('/Unfollow')) {
      myFollows = myFollows.where((follow) => !isTarget(follow)).toList();
      // The wire format omits a false, which is what every Unfollow answers
      // with.
      await _writeMessage(request, pb.UnfollowResponse());
      return;
    }
    await _writeMessage(
      request,
      pb.GetMyFollowStatusResponse(
        isFollowing: myFollows.any(isTarget) ? true : null,
      ),
    );
  }

  /// Answers the inbox RPCs of one member, every one of which needs their
  /// session the way the API refuses one without it.
  Future<void> _writeNotification(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final path = recorded.path;
    final list = path.endsWith('/ListNotifications')
        ? recorded.decode(pb.ListNotificationsRequest())
        : null;
    final mark = path.endsWith('/MarkNotificationAsRead')
        ? recorded.decode(pb.MarkNotificationAsReadRequest())
        : null;
    if (path.endsWith('/CountUnreadNotifications')) {
      recorded.decode(pb.CountUnreadNotificationsRequest());
    }
    if (path.endsWith('/MarkAllNotificationsAsRead')) {
      recorded.decode(pb.MarkAllNotificationsAsReadRequest());
    }
    if (notificationStatus != HttpStatus.ok) {
      await _writeUnavailable(request, notificationStatus);
      return;
    }
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (list != null) {
      final page = _paged(
        notifications,
        notificationsPageSize > 0 ? list.token : '',
        notificationsPageSize,
      );
      await _writeMessage(
        request,
        pb.ListNotificationsResponse(
          notifications: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    final unread = notifications.where((item) => !item.isRead);
    if (path.endsWith('/CountUnreadNotifications')) {
      // The wire format omits a zero.
      await _writeMessage(
        request,
        pb.CountUnreadNotificationsResponse(
          unreadCount: unread.isNotEmpty ? unread.length : null,
        ),
      );
      return;
    }
    pb.NotificationItem read(pb.NotificationItem item) => item.deepCopy()
      ..isRead = true
      ..readAt = DateTime.now().toUtc().toIso8601String();
    if (mark == null) {
      final marked = unread.length;
      notifications = [
        for (final item in notifications) item.isRead ? item : read(item),
      ];
      await _writeMessage(
        request,
        pb.MarkAllNotificationsAsReadResponse(
          markedCount: marked > 0 ? marked : null,
        ),
      );
      return;
    }
    final id = mark.notificationId;
    if (!notifications.any((item) => item.id == id)) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'notification not found',
      );
      return;
    }
    notifications = [
      for (final item in notifications)
        item.id == id && !item.isRead ? read(item) : item,
    ];
    await _writeMessage(
      request,
      pb.MarkNotificationAsReadResponse(marked: true),
    );
  }

  /// Answers the announcement RPCs. The reads take any caller and answer read
  /// state only to the member's session; the marks need that session.
  Future<void> _writeAnnouncement(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final path = recorded.path;
    final list = path.endsWith('/ListAnnouncements')
        ? recorded.decode(pb.ListAnnouncementsRequest())
        : null;
    final get = path.endsWith('/GetAnnouncement')
        ? recorded.decode(pb.GetAnnouncementRequest())
        : null;
    final mark = path.endsWith('/MarkAnnouncementAsRead')
        ? recorded.decode(pb.MarkAnnouncementAsReadRequest())
        : null;
    if (path.endsWith('/GetPinnedAnnouncement')) {
      recorded.decode(pb.GetPinnedAnnouncementRequest());
    }
    if (path.endsWith('/MarkAllAnnouncementsAsRead')) {
      recorded.decode(pb.MarkAllAnnouncementsAsReadRequest());
    }
    if (announcementStatus != HttpStatus.ok) {
      await _writeUnavailable(request, announcementStatus);
      return;
    }
    final member = _isAuthorized(request);
    // A token the API rejects is answered as a visitor, the way the API does.
    pb.AnnouncementItem shown(pb.AnnouncementItem item) => member
        ? item
        : (item.deepCopy()
            ..clearIsRead()
            ..clearReadAt());
    if (list != null) {
      final page = _paged(
        [for (final item in announcements) shown(item)],
        announcementsPageSize > 0 ? list.token : '',
        announcementsPageSize,
      );
      await _writeMessage(
        request,
        pb.ListAnnouncementsResponse(
          announcements: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    if (path.endsWith('/GetPinnedAnnouncement')) {
      final pinned = announcements.where(
        (item) => item.id == pinnedAnnouncementId,
      );
      await _writeMessage(
        request,
        pb.GetPinnedAnnouncementResponse(
          announcement: pinned.isNotEmpty ? shown(pinned.first) : null,
        ),
      );
      return;
    }
    if (get != null) {
      final found = announcements.where(
        (item) => item.id == get.announcementId,
      );
      if (found.isEmpty) {
        await _writeAnnouncementNotFound(request);
        return;
      }
      await _writeMessage(
        request,
        pb.GetAnnouncementResponse(announcement: shown(found.first)),
      );
      return;
    }
    if (!member) {
      await _writeUnauthenticated(request);
      return;
    }
    pb.AnnouncementItem read(pb.AnnouncementItem item) => item.isRead
        ? item
        : (item.deepCopy()
            ..isRead = true
            ..readAt = DateTime.now().toUtc().toIso8601String());
    if (mark == null) {
      final count = announcements.where((item) => !item.isRead).length;
      announcements = [for (final item in announcements) read(item)];
      await _writeMessage(
        request,
        pb.MarkAllAnnouncementsAsReadResponse(
          markedCount: count > 0 ? count : null,
        ),
      );
      return;
    }
    final id = mark.announcementId;
    if (!announcements.any((item) => item.id == id)) {
      await _writeAnnouncementNotFound(request);
      return;
    }
    announcements = [
      for (final item in announcements) item.id == id ? read(item) : item,
    ];
    await _writeMessage(
      request,
      pb.MarkAnnouncementAsReadResponse(marked: true),
    );
  }

  Future<void> _writeAnnouncementNotFound(HttpRequest request) => _writeError(
    request,
    HttpStatus.notFound,
    'not_found',
    'announcement not found',
  );

  /// Answers the reading-position, finished-episode, and continue-reading RPCs
  /// of one member.
  Future<void> _writeEpisodeRead(
    HttpRequest request,
    RecordedRequest recorded,
  ) async {
    final path = recorded.path;
    final recent = path.endsWith('/ListMyRecentSeries')
        ? recorded.decode(pb.ListMyRecentSeriesRequest())
        : null;
    final progress = path.endsWith('/GetMySeriesProgress')
        ? recorded.decode(pb.GetMySeriesProgressRequest())
        : null;
    final reads = path.endsWith('/ListMyEpisodeReads')
        ? recorded.decode(pb.ListMyEpisodeReadsRequest())
        : null;
    final markRead = path.endsWith('/MarkEpisodeAsRead')
        ? recorded.decode(pb.MarkEpisodeAsReadRequest())
        : null;
    final save = path.endsWith('/SaveReadingPosition')
        ? recorded.decode(pb.SaveReadingPositionRequest())
        : null;
    final position = path.endsWith('/GetMyReadingPosition')
        ? recorded.decode(pb.GetMyReadingPositionRequest())
        : null;
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (recent != null) {
      final page = _paged(recentSeries, recent.token, recent.limit);
      await _writeMessage(
        request,
        pb.ListMyRecentSeriesResponse(
          series: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    if (progress != null) {
      final seriesId = publicIdOf(progress.seriesId);
      final finished = [
        for (final episode
            in details[seriesId]?.episodes ?? const <pb.Episode>[])
          if (episode.hasPublicId() &&
              episodeReads.containsKey(episode.publicId))
            episode.publicId,
      ];
      // The wire format omits an unset message and an empty repeated field.
      await _writeMessage(
        request,
        pb.GetMySeriesProgressResponse(
          progress: seriesProgress[seriesId],
          finishedEpisodePublicIds: finished,
        ),
      );
      return;
    }
    if (reads != null) {
      final page = _paged(episodeReadHistory, reads.token, reads.limit);
      // The wire format omits an empty repeated field.
      await _writeMessage(
        request,
        pb.ListMyEpisodeReadsResponse(
          reads: page.items,
          nextToken: page.nextToken,
        ),
      );
      return;
    }
    if (markRead != null) {
      final errorCode = markReadErrorCode;
      if (errorCode != null) {
        await _writeError(request, HttpStatus.badRequest, errorCode, errorCode);
        return;
      }
      final readAt = episodeReads.putIfAbsent(
        publicIdOf(markRead.episodeId),
        () => DateTime.now().toUtc().toIso8601String(),
      );
      await _writeMessage(
        request,
        pb.MarkEpisodeAsReadResponse(readAt: readAt),
      );
      return;
    }
    if (save != null) {
      final episodeId = publicIdOf(save.episodeId);
      readingPositions = {...readingPositions, episodeId: save.pageIndex};
      await _writeMessage(
        request,
        pb.SaveReadingPositionResponse(
          position: _readingPosition(episodeId, save.pageIndex),
        ),
      );
      return;
    }
    final episodeId = publicIdOf(position?.episodeId);
    final pageIndex = readingPositions[episodeId];
    // The wire format omits an unset message, which is what a member who never
    // opened the episode is answered with.
    await _writeMessage(
      request,
      pb.GetMyReadingPositionResponse(
        position: pageIndex == null
            ? null
            : _readingPosition(episodeId, pageIndex),
      ),
    );
  }

  pb.ReadingPosition _readingPosition(String episodeId, int pageIndex) {
    return pb.ReadingPosition(
      episodePublicId: episodeId,
      pageIndex: pageIndex,
      pageCount: seedEpisodePageCount,
      updatedAt: DateTime.now().toUtc().toIso8601String(),
    );
  }

  Map<String, String> _snapshotHeaders(HttpHeaders headers) {
    final snapshot = <String, String>{};
    headers.forEach((name, values) {
      snapshot[name.toLowerCase()] = values.join(', ');
    });
    return snapshot;
  }

  Future<Uint8List> _readBody(HttpRequest request) async {
    final builder = BytesBuilder(copy: false);
    await request.forEach(builder.add);
    return builder.takeBytes();
  }

  /// `Login` for the seed member and for an account a test signed up here.
  ///
  /// An account whose address is still unconfirmed is refused the way the API
  /// refuses one, with `failed_precondition` rather than `unauthenticated`,
  /// because that is what tells the reader to open their mail rather than to
  /// check their password.
  Future<void> _writeLogin(HttpRequest request, pb.LoginRequest body) async {
    final email = body.email.trim();
    final password = body.password.trim();
    if (!memberDeleted &&
        email == memberEmail &&
        password == memberCurrentPassword) {
      await _writeMessage(
        request,
        pb.LoginResponse(
          user: pb.User(
            publicId: memberPublicId,
            name: memberCurrentName,
            role: 'member',
          ),
          accessToken: _accessToken(memberAccessToken),
        ),
      );
      return;
    }
    final signup = signups[email];
    if (signup == null || signup.password != password) {
      await _writeError(
        request,
        HttpStatus.unauthorized,
        'unauthenticated',
        'invalid credentials',
      );
      return;
    }
    if (!signup.verified) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'email address is not verified',
      );
      return;
    }
    _signedUpSession = (email: email, signup: signup);
    await _writeMessage(
      request,
      pb.LoginResponse(
        user: pb.User(
          publicId: signedUpPublicId,
          name: signup.name,
          role: 'member',
        ),
        accessToken: _accessToken(signedUpAccessToken),
      ),
    );
  }

  /// Whether the tenant signs readers in with [provider].
  bool _signsInWith(pb.IdentityProvider provider) => switch (provider) {
    pb.IdentityProvider.IDENTITY_PROVIDER_APPLE => appleSignIn != null,
    pb.IdentityProvider.IDENTITY_PROVIDER_GOOGLE => googleSignIn != null,
    _ => false,
  };

  /// `LoginWithIdToken` as the API answers it: a token linked to the member,
  /// or carrying the member's address, signs the member in; any other opens
  /// the account [signedUpAccessToken] stands for, once the consent the
  /// tenant's pages ask for comes with it.
  Future<void> _writeLoginWithIdToken(
    HttpRequest request,
    pb.LoginWithIdTokenRequest body,
  ) async {
    final provider = body.provider;
    final nonce = body.nonce.trim();
    final token = idTokens[body.idToken.trim()];
    if (token == null ||
        token.provider != provider ||
        token.nonce != nonce ||
        spentNonces.contains(nonce)) {
      await _writeError(
        request,
        HttpStatus.unauthorized,
        'unauthenticated',
        'invalid ID token',
      );
      return;
    }
    if (!_signsInWith(provider)) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'the tenant does not sign readers in with this provider',
      );
      return;
    }
    final linked = memberIdentities[provider];
    final isMember =
        !memberDeleted &&
        (linked?.subject == token.subject ||
            (linked == null && token.email == memberEmail));
    if (isMember) {
      memberIdentities[provider] = token;
      spentNonces.add(nonce);
      await _writeMessage(
        request,
        pb.LoginWithIdTokenResponse(
          user: pb.User(
            publicId: memberPublicId,
            name: memberCurrentName,
            role: 'member',
            iconImageVariants: _memberIcon,
            iconPresetId: memberIconPresetId,
          ),
          accessToken: _accessToken(memberAccessToken),
        ),
      );
      return;
    }
    final agreed = body.agreedPageVersionIds.toList();
    if ((termsPage != null || privacyPage != null) && agreed.isEmpty) {
      // Refused before the nonce is spent, so the same token comes again.
      await _writeError(
        request,
        HttpStatus.badRequest,
        'invalid_argument',
        'agreed_page_version_ids is required',
        details: [badRequestDetail('agreed_page_version_ids')],
      );
      return;
    }
    spentNonces.add(nonce);
    final name = body.name.trim();
    final signup = FixtureSignup(
      name: name.isEmpty ? token.email.split('@').first : name,
      password: '',
      birthDate: body.birthDate.trim(),
      agreedPageVersionIds: agreed,
    )..verified = true;
    signups[token.email] = signup;
    _signedUpSession = (email: token.email, signup: signup);
    await _writeMessage(
      request,
      pb.LoginWithIdTokenResponse(
        user: pb.User(
          publicId: signedUpPublicId,
          name: signup.name,
          role: 'member',
        ),
        accessToken: _accessToken(signedUpAccessToken),
        accountCreated: true,
      ),
    );
  }

  /// `LinkIdentity` as the API answers it, in the API's order: a token it
  /// cannot verify, and a nonce already spent, are `invalid_argument` on the
  /// field at fault rather than `unauthenticated`, which would read as an
  /// ended session; a provider account another reader signs in with, and a
  /// provider the member already has an account of, are refused with the
  /// ErrorInfo reason that says which.
  Future<void> _writeLinkIdentity(
    HttpRequest request,
    pb.LinkIdentityRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final provider = body.provider;
    final nonce = body.nonce.trim();
    final token = idTokens[body.idToken.trim()];
    if (token == null || token.provider != provider || token.nonce != nonce) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'invalid_argument',
        'invalid ID token',
        details: [badRequestDetail('id_token')],
      );
      return;
    }
    if (!_signsInWith(provider)) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'the tenant does not sign readers in with this provider',
      );
      return;
    }
    if (otherReaderSubjects.contains(token.subject)) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'the provider account signs in to another account',
        details: [errorInfoDetail('IDENTITY_LINKED_TO_ANOTHER_ACCOUNT')],
      );
      return;
    }
    if (memberIdentities.containsKey(provider)) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'the account already has an account of this provider',
        details: [errorInfoDetail('PROVIDER_ALREADY_LINKED')],
      );
      return;
    }
    if (spentNonces.contains(nonce)) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'invalid_argument',
        'the nonce has been used',
        details: [badRequestDetail('nonce')],
      );
      return;
    }
    spentNonces.add(nonce);
    memberIdentities[provider] = token;
    await _writeMessage(
      request,
      pb.LinkIdentityResponse(
        identity: pb.LinkedIdentity(
          provider: provider,
          email: token.email,
          linkedAt: '2026-01-02T03:04:05Z',
        ),
      ),
    );
  }

  /// A `google.rpc.ErrorInfo` detail naming [reason] under [domain], encoded
  /// the way connect-go puts it in an error body: the message in protobuf
  /// binary, base64 without padding.
  static Map<String, Object?> errorInfoDetail(
    String reason, {
    String domain = 'publira',
  }) {
    final reasonBytes = utf8.encode(reason);
    final domainBytes = utf8.encode(domain);
    final message = [
      0x0a,
      reasonBytes.length,
      ...reasonBytes,
      0x12,
      domainBytes.length,
      ...domainBytes,
    ];
    return {
      'type': 'google.rpc.ErrorInfo',
      'value': base64.encode(message).replaceAll('=', ''),
    };
  }

  /// A Connect `google.rpc.BadRequest` detail naming [field], as connect-go
  /// writes one: the message in protobuf binary, base64 without padding.
  static Map<String, Object?> badRequestDetail(String field) {
    final name = utf8.encode(field);
    final violation = [0x0a, name.length, ...name];
    final message = [0x0a, violation.length, ...violation];
    return {
      'type': 'google.rpc.BadRequest',
      'value': base64.encode(message).replaceAll('=', ''),
    };
  }

  /// `CreateUser` as the API answers it: an address that is already taken is
  /// accepted exactly like a free one, so nothing here says which it was.
  Future<void> _writeCreateUser(
    HttpRequest request,
    pb.CreateUserRequest body,
  ) async {
    if (signupStatus != HttpStatus.ok) {
      await _writeError(
        request,
        signupStatus,
        signupErrorCode,
        signupErrorCode,
      );
      return;
    }
    signups.putIfAbsent(
      body.email.trim(),
      () => FixtureSignup(
        name: body.name.trim(),
        password: body.password.trim(),
        birthDate: body.birthDate.trim(),
        agreedPageVersionIds: body.agreedPageVersionIds.toList(),
      ),
    );
    await _writeMessage(request, pb.CreateUserResponse(accepted: true));
  }

  /// `VerifyUserEmail` for the one token [verificationToken] a sign-up here
  /// is confirmed with. Everything else is the dead end the API answers with:
  /// an expired link on [expiredVerificationToken], and a token it never
  /// issued on anything else.
  Future<void> _writeVerifyUserEmail(
    HttpRequest request,
    pb.VerifyUserEmailRequest body,
  ) async {
    final token = body.token.trim();
    if (token == expiredVerificationToken) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'verification token expired',
      );
      return;
    }
    if (token != verificationToken || signups.isEmpty) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'verification token not found',
      );
      return;
    }
    for (final signup in signups.values) {
      signup.verified = true;
    }
    await _writeMessage(request, pb.VerifyUserEmailResponse(verified: true));
  }

  /// `ConfirmPasswordReset` for the member's [passwordResetToken]. Everything
  /// else is the dead end the API answers with: an expired link on
  /// [expiredPasswordResetToken], and a token it never issued on anything
  /// else.
  Future<void> _writeConfirmPasswordReset(
    HttpRequest request,
    pb.ConfirmPasswordResetRequest body,
  ) async {
    final token = body.token.trim();
    final newPassword = body.newPassword.trim();
    if (token.isEmpty || newPassword.isEmpty) {
      await _writeInvalidArgument(
        request,
        'token and new_password are required',
      );
      return;
    }
    if (token == expiredPasswordResetToken) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'password reset token expired',
      );
      return;
    }
    if (token != passwordResetToken) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'password reset token not found',
      );
      return;
    }
    memberCurrentPassword = newPassword;
    await _writeMessage(
      request,
      pb.ConfirmPasswordResetResponse(confirmed: true),
    );
  }

  pb.AccessToken _accessToken(String token) => pb.AccessToken(
    token: token,
    expiresAt: DateTime.now()
        .toUtc()
        .add(const Duration(hours: 24))
        .toIso8601String(),
  );

  /// The member's own account as `UpdateMe`, `UploadMyIcon`, and
  /// `DeleteMyIcon` answer it.
  pb.User _memberUser() => pb.User(
    publicId: memberPublicId,
    name: memberCurrentName,
    role: 'member',
    birthDate: memberBirthDate.isNotEmpty ? memberBirthDate : null,
    iconImageVariants: _memberIcon,
    iconPresetId: memberIconPresetId,
  );

  /// `UpdateMe` as the API applies a birth date: once, and only as a calendar
  /// date the tenant has reached and no more than 130 years back.
  Future<void> _writeUpdateMe(
    HttpRequest request,
    pb.UpdateMeRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final name = body.name.trim();
    if (name.isEmpty || name.runes.length > 100) {
      await _writeInvalidArgument(request, 'name is required');
      return;
    }
    final birthDate = body.birthDate;
    // A date is sent beside the name the account already holds, so a form
    // recording one that sent any other name has lost track of the account.
    if (birthDate.isNotEmpty && name != memberCurrentName) {
      await _writeInvalidArgument(
        request,
        'unexpected name beside a birth date',
      );
      return;
    }
    if (birthDate.isNotEmpty) {
      if (memberBirthDate.isNotEmpty) {
        await _writeError(
          request,
          HttpStatus.badRequest,
          'failed_precondition',
          'birth date is already set',
        );
        return;
      }
      final born = parseBirthDate(birthDate);
      final today = calendarDayIn(tenantTimeZone, DateTime.now())!;
      if (born == null || born.isAfter(today) || ageOn(born, today) > 130) {
        await _writeInvalidArgument(request, 'invalid birth date');
        return;
      }
      memberBirthDate = birthDate;
    }
    memberCurrentName = name;
    await _writeMessage(request, pb.UpdateMeResponse(user: _memberUser()));
  }

  /// `UploadMyIcon` and `DeleteMyIcon` as the API answers them: an upload has
  /// to be an `image/*` with bytes in it, and is stored under a new path each
  /// time, since the API never stores a replaced icon over the old one. A
  /// `null` [upload] is `DeleteMyIcon`.
  Future<void> _writeChangeMyIcon(
    HttpRequest request,
    pb.UploadMyIconRequest? upload,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (upload != null) {
      final bytes = upload.iconData.toList();
      final contentType = upload.iconContentType.trim();
      if (bytes.isEmpty || !contentType.startsWith('image/')) {
        await _writeError(
          request,
          HttpStatus.badRequest,
          'invalid_argument',
          'invalid icon image',
          details: [badRequestDetail('icon_data')],
        );
        return;
      }
      if (readerIconPolicy != pb.ReaderIconPolicy.READER_ICON_POLICY_UPLOAD) {
        await _writeIconNotAllowed(request);
        return;
      }
      if (!iconStorageConfigured) {
        await _writeError(
          request,
          HttpStatus.badRequest,
          'failed_precondition',
          'storage is not configured',
          details: [errorInfoDetail('STORAGE_NOT_CONFIGURED')],
        );
        return;
      }
      iconUploads.add((bytes: bytes, contentType: contentType));
      memberIconPresetId = null;
      memberIconPath =
          '/images/users/0190a0c0-0000-7000-8000-${iconUploads.length.toString().padLeft(12, '0')}';
      await _writeMessage(
        request,
        pb.UploadMyIconResponse(user: _memberUser()),
      );
      return;
    }
    iconRemovals++;
    memberIconPath = null;
    memberIconPresetId = null;
    await _writeMessage(request, pb.DeleteMyIconResponse(user: _memberUser()));
  }

  /// `SelectMyIcon` as the API answers it: only under the preset policy, and
  /// only for a preset the tenant holds, whose renditions the account then
  /// carries.
  Future<void> _writeSelectMyIcon(
    HttpRequest request,
    pb.SelectMyIconRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (readerIconPolicy != pb.ReaderIconPolicy.READER_ICON_POLICY_PRESET) {
      await _writeIconNotAllowed(request);
      return;
    }
    final presetId = body.presetId.trim();
    final preset = readerIconPresets
        .where((preset) => preset.id == presetId)
        .firstOrNull;
    if (preset == null) {
      await _writeError(
        request,
        HttpStatus.notFound,
        'not_found',
        'reader icon preset not found',
      );
      return;
    }
    iconSelections.add(presetId);
    memberIconPath = preset.variants.first.url;
    memberIconPresetId = presetId;
    await _writeMessage(request, pb.SelectMyIconResponse(user: _memberUser()));
  }

  /// The refusal of an icon change the tenant's reader icon policy does not
  /// allow.
  Future<void> _writeIconNotAllowed(HttpRequest request) => _writeError(
    request,
    HttpStatus.badRequest,
    'failed_precondition',
    'reader icon policy does not allow this change',
    details: [errorInfoDetail('READER_ICON_NOT_ALLOWED')],
  );

  /// `ChangePassword` as the API answers it: the current password has to be
  /// the member's, the new one has to differ, and the token the request came
  /// with is replaced by the one handed back.
  Future<void> _writeChangePassword(
    HttpRequest request,
    pb.ChangePasswordRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final current = body.currentPassword.trim();
    final next = body.newPassword.trim();
    if (current != memberCurrentPassword || next.isEmpty || next == current) {
      await _writeInvalidArgument(request, 'invalid password change');
      return;
    }
    memberCurrentPassword = next;
    activeAccessToken = changedPasswordAccessToken;
    await _writeMessage(
      request,
      pb.ChangePasswordResponse(
        accessToken: _accessToken(changedPasswordAccessToken),
      ),
    );
  }

  /// `RequestEmailChange` as the API answers it: the current address has to
  /// be the member's and confirmed with their password or a fresh sign-in to
  /// a linked provider, and an address another account holds is refused as
  /// `already_exists`.
  Future<void> _writeRequestEmailChange(
    HttpRequest request,
    pb.RequestEmailChangeRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    final current = body.currentEmail.trim();
    final next = body.newEmail.trim();
    if (current != memberEmail || next.isEmpty || next == current) {
      await _writeInvalidArgument(request, 'invalid email change');
      return;
    }
    if (body.hasProvider()) {
      final confirmed = await _writeUnlessConfirmedWithIdentity(
        request,
        provider: body.provider,
        idToken: body.idToken,
        nonce: body.nonce,
      );
      if (!confirmed) {
        return;
      }
    } else if (body.currentPassword.trim() != memberCurrentPassword) {
      await _writeInvalidArgument(request, 'invalid email change');
      return;
    }
    if (next == takenEmail) {
      await _writeError(
        request,
        HttpStatus.conflict,
        'already_exists',
        'email already exists',
      );
      return;
    }
    requestedEmailChanges.add(next);
    await _writeMessage(
      request,
      pb.RequestEmailChangeResponse(requested: true),
    );
  }

  /// `ConfirmEmailChange` for the tokens this fixture names, which needs no
  /// session the way the API needs none.
  Future<void> _writeConfirmEmailChange(
    HttpRequest request,
    pb.ConfirmEmailChangeRequest body,
  ) async {
    switch (body.token.trim()) {
      case emailChangeToken:
        await _writeMessage(
          request,
          pb.ConfirmEmailChangeResponse(confirmed: true, changed: true),
        );
      case pendingEmailChangeToken:
        // The wire format omits `changed` while it is false.
        await _writeMessage(
          request,
          pb.ConfirmEmailChangeResponse(
            confirmed: true,
            pendingConfirmationFor: 'current_email',
          ),
        );
      case conflictingEmailChangeToken:
        await _writeError(
          request,
          HttpStatus.conflict,
          'already_exists',
          'email already exists',
        );
      case expiredEmailChangeToken:
        await _writeError(
          request,
          HttpStatus.badRequest,
          'failed_precondition',
          'email change token expired',
        );
      default:
        await _writeError(
          request,
          HttpStatus.notFound,
          'not_found',
          'email change token not found',
        );
    }
  }

  /// `DeleteMe` as the API answers it: the password has to be the member's,
  /// the tenant's last active tenant admin is refused, and the account is
  /// then gone along with every token it held.
  Future<void> _writeDeleteMe(
    HttpRequest request,
    pb.DeleteMeRequest body,
  ) async {
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (body.hasProvider()) {
      final confirmed = await _writeUnlessConfirmedWithIdentity(
        request,
        provider: body.provider,
        idToken: body.idToken,
        nonce: body.nonce,
      );
      if (!confirmed) {
        return;
      }
    } else if (body.password.trim() != memberCurrentPassword) {
      await _writeInvalidArgument(request, 'invalid password');
      return;
    }
    if (memberIsLastTenantAdmin) {
      await _writeError(
        request,
        HttpStatus.badRequest,
        'failed_precondition',
        'the last tenant admin cannot be deleted',
        details: [errorInfoDetail('LAST_TENANT_ADMIN')],
      );
      return;
    }
    memberDeleted = true;
    activeAccessToken = null;
    await _writeMessage(request, pb.DeleteMeResponse());
  }

  /// Checks the fresh sign-in an account without a password confirms a step
  /// with, as the API does: `unauthenticated` for an ID token no provider
  /// issued, the same answer as for a rejected session, and
  /// `invalid_argument` for a token of an account not linked to the member.
  /// Reports whether the request may go on.
  Future<bool> _writeUnlessConfirmedWithIdentity(
    HttpRequest request, {
    required pb.IdentityProvider provider,
    required String idToken,
    required String nonce,
  }) async {
    final token = idTokens[idToken.trim()];
    if (token == null || token.nonce != nonce.trim()) {
      await _writeError(
        request,
        HttpStatus.unauthorized,
        'unauthenticated',
        'invalid ID token',
      );
      return false;
    }
    final linked = memberIdentities[provider];
    if (linked == null || token.subject != linked.subject) {
      await _writeInvalidArgument(request, 'the ID token is not the account');
      return false;
    }
    return true;
  }

  /// Answers `unauthenticated` for a request without the active token, and
  /// reports whether the request may go on.
  Future<bool> _writeUnlessAuthorized(HttpRequest request) async {
    if (_isAuthorized(request)) {
      return true;
    }
    await _writeUnauthenticated(request);
    return false;
  }

  Future<void> _writeUnauthenticated(HttpRequest request) => _writeError(
    request,
    HttpStatus.unauthorized,
    'unauthenticated',
    'invalid token',
  );

  Future<void> _writeInvalidArgument(HttpRequest request, String message) =>
      _writeError(request, HttpStatus.badRequest, 'invalid_argument', message);

  /// Answers [status] as the API answers a dependency it cannot reach.
  Future<void> _writeUnavailable(HttpRequest request, int status) =>
      _writeError(request, status, 'unavailable', 'unavailable');

  /// Answers both legal page agreement RPCs with the pages the member owes
  /// afterwards, the way the API does. An agreement to a version the member
  /// is not asked about is refused as the API refuses one the tenant does
  /// not name. A `null` [agree] is `GetMyLegalPageAgreements`.
  ///
  /// The account a sign-up opened agreed to the pages it was shown, so it
  /// owes nothing; its session is accepted rather than refused, which the app
  /// would take as a session the API has stopped accepting.
  Future<void> _writeLegalPageAgreements(
    HttpRequest request,
    pb.AgreeToLegalPagesRequest? agree,
  ) async {
    if (_isSignedUpSession(request)) {
      await _writeMessage(
        request,
        agree == null
            ? pb.GetMyLegalPageAgreementsResponse()
            : pb.AgreeToLegalPagesResponse(),
      );
      return;
    }
    if (!await _writeUnlessAuthorized(request)) {
      return;
    }
    if (agree != null) {
      final agreed = agree.agreedPageVersionIds.toList();
      final owed = {
        for (final page in [?owedTermsPage, ?owedPrivacyPage]) page.versionId,
      };
      if (agreed.isEmpty || !agreed.every(owed.contains)) {
        await _writeInvalidArgument(request, 'unknown page version');
        return;
      }
      legalPageAgreements.add(agreed);
      if (owedTermsPage case final page? when agreed.contains(page.versionId)) {
        owedTermsPage = null;
      }
      if (owedPrivacyPage case final page?
          when agreed.contains(page.versionId)) {
        owedPrivacyPage = null;
      }
    }
    await _writeMessage(
      request,
      agree == null
          ? pb.GetMyLegalPageAgreementsResponse(
              termsPage: owedTermsPage,
              privacyPage: owedPrivacyPage,
            )
          : pb.AgreeToLegalPagesResponse(
              termsPage: owedTermsPage,
              privacyPage: owedPrivacyPage,
            ),
    );
  }

  bool _isAuthorized(HttpRequest request) {
    final token = activeAccessToken;
    if (token == null || token.isEmpty) {
      return false;
    }
    return request.headers.value(HttpHeaders.authorizationHeader) ==
        'Bearer $token';
  }

  /// Whether [request] carries the session `Login` issued for an account a
  /// test signed up here.
  bool _isSignedUpSession(HttpRequest request) =>
      _signedUpSession != null &&
      request.headers.value(HttpHeaders.authorizationHeader) ==
          'Bearer $signedUpAccessToken';

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

  /// Answers [message] with 200, every record in it carrying the internal id
  /// derived from its public id.
  Future<void> _writeMessage(HttpRequest request, GeneratedMessage message) =>
      _writeProto(
        request,
        HttpStatus.ok,
        _withInternalIds(message.deepCopy()).writeToBuffer(),
      );

  /// Answers [status] with a Connect error body. The envelope is the Connect
  /// protocol's own rather than a proto message, so it stays JSON.
  Future<void> _writeError(
    HttpRequest request,
    int status,
    String code,
    String message, {
    List<Map<String, Object?>>? details,
  }) => _writeJson(request, status, {
    'code': code,
    'message': message,
    'details': ?details,
  });

  /// Answers one of the raw override hooks such as [listResponse]: a
  /// generated message and raw bytes in the binary codec, and anything else
  /// as the JSON it is.
  Future<void> _writeRaw(HttpRequest request, int status, Object body) =>
      switch (body) {
        final GeneratedMessage message => _writeProto(
          request,
          status,
          _withInternalIds(message.deepCopy()).writeToBuffer(),
        ),
        final List<int> bytes => _writeProto(request, status, bytes),
        _ => _writeJson(request, status, body),
      };

  /// Answers [status] with the raw override [body] when a test set one, and
  /// as an unavailable dependency otherwise.
  Future<void> _writeRawOrUnavailable(
    HttpRequest request,
    int status,
    Object? body,
  ) => body == null
      ? _writeUnavailable(request, status)
      : _writeRaw(request, status, body);

  Future<void> _writeProto(
    HttpRequest request,
    int status,
    List<int> body,
  ) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.parse(protoContentType);
    request.response.add(body);
    await request.response.close();
  }

  Future<void> _writeJson(HttpRequest request, int status, Object? body) async {
    request.response.statusCode = status;
    request.response.headers.contentType = ContentType.json;
    request.response.write(jsonEncode(body));
    await request.response.close();
  }

  /// [message] with every record in it whose message has both a public id
  /// and an internal id field carrying the internal id derived from the
  /// public one, unless it already holds one: `id` beside `publicId`, and
  /// `targetId` beside `targetPublicId`.
  static T _withInternalIds<T extends GeneratedMessage>(T message) {
    final info = message.info_;
    void derive(String from, String to) {
      final source = info.byName[from];
      final target = info.byName[to];
      if (source == null ||
          target == null ||
          !message.hasField(source.tagNumber) ||
          message.hasField(target.tagNumber)) {
        return;
      }
      if (message.getField(source.tagNumber) case final String publicId) {
        message.setField(target.tagNumber, internalIdOf(publicId));
      }
    }

    derive('publicId', 'id');
    derive('targetPublicId', 'targetId');
    for (final field in info.fieldInfo.values) {
      if (!message.hasField(field.tagNumber)) {
        continue;
      }
      switch (message.getField(field.tagNumber)) {
        case final GeneratedMessage child:
          _withInternalIds(child);
        case final List<Object?> children:
          children.whereType<GeneratedMessage>().forEach(_withInternalIds);
        case final Map<Object?, Object?> children:
          children.values.whereType<GeneratedMessage>().forEach(
            _withInternalIds,
          );
      }
    }
    return message;
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

/// An ID token a provider issued for one of its accounts.
class FixtureIdToken {
  const FixtureIdToken({
    required this.provider,
    required this.subject,
    required this.email,
    required this.nonce,
  });

  /// The provider that issued the token.
  final pb.IdentityProvider provider;

  /// The provider's stable id for the account, which a link is keyed on.
  final String subject;
  final String email;
  final String nonce;
}

/// One Connect request [ConnectFixtureServer] answered, kept so a test can
/// assert what the client sent and not only what it did with the answer.
class RecordedRequest {
  RecordedRequest({
    required this.path,
    required this.headers,
    required this._body,
  });

  /// Request path, ending in the Connect procedure name.
  final String path;

  /// Request headers, under lower-cased names.
  final Map<String, String> headers;

  /// The binary body as it arrived, empty when the request carried none.
  final Uint8List _body;

  /// Merges the body into [message], which is the request message of the
  /// procedure this request called, and returns it.
  ///
  /// The merge is strict: a body that does not decode, or a field the
  /// message does not define, throws a [FormatException], so a client that
  /// sends what `proto/` does not describe fails the test. A field the client
  /// set is present on the message even when it holds its default, so
  /// `hasToken()` tells a sent empty token from one left out.
  T decode<T extends GeneratedMessage>(T message) {
    try {
      message.mergeFromBuffer(_body);
    } on InvalidProtocolBufferException catch (error) {
      throw FormatException(error.message);
    }
    _rejectUnknownFields(message);
    return message;
  }

  /// Throws a [FormatException] when [message], or any message nested in it,
  /// holds a field its type does not define, which the decoder keeps in the
  /// [GeneratedMessage.unknownFields] of the message it was found in.
  static void _rejectUnknownFields(GeneratedMessage message) {
    if (message.unknownFields.isNotEmpty) {
      throw FormatException(
        '${message.info_.qualifiedMessageName} has no field '
        '${message.unknownFields.asMap().keys.join(', ')}',
      );
    }
    for (final field in message.info_.fieldInfo.values) {
      if (!message.hasField(field.tagNumber)) {
        continue;
      }
      switch (message.getField(field.tagNumber)) {
        case final GeneratedMessage child:
          _rejectUnknownFields(child);
        case final List<Object?> children:
          children.whereType<GeneratedMessage>().forEach(_rejectUnknownFields);
        case final Map<Object?, Object?> children:
          children.values.whereType<GeneratedMessage>().forEach(
            _rejectUnknownFields,
          );
      }
    }
  }
}
