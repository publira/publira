// This is a generated file - do not edit.
//
// Generated from publira/v1/creator.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import '../types/v1/types.pb.dart' as $0;
import 'creator.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'creator.pbenum.dart';

/// A creator the signed-in reader's account is linked to: the link
/// AdminCreatorService.LinkCreatorAccount makes, which is also what opens the
/// creator's episodes to the reader and marks their comments.
class MyCreator extends $pb.GeneratedMessage {
  factory MyCreator({
    $core.String? id,
    $core.String? publicId,
    $core.String? name,
    $core.String? iconImageUrl,
    $core.int? publishedSeriesCount,
  }) {
    final result = MyCreator._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (iconImageUrl != null) result.iconImageUrl = iconImageUrl;
    if (publishedSeriesCount != null)
      result.publishedSeriesCount = publishedSeriesCount;
    return result;
  }

  MyCreator._();

  factory MyCreator.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreator()..mergeFromBuffer(data, registry);
  factory MyCreator.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreator()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyCreator',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyCreator.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..aOS(4, _omitFieldNames ? '' : 'iconImageUrl')
    ..aI(5, _omitFieldNames ? '' : 'publishedSeriesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreator clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreator copyWith(void Function(MyCreator) updates) =>
      super.copyWith((message) => updates(message as MyCreator)) as MyCreator;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyCreator() / MyCreator.new instead')
  static MyCreator create() => MyCreator._();
  static $pb.GeneratedMessage $_createMessage() => MyCreator._();
  @$core.override
  MyCreator createEmptyInstance() => MyCreator._();
  @$core.pragma('dart2js:noInline')
  static MyCreator getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyCreator>(MyCreator.$_createMessage);
  static MyCreator? _defaultInstance;

  /// The creator's primary key, which the other CreatorService RPCs name it
  /// by.
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

  /// Empty for a creator with no icon.
  @$pb.TagNumber(4)
  $core.String get iconImageUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set iconImageUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIconImageUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearIconImageUrl() => $_clearField(4);

  /// The series crediting the creator that the calling surface shows now.
  @$pb.TagNumber(5)
  $core.int get publishedSeriesCount => $_getIZ(4);
  @$pb.TagNumber(5)
  set publishedSeriesCount($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPublishedSeriesCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearPublishedSeriesCount() => $_clearField(5);
}

class ListMyCreatorsRequest extends $pb.GeneratedMessage {
  factory ListMyCreatorsRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
  }) {
    final result = ListMyCreatorsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    return result;
  }

  ListMyCreatorsRequest._();

  factory ListMyCreatorsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorsRequest()..mergeFromBuffer(data, registry);
  factory ListMyCreatorsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyCreatorsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyCreatorsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorsRequest copyWith(
          void Function(ListMyCreatorsRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyCreatorsRequest))
          as ListMyCreatorsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyCreatorsRequest() / ListMyCreatorsRequest.new instead')
  static ListMyCreatorsRequest create() => ListMyCreatorsRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListMyCreatorsRequest._();
  @$core.override
  ListMyCreatorsRequest createEmptyInstance() => ListMyCreatorsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyCreatorsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyCreatorsRequest>(
          ListMyCreatorsRequest.$_createMessage);
  static ListMyCreatorsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);
}

class ListMyCreatorsResponse extends $pb.GeneratedMessage {
  factory ListMyCreatorsResponse({
    $core.Iterable<MyCreator>? creators,
    $core.bool? salesVisible,
  }) {
    final result = ListMyCreatorsResponse._();
    if (creators != null) result.creators.addAll(creators);
    if (salesVisible != null) result.salesVisible = salesVisible;
    return result;
  }

  ListMyCreatorsResponse._();

  factory ListMyCreatorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorsResponse()..mergeFromBuffer(data, registry);
  factory ListMyCreatorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyCreatorsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyCreatorsResponse.$_createMessage)
    ..pPM<MyCreator>(1, _omitFieldNames ? '' : 'creators',
        subBuilder: MyCreator.$_createMessage)
    ..aOB(2, _omitFieldNames ? '' : 'salesVisible')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorsResponse copyWith(
          void Function(ListMyCreatorsResponse) updates) =>
      super.copyWith((message) => updates(message as ListMyCreatorsResponse))
          as ListMyCreatorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyCreatorsResponse() / ListMyCreatorsResponse.new instead')
  static ListMyCreatorsResponse create() => ListMyCreatorsResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListMyCreatorsResponse._();
  @$core.override
  ListMyCreatorsResponse createEmptyInstance() => ListMyCreatorsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyCreatorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyCreatorsResponse>(
          ListMyCreatorsResponse.$_createMessage);
  static ListMyCreatorsResponse? _defaultInstance;

  /// Oldest link first. Empty for an account linked to none, and for an
  /// account that holds a staff role in the tenant.
  @$pb.TagNumber(1)
  $pb.PbList<MyCreator> get creators => $_getList(0);

  /// Whether the tenant shows its creators their sales: when false,
  /// GetMyCreatorStats sets no sales field and the statement RPCs are refused
  /// with CREATOR_SALES_HIDDEN.
  @$pb.TagNumber(2)
  $core.bool get salesVisible => $_getBF(1);
  @$pb.TagNumber(2)
  set salesVisible($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSalesVisible() => $_has(1);
  @$pb.TagNumber(2)
  void clearSalesVisible() => $_clearField(2);
}

/// One episode crediting the creator, with how it was read over the window and,
/// where the tenant shows sales, how it sold.
class MyCreatorEpisodeStats extends $pb.GeneratedMessage {
  factory MyCreatorEpisodeStats({
    $core.String? seriesPublicId,
    $core.String? seriesTitle,
    $core.String? episodePublicId,
    $core.String? episodeTitle,
    $fixnum.Int64? memberViewCount,
    $fixnum.Int64? completeCount,
    $fixnum.Int64? purchaseCount,
    $fixnum.Int64? netAmount,
  }) {
    final result = MyCreatorEpisodeStats._();
    if (seriesPublicId != null) result.seriesPublicId = seriesPublicId;
    if (seriesTitle != null) result.seriesTitle = seriesTitle;
    if (episodePublicId != null) result.episodePublicId = episodePublicId;
    if (episodeTitle != null) result.episodeTitle = episodeTitle;
    if (memberViewCount != null) result.memberViewCount = memberViewCount;
    if (completeCount != null) result.completeCount = completeCount;
    if (purchaseCount != null) result.purchaseCount = purchaseCount;
    if (netAmount != null) result.netAmount = netAmount;
    return result;
  }

  MyCreatorEpisodeStats._();

  factory MyCreatorEpisodeStats.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorEpisodeStats()..mergeFromBuffer(data, registry);
  factory MyCreatorEpisodeStats.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorEpisodeStats()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyCreatorEpisodeStats',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyCreatorEpisodeStats.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'seriesPublicId')
    ..aOS(2, _omitFieldNames ? '' : 'seriesTitle')
    ..aOS(3, _omitFieldNames ? '' : 'episodePublicId')
    ..aOS(4, _omitFieldNames ? '' : 'episodeTitle')
    ..aInt64(5, _omitFieldNames ? '' : 'memberViewCount')
    ..aInt64(6, _omitFieldNames ? '' : 'completeCount')
    ..aInt64(7, _omitFieldNames ? '' : 'purchaseCount')
    ..aInt64(8, _omitFieldNames ? '' : 'netAmount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorEpisodeStats clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorEpisodeStats copyWith(
          void Function(MyCreatorEpisodeStats) updates) =>
      super.copyWith((message) => updates(message as MyCreatorEpisodeStats))
          as MyCreatorEpisodeStats;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MyCreatorEpisodeStats() / MyCreatorEpisodeStats.new instead')
  static MyCreatorEpisodeStats create() => MyCreatorEpisodeStats._();
  static $pb.GeneratedMessage $_createMessage() => MyCreatorEpisodeStats._();
  @$core.override
  MyCreatorEpisodeStats createEmptyInstance() => MyCreatorEpisodeStats._();
  @$core.pragma('dart2js:noInline')
  static MyCreatorEpisodeStats getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyCreatorEpisodeStats>(
          MyCreatorEpisodeStats.$_createMessage);
  static MyCreatorEpisodeStats? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get seriesPublicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set seriesPublicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSeriesPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearSeriesPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get seriesTitle => $_getSZ(1);
  @$pb.TagNumber(2)
  set seriesTitle($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSeriesTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeriesTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get episodePublicId => $_getSZ(2);
  @$pb.TagNumber(3)
  set episodePublicId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEpisodePublicId() => $_has(2);
  @$pb.TagNumber(3)
  void clearEpisodePublicId() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodeTitle => $_getSZ(3);
  @$pb.TagNumber(4)
  set episodeTitle($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeTitle() => $_has(3);
  @$pb.TagNumber(4)
  void clearEpisodeTitle() => $_clearField(4);

  /// Members who opened the episode, and members who read it to the end, as
  /// the console's read-through report counts them.
  @$pb.TagNumber(5)
  $fixnum.Int64 get memberViewCount => $_getI64(4);
  @$pb.TagNumber(5)
  set memberViewCount($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasMemberViewCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearMemberViewCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get completeCount => $_getI64(5);
  @$pb.TagNumber(6)
  set completeCount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCompleteCount() => $_has(5);
  @$pb.TagNumber(6)
  void clearCompleteCount() => $_clearField(6);

  /// The sales of the episode made in the window, as the console's revenue
  /// report by episode counts them, and their net of refunds in the minor unit
  /// of GetMyCreatorStatsResponse.currency. Both unset while the tenant does
  /// not show its creators their sales.
  @$pb.TagNumber(7)
  $fixnum.Int64 get purchaseCount => $_getI64(6);
  @$pb.TagNumber(7)
  set purchaseCount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasPurchaseCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearPurchaseCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get netAmount => $_getI64(7);
  @$pb.TagNumber(8)
  set netAmount($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasNetAmount() => $_has(7);
  @$pb.TagNumber(8)
  void clearNetAmount() => $_clearField(8);
}

/// Cursor pagination over the episodes. Field shape and token rules:
/// proto/README.md.
class GetMyCreatorStatsRequest extends $pb.GeneratedMessage {
  factory GetMyCreatorStatsRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? creatorId,
    $core.String? locale,
    $core.int? limit,
    $core.String? token,
  }) {
    final result = GetMyCreatorStatsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (creatorId != null) result.creatorId = creatorId;
    if (locale != null) result.locale = locale;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    return result;
  }

  GetMyCreatorStatsRequest._();

  factory GetMyCreatorStatsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatsRequest()..mergeFromBuffer(data, registry);
  factory GetMyCreatorStatsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyCreatorStatsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyCreatorStatsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(3, _omitFieldNames ? '' : 'creatorId')
    ..aOS(4, _omitFieldNames ? '' : 'locale')
    ..aI(5, _omitFieldNames ? '' : 'limit')
    ..aOS(6, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatsRequest copyWith(
          void Function(GetMyCreatorStatsRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyCreatorStatsRequest))
          as GetMyCreatorStatsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyCreatorStatsRequest() / GetMyCreatorStatsRequest.new instead')
  static GetMyCreatorStatsRequest create() => GetMyCreatorStatsRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMyCreatorStatsRequest._();
  @$core.override
  GetMyCreatorStatsRequest createEmptyInstance() =>
      GetMyCreatorStatsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyCreatorStatsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyCreatorStatsRequest>(
          GetMyCreatorStatsRequest.$_createMessage);
  static GetMyCreatorStatsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);

  /// MyCreator.id of a creator the account is linked to. Any other is
  /// not_found.
  @$pb.TagNumber(3)
  $core.String get creatorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set creatorId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatorId() => $_clearField(3);

  /// The reader's locale, which every title is given in. Empty means the
  /// tenant's default locale.
  @$pb.TagNumber(4)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(4)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(4)
  void clearLocale() => $_clearField(4);

  /// Max episodes in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(5)
  $core.int get limit => $_getIZ(4);
  @$pb.TagNumber(5)
  set limit($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLimit() => $_has(4);
  @$pb.TagNumber(5)
  void clearLimit() => $_clearField(5);

  /// Opaque token from a previous response. Empty for the first page. A token
  /// issued for another creator or another surface is invalid_argument.
  @$pb.TagNumber(6)
  $core.String get token => $_getSZ(5);
  @$pb.TagNumber(6)
  set token($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasToken() => $_has(5);
  @$pb.TagNumber(6)
  void clearToken() => $_clearField(6);
}

class GetMyCreatorStatsResponse extends $pb.GeneratedMessage {
  factory GetMyCreatorStatsResponse({
    $core.String? periodStart,
    $core.String? periodEnd,
    $core.String? timeZone,
    $fixnum.Int64? followerCount,
    $fixnum.Int64? totalMemberViewCount,
    $fixnum.Int64? totalCompleteCount,
    $core.String? currency,
    $core.Iterable<MyCreatorEpisodeStats>? episodes,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = GetMyCreatorStatsResponse._();
    if (periodStart != null) result.periodStart = periodStart;
    if (periodEnd != null) result.periodEnd = periodEnd;
    if (timeZone != null) result.timeZone = timeZone;
    if (followerCount != null) result.followerCount = followerCount;
    if (totalMemberViewCount != null)
      result.totalMemberViewCount = totalMemberViewCount;
    if (totalCompleteCount != null)
      result.totalCompleteCount = totalCompleteCount;
    if (currency != null) result.currency = currency;
    if (episodes != null) result.episodes.addAll(episodes);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  GetMyCreatorStatsResponse._();

  factory GetMyCreatorStatsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatsResponse()..mergeFromBuffer(data, registry);
  factory GetMyCreatorStatsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyCreatorStatsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyCreatorStatsResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'periodStart')
    ..aOS(2, _omitFieldNames ? '' : 'periodEnd')
    ..aOS(3, _omitFieldNames ? '' : 'timeZone')
    ..aInt64(4, _omitFieldNames ? '' : 'followerCount')
    ..aInt64(5, _omitFieldNames ? '' : 'totalMemberViewCount')
    ..aInt64(6, _omitFieldNames ? '' : 'totalCompleteCount')
    ..aOS(7, _omitFieldNames ? '' : 'currency')
    ..pPM<MyCreatorEpisodeStats>(8, _omitFieldNames ? '' : 'episodes',
        subBuilder: MyCreatorEpisodeStats.$_createMessage)
    ..aOS(9, _omitFieldNames ? '' : 'previousToken')
    ..aOS(10, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatsResponse copyWith(
          void Function(GetMyCreatorStatsResponse) updates) =>
      super.copyWith((message) => updates(message as GetMyCreatorStatsResponse))
          as GetMyCreatorStatsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyCreatorStatsResponse() / GetMyCreatorStatsResponse.new instead')
  static GetMyCreatorStatsResponse create() => GetMyCreatorStatsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyCreatorStatsResponse._();
  @$core.override
  GetMyCreatorStatsResponse createEmptyInstance() =>
      GetMyCreatorStatsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyCreatorStatsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyCreatorStatsResponse>(
          GetMyCreatorStatsResponse.$_createMessage);
  static GetMyCreatorStatsResponse? _defaultInstance;

  /// YYYY-MM-DD: the 28 days of the tenant ending with the last whole one,
  /// which the console's read-through report covers too, in time_zone.
  @$pb.TagNumber(1)
  $core.String get periodStart => $_getSZ(0);
  @$pb.TagNumber(1)
  set periodStart($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPeriodStart() => $_has(0);
  @$pb.TagNumber(1)
  void clearPeriodStart() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get periodEnd => $_getSZ(1);
  @$pb.TagNumber(2)
  set periodEnd($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPeriodEnd() => $_has(1);
  @$pb.TagNumber(2)
  void clearPeriodEnd() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get timeZone => $_getSZ(2);
  @$pb.TagNumber(3)
  set timeZone($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTimeZone() => $_has(2);
  @$pb.TagNumber(3)
  void clearTimeZone() => $_clearField(3);

  /// The readers following the creator now.
  @$pb.TagNumber(4)
  $fixnum.Int64 get followerCount => $_getI64(3);
  @$pb.TagNumber(4)
  set followerCount($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasFollowerCount() => $_has(3);
  @$pb.TagNumber(4)
  void clearFollowerCount() => $_clearField(4);

  /// Over every episode crediting the creator, not only this page's.
  @$pb.TagNumber(5)
  $fixnum.Int64 get totalMemberViewCount => $_getI64(4);
  @$pb.TagNumber(5)
  set totalMemberViewCount($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasTotalMemberViewCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearTotalMemberViewCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get totalCompleteCount => $_getI64(5);
  @$pb.TagNumber(6)
  set totalCompleteCount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasTotalCompleteCount() => $_has(5);
  @$pb.TagNumber(6)
  void clearTotalCompleteCount() => $_clearField(6);

  /// The ISO 4217 code, in capitals, of the tenant currency every net_amount
  /// is in.
  @$pb.TagNumber(7)
  $core.String get currency => $_getSZ(6);
  @$pb.TagNumber(7)
  set currency($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasCurrency() => $_has(6);
  @$pb.TagNumber(7)
  void clearCurrency() => $_clearField(7);

  /// Every episode crediting the creator that the calling surface shows now,
  /// those nobody read in the window included, most completions first, then
  /// by episode.
  @$pb.TagNumber(8)
  $pb.PbList<MyCreatorEpisodeStats> get episodes => $_getList(7);

  @$pb.TagNumber(9)
  $core.String get previousToken => $_getSZ(8);
  @$pb.TagNumber(9)
  set previousToken($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPreviousToken() => $_has(8);
  @$pb.TagNumber(9)
  void clearPreviousToken() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get nextToken => $_getSZ(9);
  @$pb.TagNumber(10)
  set nextToken($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasNextToken() => $_has(9);
  @$pb.TagNumber(10)
  void clearNextToken() => $_clearField(10);
}

/// The creator's part of one closed month: the sum of the creator's own lines of
/// that month's royalty statement, its adjustments included. What the
/// statement holds for other creators, and its totals, are never answered.
class MyCreatorStatement extends $pb.GeneratedMessage {
  factory MyCreatorStatement({
    $core.String? period,
    $core.String? timeZone,
    $core.String? closedAt,
    $core.String? currency,
    $fixnum.Int64? saleCount,
    $fixnum.Int64? grossAmount,
    $fixnum.Int64? refundedAmount,
    $fixnum.Int64? payoutAmount,
  }) {
    final result = MyCreatorStatement._();
    if (period != null) result.period = period;
    if (timeZone != null) result.timeZone = timeZone;
    if (closedAt != null) result.closedAt = closedAt;
    if (currency != null) result.currency = currency;
    if (saleCount != null) result.saleCount = saleCount;
    if (grossAmount != null) result.grossAmount = grossAmount;
    if (refundedAmount != null) result.refundedAmount = refundedAmount;
    if (payoutAmount != null) result.payoutAmount = payoutAmount;
    return result;
  }

  MyCreatorStatement._();

  factory MyCreatorStatement.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorStatement()..mergeFromBuffer(data, registry);
  factory MyCreatorStatement.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorStatement()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyCreatorStatement',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyCreatorStatement.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'period')
    ..aOS(2, _omitFieldNames ? '' : 'timeZone')
    ..aOS(3, _omitFieldNames ? '' : 'closedAt')
    ..aOS(4, _omitFieldNames ? '' : 'currency')
    ..aInt64(5, _omitFieldNames ? '' : 'saleCount')
    ..aInt64(6, _omitFieldNames ? '' : 'grossAmount')
    ..aInt64(7, _omitFieldNames ? '' : 'refundedAmount')
    ..aInt64(8, _omitFieldNames ? '' : 'payoutAmount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorStatement clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorStatement copyWith(void Function(MyCreatorStatement) updates) =>
      super.copyWith((message) => updates(message as MyCreatorStatement))
          as MyCreatorStatement;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyCreatorStatement() / MyCreatorStatement.new instead')
  static MyCreatorStatement create() => MyCreatorStatement._();
  static $pb.GeneratedMessage $_createMessage() => MyCreatorStatement._();
  @$core.override
  MyCreatorStatement createEmptyInstance() => MyCreatorStatement._();
  @$core.pragma('dart2js:noInline')
  static MyCreatorStatement getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyCreatorStatement>(
          MyCreatorStatement.$_createMessage);
  static MyCreatorStatement? _defaultInstance;

  /// The month, as YYYY-MM.
  @$pb.TagNumber(1)
  $core.String get period => $_getSZ(0);
  @$pb.TagNumber(1)
  set period($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPeriod() => $_has(0);
  @$pb.TagNumber(1)
  void clearPeriod() => $_clearField(1);

  /// The IANA zone the month was cut in.
  @$pb.TagNumber(2)
  $core.String get timeZone => $_getSZ(1);
  @$pb.TagNumber(2)
  set timeZone($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTimeZone() => $_has(1);
  @$pb.TagNumber(2)
  void clearTimeZone() => $_clearField(2);

  /// RFC3339.
  @$pb.TagNumber(3)
  $core.String get closedAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set closedAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasClosedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearClosedAt() => $_clearField(3);

  /// The ISO 4217 code every amount is in: the tenant's at close.
  @$pb.TagNumber(4)
  $core.String get currency => $_getSZ(3);
  @$pb.TagNumber(4)
  set currency($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCurrency() => $_has(3);
  @$pb.TagNumber(4)
  void clearCurrency() => $_clearField(4);

  /// Each a sum over the creator's lines, as AdminRoyaltyService's
  /// RoyaltyStatementLine states them, so an adjustment takes off what it
  /// carries and sale_count counts the subscription payments a subscription
  /// line shares beside the sales. All zero for a month that credited the
  /// creator nothing.
  @$pb.TagNumber(5)
  $fixnum.Int64 get saleCount => $_getI64(4);
  @$pb.TagNumber(5)
  set saleCount($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSaleCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearSaleCount() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get grossAmount => $_getI64(5);
  @$pb.TagNumber(6)
  set grossAmount($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasGrossAmount() => $_has(5);
  @$pb.TagNumber(6)
  void clearGrossAmount() => $_clearField(6);

  @$pb.TagNumber(7)
  $fixnum.Int64 get refundedAmount => $_getI64(6);
  @$pb.TagNumber(7)
  set refundedAmount($fixnum.Int64 value) => $_setInt64(6, value);
  @$pb.TagNumber(7)
  $core.bool hasRefundedAmount() => $_has(6);
  @$pb.TagNumber(7)
  void clearRefundedAmount() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get payoutAmount => $_getI64(7);
  @$pb.TagNumber(8)
  set payoutAmount($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasPayoutAmount() => $_has(7);
  @$pb.TagNumber(8)
  void clearPayoutAmount() => $_clearField(8);
}

/// One of the creator's lines of a closed statement, as
/// AdminRoyaltyService.GetRoyaltyStatement answers it. Names are as they stood
/// at close; a public ID is empty once the row it named has been deleted.
class MyCreatorStatementLine extends $pb.GeneratedMessage {
  factory MyCreatorStatementLine({
    $core.int? lineNumber,
    $core.String? seriesPublicId,
    $core.String? seriesTitle,
    $core.String? episodePublicId,
    $core.String? episodeTitle,
    $core.String? roleName,
    $core.int? saleCount,
    $fixnum.Int64? grossAmount,
    $fixnum.Int64? refundedAmount,
    $core.int? shareBps,
    $fixnum.Int64? payoutAmount,
    $core.String? adjustedPeriod,
    CreatorStatementLineSource? source,
  }) {
    final result = MyCreatorStatementLine._();
    if (lineNumber != null) result.lineNumber = lineNumber;
    if (seriesPublicId != null) result.seriesPublicId = seriesPublicId;
    if (seriesTitle != null) result.seriesTitle = seriesTitle;
    if (episodePublicId != null) result.episodePublicId = episodePublicId;
    if (episodeTitle != null) result.episodeTitle = episodeTitle;
    if (roleName != null) result.roleName = roleName;
    if (saleCount != null) result.saleCount = saleCount;
    if (grossAmount != null) result.grossAmount = grossAmount;
    if (refundedAmount != null) result.refundedAmount = refundedAmount;
    if (shareBps != null) result.shareBps = shareBps;
    if (payoutAmount != null) result.payoutAmount = payoutAmount;
    if (adjustedPeriod != null) result.adjustedPeriod = adjustedPeriod;
    if (source != null) result.source = source;
    return result;
  }

  MyCreatorStatementLine._();

  factory MyCreatorStatementLine.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorStatementLine()..mergeFromBuffer(data, registry);
  factory MyCreatorStatementLine.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyCreatorStatementLine()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyCreatorStatementLine',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyCreatorStatementLine.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'lineNumber')
    ..aOS(2, _omitFieldNames ? '' : 'seriesPublicId')
    ..aOS(3, _omitFieldNames ? '' : 'seriesTitle')
    ..aOS(4, _omitFieldNames ? '' : 'episodePublicId')
    ..aOS(5, _omitFieldNames ? '' : 'episodeTitle')
    ..aOS(6, _omitFieldNames ? '' : 'roleName')
    ..aI(7, _omitFieldNames ? '' : 'saleCount')
    ..aInt64(8, _omitFieldNames ? '' : 'grossAmount')
    ..aInt64(9, _omitFieldNames ? '' : 'refundedAmount')
    ..aI(10, _omitFieldNames ? '' : 'shareBps')
    ..aInt64(11, _omitFieldNames ? '' : 'payoutAmount')
    ..aOS(12, _omitFieldNames ? '' : 'adjustedPeriod')
    ..aE<CreatorStatementLineSource>(13, _omitFieldNames ? '' : 'source',
        enumValues: CreatorStatementLineSource.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorStatementLine clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyCreatorStatementLine copyWith(
          void Function(MyCreatorStatementLine) updates) =>
      super.copyWith((message) => updates(message as MyCreatorStatementLine))
          as MyCreatorStatementLine;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MyCreatorStatementLine() / MyCreatorStatementLine.new instead')
  static MyCreatorStatementLine create() => MyCreatorStatementLine._();
  static $pb.GeneratedMessage $_createMessage() => MyCreatorStatementLine._();
  @$core.override
  MyCreatorStatementLine createEmptyInstance() => MyCreatorStatementLine._();
  @$core.pragma('dart2js:noInline')
  static MyCreatorStatementLine getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyCreatorStatementLine>(
          MyCreatorStatementLine.$_createMessage);
  static MyCreatorStatementLine? _defaultInstance;

  /// Position in the statement, from 1. The creator's lines are a subset of
  /// the statement's, so the numbers have gaps.
  @$pb.TagNumber(1)
  $core.int get lineNumber => $_getIZ(0);
  @$pb.TagNumber(1)
  set lineNumber($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLineNumber() => $_has(0);
  @$pb.TagNumber(1)
  void clearLineNumber() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get seriesPublicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set seriesPublicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSeriesPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeriesPublicId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get seriesTitle => $_getSZ(2);
  @$pb.TagNumber(3)
  set seriesTitle($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSeriesTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearSeriesTitle() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodePublicId => $_getSZ(3);
  @$pb.TagNumber(4)
  set episodePublicId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodePublicId() => $_has(3);
  @$pb.TagNumber(4)
  void clearEpisodePublicId() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get episodeTitle => $_getSZ(4);
  @$pb.TagNumber(5)
  set episodeTitle($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEpisodeTitle() => $_has(4);
  @$pb.TagNumber(5)
  void clearEpisodeTitle() => $_clearField(5);

  /// Empty for a credit that states no role.
  @$pb.TagNumber(6)
  $core.String get roleName => $_getSZ(5);
  @$pb.TagNumber(6)
  set roleName($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasRoleName() => $_has(5);
  @$pb.TagNumber(6)
  void clearRoleName() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get saleCount => $_getIZ(6);
  @$pb.TagNumber(7)
  set saleCount($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasSaleCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearSaleCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $fixnum.Int64 get grossAmount => $_getI64(7);
  @$pb.TagNumber(8)
  set grossAmount($fixnum.Int64 value) => $_setInt64(7, value);
  @$pb.TagNumber(8)
  $core.bool hasGrossAmount() => $_has(7);
  @$pb.TagNumber(8)
  void clearGrossAmount() => $_clearField(8);

  @$pb.TagNumber(9)
  $fixnum.Int64 get refundedAmount => $_getI64(8);
  @$pb.TagNumber(9)
  set refundedAmount($fixnum.Int64 value) => $_setInt64(8, value);
  @$pb.TagNumber(9)
  $core.bool hasRefundedAmount() => $_has(8);
  @$pb.TagNumber(9)
  void clearRefundedAmount() => $_clearField(9);

  /// The credit's share in basis points (10000 is all of it), as applied.
  @$pb.TagNumber(10)
  $core.int get shareBps => $_getIZ(9);
  @$pb.TagNumber(10)
  set shareBps($core.int value) => $_setSignedInt32(9, value);
  @$pb.TagNumber(10)
  $core.bool hasShareBps() => $_has(9);
  @$pb.TagNumber(10)
  void clearShareBps() => $_clearField(10);

  @$pb.TagNumber(11)
  $fixnum.Int64 get payoutAmount => $_getI64(10);
  @$pb.TagNumber(11)
  set payoutAmount($fixnum.Int64 value) => $_setInt64(10, value);
  @$pb.TagNumber(11)
  $core.bool hasPayoutAmount() => $_has(10);
  @$pb.TagNumber(11)
  void clearPayoutAmount() => $_clearField(11);

  /// YYYY-MM of the closed month an adjustment line adjusts. Empty for a line
  /// of the month's own sales or subscription payments.
  @$pb.TagNumber(12)
  $core.String get adjustedPeriod => $_getSZ(11);
  @$pb.TagNumber(12)
  set adjustedPeriod($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasAdjustedPeriod() => $_has(11);
  @$pb.TagNumber(12)
  void clearAdjustedPeriod() => $_clearField(12);

  /// What the line credits. On a subscription line, sale_count is the payments
  /// shared to the episode and the amounts are its parts of them. An
  /// adjustment line has the source of the line it adjusts.
  @$pb.TagNumber(13)
  CreatorStatementLineSource get source => $_getN(12);
  @$pb.TagNumber(13)
  set source(CreatorStatementLineSource value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasSource() => $_has(12);
  @$pb.TagNumber(13)
  void clearSource() => $_clearField(13);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListMyCreatorStatementsRequest extends $pb.GeneratedMessage {
  factory ListMyCreatorStatementsRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? creatorId,
    $core.int? limit,
    $core.String? token,
  }) {
    final result = ListMyCreatorStatementsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (creatorId != null) result.creatorId = creatorId;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    return result;
  }

  ListMyCreatorStatementsRequest._();

  factory ListMyCreatorStatementsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorStatementsRequest()..mergeFromBuffer(data, registry);
  factory ListMyCreatorStatementsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorStatementsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyCreatorStatementsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyCreatorStatementsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(3, _omitFieldNames ? '' : 'creatorId')
    ..aI(4, _omitFieldNames ? '' : 'limit')
    ..aOS(5, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorStatementsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorStatementsRequest copyWith(
          void Function(ListMyCreatorStatementsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyCreatorStatementsRequest))
          as ListMyCreatorStatementsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyCreatorStatementsRequest() / ListMyCreatorStatementsRequest.new instead')
  static ListMyCreatorStatementsRequest create() =>
      ListMyCreatorStatementsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyCreatorStatementsRequest._();
  @$core.override
  ListMyCreatorStatementsRequest createEmptyInstance() =>
      ListMyCreatorStatementsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyCreatorStatementsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyCreatorStatementsRequest>(
          ListMyCreatorStatementsRequest.$_createMessage);
  static ListMyCreatorStatementsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);

  /// MyCreator.id of a creator the account is linked to. Any other is
  /// not_found.
  @$pb.TagNumber(3)
  $core.String get creatorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set creatorId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatorId() => $_clearField(3);

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(4)
  $core.int get limit => $_getIZ(3);
  @$pb.TagNumber(4)
  set limit($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLimit() => $_has(3);
  @$pb.TagNumber(4)
  void clearLimit() => $_clearField(4);

  /// Opaque token from a previous response. Empty for the first page. A token
  /// issued for another creator is invalid_argument.
  @$pb.TagNumber(5)
  $core.String get token => $_getSZ(4);
  @$pb.TagNumber(5)
  set token($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasToken() => $_has(4);
  @$pb.TagNumber(5)
  void clearToken() => $_clearField(5);
}

class ListMyCreatorStatementsResponse extends $pb.GeneratedMessage {
  factory ListMyCreatorStatementsResponse({
    $core.Iterable<MyCreatorStatement>? statements,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyCreatorStatementsResponse._();
    if (statements != null) result.statements.addAll(statements);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyCreatorStatementsResponse._();

  factory ListMyCreatorStatementsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorStatementsResponse()..mergeFromBuffer(data, registry);
  factory ListMyCreatorStatementsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyCreatorStatementsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyCreatorStatementsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyCreatorStatementsResponse.$_createMessage)
    ..pPM<MyCreatorStatement>(1, _omitFieldNames ? '' : 'statements',
        subBuilder: MyCreatorStatement.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorStatementsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyCreatorStatementsResponse copyWith(
          void Function(ListMyCreatorStatementsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyCreatorStatementsResponse))
          as ListMyCreatorStatementsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyCreatorStatementsResponse() / ListMyCreatorStatementsResponse.new instead')
  static ListMyCreatorStatementsResponse create() =>
      ListMyCreatorStatementsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyCreatorStatementsResponse._();
  @$core.override
  ListMyCreatorStatementsResponse createEmptyInstance() =>
      ListMyCreatorStatementsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyCreatorStatementsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyCreatorStatementsResponse>(
          ListMyCreatorStatementsResponse.$_createMessage);
  static ListMyCreatorStatementsResponse? _defaultInstance;

  /// Every closed month, newest first.
  @$pb.TagNumber(1)
  $pb.PbList<MyCreatorStatement> get statements => $_getList(0);

  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination over the lines. Field shape and token rules:
/// proto/README.md.
class GetMyCreatorStatementRequest extends $pb.GeneratedMessage {
  factory GetMyCreatorStatementRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? creatorId,
    $core.String? period,
    $core.int? limit,
    $core.String? token,
  }) {
    final result = GetMyCreatorStatementRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (creatorId != null) result.creatorId = creatorId;
    if (period != null) result.period = period;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    return result;
  }

  GetMyCreatorStatementRequest._();

  factory GetMyCreatorStatementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatementRequest()..mergeFromBuffer(data, registry);
  factory GetMyCreatorStatementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatementRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyCreatorStatementRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyCreatorStatementRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(3, _omitFieldNames ? '' : 'creatorId')
    ..aOS(4, _omitFieldNames ? '' : 'period')
    ..aI(5, _omitFieldNames ? '' : 'limit')
    ..aOS(6, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatementRequest copyWith(
          void Function(GetMyCreatorStatementRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyCreatorStatementRequest))
          as GetMyCreatorStatementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyCreatorStatementRequest() / GetMyCreatorStatementRequest.new instead')
  static GetMyCreatorStatementRequest create() =>
      GetMyCreatorStatementRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyCreatorStatementRequest._();
  @$core.override
  GetMyCreatorStatementRequest createEmptyInstance() =>
      GetMyCreatorStatementRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyCreatorStatementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyCreatorStatementRequest>(
          GetMyCreatorStatementRequest.$_createMessage);
  static GetMyCreatorStatementRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);

  /// MyCreator.id of a creator the account is linked to. Any other is
  /// not_found.
  @$pb.TagNumber(3)
  $core.String get creatorId => $_getSZ(2);
  @$pb.TagNumber(3)
  set creatorId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatorId() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatorId() => $_clearField(3);

  /// YYYY-MM of a closed month. A month not closed is not_found.
  @$pb.TagNumber(4)
  $core.String get period => $_getSZ(3);
  @$pb.TagNumber(4)
  set period($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPeriod() => $_has(3);
  @$pb.TagNumber(4)
  void clearPeriod() => $_clearField(4);

  /// Max lines in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(5)
  $core.int get limit => $_getIZ(4);
  @$pb.TagNumber(5)
  set limit($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLimit() => $_has(4);
  @$pb.TagNumber(5)
  void clearLimit() => $_clearField(5);

  /// Opaque token from a previous response. Empty for the first page. A token
  /// issued for another creator or another period is invalid_argument.
  @$pb.TagNumber(6)
  $core.String get token => $_getSZ(5);
  @$pb.TagNumber(6)
  set token($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasToken() => $_has(5);
  @$pb.TagNumber(6)
  void clearToken() => $_clearField(6);
}

class GetMyCreatorStatementResponse extends $pb.GeneratedMessage {
  factory GetMyCreatorStatementResponse({
    MyCreatorStatement? statement,
    $core.Iterable<MyCreatorStatementLine>? lines,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = GetMyCreatorStatementResponse._();
    if (statement != null) result.statement = statement;
    if (lines != null) result.lines.addAll(lines);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  GetMyCreatorStatementResponse._();

  factory GetMyCreatorStatementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatementResponse()..mergeFromBuffer(data, registry);
  factory GetMyCreatorStatementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyCreatorStatementResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyCreatorStatementResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyCreatorStatementResponse.$_createMessage)
    ..aOM<MyCreatorStatement>(1, _omitFieldNames ? '' : 'statement',
        subBuilder: MyCreatorStatement.$_createMessage)
    ..pPM<MyCreatorStatementLine>(2, _omitFieldNames ? '' : 'lines',
        subBuilder: MyCreatorStatementLine.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'previousToken')
    ..aOS(4, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyCreatorStatementResponse copyWith(
          void Function(GetMyCreatorStatementResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyCreatorStatementResponse))
          as GetMyCreatorStatementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyCreatorStatementResponse() / GetMyCreatorStatementResponse.new instead')
  static GetMyCreatorStatementResponse create() =>
      GetMyCreatorStatementResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyCreatorStatementResponse._();
  @$core.override
  GetMyCreatorStatementResponse createEmptyInstance() =>
      GetMyCreatorStatementResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyCreatorStatementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyCreatorStatementResponse>(
          GetMyCreatorStatementResponse.$_createMessage);
  static GetMyCreatorStatementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MyCreatorStatement get statement => $_getN(0);
  @$pb.TagNumber(1)
  set statement(MyCreatorStatement value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasStatement() => $_has(0);
  @$pb.TagNumber(1)
  void clearStatement() => $_clearField(1);
  @$pb.TagNumber(1)
  MyCreatorStatement ensureStatement() => $_ensure(0);

  /// The creator's own lines in line order: the month's sales, then its
  /// subscription payments, then its adjustments.
  @$pb.TagNumber(2)
  $pb.PbList<MyCreatorStatementLine> get lines => $_getList(1);

  @$pb.TagNumber(3)
  $core.String get previousToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set previousToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPreviousToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearPreviousToken() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get nextToken => $_getSZ(3);
  @$pb.TagNumber(4)
  set nextToken($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNextToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearNextToken() => $_clearField(4);
}

/// What a signed-in reader linked to a creator reads of that creator's works.
/// Every RPC requires a session and answers about the session account's links
/// alone. While GetTenantResponse.creator_pages_enabled is false every RPC is
/// failed_precondition with the CREATOR_PAGES_DISABLED reason.
class CreatorServiceApi {
  final $pb.RpcClient _client;

  CreatorServiceApi(this._client);

  /// The creators the account is linked to.
  $async.Future<ListMyCreatorsResponse> listMyCreators(
          $pb.ClientContext? ctx, ListMyCreatorsRequest request) =>
      _client.invoke<ListMyCreatorsResponse>(ctx, 'CreatorService',
          'ListMyCreators', request, ListMyCreatorsResponse());

  /// How the creator's episodes were read over the last 28 whole days of the
  /// tenant, and how many readers follow the creator.
  $async.Future<GetMyCreatorStatsResponse> getMyCreatorStats(
          $pb.ClientContext? ctx, GetMyCreatorStatsRequest request) =>
      _client.invoke<GetMyCreatorStatsResponse>(ctx, 'CreatorService',
          'GetMyCreatorStats', request, GetMyCreatorStatsResponse());

  /// The creator's part of every closed month. failed_precondition with the
  /// CREATOR_SALES_HIDDEN reason while ListMyCreatorsResponse.sales_visible is
  /// false.
  $async.Future<ListMyCreatorStatementsResponse> listMyCreatorStatements(
          $pb.ClientContext? ctx, ListMyCreatorStatementsRequest request) =>
      _client.invoke<ListMyCreatorStatementsResponse>(
          ctx,
          'CreatorService',
          'ListMyCreatorStatements',
          request,
          ListMyCreatorStatementsResponse());

  /// The creator's part of one closed month, line by line. Refused as
  /// ListMyCreatorStatements is.
  $async.Future<GetMyCreatorStatementResponse> getMyCreatorStatement(
          $pb.ClientContext? ctx, GetMyCreatorStatementRequest request) =>
      _client.invoke<GetMyCreatorStatementResponse>(ctx, 'CreatorService',
          'GetMyCreatorStatement', request, GetMyCreatorStatementResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
