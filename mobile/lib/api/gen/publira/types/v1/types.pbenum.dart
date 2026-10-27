// This is a generated file - do not edit.
//
// Generated from publira/types/v1/types.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// Where an episode credit was written. Series rows are baked onto an episode
/// when it is created; episode rows are additions made for that episode alone.
class CreatorCreditSource extends $pb.ProtobufEnum {
  static const CreatorCreditSource CREATOR_CREDIT_SOURCE_UNSPECIFIED =
      CreatorCreditSource._(
          0, _omitEnumNames ? '' : 'CREATOR_CREDIT_SOURCE_UNSPECIFIED');
  static const CreatorCreditSource CREATOR_CREDIT_SOURCE_SERIES =
      CreatorCreditSource._(
          1, _omitEnumNames ? '' : 'CREATOR_CREDIT_SOURCE_SERIES');
  static const CreatorCreditSource CREATOR_CREDIT_SOURCE_EPISODE =
      CreatorCreditSource._(
          2, _omitEnumNames ? '' : 'CREATOR_CREDIT_SOURCE_EPISODE');

  static const $core.List<CreatorCreditSource> values = <CreatorCreditSource>[
    CREATOR_CREDIT_SOURCE_UNSPECIFIED,
    CREATOR_CREDIT_SOURCE_SERIES,
    CREATOR_CREDIT_SOURCE_EPISODE,
  ];

  static final $core.List<CreatorCreditSource?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static CreatorCreditSource? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CreatorCreditSource._(super.value, super.name);
}

/// Whether a series is still gaining episodes. Stored on
/// series_listings.status, so it is the tenant's statement about the series
/// rather than something derived from the episodes it happens to hold.
class SeriesStatus extends $pb.ProtobufEnum {
  static const SeriesStatus SERIES_STATUS_UNSPECIFIED =
      SeriesStatus._(0, _omitEnumNames ? '' : 'SERIES_STATUS_UNSPECIFIED');

  /// New episodes are still coming.
  static const SeriesStatus SERIES_STATUS_ONGOING =
      SeriesStatus._(1, _omitEnumNames ? '' : 'SERIES_STATUS_ONGOING');

  /// The series has ended; no further episode is planned.
  static const SeriesStatus SERIES_STATUS_COMPLETED =
      SeriesStatus._(2, _omitEnumNames ? '' : 'SERIES_STATUS_COMPLETED');

  /// Paused, with more episodes intended.
  static const SeriesStatus SERIES_STATUS_HIATUS =
      SeriesStatus._(3, _omitEnumNames ? '' : 'SERIES_STATUS_HIATUS');

  static const $core.List<SeriesStatus> values = <SeriesStatus>[
    SERIES_STATUS_UNSPECIFIED,
    SERIES_STATUS_ONGOING,
    SERIES_STATUS_COMPLETED,
    SERIES_STATUS_HIATUS,
  ];

  static final $core.List<SeriesStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static SeriesStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SeriesStatus._(super.value, super.name);
}

/// Who a series is meant for. A client interposes its own confirmation on a
/// rated series; whether the reader has to prove an age is a separate tenant
/// setting.
class SeriesAgeRating extends $pb.ProtobufEnum {
  static const SeriesAgeRating SERIES_AGE_RATING_UNSPECIFIED =
      SeriesAgeRating._(
          0, _omitEnumNames ? '' : 'SERIES_AGE_RATING_UNSPECIFIED');

  /// No age restriction.
  static const SeriesAgeRating SERIES_AGE_RATING_ALL =
      SeriesAgeRating._(1, _omitEnumNames ? '' : 'SERIES_AGE_RATING_ALL');
  static const SeriesAgeRating SERIES_AGE_RATING_R15 =
      SeriesAgeRating._(2, _omitEnumNames ? '' : 'SERIES_AGE_RATING_R15');
  static const SeriesAgeRating SERIES_AGE_RATING_R18 =
      SeriesAgeRating._(3, _omitEnumNames ? '' : 'SERIES_AGE_RATING_R18');

  static const $core.List<SeriesAgeRating> values = <SeriesAgeRating>[
    SERIES_AGE_RATING_UNSPECIFIED,
    SERIES_AGE_RATING_ALL,
    SERIES_AGE_RATING_R15,
    SERIES_AGE_RATING_R18,
  ];

  static final $core.List<SeriesAgeRating?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static SeriesAgeRating? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SeriesAgeRating._(super.value, super.name);
}

/// Which way the pages of a work are turned. A series states it for every one
/// of its episodes, and an episode may state its own.
class ReadingDirection extends $pb.ProtobufEnum {
  static const ReadingDirection READING_DIRECTION_UNSPECIFIED =
      ReadingDirection._(
          0, _omitEnumNames ? '' : 'READING_DIRECTION_UNSPECIFIED');

  /// The reader turns from right to left, the binding of most manga. It is what
  /// a series nobody has set is read in.
  static const ReadingDirection READING_DIRECTION_RIGHT_TO_LEFT =
      ReadingDirection._(
          1, _omitEnumNames ? '' : 'READING_DIRECTION_RIGHT_TO_LEFT');
  static const ReadingDirection READING_DIRECTION_LEFT_TO_RIGHT =
      ReadingDirection._(
          2, _omitEnumNames ? '' : 'READING_DIRECTION_LEFT_TO_RIGHT');

  static const $core.List<ReadingDirection> values = <ReadingDirection>[
    READING_DIRECTION_UNSPECIFIED,
    READING_DIRECTION_RIGHT_TO_LEFT,
    READING_DIRECTION_LEFT_TO_RIGHT,
  ];

  static final $core.List<ReadingDirection?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static ReadingDirection? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ReadingDirection._(super.value, super.name);
}

/// Which third-party mark a tenant brand mark is, which also says where the
/// storefront draws it. The repository ships none of them: each is the tenant's
/// own upload, accepted under the terms of the mark's owner.
class TenantBrandMarkKind extends $pb.ProtobufEnum {
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_UNSPECIFIED =
      TenantBrandMarkKind._(
          0, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_UNSPECIFIED');

  /// X's mark, on the share menu's X row.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_X_SHARE =
      TenantBrandMarkKind._(
          1, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_X_SHARE');

  /// LINE's mark, on the share menu's LINE row.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_LINE_SHARE =
      TenantBrandMarkKind._(
          2, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_LINE_SHARE');

  /// The App Store badge, on the link to the tenant's app there.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_APP_STORE_BADGE =
      TenantBrandMarkKind._(
          3, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_APP_STORE_BADGE');

  /// The Google Play badge, on the link to the tenant's app there.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_GOOGLE_PLAY_BADGE =
      TenantBrandMarkKind._(
          4, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_GOOGLE_PLAY_BADGE');

  /// Apple's mark, on the Sign in with Apple button.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_APPLE_SIGN_IN =
      TenantBrandMarkKind._(
          5, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_APPLE_SIGN_IN');

  /// Google's mark, on the Sign in with Google button.
  static const TenantBrandMarkKind TENANT_BRAND_MARK_KIND_GOOGLE_SIGN_IN =
      TenantBrandMarkKind._(
          6, _omitEnumNames ? '' : 'TENANT_BRAND_MARK_KIND_GOOGLE_SIGN_IN');

  static const $core.List<TenantBrandMarkKind> values = <TenantBrandMarkKind>[
    TENANT_BRAND_MARK_KIND_UNSPECIFIED,
    TENANT_BRAND_MARK_KIND_X_SHARE,
    TENANT_BRAND_MARK_KIND_LINE_SHARE,
    TENANT_BRAND_MARK_KIND_APP_STORE_BADGE,
    TENANT_BRAND_MARK_KIND_GOOGLE_PLAY_BADGE,
    TENANT_BRAND_MARK_KIND_APPLE_SIGN_IN,
    TENANT_BRAND_MARK_KIND_GOOGLE_SIGN_IN,
  ];

  static final $core.List<TenantBrandMarkKind?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 6);
  static TenantBrandMarkKind? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const TenantBrandMarkKind._(super.value, super.name);
}

/// How comments a reader writes on an episode are published. The tenant states
/// it once (tenant_config.comment_mode) and one series may state its own
/// instead (series_listings.comment_mode), so a storefront deciding whether an
/// episode page offers commenting at all reads the mode of the series it is in.
class CommentMode extends $pb.ProtobufEnum {
  static const CommentMode COMMENT_MODE_UNSPECIFIED =
      CommentMode._(0, _omitEnumNames ? '' : 'COMMENT_MODE_UNSPECIFIED');

  /// Commenting is off: the storefront shows no comment section, and posting is
  /// refused. This is what a tenant that has never chosen gets.
  static const CommentMode COMMENT_MODE_DISABLED =
      CommentMode._(1, _omitEnumNames ? '' : 'COMMENT_MODE_DISABLED');

  /// A posted comment is readable by everyone as soon as it is stored.
  static const CommentMode COMMENT_MODE_IMMEDIATE =
      CommentMode._(2, _omitEnumNames ? '' : 'COMMENT_MODE_IMMEDIATE');

  /// A posted comment waits for a staff approval before anyone but its author
  /// can read it.
  static const CommentMode COMMENT_MODE_APPROVAL_REQUIRED =
      CommentMode._(3, _omitEnumNames ? '' : 'COMMENT_MODE_APPROVAL_REQUIRED');

  static const $core.List<CommentMode> values = <CommentMode>[
    COMMENT_MODE_UNSPECIFIED,
    COMMENT_MODE_DISABLED,
    COMMENT_MODE_IMMEDIATE,
    COMMENT_MODE_APPROVAL_REQUIRED,
  ];

  static final $core.List<CommentMode?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static CommentMode? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CommentMode._(super.value, super.name);
}

/// The client a public read or write that acts on a work is made from: the
/// catalog, and the reader's own follows, reading history, library, ratings,
/// comments, and views. A work may be withheld from either of them
/// (SurfaceAvailability), and the server answers each one with the works it may
/// show, so the rule lives on the server rather than in two clients filtering a
/// full catalog.
class ClientSurface extends $pb.ProtobufEnum {
  /// Answered as CLIENT_SURFACE_WEB, so a caller that names nothing keeps
  /// seeing what the storefront sees.
  static const ClientSurface CLIENT_SURFACE_UNSPECIFIED =
      ClientSurface._(0, _omitEnumNames ? '' : 'CLIENT_SURFACE_UNSPECIFIED');

  /// The tenant's web storefront.
  static const ClientSurface CLIENT_SURFACE_WEB =
      ClientSurface._(1, _omitEnumNames ? '' : 'CLIENT_SURFACE_WEB');

  /// The tenant's mobile app.
  static const ClientSurface CLIENT_SURFACE_APP =
      ClientSurface._(2, _omitEnumNames ? '' : 'CLIENT_SURFACE_APP');

  static const $core.List<ClientSurface> values = <ClientSurface>[
    CLIENT_SURFACE_UNSPECIFIED,
    CLIENT_SURFACE_WEB,
    CLIENT_SURFACE_APP,
  ];

  static final $core.List<ClientSurface?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static ClientSurface? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ClientSurface._(super.value, super.name);
}

/// How a tenant's app sells an episode the app may sell
/// (tenant_config.app_purchase_route). Where an episode may be bought at all is
/// SurfaceAvailability; this says only which purchase the app offers for it.
class AppPurchaseRoute extends $pb.ProtobufEnum {
  /// Never answered by a read. A write naming it is rejected: the tenant states
  /// one of the two routes.
  static const AppPurchaseRoute APP_PURCHASE_ROUTE_UNSPECIFIED =
      AppPurchaseRoute._(
          0, _omitEnumNames ? '' : 'APP_PURCHASE_ROUTE_UNSPECIFIED');

  /// The web checkout, opened in the system browser. What every tenant sells
  /// through until it chooses otherwise.
  static const AppPurchaseRoute APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT =
      AppPurchaseRoute._(
          1, _omitEnumNames ? '' : 'APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT');

  /// The App Store's or Google Play's own in-app purchase.
  static const AppPurchaseRoute APP_PURCHASE_ROUTE_STORE =
      AppPurchaseRoute._(2, _omitEnumNames ? '' : 'APP_PURCHASE_ROUTE_STORE');

  static const $core.List<AppPurchaseRoute> values = <AppPurchaseRoute>[
    APP_PURCHASE_ROUTE_UNSPECIFIED,
    APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT,
    APP_PURCHASE_ROUTE_STORE,
  ];

  static final $core.List<AppPurchaseRoute?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static AppPurchaseRoute? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const AppPurchaseRoute._(super.value, super.name);
}

/// Which surfaces a work may be shown on, or an episode bought on.
///
/// Where a work is shown, a series states it (series.availability) and an
/// episode may narrow it (episodes.availability): an episode is shown only where
/// its series is, so its own value can take it off a surface but never put it on
/// one its series is kept off. A work kept off a surface is absent from every
/// list, search, ranking, and recommendation read that surface makes, and from
/// the reader's own lists read there, and a read or write of it by public ID
/// answers not_found exactly as it does for an unpublished one.
///
/// Where an episode is bought, the tenant states a default
/// (tenant_config.purchase_availability), and a series and then an episode may
/// each replace the value above it rather than narrow it.
class SurfaceAvailability extends $pb.ProtobufEnum {
  /// On a series write, the default the column carries: both surfaces. On an
  /// episode, following its series.
  static const SurfaceAvailability SURFACE_AVAILABILITY_UNSPECIFIED =
      SurfaceAvailability._(
          0, _omitEnumNames ? '' : 'SURFACE_AVAILABILITY_UNSPECIFIED');

  /// The storefront and the app.
  static const SurfaceAvailability SURFACE_AVAILABILITY_ALL =
      SurfaceAvailability._(
          1, _omitEnumNames ? '' : 'SURFACE_AVAILABILITY_ALL');

  /// The storefront alone.
  static const SurfaceAvailability SURFACE_AVAILABILITY_WEB =
      SurfaceAvailability._(
          2, _omitEnumNames ? '' : 'SURFACE_AVAILABILITY_WEB');

  /// The app alone.
  static const SurfaceAvailability SURFACE_AVAILABILITY_APP =
      SurfaceAvailability._(
          3, _omitEnumNames ? '' : 'SURFACE_AVAILABILITY_APP');

  static const $core.List<SurfaceAvailability> values = <SurfaceAvailability>[
    SURFACE_AVAILABILITY_UNSPECIFIED,
    SURFACE_AVAILABILITY_ALL,
    SURFACE_AVAILABILITY_WEB,
    SURFACE_AVAILABILITY_APP,
  ];

  static final $core.List<SurfaceAvailability?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static SurfaceAvailability? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SurfaceAvailability._(super.value, super.name);
}

/// Which of an episode's two sales a purchase is (purchases.kind).
class PurchaseKind extends $pb.ProtobufEnum {
  /// On a request, the permanent copy, which is what every client that names no
  /// kind buys.
  static const PurchaseKind PURCHASE_KIND_UNSPECIFIED =
      PurchaseKind._(0, _omitEnumNames ? '' : 'PURCHASE_KIND_UNSPECIFIED');

  /// The permanent copy, at Episode.price, which opens the episode for its
  /// reading period if it has one and for good if it does not. A store purchase
  /// and a grant staff record are always this.
  static const PurchaseKind PURCHASE_KIND_PURCHASE =
      PurchaseKind._(1, _omitEnumNames ? '' : 'PURCHASE_KIND_PURCHASE');

  /// The rental, at Episode.rental_price, which opens the episode for
  /// Episode.rental_period_hours.
  static const PurchaseKind PURCHASE_KIND_RENTAL =
      PurchaseKind._(2, _omitEnumNames ? '' : 'PURCHASE_KIND_RENTAL');

  static const $core.List<PurchaseKind> values = <PurchaseKind>[
    PURCHASE_KIND_UNSPECIFIED,
    PURCHASE_KIND_PURCHASE,
    PURCHASE_KIND_RENTAL,
  ];

  static final $core.List<PurchaseKind?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static PurchaseKind? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const PurchaseKind._(super.value, super.name);
}

/// What a tenant lets a reader show as an icon (tenant_config.reader_icon_policy).
class ReaderIconPolicy extends $pb.ProtobufEnum {
  static const ReaderIconPolicy READER_ICON_POLICY_UNSPECIFIED =
      ReaderIconPolicy._(
          0, _omitEnumNames ? '' : 'READER_ICON_POLICY_UNSPECIFIED');

  /// A reader uploads an image of their own. This is what a tenant that has
  /// never chosen gets.
  static const ReaderIconPolicy READER_ICON_POLICY_UPLOAD =
      ReaderIconPolicy._(1, _omitEnumNames ? '' : 'READER_ICON_POLICY_UPLOAD');

  /// A reader picks one of the tenant's presets and uploads nothing.
  static const ReaderIconPolicy READER_ICON_POLICY_PRESET =
      ReaderIconPolicy._(2, _omitEnumNames ? '' : 'READER_ICON_POLICY_PRESET');

  /// No reader shows an icon.
  static const ReaderIconPolicy READER_ICON_POLICY_DISABLED =
      ReaderIconPolicy._(
          3, _omitEnumNames ? '' : 'READER_ICON_POLICY_DISABLED');

  static const $core.List<ReaderIconPolicy> values = <ReaderIconPolicy>[
    READER_ICON_POLICY_UNSPECIFIED,
    READER_ICON_POLICY_UPLOAD,
    READER_ICON_POLICY_PRESET,
    READER_ICON_POLICY_DISABLED,
  ];

  static final $core.List<ReaderIconPolicy?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static ReaderIconPolicy? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const ReaderIconPolicy._(super.value, super.name);
}

/// Where a tenant's storefront loads its Google tag from
/// (tenant_analytics_settings.serving_mode).
class GoogleTagServingMode extends $pb.ProtobufEnum {
  static const GoogleTagServingMode GOOGLE_TAG_SERVING_MODE_UNSPECIFIED =
      GoogleTagServingMode._(
          0, _omitEnumNames ? '' : 'GOOGLE_TAG_SERVING_MODE_UNSPECIFIED');

  /// The tag is loaded from Google and sends its hits there. This is what a
  /// tenant that has never chosen gets.
  static const GoogleTagServingMode GOOGLE_TAG_SERVING_MODE_GOOGLE =
      GoogleTagServingMode._(
          1, _omitEnumNames ? '' : 'GOOGLE_TAG_SERVING_MODE_GOOGLE');

  /// The tag is loaded from, and sends its hits to, the tenant's server-side
  /// Tag Manager container at server_container_url.
  static const GoogleTagServingMode GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER =
      GoogleTagServingMode._(
          2, _omitEnumNames ? '' : 'GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER');

  /// The tag is loaded from, and sends its hits to, gateway_path on the
  /// storefront's own origin, which Publira proxies to Google, or to the
  /// tenant's server container when server_container_url is set.
  static const GoogleTagServingMode GOOGLE_TAG_SERVING_MODE_GATEWAY =
      GoogleTagServingMode._(
          3, _omitEnumNames ? '' : 'GOOGLE_TAG_SERVING_MODE_GATEWAY');

  static const $core.List<GoogleTagServingMode> values = <GoogleTagServingMode>[
    GOOGLE_TAG_SERVING_MODE_UNSPECIFIED,
    GOOGLE_TAG_SERVING_MODE_GOOGLE,
    GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER,
    GOOGLE_TAG_SERVING_MODE_GATEWAY,
  ];

  static final $core.List<GoogleTagServingMode?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static GoogleTagServingMode? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GoogleTagServingMode._(super.value, super.name);
}

/// Whether a tenant's storefront asks a reader before its Google tag stores
/// anything (tenant_analytics_settings.consent_mode). The mode applies to every
/// reader of the tenant, wherever they read from.
class GoogleTagConsentMode extends $pb.ProtobufEnum {
  static const GoogleTagConsentMode GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED =
      GoogleTagConsentMode._(
          0, _omitEnumNames ? '' : 'GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED');

  /// The tag runs as soon as the page loads, and the tenant discloses it on its
  /// privacy page. This is what a tenant that has never chosen gets.
  static const GoogleTagConsentMode GOOGLE_TAG_CONSENT_MODE_NOT_REQUIRED =
      GoogleTagConsentMode._(
          1, _omitEnumNames ? '' : 'GOOGLE_TAG_CONSENT_MODE_NOT_REQUIRED');

  /// The storefront asks the reader before the tag runs, and sends Google
  /// Consent Mode v2 signals that match the answer.
  static const GoogleTagConsentMode GOOGLE_TAG_CONSENT_MODE_OPT_IN =
      GoogleTagConsentMode._(
          2, _omitEnumNames ? '' : 'GOOGLE_TAG_CONSENT_MODE_OPT_IN');

  /// The storefront sends Google Consent Mode v2 defaults of denied and shows
  /// no banner of its own: the tenant's consent tool, running inside its Tag
  /// Manager container, collects the answer and updates the signals. Requires
  /// a Tag Manager container ID.
  static const GoogleTagConsentMode GOOGLE_TAG_CONSENT_MODE_EXTERNAL =
      GoogleTagConsentMode._(
          3, _omitEnumNames ? '' : 'GOOGLE_TAG_CONSENT_MODE_EXTERNAL');

  static const $core.List<GoogleTagConsentMode> values = <GoogleTagConsentMode>[
    GOOGLE_TAG_CONSENT_MODE_UNSPECIFIED,
    GOOGLE_TAG_CONSENT_MODE_NOT_REQUIRED,
    GOOGLE_TAG_CONSENT_MODE_OPT_IN,
    GOOGLE_TAG_CONSENT_MODE_EXTERNAL,
  ];

  static final $core.List<GoogleTagConsentMode?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static GoogleTagConsentMode? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const GoogleTagConsentMode._(super.value, super.name);
}

/// Which of a tenant's age ratings a reader has to prove an age for
/// (tenant_config.age_verification). The values are the rungs of one ladder
/// rather than a switch per rating: a tenant that gated `r15` while leaving
/// `r18` open would be stating a policy nobody means.
class AgeVerification extends $pb.ProtobufEnum {
  static const AgeVerification AGE_VERIFICATION_UNSPECIFIED = AgeVerification._(
      0, _omitEnumNames ? '' : 'AGE_VERIFICATION_UNSPECIFIED');

  /// Nothing is proven. A rated series still carries its rating, and a client
  /// still interposes its own confirmation on one, but no birth date is asked
  /// for and none is checked. This is what a tenant that has never chosen gets.
  static const AgeVerification AGE_VERIFICATION_NONE =
      AgeVerification._(1, _omitEnumNames ? '' : 'AGE_VERIFICATION_NONE');

  /// `r18` series demand a proven 18. `r15` series are left to the client's
  /// confirmation.
  static const AgeVerification AGE_VERIFICATION_R18 =
      AgeVerification._(2, _omitEnumNames ? '' : 'AGE_VERIFICATION_R18');

  /// `r15` series demand a proven 15 and `r18` series a proven 18.
  static const AgeVerification AGE_VERIFICATION_R15_AND_R18 = AgeVerification._(
      3, _omitEnumNames ? '' : 'AGE_VERIFICATION_R15_AND_R18');

  static const $core.List<AgeVerification> values = <AgeVerification>[
    AGE_VERIFICATION_UNSPECIFIED,
    AGE_VERIFICATION_NONE,
    AGE_VERIFICATION_R18,
    AGE_VERIFICATION_R15_AND_R18,
  ];

  static final $core.List<AgeVerification?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static AgeVerification? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const AgeVerification._(super.value, super.name);
}

/// What a subscription plan opens while it is paid
/// (subscription_plans.scope).
class SubscriptionPlanScope extends $pb.ProtobufEnum {
  /// Never answered by a read. A write naming it is rejected: a plan states
  /// one of the three.
  static const SubscriptionPlanScope SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED =
      SubscriptionPlanScope._(
          0, _omitEnumNames ? '' : 'SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED');

  /// Every episode of the tenant. Such a plan names no labels and no series.
  static const SubscriptionPlanScope SUBSCRIPTION_PLAN_SCOPE_ALL =
      SubscriptionPlanScope._(
          1, _omitEnumNames ? '' : 'SUBSCRIPTION_PLAN_SCOPE_ALL');

  /// Every episode of the series of the labels the plan names.
  static const SubscriptionPlanScope SUBSCRIPTION_PLAN_SCOPE_LABEL =
      SubscriptionPlanScope._(
          2, _omitEnumNames ? '' : 'SUBSCRIPTION_PLAN_SCOPE_LABEL');

  /// Every episode of the series the plan names.
  static const SubscriptionPlanScope SUBSCRIPTION_PLAN_SCOPE_SERIES =
      SubscriptionPlanScope._(
          3, _omitEnumNames ? '' : 'SUBSCRIPTION_PLAN_SCOPE_SERIES');

  static const $core.List<SubscriptionPlanScope> values =
      <SubscriptionPlanScope>[
    SUBSCRIPTION_PLAN_SCOPE_UNSPECIFIED,
    SUBSCRIPTION_PLAN_SCOPE_ALL,
    SUBSCRIPTION_PLAN_SCOPE_LABEL,
    SUBSCRIPTION_PLAN_SCOPE_SERIES,
  ];

  static final $core.List<SubscriptionPlanScope?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static SubscriptionPlanScope? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SubscriptionPlanScope._(super.value, super.name);
}

/// The unit a subscription plan's recurring price is billed every so many of,
/// as its Stripe Price states it (subscription_plans.recurring_interval).
class SubscriptionInterval extends $pb.ProtobufEnum {
  static const SubscriptionInterval SUBSCRIPTION_INTERVAL_UNSPECIFIED =
      SubscriptionInterval._(
          0, _omitEnumNames ? '' : 'SUBSCRIPTION_INTERVAL_UNSPECIFIED');
  static const SubscriptionInterval SUBSCRIPTION_INTERVAL_DAY =
      SubscriptionInterval._(
          1, _omitEnumNames ? '' : 'SUBSCRIPTION_INTERVAL_DAY');
  static const SubscriptionInterval SUBSCRIPTION_INTERVAL_WEEK =
      SubscriptionInterval._(
          2, _omitEnumNames ? '' : 'SUBSCRIPTION_INTERVAL_WEEK');
  static const SubscriptionInterval SUBSCRIPTION_INTERVAL_MONTH =
      SubscriptionInterval._(
          3, _omitEnumNames ? '' : 'SUBSCRIPTION_INTERVAL_MONTH');
  static const SubscriptionInterval SUBSCRIPTION_INTERVAL_YEAR =
      SubscriptionInterval._(
          4, _omitEnumNames ? '' : 'SUBSCRIPTION_INTERVAL_YEAR');

  static const $core.List<SubscriptionInterval> values = <SubscriptionInterval>[
    SUBSCRIPTION_INTERVAL_UNSPECIFIED,
    SUBSCRIPTION_INTERVAL_DAY,
    SUBSCRIPTION_INTERVAL_WEEK,
    SUBSCRIPTION_INTERVAL_MONTH,
    SUBSCRIPTION_INTERVAL_YEAR,
  ];

  static final $core.List<SubscriptionInterval?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static SubscriptionInterval? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SubscriptionInterval._(super.value, super.name);
}

/// A subscription's state, as Stripe last reported it (subscriptions.status).
/// Each value is Stripe's own status of the same name.
class SubscriptionStatus extends $pb.ProtobufEnum {
  static const SubscriptionStatus SUBSCRIPTION_STATUS_UNSPECIFIED =
      SubscriptionStatus._(
          0, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_UNSPECIFIED');

  /// The first payment has not gone through yet, such as one waiting on the
  /// reader's 3-D Secure.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_INCOMPLETE =
      SubscriptionStatus._(
          1, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_INCOMPLETE');

  /// The first payment never went through, and the subscription was dropped.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_INCOMPLETE_EXPIRED =
      SubscriptionStatus._(
          2, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_INCOMPLETE_EXPIRED');
  static const SubscriptionStatus SUBSCRIPTION_STATUS_TRIALING =
      SubscriptionStatus._(
          3, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_TRIALING');

  /// Paid up.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_ACTIVE =
      SubscriptionStatus._(
          4, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_ACTIVE');

  /// A renewal payment failed, and Stripe is retrying it.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_PAST_DUE =
      SubscriptionStatus._(
          5, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_PAST_DUE');

  /// Ended: canceled at once, at the end of its period, or after its retries
  /// ran out.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_CANCELED =
      SubscriptionStatus._(
          6, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_CANCELED');

  /// Stripe's retries ran out and the tenant's Stripe settings keep the
  /// subscription open, unpaid.
  static const SubscriptionStatus SUBSCRIPTION_STATUS_UNPAID =
      SubscriptionStatus._(
          7, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_UNPAID');
  static const SubscriptionStatus SUBSCRIPTION_STATUS_PAUSED =
      SubscriptionStatus._(
          8, _omitEnumNames ? '' : 'SUBSCRIPTION_STATUS_PAUSED');

  static const $core.List<SubscriptionStatus> values = <SubscriptionStatus>[
    SUBSCRIPTION_STATUS_UNSPECIFIED,
    SUBSCRIPTION_STATUS_INCOMPLETE,
    SUBSCRIPTION_STATUS_INCOMPLETE_EXPIRED,
    SUBSCRIPTION_STATUS_TRIALING,
    SUBSCRIPTION_STATUS_ACTIVE,
    SUBSCRIPTION_STATUS_PAST_DUE,
    SUBSCRIPTION_STATUS_CANCELED,
    SUBSCRIPTION_STATUS_UNPAID,
    SUBSCRIPTION_STATUS_PAUSED,
  ];

  static final $core.List<SubscriptionStatus?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 8);
  static SubscriptionStatus? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const SubscriptionStatus._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
