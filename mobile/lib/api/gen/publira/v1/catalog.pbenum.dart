// This is a generated file - do not edit.
//
// Generated from publira/v1/catalog.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// Sort order of a published series list.
class SeriesOrder extends $pb.ProtobufEnum {
  /// Same as SERIES_ORDER_PUBLISHED_AT_DESC in a list. A search gives it a
  /// meaning of its own, stated at SearchPublishedSeriesRequest.order.
  static const SeriesOrder SERIES_ORDER_UNSPECIFIED =
      SeriesOrder._(0, _omitEnumNames ? '' : 'SERIES_ORDER_UNSPECIFIED');

  /// Newest published first.
  static const SeriesOrder SERIES_ORDER_PUBLISHED_AT_DESC =
      SeriesOrder._(1, _omitEnumNames ? '' : 'SERIES_ORDER_PUBLISHED_AT_DESC');

  /// Oldest published first.
  static const SeriesOrder SERIES_ORDER_PUBLISHED_AT_ASC =
      SeriesOrder._(2, _omitEnumNames ? '' : 'SERIES_ORDER_PUBLISHED_AT_ASC');

  /// By title, ascending.
  static const SeriesOrder SERIES_ORDER_TITLE_ASC =
      SeriesOrder._(3, _omitEnumNames ? '' : 'SERIES_ORDER_TITLE_ASC');

  /// By title, descending.
  static const SeriesOrder SERIES_ORDER_TITLE_DESC =
      SeriesOrder._(4, _omitEnumNames ? '' : 'SERIES_ORDER_TITLE_DESC');

  /// By the most recent episode of each series, newest first. A series whose
  /// episodes are all still unpublished sorts by its own publication instant,
  /// which is the last thing that happened to it.
  static const SeriesOrder SERIES_ORDER_LATEST_EPISODE_AT_DESC = SeriesOrder._(
      5, _omitEnumNames ? '' : 'SERIES_ORDER_LATEST_EPISODE_AT_DESC');

  static const $core.List<SeriesOrder> values = <SeriesOrder>[
    SERIES_ORDER_UNSPECIFIED,
    SERIES_ORDER_PUBLISHED_AT_DESC,
    SERIES_ORDER_PUBLISHED_AT_ASC,
    SERIES_ORDER_TITLE_ASC,
    SERIES_ORDER_TITLE_DESC,
    SERIES_ORDER_LATEST_EPISODE_AT_DESC,
  ];

  static final $core.List<SeriesOrder?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 5);
  static SeriesOrder? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SeriesOrder._(super.value, super.name);
}

/// Viewer access state for an episode body on GetEpisodeDetail.
class EpisodeAccess extends $pb.ProtobufEnum {
  static const EpisodeAccess EPISODE_ACCESS_UNSPECIFIED =
      EpisodeAccess._(0, _omitEnumNames ? '' : 'EPISODE_ACCESS_UNSPECIFIED');

  /// The body is public: price is 0, or a scheduled free window is open on it.
  static const EpisodeAccess EPISODE_ACCESS_FREE =
      EpisodeAccess._(1, _omitEnumNames ? '' : 'EPISODE_ACCESS_FREE');

  /// paid and no grant.
  static const EpisodeAccess EPISODE_ACCESS_LOCKED =
      EpisodeAccess._(2, _omitEnumNames ? '' : 'EPISODE_ACCESS_LOCKED');

  /// The reader holds a grant on the episode; which one is
  /// GetEpisodeDetailResponse.entitlement_source.
  static const EpisodeAccess EPISODE_ACCESS_ENTITLED =
      EpisodeAccess._(3, _omitEnumNames ? '' : 'EPISODE_ACCESS_ENTITLED');

  /// The tenant makes a reader prove an age for this series' rating and this
  /// reader has not: they are reading as a guest, have given no birth date, or
  /// are younger than the rating asks for. It outranks the three above, so a
  /// free body and a purchased one are both withheld, and it is answered the
  /// same way as EPISODE_ACCESS_LOCKED — no images and no media token, and the
  /// same preview_images.
  static const EpisodeAccess EPISODE_ACCESS_AGE_RESTRICTED =
      EpisodeAccess._(4, _omitEnumNames ? '' : 'EPISODE_ACCESS_AGE_RESTRICTED');

  static const $core.List<EpisodeAccess> values = <EpisodeAccess>[
    EPISODE_ACCESS_UNSPECIFIED,
    EPISODE_ACCESS_FREE,
    EPISODE_ACCESS_LOCKED,
    EPISODE_ACCESS_ENTITLED,
    EPISODE_ACCESS_AGE_RESTRICTED,
  ];

  static final $core.List<EpisodeAccess?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static EpisodeAccess? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const EpisodeAccess._(super.value, super.name);
}

/// Why an entitled reader may open an episode's body. It is reported beside
/// EPISODE_ACCESS_ENTITLED rather than as further EpisodeAccess values, so a
/// client that does not read it still renders the body as entitled.
class EpisodeEntitlementSource extends $pb.ProtobufEnum {
  static const EpisodeEntitlementSource EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED =
      EpisodeEntitlementSource._(
          0, _omitEnumNames ? '' : 'EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED');

  /// A purchase neither revoked nor past its reading period.
  static const EpisodeEntitlementSource EPISODE_ENTITLEMENT_SOURCE_PURCHASE =
      EpisodeEntitlementSource._(
          1, _omitEnumNames ? '' : 'EPISODE_ENTITLEMENT_SOURCE_PURCHASE');

  /// An access ticket neither revoked nor expired.
  static const EpisodeEntitlementSource
      EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET = EpisodeEntitlementSource._(
          2, _omitEnumNames ? '' : 'EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET');

  /// The reader's account is linked to a creator the episode credits. It is
  /// reported over a purchase or a ticket the same reader also holds.
  static const EpisodeEntitlementSource EPISODE_ENTITLEMENT_SOURCE_CREATOR =
      EpisodeEntitlementSource._(
          3, _omitEnumNames ? '' : 'EPISODE_ENTITLEMENT_SOURCE_CREATOR');

  static const $core.List<EpisodeEntitlementSource> values =
      <EpisodeEntitlementSource>[
    EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED,
    EPISODE_ENTITLEMENT_SOURCE_PURCHASE,
    EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET,
    EPISODE_ENTITLEMENT_SOURCE_CREATOR,
  ];

  static final $core.List<EpisodeEntitlementSource?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static EpisodeEntitlementSource? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const EpisodeEntitlementSource._(super.value, super.name);
}

/// Whether behavioural signals are behind a recommendation list at all. It
/// describes the tenant rather than the page: a later page of a ranked list is
/// all new arrivals, and still says RANKING. The list itself cannot be read for
/// this — a ranked list and its fallback are both just series.
class RecommendationSource extends $pb.ProtobufEnum {
  static const RecommendationSource RECOMMENDATION_SOURCE_UNSPECIFIED =
      RecommendationSource._(
          0, _omitEnumNames ? '' : 'RECOMMENDATION_SOURCE_UNSPECIFIED');

  /// A ranking snapshot decided the front of the list.
  static const RecommendationSource RECOMMENDATION_SOURCE_RANKING =
      RecommendationSource._(
          1, _omitEnumNames ? '' : 'RECOMMENDATION_SOURCE_RANKING');

  /// The tenant has no usable ranking snapshot, so the whole list is ordered
  /// newest first.
  static const RecommendationSource RECOMMENDATION_SOURCE_NEW_ARRIVALS =
      RecommendationSource._(
          2, _omitEnumNames ? '' : 'RECOMMENDATION_SOURCE_NEW_ARRIVALS');

  /// The signed-in reader's own features decided the order. Only
  /// ListMyRecommendedSeries answers it.
  static const RecommendationSource RECOMMENDATION_SOURCE_READER_FEATURES =
      RecommendationSource._(
          3, _omitEnumNames ? '' : 'RECOMMENDATION_SOURCE_READER_FEATURES');

  static const $core.List<RecommendationSource> values = <RecommendationSource>[
    RECOMMENDATION_SOURCE_UNSPECIFIED,
    RECOMMENDATION_SOURCE_RANKING,
    RECOMMENDATION_SOURCE_NEW_ARRIVALS,
    RECOMMENDATION_SOURCE_READER_FEATURES,
  ];

  static final $core.List<RecommendationSource?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static RecommendationSource? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const RecommendationSource._(super.value, super.name);
}

/// The window a ranking snapshot covers. The batch writes one snapshot per
/// period on every run, so a tenant that has one has both.
class RankingPeriod extends $pb.ProtobufEnum {
  /// Same as RANKING_PERIOD_DAILY.
  static const RankingPeriod RANKING_PERIOD_UNSPECIFIED =
      RankingPeriod._(0, _omitEnumNames ? '' : 'RANKING_PERIOD_UNSPECIFIED');

  /// The single day the last run ranked.
  static const RankingPeriod RANKING_PERIOD_DAILY =
      RankingPeriod._(1, _omitEnumNames ? '' : 'RANKING_PERIOD_DAILY');

  /// The seven days ending on that same day.
  static const RankingPeriod RANKING_PERIOD_WEEKLY =
      RankingPeriod._(2, _omitEnumNames ? '' : 'RANKING_PERIOD_WEEKLY');

  static const $core.List<RankingPeriod> values = <RankingPeriod>[
    RANKING_PERIOD_UNSPECIFIED,
    RANKING_PERIOD_DAILY,
    RANKING_PERIOD_WEEKLY,
  ];

  static final $core.List<RankingPeriod?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static RankingPeriod? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const RankingPeriod._(super.value, super.name);
}

/// What a sitemap entry links to. The numbers are the order ListSitemapEntries
/// walks the kinds in, so a token can name its position with the kind alone.
class SitemapEntryKind extends $pb.ProtobufEnum {
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_UNSPECIFIED =
      SitemapEntryKind._(
          0, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_UNSPECIFIED');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_SERIES =
      SitemapEntryKind._(1, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_SERIES');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_EPISODE =
      SitemapEntryKind._(2, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_EPISODE');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_LABEL =
      SitemapEntryKind._(3, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_LABEL');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_CREATOR =
      SitemapEntryKind._(4, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_CREATOR');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_GENRE =
      SitemapEntryKind._(5, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_GENRE');
  static const SitemapEntryKind SITEMAP_ENTRY_KIND_PAGE =
      SitemapEntryKind._(6, _omitEnumNames ? '' : 'SITEMAP_ENTRY_KIND_PAGE');

  static const $core.List<SitemapEntryKind> values = <SitemapEntryKind>[
    SITEMAP_ENTRY_KIND_UNSPECIFIED,
    SITEMAP_ENTRY_KIND_SERIES,
    SITEMAP_ENTRY_KIND_EPISODE,
    SITEMAP_ENTRY_KIND_LABEL,
    SITEMAP_ENTRY_KIND_CREATOR,
    SITEMAP_ENTRY_KIND_GENRE,
    SITEMAP_ENTRY_KIND_PAGE,
  ];

  static final $core.List<SitemapEntryKind?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 6);
  static SitemapEntryKind? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SitemapEntryKind._(super.value, super.name);
}

/// Kinds of public catalog targets a member can follow.
class FollowTargetType extends $pb.ProtobufEnum {
  static const FollowTargetType FOLLOW_TARGET_TYPE_UNSPECIFIED =
      FollowTargetType._(
          0, _omitEnumNames ? '' : 'FOLLOW_TARGET_TYPE_UNSPECIFIED');
  static const FollowTargetType FOLLOW_TARGET_TYPE_EPISODE =
      FollowTargetType._(1, _omitEnumNames ? '' : 'FOLLOW_TARGET_TYPE_EPISODE');
  static const FollowTargetType FOLLOW_TARGET_TYPE_CREATOR =
      FollowTargetType._(2, _omitEnumNames ? '' : 'FOLLOW_TARGET_TYPE_CREATOR');
  static const FollowTargetType FOLLOW_TARGET_TYPE_SERIES =
      FollowTargetType._(3, _omitEnumNames ? '' : 'FOLLOW_TARGET_TYPE_SERIES');

  static const $core.List<FollowTargetType> values = <FollowTargetType>[
    FOLLOW_TARGET_TYPE_UNSPECIFIED,
    FOLLOW_TARGET_TYPE_EPISODE,
    FOLLOW_TARGET_TYPE_CREATOR,
    FOLLOW_TARGET_TYPE_SERIES,
  ];

  static final $core.List<FollowTargetType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static FollowTargetType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const FollowTargetType._(super.value, super.name);
}

/// How expressive an episode rating is, which a tenant decides and a series may
/// override. It reaches the client so the control knows whether to render a
/// plain button or one that can be pressed again.
class EpisodeRatingMode extends $pb.ProtobufEnum {
  static const EpisodeRatingMode EPISODE_RATING_MODE_UNSPECIFIED =
      EpisodeRatingMode._(
          0, _omitEnumNames ? '' : 'EPISODE_RATING_MODE_UNSPECIFIED');

  /// One press says everything the reader can say, and stores the full 5.
  static const EpisodeRatingMode EPISODE_RATING_MODE_SINGLE =
      EpisodeRatingMode._(
          1, _omitEnumNames ? '' : 'EPISODE_RATING_MODE_SINGLE');

  /// The reader presses their way up to 5.
  static const EpisodeRatingMode EPISODE_RATING_MODE_MULTIPLE =
      EpisodeRatingMode._(
          2, _omitEnumNames ? '' : 'EPISODE_RATING_MODE_MULTIPLE');

  static const $core.List<EpisodeRatingMode> values = <EpisodeRatingMode>[
    EPISODE_RATING_MODE_UNSPECIFIED,
    EPISODE_RATING_MODE_SINGLE,
    EPISODE_RATING_MODE_MULTIPLE,
  ];

  static final $core.List<EpisodeRatingMode?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static EpisodeRatingMode? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const EpisodeRatingMode._(super.value, super.name);
}

/// Kinds of public catalog targets a page view can be recorded for.
class ContentViewTargetType extends $pb.ProtobufEnum {
  static const ContentViewTargetType CONTENT_VIEW_TARGET_TYPE_UNSPECIFIED =
      ContentViewTargetType._(
          0, _omitEnumNames ? '' : 'CONTENT_VIEW_TARGET_TYPE_UNSPECIFIED');
  static const ContentViewTargetType CONTENT_VIEW_TARGET_TYPE_SERIES =
      ContentViewTargetType._(
          1, _omitEnumNames ? '' : 'CONTENT_VIEW_TARGET_TYPE_SERIES');
  static const ContentViewTargetType CONTENT_VIEW_TARGET_TYPE_EPISODE =
      ContentViewTargetType._(
          2, _omitEnumNames ? '' : 'CONTENT_VIEW_TARGET_TYPE_EPISODE');

  static const $core.List<ContentViewTargetType> values =
      <ContentViewTargetType>[
    CONTENT_VIEW_TARGET_TYPE_UNSPECIFIED,
    CONTENT_VIEW_TARGET_TYPE_SERIES,
    CONTENT_VIEW_TARGET_TYPE_EPISODE,
  ];

  static final $core.List<ContentViewTargetType?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static ContentViewTargetType? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ContentViewTargetType._(super.value, super.name);
}

/// The store an app buys through with the store's own in-app purchase.
class InAppPurchaseStore extends $pb.ProtobufEnum {
  static const InAppPurchaseStore IN_APP_PURCHASE_STORE_UNSPECIFIED =
      InAppPurchaseStore._(
          0, _omitEnumNames ? '' : 'IN_APP_PURCHASE_STORE_UNSPECIFIED');
  static const InAppPurchaseStore IN_APP_PURCHASE_STORE_APP_STORE =
      InAppPurchaseStore._(
          1, _omitEnumNames ? '' : 'IN_APP_PURCHASE_STORE_APP_STORE');
  static const InAppPurchaseStore IN_APP_PURCHASE_STORE_GOOGLE_PLAY =
      InAppPurchaseStore._(
          2, _omitEnumNames ? '' : 'IN_APP_PURCHASE_STORE_GOOGLE_PLAY');

  static const $core.List<InAppPurchaseStore> values = <InAppPurchaseStore>[
    IN_APP_PURCHASE_STORE_UNSPECIFIED,
    IN_APP_PURCHASE_STORE_APP_STORE,
    IN_APP_PURCHASE_STORE_GOOGLE_PLAY,
  ];

  static final $core.List<InAppPurchaseStore?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static InAppPurchaseStore? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const InAppPurchaseStore._(super.value, super.name);
}

class StartEpisodeCheckoutRequest_Client extends $pb.ProtobufEnum {
  static const StartEpisodeCheckoutRequest_Client CLIENT_UNSPECIFIED =
      StartEpisodeCheckoutRequest_Client._(
          0, _omitEnumNames ? '' : 'CLIENT_UNSPECIFIED');
  static const StartEpisodeCheckoutRequest_Client CLIENT_WEB =
      StartEpisodeCheckoutRequest_Client._(
          1, _omitEnumNames ? '' : 'CLIENT_WEB');
  static const StartEpisodeCheckoutRequest_Client CLIENT_MOBILE =
      StartEpisodeCheckoutRequest_Client._(
          2, _omitEnumNames ? '' : 'CLIENT_MOBILE');

  static const $core.List<StartEpisodeCheckoutRequest_Client> values =
      <StartEpisodeCheckoutRequest_Client>[
    CLIENT_UNSPECIFIED,
    CLIENT_WEB,
    CLIENT_MOBILE,
  ];

  static final $core.List<StartEpisodeCheckoutRequest_Client?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static StartEpisodeCheckoutRequest_Client? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const StartEpisodeCheckoutRequest_Client._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
