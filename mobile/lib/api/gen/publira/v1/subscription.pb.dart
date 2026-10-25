// This is a generated file - do not edit.
//
// Generated from publira/v1/subscription.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../types/v1/types.pb.dart' as $1;
import 'catalog.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

/// A subscription plan the tenant has published: a recurring price on its
/// Stripe account, and what a reader who pays it may read.
class SubscriptionPlan extends $pb.GeneratedMessage {
  factory SubscriptionPlan({
    $core.String? id,
    $core.String? publicId,
    $core.String? name,
    $core.String? description,
    $core.int? priceAmount,
    $core.String? currency,
    $1.SubscriptionInterval? interval,
    $core.int? intervalCount,
    $1.SubscriptionPlanScope? scope,
    $core.Iterable<$core.String>? labelIds,
    $core.Iterable<$core.String>? seriesIds,
    $core.Iterable<$0.PublishedLabel>? labels,
    $core.Iterable<$1.Series>? series,
  }) {
    final result = SubscriptionPlan._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (description != null) result.description = description;
    if (priceAmount != null) result.priceAmount = priceAmount;
    if (currency != null) result.currency = currency;
    if (interval != null) result.interval = interval;
    if (intervalCount != null) result.intervalCount = intervalCount;
    if (scope != null) result.scope = scope;
    if (labelIds != null) result.labelIds.addAll(labelIds);
    if (seriesIds != null) result.seriesIds.addAll(seriesIds);
    if (labels != null) result.labels.addAll(labels);
    if (series != null) result.series.addAll(series);
    return result;
  }

  SubscriptionPlan._();

  factory SubscriptionPlan.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubscriptionPlan()..mergeFromBuffer(data, registry);
  factory SubscriptionPlan.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubscriptionPlan()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SubscriptionPlan',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SubscriptionPlan.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..aOS(4, _omitFieldNames ? '' : 'description')
    ..aI(5, _omitFieldNames ? '' : 'priceAmount')
    ..aOS(6, _omitFieldNames ? '' : 'currency')
    ..aE<$1.SubscriptionInterval>(7, _omitFieldNames ? '' : 'interval',
        enumValues: $1.SubscriptionInterval.values)
    ..aI(8, _omitFieldNames ? '' : 'intervalCount')
    ..aE<$1.SubscriptionPlanScope>(9, _omitFieldNames ? '' : 'scope',
        enumValues: $1.SubscriptionPlanScope.values)
    ..pPS(10, _omitFieldNames ? '' : 'labelIds')
    ..pPS(11, _omitFieldNames ? '' : 'seriesIds')
    ..pPM<$0.PublishedLabel>(12, _omitFieldNames ? '' : 'labels',
        subBuilder: $0.PublishedLabel.$_createMessage)
    ..pPM<$1.Series>(13, _omitFieldNames ? '' : 'series',
        subBuilder: $1.Series.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscriptionPlan clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubscriptionPlan copyWith(void Function(SubscriptionPlan) updates) =>
      super.copyWith((message) => updates(message as SubscriptionPlan))
          as SubscriptionPlan;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use SubscriptionPlan() / SubscriptionPlan.new instead')
  static SubscriptionPlan create() => SubscriptionPlan._();
  static $pb.GeneratedMessage $_createMessage() => SubscriptionPlan._();
  @$core.override
  SubscriptionPlan createEmptyInstance() => SubscriptionPlan._();
  @$core.pragma('dart2js:noInline')
  static SubscriptionPlan getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<SubscriptionPlan>(
          SubscriptionPlan.$_createMessage);
  static SubscriptionPlan? _defaultInstance;

  /// The plan's primary key, which StartSubscriptionCheckout addresses it by.
  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);

  /// Plain text. Empty when the tenant wrote none.
  @$pb.TagNumber(4)
  $core.String get description => $_getSZ(3);
  @$pb.TagNumber(4)
  set description($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasDescription() => $_has(3);
  @$pb.TagNumber(4)
  void clearDescription() => $_clearField(4);

  /// What one period costs, in the minor unit of currency.
  @$pb.TagNumber(5)
  $core.int get priceAmount => $_getIZ(4);
  @$pb.TagNumber(5)
  set priceAmount($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPriceAmount() => $_has(4);
  @$pb.TagNumber(5)
  void clearPriceAmount() => $_clearField(5);

  /// The ISO 4217 code, in capitals, of the currency the plan bills in.
  @$pb.TagNumber(6)
  $core.String get currency => $_getSZ(5);
  @$pb.TagNumber(6)
  set currency($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCurrency() => $_has(5);
  @$pb.TagNumber(6)
  void clearCurrency() => $_clearField(6);

  /// The plan bills price_amount every interval_count intervals: a monthly plan
  /// is SUBSCRIPTION_INTERVAL_MONTH and 1.
  @$pb.TagNumber(7)
  $1.SubscriptionInterval get interval => $_getN(6);
  @$pb.TagNumber(7)
  set interval($1.SubscriptionInterval value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasInterval() => $_has(6);
  @$pb.TagNumber(7)
  void clearInterval() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.int get intervalCount => $_getIZ(7);
  @$pb.TagNumber(8)
  set intervalCount($core.int value) => $_setSignedInt32(7, value);
  @$pb.TagNumber(8)
  $core.bool hasIntervalCount() => $_has(7);
  @$pb.TagNumber(8)
  void clearIntervalCount() => $_clearField(8);

  @$pb.TagNumber(9)
  $1.SubscriptionPlanScope get scope => $_getN(8);
  @$pb.TagNumber(9)
  set scope($1.SubscriptionPlanScope value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasScope() => $_has(8);
  @$pb.TagNumber(9)
  void clearScope() => $_clearField(9);

  /// The labels a SUBSCRIPTION_PLAN_SCOPE_LABEL plan opens the series of, and
  /// the series a SUBSCRIPTION_PLAN_SCOPE_SERIES plan opens, by their primary
  /// keys. Both are empty on a SUBSCRIPTION_PLAN_SCOPE_ALL plan. They name what
  /// the tenant chose, published or not, so a client shows only the ones its
  /// catalog reads answer.
  @$pb.TagNumber(10)
  $pb.PbList<$core.String> get labelIds => $_getList(9);

  @$pb.TagNumber(11)
  $pb.PbList<$core.String> get seriesIds => $_getList(10);

  /// The labels of label_ids and the series of series_ids that the calling
  /// surface may show, in the order the plan names them: a label with no
  /// series published there, and a series that is not, are left out. The
  /// series are titled in the reader's locale. ListSubscriptionPlans fills
  /// them; GetMySubscription, which reports a plan the reader already holds,
  /// leaves them empty.
  @$pb.TagNumber(12)
  $pb.PbList<$0.PublishedLabel> get labels => $_getList(11);

  @$pb.TagNumber(13)
  $pb.PbList<$1.Series> get series => $_getList(12);
}

/// A reader's subscription to one plan, as Stripe last reported it.
class Subscription extends $pb.GeneratedMessage {
  factory Subscription({
    $core.String? id,
    SubscriptionPlan? plan,
    $1.SubscriptionStatus? status,
    $core.String? currentPeriodEnd,
    $core.bool? cancelAtPeriodEnd,
    $core.String? createdAt,
  }) {
    final result = Subscription._();
    if (id != null) result.id = id;
    if (plan != null) result.plan = plan;
    if (status != null) result.status = status;
    if (currentPeriodEnd != null) result.currentPeriodEnd = currentPeriodEnd;
    if (cancelAtPeriodEnd != null) result.cancelAtPeriodEnd = cancelAtPeriodEnd;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  Subscription._();

  factory Subscription.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Subscription()..mergeFromBuffer(data, registry);
  factory Subscription.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Subscription()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Subscription',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: Subscription.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOM<SubscriptionPlan>(2, _omitFieldNames ? '' : 'plan',
        subBuilder: SubscriptionPlan.$_createMessage)
    ..aE<$1.SubscriptionStatus>(3, _omitFieldNames ? '' : 'status',
        enumValues: $1.SubscriptionStatus.values)
    ..aOS(4, _omitFieldNames ? '' : 'currentPeriodEnd')
    ..aOB(5, _omitFieldNames ? '' : 'cancelAtPeriodEnd')
    ..aOS(6, _omitFieldNames ? '' : 'createdAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Subscription clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Subscription copyWith(void Function(Subscription) updates) =>
      super.copyWith((message) => updates(message as Subscription))
          as Subscription;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Subscription() / Subscription.new instead')
  static Subscription create() => Subscription._();
  static $pb.GeneratedMessage $_createMessage() => Subscription._();
  @$core.override
  Subscription createEmptyInstance() => Subscription._();
  @$core.pragma('dart2js:noInline')
  static Subscription getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<Subscription>(
          Subscription.$_createMessage);
  static Subscription? _defaultInstance;

  /// The subscription's primary key, a UUID.
  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  /// The plan it bills, published or not: a subscription goes on after the
  /// tenant unpublishes its plan.
  @$pb.TagNumber(2)
  SubscriptionPlan get plan => $_getN(1);
  @$pb.TagNumber(2)
  set plan(SubscriptionPlan value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPlan() => $_has(1);
  @$pb.TagNumber(2)
  void clearPlan() => $_clearField(2);
  @$pb.TagNumber(2)
  SubscriptionPlan ensurePlan() => $_ensure(1);

  @$pb.TagNumber(3)
  $1.SubscriptionStatus get status => $_getN(2);
  @$pb.TagNumber(3)
  set status($1.SubscriptionStatus value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasStatus() => $_has(2);
  @$pb.TagNumber(3)
  void clearStatus() => $_clearField(3);

  /// RFC 3339; the end of the period paid for. Empty when Stripe reported none.
  @$pb.TagNumber(4)
  $core.String get currentPeriodEnd => $_getSZ(3);
  @$pb.TagNumber(4)
  set currentPeriodEnd($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCurrentPeriodEnd() => $_has(3);
  @$pb.TagNumber(4)
  void clearCurrentPeriodEnd() => $_clearField(4);

  /// Whether the reader has canceled it, which ends it at current_period_end
  /// rather than renewing it.
  @$pb.TagNumber(5)
  $core.bool get cancelAtPeriodEnd => $_getBF(4);
  @$pb.TagNumber(5)
  set cancelAtPeriodEnd($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasCancelAtPeriodEnd() => $_has(4);
  @$pb.TagNumber(5)
  void clearCancelAtPeriodEnd() => $_clearField(5);

  /// RFC 3339; when the subscription was first recorded.
  @$pb.TagNumber(6)
  $core.String get createdAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set createdAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);
}

class ListSubscriptionPlansRequest extends $pb.GeneratedMessage {
  factory ListSubscriptionPlansRequest({
    $1.TenantContext? tenant,
    $1.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListSubscriptionPlansRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListSubscriptionPlansRequest._();

  factory ListSubscriptionPlansRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSubscriptionPlansRequest()..mergeFromBuffer(data, registry);
  factory ListSubscriptionPlansRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSubscriptionPlansRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSubscriptionPlansRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListSubscriptionPlansRequest.$_createMessage)
    ..aOM<$1.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $1.TenantContext.$_createMessage)
    ..aE<$1.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $1.ClientSurface.values)
    ..aOS(3, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSubscriptionPlansRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSubscriptionPlansRequest copyWith(
          void Function(ListSubscriptionPlansRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListSubscriptionPlansRequest))
          as ListSubscriptionPlansRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListSubscriptionPlansRequest() / ListSubscriptionPlansRequest.new instead')
  static ListSubscriptionPlansRequest create() =>
      ListSubscriptionPlansRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListSubscriptionPlansRequest._();
  @$core.override
  ListSubscriptionPlansRequest createEmptyInstance() =>
      ListSubscriptionPlansRequest._();
  @$core.pragma('dart2js:noInline')
  static ListSubscriptionPlansRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSubscriptionPlansRequest>(
          ListSubscriptionPlansRequest.$_createMessage);
  static ListSubscriptionPlansRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($1.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantContext ensureTenant() => $_ensure(0);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(2)
  $1.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($1.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);

  /// The reader's locale, which every series title in the answer is written
  /// in, else the tenant's default locale's, else the oldest one. Empty means
  /// the tenant's default locale.
  @$pb.TagNumber(3)
  $core.String get locale => $_getSZ(2);
  @$pb.TagNumber(3)
  set locale($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLocale() => $_has(2);
  @$pb.TagNumber(3)
  void clearLocale() => $_clearField(3);
}

/// Every published plan of the tenant, in the order the tenant created them. A
/// tenant holds at most 20 plans, so the list is never paged. Needs no session.
class ListSubscriptionPlansResponse extends $pb.GeneratedMessage {
  factory ListSubscriptionPlansResponse({
    $core.Iterable<SubscriptionPlan>? plans,
  }) {
    final result = ListSubscriptionPlansResponse._();
    if (plans != null) result.plans.addAll(plans);
    return result;
  }

  ListSubscriptionPlansResponse._();

  factory ListSubscriptionPlansResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSubscriptionPlansResponse()..mergeFromBuffer(data, registry);
  factory ListSubscriptionPlansResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSubscriptionPlansResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSubscriptionPlansResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListSubscriptionPlansResponse.$_createMessage)
    ..pPM<SubscriptionPlan>(1, _omitFieldNames ? '' : 'plans',
        subBuilder: SubscriptionPlan.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSubscriptionPlansResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSubscriptionPlansResponse copyWith(
          void Function(ListSubscriptionPlansResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListSubscriptionPlansResponse))
          as ListSubscriptionPlansResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListSubscriptionPlansResponse() / ListSubscriptionPlansResponse.new instead')
  static ListSubscriptionPlansResponse create() =>
      ListSubscriptionPlansResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListSubscriptionPlansResponse._();
  @$core.override
  ListSubscriptionPlansResponse createEmptyInstance() =>
      ListSubscriptionPlansResponse._();
  @$core.pragma('dart2js:noInline')
  static ListSubscriptionPlansResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSubscriptionPlansResponse>(
          ListSubscriptionPlansResponse.$_createMessage);
  static ListSubscriptionPlansResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<SubscriptionPlan> get plans => $_getList(0);
}

/// Starts a Stripe Checkout of a published plan, in subscription mode, and
/// answers the URL of Stripe's checkout page. The subscription is recorded by
/// Stripe's webhook alone, and its state follows the webhook from then on.
///
/// A reader has at most one checkout they could pay. Asking again for the plan
/// of the reader's checkout that is still open answers that checkout's URL;
/// asking for another plan closes it before the new one is started, so a page
/// still showing it can no longer be paid.
///
/// Signed-in readers only. A plan that is not published is not_found, and a
/// tenant that takes no payments, or takes them through a provider that sells
/// no subscriptions, is failed_precondition. A reader who already holds a
/// subscription that is trialing, active, past due, unpaid, or paused is
/// already_exists, and so is one who has paid a checkout whose subscription
/// Stripe has not reported as ended: one reader holds one subscription, and
/// changing it is what CreateBillingPortalSession is for. Each call spends the
/// reader's allowance for subscription checkouts, and a reader past it is
/// resource_exhausted before anything is asked of Stripe.
///
/// The reader returns to `/my` on the tenant's site with `subscription=success`
/// in the query, or to `/plans` with `subscription=cancelled`.
class StartSubscriptionCheckoutRequest extends $pb.GeneratedMessage {
  factory StartSubscriptionCheckoutRequest({
    $1.TenantContext? tenant,
    $core.String? planId,
  }) {
    final result = StartSubscriptionCheckoutRequest._();
    if (tenant != null) result.tenant = tenant;
    if (planId != null) result.planId = planId;
    return result;
  }

  StartSubscriptionCheckoutRequest._();

  factory StartSubscriptionCheckoutRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartSubscriptionCheckoutRequest()..mergeFromBuffer(data, registry);
  factory StartSubscriptionCheckoutRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartSubscriptionCheckoutRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartSubscriptionCheckoutRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartSubscriptionCheckoutRequest.$_createMessage)
    ..aOM<$1.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $1.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'planId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartSubscriptionCheckoutRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartSubscriptionCheckoutRequest copyWith(
          void Function(StartSubscriptionCheckoutRequest) updates) =>
      super.copyWith(
              (message) => updates(message as StartSubscriptionCheckoutRequest))
          as StartSubscriptionCheckoutRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartSubscriptionCheckoutRequest() / StartSubscriptionCheckoutRequest.new instead')
  static StartSubscriptionCheckoutRequest create() =>
      StartSubscriptionCheckoutRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartSubscriptionCheckoutRequest._();
  @$core.override
  StartSubscriptionCheckoutRequest createEmptyInstance() =>
      StartSubscriptionCheckoutRequest._();
  @$core.pragma('dart2js:noInline')
  static StartSubscriptionCheckoutRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartSubscriptionCheckoutRequest>(
          StartSubscriptionCheckoutRequest.$_createMessage);
  static StartSubscriptionCheckoutRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($1.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantContext ensureTenant() => $_ensure(0);

  @$pb.TagNumber(2)
  $core.String get planId => $_getSZ(1);
  @$pb.TagNumber(2)
  set planId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPlanId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPlanId() => $_clearField(2);
}

class StartSubscriptionCheckoutResponse extends $pb.GeneratedMessage {
  factory StartSubscriptionCheckoutResponse({
    $core.String? checkoutUrl,
  }) {
    final result = StartSubscriptionCheckoutResponse._();
    if (checkoutUrl != null) result.checkoutUrl = checkoutUrl;
    return result;
  }

  StartSubscriptionCheckoutResponse._();

  factory StartSubscriptionCheckoutResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartSubscriptionCheckoutResponse()..mergeFromBuffer(data, registry);
  factory StartSubscriptionCheckoutResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartSubscriptionCheckoutResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartSubscriptionCheckoutResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartSubscriptionCheckoutResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'checkoutUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartSubscriptionCheckoutResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartSubscriptionCheckoutResponse copyWith(
          void Function(StartSubscriptionCheckoutResponse) updates) =>
      super.copyWith((message) =>
              updates(message as StartSubscriptionCheckoutResponse))
          as StartSubscriptionCheckoutResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartSubscriptionCheckoutResponse() / StartSubscriptionCheckoutResponse.new instead')
  static StartSubscriptionCheckoutResponse create() =>
      StartSubscriptionCheckoutResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartSubscriptionCheckoutResponse._();
  @$core.override
  StartSubscriptionCheckoutResponse createEmptyInstance() =>
      StartSubscriptionCheckoutResponse._();
  @$core.pragma('dart2js:noInline')
  static StartSubscriptionCheckoutResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartSubscriptionCheckoutResponse>(
          StartSubscriptionCheckoutResponse.$_createMessage);
  static StartSubscriptionCheckoutResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get checkoutUrl => $_getSZ(0);
  @$pb.TagNumber(1)
  set checkoutUrl($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCheckoutUrl() => $_has(0);
  @$pb.TagNumber(1)
  void clearCheckoutUrl() => $_clearField(1);
}

class GetMySubscriptionRequest extends $pb.GeneratedMessage {
  factory GetMySubscriptionRequest({
    $1.TenantContext? tenant,
  }) {
    final result = GetMySubscriptionRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetMySubscriptionRequest._();

  factory GetMySubscriptionRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySubscriptionRequest()..mergeFromBuffer(data, registry);
  factory GetMySubscriptionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySubscriptionRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySubscriptionRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySubscriptionRequest.$_createMessage)
    ..aOM<$1.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $1.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySubscriptionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySubscriptionRequest copyWith(
          void Function(GetMySubscriptionRequest) updates) =>
      super.copyWith((message) => updates(message as GetMySubscriptionRequest))
          as GetMySubscriptionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySubscriptionRequest() / GetMySubscriptionRequest.new instead')
  static GetMySubscriptionRequest create() => GetMySubscriptionRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMySubscriptionRequest._();
  @$core.override
  GetMySubscriptionRequest createEmptyInstance() =>
      GetMySubscriptionRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMySubscriptionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySubscriptionRequest>(
          GetMySubscriptionRequest.$_createMessage);
  static GetMySubscriptionRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($1.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantContext ensureTenant() => $_ensure(0);
}

/// The signed-in reader's subscription: the latest one that is not over, or
/// failing that the latest one that is. Unset for a reader who has never
/// subscribed.
class GetMySubscriptionResponse extends $pb.GeneratedMessage {
  factory GetMySubscriptionResponse({
    Subscription? subscription,
  }) {
    final result = GetMySubscriptionResponse._();
    if (subscription != null) result.subscription = subscription;
    return result;
  }

  GetMySubscriptionResponse._();

  factory GetMySubscriptionResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySubscriptionResponse()..mergeFromBuffer(data, registry);
  factory GetMySubscriptionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySubscriptionResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySubscriptionResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySubscriptionResponse.$_createMessage)
    ..aOM<Subscription>(1, _omitFieldNames ? '' : 'subscription',
        subBuilder: Subscription.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySubscriptionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySubscriptionResponse copyWith(
          void Function(GetMySubscriptionResponse) updates) =>
      super.copyWith((message) => updates(message as GetMySubscriptionResponse))
          as GetMySubscriptionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySubscriptionResponse() / GetMySubscriptionResponse.new instead')
  static GetMySubscriptionResponse create() => GetMySubscriptionResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMySubscriptionResponse._();
  @$core.override
  GetMySubscriptionResponse createEmptyInstance() =>
      GetMySubscriptionResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMySubscriptionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySubscriptionResponse>(
          GetMySubscriptionResponse.$_createMessage);
  static GetMySubscriptionResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Subscription get subscription => $_getN(0);
  @$pb.TagNumber(1)
  set subscription(Subscription value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSubscription() => $_has(0);
  @$pb.TagNumber(1)
  void clearSubscription() => $_clearField(1);
  @$pb.TagNumber(1)
  Subscription ensureSubscription() => $_ensure(0);
}

/// Opens a session of Stripe's customer portal for the signed-in reader, where
/// they change their payment method, see their invoices, and cancel. It answers
/// the URL of the portal, which returns the reader to `/my` on the tenant's
/// site. What the reader changes there reaches the server through Stripe's
/// webhook.
///
/// A reader who has never subscribed is failed_precondition, and so is a
/// tenant that takes no payments through Stripe.
class CreateBillingPortalSessionRequest extends $pb.GeneratedMessage {
  factory CreateBillingPortalSessionRequest({
    $1.TenantContext? tenant,
  }) {
    final result = CreateBillingPortalSessionRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  CreateBillingPortalSessionRequest._();

  factory CreateBillingPortalSessionRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateBillingPortalSessionRequest()..mergeFromBuffer(data, registry);
  factory CreateBillingPortalSessionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateBillingPortalSessionRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateBillingPortalSessionRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CreateBillingPortalSessionRequest.$_createMessage)
    ..aOM<$1.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $1.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateBillingPortalSessionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateBillingPortalSessionRequest copyWith(
          void Function(CreateBillingPortalSessionRequest) updates) =>
      super.copyWith((message) =>
              updates(message as CreateBillingPortalSessionRequest))
          as CreateBillingPortalSessionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use CreateBillingPortalSessionRequest() / CreateBillingPortalSessionRequest.new instead')
  static CreateBillingPortalSessionRequest create() =>
      CreateBillingPortalSessionRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      CreateBillingPortalSessionRequest._();
  @$core.override
  CreateBillingPortalSessionRequest createEmptyInstance() =>
      CreateBillingPortalSessionRequest._();
  @$core.pragma('dart2js:noInline')
  static CreateBillingPortalSessionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateBillingPortalSessionRequest>(
          CreateBillingPortalSessionRequest.$_createMessage);
  static CreateBillingPortalSessionRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($1.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantContext ensureTenant() => $_ensure(0);
}

class CreateBillingPortalSessionResponse extends $pb.GeneratedMessage {
  factory CreateBillingPortalSessionResponse({
    $core.String? url,
  }) {
    final result = CreateBillingPortalSessionResponse._();
    if (url != null) result.url = url;
    return result;
  }

  CreateBillingPortalSessionResponse._();

  factory CreateBillingPortalSessionResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateBillingPortalSessionResponse()..mergeFromBuffer(data, registry);
  factory CreateBillingPortalSessionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateBillingPortalSessionResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateBillingPortalSessionResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CreateBillingPortalSessionResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'url')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateBillingPortalSessionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateBillingPortalSessionResponse copyWith(
          void Function(CreateBillingPortalSessionResponse) updates) =>
      super.copyWith((message) =>
              updates(message as CreateBillingPortalSessionResponse))
          as CreateBillingPortalSessionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use CreateBillingPortalSessionResponse() / CreateBillingPortalSessionResponse.new instead')
  static CreateBillingPortalSessionResponse create() =>
      CreateBillingPortalSessionResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      CreateBillingPortalSessionResponse._();
  @$core.override
  CreateBillingPortalSessionResponse createEmptyInstance() =>
      CreateBillingPortalSessionResponse._();
  @$core.pragma('dart2js:noInline')
  static CreateBillingPortalSessionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateBillingPortalSessionResponse>(
          CreateBillingPortalSessionResponse.$_createMessage);
  static CreateBillingPortalSessionResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get url => $_getSZ(0);
  @$pb.TagNumber(1)
  set url($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUrl() => $_has(0);
  @$pb.TagNumber(1)
  void clearUrl() => $_clearField(1);
}

class SubscriptionServiceApi {
  final $pb.RpcClient _client;

  SubscriptionServiceApi(this._client);

  $async.Future<ListSubscriptionPlansResponse> listSubscriptionPlans(
          $pb.ClientContext? ctx, ListSubscriptionPlansRequest request) =>
      _client.invoke<ListSubscriptionPlansResponse>(ctx, 'SubscriptionService',
          'ListSubscriptionPlans', request, ListSubscriptionPlansResponse());
  $async.Future<StartSubscriptionCheckoutResponse> startSubscriptionCheckout(
          $pb.ClientContext? ctx, StartSubscriptionCheckoutRequest request) =>
      _client.invoke<StartSubscriptionCheckoutResponse>(
          ctx,
          'SubscriptionService',
          'StartSubscriptionCheckout',
          request,
          StartSubscriptionCheckoutResponse());
  $async.Future<GetMySubscriptionResponse> getMySubscription(
          $pb.ClientContext? ctx, GetMySubscriptionRequest request) =>
      _client.invoke<GetMySubscriptionResponse>(ctx, 'SubscriptionService',
          'GetMySubscription', request, GetMySubscriptionResponse());
  $async.Future<CreateBillingPortalSessionResponse> createBillingPortalSession(
          $pb.ClientContext? ctx, CreateBillingPortalSessionRequest request) =>
      _client.invoke<CreateBillingPortalSessionResponse>(
          ctx,
          'SubscriptionService',
          'CreateBillingPortalSession',
          request,
          CreateBillingPortalSessionResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
