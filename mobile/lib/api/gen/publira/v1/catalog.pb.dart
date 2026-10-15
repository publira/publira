// This is a generated file - do not edit.
//
// Generated from publira/v1/catalog.proto.

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
import 'catalog.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'catalog.pbenum.dart';

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListPublishedLabelsRequest extends $pb.GeneratedMessage {
  factory ListPublishedLabelsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.bool? hasPublishedSeries,
  }) {
    final result = ListPublishedLabelsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (hasPublishedSeries != null)
      result.hasPublishedSeries = hasPublishedSeries;
    return result;
  }

  ListPublishedLabelsRequest._();

  factory ListPublishedLabelsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedLabelsRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedLabelsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedLabelsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedLabelsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedLabelsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOB(6, _omitFieldNames ? '' : 'hasPublishedSeries')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedLabelsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedLabelsRequest copyWith(
          void Function(ListPublishedLabelsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedLabelsRequest))
          as ListPublishedLabelsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedLabelsRequest() / ListPublishedLabelsRequest.new instead')
  static ListPublishedLabelsRequest create() => ListPublishedLabelsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedLabelsRequest._();
  @$core.override
  ListPublishedLabelsRequest createEmptyInstance() =>
      ListPublishedLabelsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedLabelsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedLabelsRequest>(
          ListPublishedLabelsRequest.$_createMessage);
  static ListPublishedLabelsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// Keep only the labels with at least one series published on the calling
  /// surface — the labels SearchPublishedLabels answers — for a list that
  /// features labels rather than one that keeps every label's URL reachable.
  /// False lists every label, as the RPC states. A token names the filter it
  /// was built under, so sending it with the other value is invalid_argument
  /// and changing the filter restarts at page 1.
  @$pb.TagNumber(6)
  $core.bool get hasPublishedSeries => $_getBF(4);
  @$pb.TagNumber(6)
  set hasPublishedSeries($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(6)
  $core.bool hasHasPublishedSeries() => $_has(4);
  @$pb.TagNumber(6)
  void clearHasPublishedSeries() => $_clearField(6);
}

class ListPublishedLabelsResponse extends $pb.GeneratedMessage {
  factory ListPublishedLabelsResponse({
    $core.Iterable<PublishedLabel>? labels,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListPublishedLabelsResponse._();
    if (labels != null) result.labels.addAll(labels);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListPublishedLabelsResponse._();

  factory ListPublishedLabelsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedLabelsResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedLabelsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedLabelsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedLabelsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedLabelsResponse.$_createMessage)
    ..pPM<PublishedLabel>(1, _omitFieldNames ? '' : 'labels',
        subBuilder: PublishedLabel.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedLabelsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedLabelsResponse copyWith(
          void Function(ListPublishedLabelsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedLabelsResponse))
          as ListPublishedLabelsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedLabelsResponse() / ListPublishedLabelsResponse.new instead')
  static ListPublishedLabelsResponse create() =>
      ListPublishedLabelsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedLabelsResponse._();
  @$core.override
  ListPublishedLabelsResponse createEmptyInstance() =>
      ListPublishedLabelsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedLabelsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedLabelsResponse>(
          ListPublishedLabelsResponse.$_createMessage);
  static ListPublishedLabelsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedLabel> get labels => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListPublishedSeriesRequest extends $pb.GeneratedMessage {
  factory ListPublishedSeriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    SeriesOrder? order,
    $core.bool? hasFreeEpisodes,
    $core.String? genrePublicId,
    $core.String? tagSlug,
    $0.SeriesStatus? status,
    $core.int? weekday,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListPublishedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (order != null) result.order = order;
    if (hasFreeEpisodes != null) result.hasFreeEpisodes = hasFreeEpisodes;
    if (genrePublicId != null) result.genrePublicId = genrePublicId;
    if (tagSlug != null) result.tagSlug = tagSlug;
    if (status != null) result.status = status;
    if (weekday != null) result.weekday = weekday;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListPublishedSeriesRequest._();

  factory ListPublishedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<SeriesOrder>(5, _omitFieldNames ? '' : 'order',
        enumValues: SeriesOrder.values)
    ..aOB(6, _omitFieldNames ? '' : 'hasFreeEpisodes')
    ..aOS(7, _omitFieldNames ? '' : 'genrePublicId')
    ..aOS(8, _omitFieldNames ? '' : 'tagSlug')
    ..aE<$0.SeriesStatus>(9, _omitFieldNames ? '' : 'status',
        enumValues: $0.SeriesStatus.values)
    ..aI(10, _omitFieldNames ? '' : 'weekday')
    ..aE<$0.ClientSurface>(11, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(12, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedSeriesRequest copyWith(
          void Function(ListPublishedSeriesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedSeriesRequest))
          as ListPublishedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedSeriesRequest() / ListPublishedSeriesRequest.new instead')
  static ListPublishedSeriesRequest create() => ListPublishedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedSeriesRequest._();
  @$core.override
  ListPublishedSeriesRequest createEmptyInstance() =>
      ListPublishedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedSeriesRequest>(
          ListPublishedSeriesRequest.$_createMessage);
  static ListPublishedSeriesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// Sort order. A token carries the order it was built for; sending it with a
  /// different order is invalid_argument, because the page it points at no
  /// longer exists in the new order. Changing the order restarts at page 1.
  @$pb.TagNumber(5)
  SeriesOrder get order => $_getN(3);
  @$pb.TagNumber(5)
  set order(SeriesOrder value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasOrder() => $_has(3);
  @$pb.TagNumber(5)
  void clearOrder() => $_clearField(5);

  /// Keep only the series a reader can start without paying: those whose
  /// free_episode_count is above zero right now. A token carries the filters it
  /// was built for next to the order, and for the same reason — the row it names
  /// sits somewhere else in a differently filtered list — so sending it with a
  /// different filter is invalid_argument and changing the filter restarts at
  /// page 1. Every filter below is bound to the token the same way.
  @$pb.TagNumber(6)
  $core.bool get hasFreeEpisodes => $_getBF(4);
  @$pb.TagNumber(6)
  set hasFreeEpisodes($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(6)
  $core.bool hasHasFreeEpisodes() => $_has(4);
  @$pb.TagNumber(6)
  void clearHasFreeEpisodes() => $_clearField(6);

  /// Keep only the series carrying this genre, named by the public ID
  /// ListPublishedGenres reports. Empty applies no genre filter. A public ID
  /// naming no genre of the tenant is not_found rather than an empty list: the
  /// storefront asked for a page that does not exist, and a genre of another
  /// tenant has to be indistinguishable from one that was never there.
  @$pb.TagNumber(7)
  $core.String get genrePublicId => $_getSZ(5);
  @$pb.TagNumber(7)
  set genrePublicId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(7)
  $core.bool hasGenrePublicId() => $_has(5);
  @$pb.TagNumber(7)
  void clearGenrePublicId() => $_clearField(7);

  /// Keep only the series carrying this tag, named by the slug
  /// ListPublishedTags reports. Empty applies no tag filter. A slug naming no
  /// tag of the tenant is not_found, for the reason genre_public_id is.
  @$pb.TagNumber(8)
  $core.String get tagSlug => $_getSZ(6);
  @$pb.TagNumber(8)
  set tagSlug($core.String value) => $_setString(6, value);
  @$pb.TagNumber(8)
  $core.bool hasTagSlug() => $_has(6);
  @$pb.TagNumber(8)
  void clearTagSlug() => $_clearField(8);

  /// Keep only the series in this serialization state. Unlike the status a
  /// series is saved with, where unspecified means the column default, an
  /// unspecified status here applies no filter: a list nobody narrowed holds
  /// every state.
  @$pb.TagNumber(9)
  $0.SeriesStatus get status => $_getN(7);
  @$pb.TagNumber(9)
  set status($0.SeriesStatus value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasStatus() => $_has(7);
  @$pb.TagNumber(9)
  void clearStatus() => $_clearField(9);

  /// Keep only the series expecting an episode on this weekday, as an
  /// EXTRACT(DOW) number: 0 is Sunday and 6 is Saturday. It is optional because
  /// 0 is Sunday rather than "no weekday"; a weekday outside 0 to 6 is
  /// invalid_argument.
  @$pb.TagNumber(10)
  $core.int get weekday => $_getIZ(8);
  @$pb.TagNumber(10)
  set weekday($core.int value) => $_setSignedInt32(8, value);
  @$pb.TagNumber(10)
  $core.bool hasWeekday() => $_has(8);
  @$pb.TagNumber(10)
  void clearWeekday() => $_clearField(10);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(11)
  $0.ClientSurface get surface => $_getN(9);
  @$pb.TagNumber(11)
  set surface($0.ClientSurface value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasSurface() => $_has(9);
  @$pb.TagNumber(11)
  void clearSurface() => $_clearField(11);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  /// The title orders sort by those titles, so a token of a title order carries
  /// the locale as well, and sending it in another locale is invalid_argument.
  @$pb.TagNumber(12)
  $core.String get locale => $_getSZ(10);
  @$pb.TagNumber(12)
  set locale($core.String value) => $_setString(10, value);
  @$pb.TagNumber(12)
  $core.bool hasLocale() => $_has(10);
  @$pb.TagNumber(12)
  void clearLocale() => $_clearField(12);
}

class ListPublishedSeriesResponse extends $pb.GeneratedMessage {
  factory ListPublishedSeriesResponse({
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListPublishedSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListPublishedSeriesResponse._();

  factory ListPublishedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedSeriesResponse.$_createMessage)
    ..pPM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedSeriesResponse copyWith(
          void Function(ListPublishedSeriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedSeriesResponse))
          as ListPublishedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedSeriesResponse() / ListPublishedSeriesResponse.new instead')
  static ListPublishedSeriesResponse create() =>
      ListPublishedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedSeriesResponse._();
  @$core.override
  ListPublishedSeriesResponse createEmptyInstance() =>
      ListPublishedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedSeriesResponse>(
          ListPublishedSeriesResponse.$_createMessage);
  static ListPublishedSeriesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$0.Series> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

class GetSeriesDetailRequest extends $pb.GeneratedMessage {
  factory GetSeriesDetailRequest({
    $0.TenantContext? tenant,
    $core.String? publicId,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = GetSeriesDetailRequest._();
    if (tenant != null) result.tenant = tenant;
    if (publicId != null) result.publicId = publicId;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetSeriesDetailRequest._();

  factory GetSeriesDetailRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesDetailRequest()..mergeFromBuffer(data, registry);
  factory GetSeriesDetailRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesDetailRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSeriesDetailRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetSeriesDetailRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesDetailRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesDetailRequest copyWith(
          void Function(GetSeriesDetailRequest) updates) =>
      super.copyWith((message) => updates(message as GetSeriesDetailRequest))
          as GetSeriesDetailRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetSeriesDetailRequest() / GetSeriesDetailRequest.new instead')
  static GetSeriesDetailRequest create() => GetSeriesDetailRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetSeriesDetailRequest._();
  @$core.override
  GetSeriesDetailRequest createEmptyInstance() => GetSeriesDetailRequest._();
  @$core.pragma('dart2js:noInline')
  static GetSeriesDetailRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSeriesDetailRequest>(
          GetSeriesDetailRequest.$_createMessage);
  static GetSeriesDetailRequest? _defaultInstance;

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
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(4)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(4)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(4)
  void clearLocale() => $_clearField(4);
}

/// A series' wait-for-free rule as a reader is told it: a signed-in reader may
/// open one priced episode of the series for access_hours, and the next ticket
/// is ready recharge_hours after using one. Whether this reader has a ticket
/// ready is WaitFreeService.GetMyTicketState.
class WaitFreeRule extends $pb.GeneratedMessage {
  factory WaitFreeRule({
    $core.int? rechargeHours,
    $core.int? accessHours,
    $core.int? excludedLatestCount,
    $core.Iterable<$core.String>? excludedEpisodeIds,
  }) {
    final result = WaitFreeRule._();
    if (rechargeHours != null) result.rechargeHours = rechargeHours;
    if (accessHours != null) result.accessHours = accessHours;
    if (excludedLatestCount != null)
      result.excludedLatestCount = excludedLatestCount;
    if (excludedEpisodeIds != null)
      result.excludedEpisodeIds.addAll(excludedEpisodeIds);
    return result;
  }

  WaitFreeRule._();

  factory WaitFreeRule.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WaitFreeRule()..mergeFromBuffer(data, registry);
  factory WaitFreeRule.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WaitFreeRule()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WaitFreeRule',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: WaitFreeRule.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'rechargeHours')
    ..aI(2, _omitFieldNames ? '' : 'accessHours')
    ..aI(3, _omitFieldNames ? '' : 'excludedLatestCount')
    ..pPS(4, _omitFieldNames ? '' : 'excludedEpisodeIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WaitFreeRule clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WaitFreeRule copyWith(void Function(WaitFreeRule) updates) =>
      super.copyWith((message) => updates(message as WaitFreeRule))
          as WaitFreeRule;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use WaitFreeRule() / WaitFreeRule.new instead')
  static WaitFreeRule create() => WaitFreeRule._();
  static $pb.GeneratedMessage $_createMessage() => WaitFreeRule._();
  @$core.override
  WaitFreeRule createEmptyInstance() => WaitFreeRule._();
  @$core.pragma('dart2js:noInline')
  static WaitFreeRule getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<WaitFreeRule>(
          WaitFreeRule.$_createMessage);
  static WaitFreeRule? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get rechargeHours => $_getIZ(0);
  @$pb.TagNumber(1)
  set rechargeHours($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRechargeHours() => $_has(0);
  @$pb.TagNumber(1)
  void clearRechargeHours() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get accessHours => $_getIZ(1);
  @$pb.TagNumber(2)
  set accessHours($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAccessHours() => $_has(1);
  @$pb.TagNumber(2)
  void clearAccessHours() => $_clearField(2);

  /// How many of the latest episodes the rule keeps a ticket off.
  @$pb.TagNumber(3)
  $core.int get excludedLatestCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set excludedLatestCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasExcludedLatestCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearExcludedLatestCount() => $_clearField(3);

  /// The episodes it keeps a ticket off, by Episode.id: the last
  /// excluded_latest_count of GetSeriesDetailResponse.episodes, resolved here so
  /// a client marks them without counting. UseTicket refuses exactly these.
  @$pb.TagNumber(4)
  $pb.PbList<$core.String> get excludedEpisodeIds => $_getList(3);
}

class GetSeriesDetailResponse extends $pb.GeneratedMessage {
  factory GetSeriesDetailResponse({
    $0.Series? series,
    $core.Iterable<$0.Episode>? episodes,
    $core.int? requiredMinimumAge,
    $0.CommentMode? commentMode,
    WaitFreeRule? waitFree,
    $core.Iterable<$core.String>? publishedLocales,
  }) {
    final result = GetSeriesDetailResponse._();
    if (series != null) result.series = series;
    if (episodes != null) result.episodes.addAll(episodes);
    if (requiredMinimumAge != null)
      result.requiredMinimumAge = requiredMinimumAge;
    if (commentMode != null) result.commentMode = commentMode;
    if (waitFree != null) result.waitFree = waitFree;
    if (publishedLocales != null)
      result.publishedLocales.addAll(publishedLocales);
    return result;
  }

  GetSeriesDetailResponse._();

  factory GetSeriesDetailResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesDetailResponse()..mergeFromBuffer(data, registry);
  factory GetSeriesDetailResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesDetailResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSeriesDetailResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetSeriesDetailResponse.$_createMessage)
    ..aOM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..pPM<$0.Episode>(2, _omitFieldNames ? '' : 'episodes',
        subBuilder: $0.Episode.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'requiredMinimumAge')
    ..aE<$0.CommentMode>(4, _omitFieldNames ? '' : 'commentMode',
        enumValues: $0.CommentMode.values)
    ..aOM<WaitFreeRule>(5, _omitFieldNames ? '' : 'waitFree',
        subBuilder: WaitFreeRule.$_createMessage)
    ..pPS(6, _omitFieldNames ? '' : 'publishedLocales')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesDetailResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesDetailResponse copyWith(
          void Function(GetSeriesDetailResponse) updates) =>
      super.copyWith((message) => updates(message as GetSeriesDetailResponse))
          as GetSeriesDetailResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetSeriesDetailResponse() / GetSeriesDetailResponse.new instead')
  static GetSeriesDetailResponse create() => GetSeriesDetailResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetSeriesDetailResponse._();
  @$core.override
  GetSeriesDetailResponse createEmptyInstance() => GetSeriesDetailResponse._();
  @$core.pragma('dart2js:noInline')
  static GetSeriesDetailResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSeriesDetailResponse>(
          GetSeriesDetailResponse.$_createMessage);
  static GetSeriesDetailResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Series get series => $_getN(0);
  @$pb.TagNumber(1)
  set series($0.Series value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSeries() => $_has(0);
  @$pb.TagNumber(1)
  void clearSeries() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Series ensureSeries() => $_ensure(0);

  @$pb.TagNumber(2)
  $pb.PbList<$0.Episode> get episodes => $_getList(1);

  /// How old the tenant's age rule makes a reader prove they are before it will
  /// open this series' bodies, and 0 when the rule asks nothing of it. It is
  /// the rating and the tenant setting resolved together, so a client applies
  /// one number to the reader in front of it instead of carrying its own copy
  /// of which rule covers which rating.
  ///
  /// It says nothing about the reader, which is what keeps this response the
  /// same bytes for everyone: whether a particular reader clears the number is
  /// decided where the body is asked for, by GetEpisodeDetail.
  @$pb.TagNumber(3)
  $core.int get requiredMinimumAge => $_getIZ(2);
  @$pb.TagNumber(3)
  set requiredMinimumAge($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasRequiredMinimumAge() => $_has(2);
  @$pb.TagNumber(3)
  void clearRequiredMinimumAge() => $_clearField(3);

  /// How comments on this series' episodes are published: the series' own mode
  /// when it states one, and the tenant's when it does not. It is the resolved
  /// answer rather than the override, so a client hides or shows the comment
  /// section from this field alone.
  ///
  /// Never COMMENT_MODE_UNSPECIFIED: a series that states nothing follows a
  /// tenant setting that always names a mode, and a stored value naming none
  /// fails this RPC.
  @$pb.TagNumber(4)
  $0.CommentMode get commentMode => $_getN(3);
  @$pb.TagNumber(4)
  set commentMode($0.CommentMode value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasCommentMode() => $_has(3);
  @$pb.TagNumber(4)
  void clearCommentMode() => $_clearField(4);

  /// The series' wait-for-free rule, and unset when the series does not offer
  /// one. Like the rest of this response it says nothing about the reader.
  @$pb.TagNumber(5)
  WaitFreeRule get waitFree => $_getN(4);
  @$pb.TagNumber(5)
  set waitFree(WaitFreeRule value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasWaitFree() => $_has(4);
  @$pb.TagNumber(5)
  void clearWaitFree() => $_clearField(5);
  @$pb.TagNumber(5)
  WaitFreeRule ensureWaitFree() => $_ensure(4);

  /// Every locale the series has a translation in that the tenant offers, the
  /// served one included, in code order: the language alternates of the series.
  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get publishedLocales => $_getList(5);
}

class GetSeriesEpisodeAccessRequest extends $pb.GeneratedMessage {
  factory GetSeriesEpisodeAccessRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? seriesId,
  }) {
    final result = GetSeriesEpisodeAccessRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (seriesId != null) result.seriesId = seriesId;
    return result;
  }

  GetSeriesEpisodeAccessRequest._();

  factory GetSeriesEpisodeAccessRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesEpisodeAccessRequest()..mergeFromBuffer(data, registry);
  factory GetSeriesEpisodeAccessRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesEpisodeAccessRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSeriesEpisodeAccessRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetSeriesEpisodeAccessRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'seriesId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesEpisodeAccessRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesEpisodeAccessRequest copyWith(
          void Function(GetSeriesEpisodeAccessRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetSeriesEpisodeAccessRequest))
          as GetSeriesEpisodeAccessRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetSeriesEpisodeAccessRequest() / GetSeriesEpisodeAccessRequest.new instead')
  static GetSeriesEpisodeAccessRequest create() =>
      GetSeriesEpisodeAccessRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetSeriesEpisodeAccessRequest._();
  @$core.override
  GetSeriesEpisodeAccessRequest createEmptyInstance() =>
      GetSeriesEpisodeAccessRequest._();
  @$core.pragma('dart2js:noInline')
  static GetSeriesEpisodeAccessRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSeriesEpisodeAccessRequest>(
          GetSeriesEpisodeAccessRequest.$_createMessage);
  static GetSeriesEpisodeAccessRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get seriesId => $_getSZ(2);
  @$pb.TagNumber(4)
  set seriesId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasSeriesId() => $_has(2);
  @$pb.TagNumber(4)
  void clearSeriesId() => $_clearField(4);
}

/// What the caller may do with one published episode's body.
class SeriesEpisodeAccess extends $pb.GeneratedMessage {
  factory SeriesEpisodeAccess({
    $core.String? episodePublicId,
    EpisodeAccess? access,
    $core.String? episodeId,
  }) {
    final result = SeriesEpisodeAccess._();
    if (episodePublicId != null) result.episodePublicId = episodePublicId;
    if (access != null) result.access = access;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  SeriesEpisodeAccess._();

  factory SeriesEpisodeAccess.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesEpisodeAccess()..mergeFromBuffer(data, registry);
  factory SeriesEpisodeAccess.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesEpisodeAccess()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SeriesEpisodeAccess',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SeriesEpisodeAccess.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'episodePublicId')
    ..aE<EpisodeAccess>(2, _omitFieldNames ? '' : 'access',
        enumValues: EpisodeAccess.values)
    ..aOS(3, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesEpisodeAccess clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesEpisodeAccess copyWith(void Function(SeriesEpisodeAccess) updates) =>
      super.copyWith((message) => updates(message as SeriesEpisodeAccess))
          as SeriesEpisodeAccess;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use SeriesEpisodeAccess() / SeriesEpisodeAccess.new instead')
  static SeriesEpisodeAccess create() => SeriesEpisodeAccess._();
  static $pb.GeneratedMessage $_createMessage() => SeriesEpisodeAccess._();
  @$core.override
  SeriesEpisodeAccess createEmptyInstance() => SeriesEpisodeAccess._();
  @$core.pragma('dart2js:noInline')
  static SeriesEpisodeAccess getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SeriesEpisodeAccess>(
          SeriesEpisodeAccess.$_createMessage);
  static SeriesEpisodeAccess? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get episodePublicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set episodePublicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEpisodePublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpisodePublicId() => $_clearField(1);

  /// Never EPISODE_ACCESS_UNSPECIFIED.
  @$pb.TagNumber(2)
  EpisodeAccess get access => $_getN(1);
  @$pb.TagNumber(2)
  set access(EpisodeAccess value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasAccess() => $_has(1);
  @$pb.TagNumber(2)
  void clearAccess() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(3)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(3)
  void clearEpisodeId() => $_clearField(3);
}

class GetSeriesEpisodeAccessResponse extends $pb.GeneratedMessage {
  factory GetSeriesEpisodeAccessResponse({
    $core.Iterable<SeriesEpisodeAccess>? episodes,
  }) {
    final result = GetSeriesEpisodeAccessResponse._();
    if (episodes != null) result.episodes.addAll(episodes);
    return result;
  }

  GetSeriesEpisodeAccessResponse._();

  factory GetSeriesEpisodeAccessResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesEpisodeAccessResponse()..mergeFromBuffer(data, registry);
  factory GetSeriesEpisodeAccessResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetSeriesEpisodeAccessResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetSeriesEpisodeAccessResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetSeriesEpisodeAccessResponse.$_createMessage)
    ..pPM<SeriesEpisodeAccess>(1, _omitFieldNames ? '' : 'episodes',
        subBuilder: SeriesEpisodeAccess.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesEpisodeAccessResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetSeriesEpisodeAccessResponse copyWith(
          void Function(GetSeriesEpisodeAccessResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetSeriesEpisodeAccessResponse))
          as GetSeriesEpisodeAccessResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetSeriesEpisodeAccessResponse() / GetSeriesEpisodeAccessResponse.new instead')
  static GetSeriesEpisodeAccessResponse create() =>
      GetSeriesEpisodeAccessResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetSeriesEpisodeAccessResponse._();
  @$core.override
  GetSeriesEpisodeAccessResponse createEmptyInstance() =>
      GetSeriesEpisodeAccessResponse._();
  @$core.pragma('dart2js:noInline')
  static GetSeriesEpisodeAccessResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetSeriesEpisodeAccessResponse>(
          GetSeriesEpisodeAccessResponse.$_createMessage);
  static GetSeriesEpisodeAccessResponse? _defaultInstance;

  /// Every published episode of the series, in the order GetSeriesDetail lists
  /// them.
  @$pb.TagNumber(1)
  $pb.PbList<SeriesEpisodeAccess> get episodes => $_getList(0);
}

class GetEpisodeDetailRequest extends $pb.GeneratedMessage {
  factory GetEpisodeDetailRequest({
    $0.TenantContext? tenant,
    $core.String? publicId,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = GetEpisodeDetailRequest._();
    if (tenant != null) result.tenant = tenant;
    if (publicId != null) result.publicId = publicId;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetEpisodeDetailRequest._();

  factory GetEpisodeDetailRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetEpisodeDetailRequest()..mergeFromBuffer(data, registry);
  factory GetEpisodeDetailRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetEpisodeDetailRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetEpisodeDetailRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetEpisodeDetailRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEpisodeDetailRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEpisodeDetailRequest copyWith(
          void Function(GetEpisodeDetailRequest) updates) =>
      super.copyWith((message) => updates(message as GetEpisodeDetailRequest))
          as GetEpisodeDetailRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetEpisodeDetailRequest() / GetEpisodeDetailRequest.new instead')
  static GetEpisodeDetailRequest create() => GetEpisodeDetailRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetEpisodeDetailRequest._();
  @$core.override
  GetEpisodeDetailRequest createEmptyInstance() => GetEpisodeDetailRequest._();
  @$core.pragma('dart2js:noInline')
  static GetEpisodeDetailRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetEpisodeDetailRequest>(
          GetEpisodeDetailRequest.$_createMessage);
  static GetEpisodeDetailRequest? _defaultInstance;

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
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(4)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(4)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(4)
  void clearLocale() => $_clearField(4);
}

/// A published episode of the series being read that the episode detail links
/// to: one either side of it, or the next one free to read. It holds what a
/// link to that episode needs and nothing about the reader, so an episode
/// detail carrying it stays as cacheable as it was; what the reader may do with
/// the linked episode's body is decided when they open it.
class EpisodeNeighbor extends $pb.GeneratedMessage {
  factory EpisodeNeighbor({
    $core.String? publicId,
    $core.String? title,
    $core.int? orderIndex,
    $core.int? price,
    $core.bool? isFree,
    $core.Iterable<$0.Creator>? creators,
    $0.SurfaceAvailability? purchaseAvailability,
  }) {
    final result = EpisodeNeighbor._();
    if (publicId != null) result.publicId = publicId;
    if (title != null) result.title = title;
    if (orderIndex != null) result.orderIndex = orderIndex;
    if (price != null) result.price = price;
    if (isFree != null) result.isFree = isFree;
    if (creators != null) result.creators.addAll(creators);
    if (purchaseAvailability != null)
      result.purchaseAvailability = purchaseAvailability;
    return result;
  }

  EpisodeNeighbor._();

  factory EpisodeNeighbor.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeNeighbor()..mergeFromBuffer(data, registry);
  factory EpisodeNeighbor.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeNeighbor()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EpisodeNeighbor',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: EpisodeNeighbor.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aI(3, _omitFieldNames ? '' : 'orderIndex')
    ..aI(4, _omitFieldNames ? '' : 'price')
    ..aOB(5, _omitFieldNames ? '' : 'isFree')
    ..pPM<$0.Creator>(6, _omitFieldNames ? '' : 'creators',
        subBuilder: $0.Creator.$_createMessage)
    ..aE<$0.SurfaceAvailability>(
        7, _omitFieldNames ? '' : 'purchaseAvailability',
        enumValues: $0.SurfaceAvailability.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeNeighbor clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeNeighbor copyWith(void Function(EpisodeNeighbor) updates) =>
      super.copyWith((message) => updates(message as EpisodeNeighbor))
          as EpisodeNeighbor;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use EpisodeNeighbor() / EpisodeNeighbor.new instead')
  static EpisodeNeighbor create() => EpisodeNeighbor._();
  static $pb.GeneratedMessage $_createMessage() => EpisodeNeighbor._();
  @$core.override
  EpisodeNeighbor createEmptyInstance() => EpisodeNeighbor._();
  @$core.pragma('dart2js:noInline')
  static EpisodeNeighbor getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<EpisodeNeighbor>(
          EpisodeNeighbor.$_createMessage);
  static EpisodeNeighbor? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get orderIndex => $_getIZ(2);
  @$pb.TagNumber(3)
  set orderIndex($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasOrderIndex() => $_has(2);
  @$pb.TagNumber(3)
  void clearOrderIndex() => $_clearField(3);

  /// What the episode costs. It stays the stored price while a free window is
  /// open, because that is what the episode costs again once the window closes.
  @$pb.TagNumber(4)
  $core.int get price => $_getIZ(3);
  @$pb.TagNumber(4)
  set price($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPrice() => $_has(3);
  @$pb.TagNumber(4)
  void clearPrice() => $_clearField(4);

  /// Whether the body is public right now: price is 0, or a free window is open
  /// on it. It is resolved here rather than read off the price, so a link
  /// cannot say "paid" about an episode that is free at the moment the reader
  /// follows it.
  @$pb.TagNumber(5)
  $core.bool get isFree => $_getBF(4);
  @$pb.TagNumber(5)
  set isFree($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasIsFree() => $_has(4);
  @$pb.TagNumber(5)
  void clearIsFree() => $_clearField(5);

  /// Who the neighbouring episode is credited to, in role priority order. A
  /// series whose artist changed part way through credits its episodes
  /// differently, so a link to the next one names the team the reader will
  /// actually find on it.
  @$pb.TagNumber(6)
  $pb.PbList<$0.Creator> get creators => $_getList(5);

  /// Which surfaces the episode may be bought on, resolved as
  /// Episode.purchase_availability is, so a link to a paid episode sold on the
  /// other surface alone does not quote a price this surface cannot take.
  @$pb.TagNumber(7)
  $0.SurfaceAvailability get purchaseAvailability => $_getN(6);
  @$pb.TagNumber(7)
  set purchaseAvailability($0.SurfaceAvailability value) =>
      $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasPurchaseAvailability() => $_has(6);
  @$pb.TagNumber(7)
  void clearPurchaseAvailability() => $_clearField(7);
}

/// Episode detail for public viewing.
/// Body/content is represented as ordered images for the reader UI.
class GetEpisodeDetailResponse extends $pb.GeneratedMessage {
  factory GetEpisodeDetailResponse({
    $0.Episode? episode,
    $0.Series? series,
    $core.Iterable<$0.EpisodeImage>? images,
    EpisodeAccess? access,
    $core.String? freeUntil,
    EpisodeNeighbor? previousEpisode,
    EpisodeNeighbor? nextEpisode,
    EpisodeEntitlementSource? entitlementSource,
    $core.Iterable<$0.EpisodeImage>? previewImages,
    EpisodeNeighbor? nextFreeEpisode,
    $core.Iterable<$core.String>? publishedLocales,
  }) {
    final result = GetEpisodeDetailResponse._();
    if (episode != null) result.episode = episode;
    if (series != null) result.series = series;
    if (images != null) result.images.addAll(images);
    if (access != null) result.access = access;
    if (freeUntil != null) result.freeUntil = freeUntil;
    if (previousEpisode != null) result.previousEpisode = previousEpisode;
    if (nextEpisode != null) result.nextEpisode = nextEpisode;
    if (entitlementSource != null) result.entitlementSource = entitlementSource;
    if (previewImages != null) result.previewImages.addAll(previewImages);
    if (nextFreeEpisode != null) result.nextFreeEpisode = nextFreeEpisode;
    if (publishedLocales != null)
      result.publishedLocales.addAll(publishedLocales);
    return result;
  }

  GetEpisodeDetailResponse._();

  factory GetEpisodeDetailResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetEpisodeDetailResponse()..mergeFromBuffer(data, registry);
  factory GetEpisodeDetailResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetEpisodeDetailResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetEpisodeDetailResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetEpisodeDetailResponse.$_createMessage)
    ..aOM<$0.Episode>(1, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOM<$0.Series>(2, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..pPM<$0.EpisodeImage>(3, _omitFieldNames ? '' : 'images',
        subBuilder: $0.EpisodeImage.$_createMessage)
    ..aE<EpisodeAccess>(4, _omitFieldNames ? '' : 'access',
        enumValues: EpisodeAccess.values)
    ..aOS(5, _omitFieldNames ? '' : 'freeUntil')
    ..aOM<EpisodeNeighbor>(6, _omitFieldNames ? '' : 'previousEpisode',
        subBuilder: EpisodeNeighbor.$_createMessage)
    ..aOM<EpisodeNeighbor>(7, _omitFieldNames ? '' : 'nextEpisode',
        subBuilder: EpisodeNeighbor.$_createMessage)
    ..aE<EpisodeEntitlementSource>(
        8, _omitFieldNames ? '' : 'entitlementSource',
        enumValues: EpisodeEntitlementSource.values)
    ..pPM<$0.EpisodeImage>(9, _omitFieldNames ? '' : 'previewImages',
        subBuilder: $0.EpisodeImage.$_createMessage)
    ..aOM<EpisodeNeighbor>(10, _omitFieldNames ? '' : 'nextFreeEpisode',
        subBuilder: EpisodeNeighbor.$_createMessage)
    ..pPS(11, _omitFieldNames ? '' : 'publishedLocales')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEpisodeDetailResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetEpisodeDetailResponse copyWith(
          void Function(GetEpisodeDetailResponse) updates) =>
      super.copyWith((message) => updates(message as GetEpisodeDetailResponse))
          as GetEpisodeDetailResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetEpisodeDetailResponse() / GetEpisodeDetailResponse.new instead')
  static GetEpisodeDetailResponse create() => GetEpisodeDetailResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetEpisodeDetailResponse._();
  @$core.override
  GetEpisodeDetailResponse createEmptyInstance() =>
      GetEpisodeDetailResponse._();
  @$core.pragma('dart2js:noInline')
  static GetEpisodeDetailResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetEpisodeDetailResponse>(
          GetEpisodeDetailResponse.$_createMessage);
  static GetEpisodeDetailResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Episode get episode => $_getN(0);
  @$pb.TagNumber(1)
  set episode($0.Episode value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasEpisode() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpisode() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Episode ensureEpisode() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.Series get series => $_getN(1);
  @$pb.TagNumber(2)
  set series($0.Series value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSeries() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeries() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Series ensureSeries() => $_ensure(1);

  /// Body images. Empty when access is EPISODE_ACCESS_LOCKED or
  /// EPISODE_ACCESS_AGE_RESTRICTED; preview_images stands in for them there.
  @$pb.TagNumber(3)
  $pb.PbList<$0.EpisodeImage> get images => $_getList(2);

  /// Viewer access state for this episode.
  @$pb.TagNumber(4)
  EpisodeAccess get access => $_getN(3);
  @$pb.TagNumber(4)
  set access(EpisodeAccess value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasAccess() => $_has(3);
  @$pb.TagNumber(4)
  void clearAccess() => $_clearField(4);

  /// RFC3339 end of the free window open on this episode, empty when none is.
  /// A priced episode reads as free until this instant and is locked again
  /// afterwards, which is what a countdown on the reader's screen counts down
  /// to. An episode whose price is 0 carries no value here: it is not free
  /// until anything. episode.free_until carries the same value.
  @$pb.TagNumber(5)
  $core.String get freeUntil => $_getSZ(4);
  @$pb.TagNumber(5)
  set freeUntil($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasFreeUntil() => $_has(4);
  @$pb.TagNumber(5)
  void clearFreeUntil() => $_clearField(5);

  /// The published episodes either side of this one in the same series, by
  /// order_index and then id, which is the order the series detail lists them
  /// in. Unset at the ends of the series, and both unset when the series has
  /// this episode alone. A draft or scheduled episode is never one of them, so
  /// the pair moves as episodes are published, reordered, or taken down.
  @$pb.TagNumber(6)
  EpisodeNeighbor get previousEpisode => $_getN(5);
  @$pb.TagNumber(6)
  set previousEpisode(EpisodeNeighbor value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasPreviousEpisode() => $_has(5);
  @$pb.TagNumber(6)
  void clearPreviousEpisode() => $_clearField(6);
  @$pb.TagNumber(6)
  EpisodeNeighbor ensurePreviousEpisode() => $_ensure(5);

  @$pb.TagNumber(7)
  EpisodeNeighbor get nextEpisode => $_getN(6);
  @$pb.TagNumber(7)
  set nextEpisode(EpisodeNeighbor value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasNextEpisode() => $_has(6);
  @$pb.TagNumber(7)
  void clearNextEpisode() => $_clearField(7);
  @$pb.TagNumber(7)
  EpisodeNeighbor ensureNextEpisode() => $_ensure(6);

  /// Set only when access is EPISODE_ACCESS_ENTITLED, and unspecified
  /// otherwise.
  @$pb.TagNumber(8)
  EpisodeEntitlementSource get entitlementSource => $_getN(7);
  @$pb.TagNumber(8)
  set entitlementSource(EpisodeEntitlementSource value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasEntitlementSource() => $_has(7);
  @$pb.TagNumber(8)
  void clearEntitlementSource() => $_clearField(8);

  /// A blurred, downscaled rendition of each of the body's opening pages, in
  /// reading order: the first two, or fewer when the body is shorter. Set only
  /// when access is EPISODE_ACCESS_LOCKED or EPISODE_ACCESS_AGE_RESTRICTED, and
  /// empty otherwise, whatever the series' rating.
  ///
  /// The blur is the server's, applied before the image leaves it, so what a
  /// client holds is the rendition and never the page: a client draws it as it
  /// comes and adds no blur of its own. Each image_url needs no token and is
  /// the same for every reader. width and height are the rendition's own,
  /// which keeps the page's aspect ratio and is far smaller than the page;
  /// file_size_bytes is 0, since the rendition is rendered on request and its
  /// size is not known until then.
  @$pb.TagNumber(9)
  $pb.PbList<$0.EpisodeImage> get previewImages => $_getList(8);

  /// The first published episode after this one in the same series, in the
  /// order previous_episode and next_episode follow, whose body is public at
  /// the moment of the read: price is 0, or a free window is open on it. It may
  /// be the same episode as next_episode. Unset when no later episode is free.
  @$pb.TagNumber(10)
  EpisodeNeighbor get nextFreeEpisode => $_getN(9);
  @$pb.TagNumber(10)
  set nextFreeEpisode(EpisodeNeighbor value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasNextFreeEpisode() => $_has(9);
  @$pb.TagNumber(10)
  void clearNextFreeEpisode() => $_clearField(10);
  @$pb.TagNumber(10)
  EpisodeNeighbor ensureNextFreeEpisode() => $_ensure(9);

  /// Every locale the episode has a translation in that the tenant offers, the
  /// served one included, in code order: the language alternates of the episode.
  @$pb.TagNumber(11)
  $pb.PbList<$core.String> get publishedLocales => $_getList(10);
}

/// A creator that currently has at least one published series.
class PublishedCreator extends $pb.GeneratedMessage {
  factory PublishedCreator({
    $core.String? publicId,
    $core.String? name,
    $core.String? profileText,
    $core.String? iconImageUrl,
    $fixnum.Int64? iconImageFileSizeBytes,
    $core.String? iconImageUpdatedAt,
    $core.int? publishedSeriesCount,
    $core.String? id,
  }) {
    final result = PublishedCreator._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (profileText != null) result.profileText = profileText;
    if (iconImageUrl != null) result.iconImageUrl = iconImageUrl;
    if (iconImageFileSizeBytes != null)
      result.iconImageFileSizeBytes = iconImageFileSizeBytes;
    if (iconImageUpdatedAt != null)
      result.iconImageUpdatedAt = iconImageUpdatedAt;
    if (publishedSeriesCount != null)
      result.publishedSeriesCount = publishedSeriesCount;
    if (id != null) result.id = id;
    return result;
  }

  PublishedCreator._();

  factory PublishedCreator.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedCreator()..mergeFromBuffer(data, registry);
  factory PublishedCreator.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedCreator()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishedCreator',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PublishedCreator.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'profileText')
    ..aOS(4, _omitFieldNames ? '' : 'iconImageUrl')
    ..aInt64(5, _omitFieldNames ? '' : 'iconImageFileSizeBytes')
    ..aOS(6, _omitFieldNames ? '' : 'iconImageUpdatedAt')
    ..aI(7, _omitFieldNames ? '' : 'publishedSeriesCount')
    ..aOS(8, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedCreator clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedCreator copyWith(void Function(PublishedCreator) updates) =>
      super.copyWith((message) => updates(message as PublishedCreator))
          as PublishedCreator;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PublishedCreator() / PublishedCreator.new instead')
  static PublishedCreator create() => PublishedCreator._();
  static $pb.GeneratedMessage $_createMessage() => PublishedCreator._();
  @$core.override
  PublishedCreator createEmptyInstance() => PublishedCreator._();
  @$core.pragma('dart2js:noInline')
  static PublishedCreator getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PublishedCreator>(
          PublishedCreator.$_createMessage);
  static PublishedCreator? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get profileText => $_getSZ(2);
  @$pb.TagNumber(3)
  set profileText($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasProfileText() => $_has(2);
  @$pb.TagNumber(3)
  void clearProfileText() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get iconImageUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set iconImageUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIconImageUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearIconImageUrl() => $_clearField(4);

  @$pb.TagNumber(5)
  $fixnum.Int64 get iconImageFileSizeBytes => $_getI64(4);
  @$pb.TagNumber(5)
  set iconImageFileSizeBytes($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(5)
  $core.bool hasIconImageFileSizeBytes() => $_has(4);
  @$pb.TagNumber(5)
  void clearIconImageFileSizeBytes() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get iconImageUpdatedAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set iconImageUpdatedAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIconImageUpdatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearIconImageUpdatedAt() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get publishedSeriesCount => $_getIZ(6);
  @$pb.TagNumber(7)
  set publishedSeriesCount($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasPublishedSeriesCount() => $_has(6);
  @$pb.TagNumber(7)
  void clearPublishedSeriesCount() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get id => $_getSZ(7);
  @$pb.TagNumber(8)
  set id($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasId() => $_has(7);
  @$pb.TagNumber(8)
  void clearId() => $_clearField(8);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Sorted by creator name, then id. There is no order field: name order is the
/// only list the storefront needs, and a later selectable order would have to
/// carry its name in the token (see proto/README.md).
class ListPublishedCreatorsRequest extends $pb.GeneratedMessage {
  factory ListPublishedCreatorsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = ListPublishedCreatorsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  ListPublishedCreatorsRequest._();

  factory ListPublishedCreatorsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedCreatorsRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedCreatorsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedCreatorsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedCreatorsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedCreatorsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedCreatorsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedCreatorsRequest copyWith(
          void Function(ListPublishedCreatorsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedCreatorsRequest))
          as ListPublishedCreatorsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedCreatorsRequest() / ListPublishedCreatorsRequest.new instead')
  static ListPublishedCreatorsRequest create() =>
      ListPublishedCreatorsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedCreatorsRequest._();
  @$core.override
  ListPublishedCreatorsRequest createEmptyInstance() =>
      ListPublishedCreatorsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedCreatorsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedCreatorsRequest>(
          ListPublishedCreatorsRequest.$_createMessage);
  static ListPublishedCreatorsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);
}

class ListPublishedCreatorsResponse extends $pb.GeneratedMessage {
  factory ListPublishedCreatorsResponse({
    $core.Iterable<PublishedCreator>? creators,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListPublishedCreatorsResponse._();
    if (creators != null) result.creators.addAll(creators);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListPublishedCreatorsResponse._();

  factory ListPublishedCreatorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedCreatorsResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedCreatorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedCreatorsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedCreatorsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedCreatorsResponse.$_createMessage)
    ..pPM<PublishedCreator>(1, _omitFieldNames ? '' : 'creators',
        subBuilder: PublishedCreator.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedCreatorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedCreatorsResponse copyWith(
          void Function(ListPublishedCreatorsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedCreatorsResponse))
          as ListPublishedCreatorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedCreatorsResponse() / ListPublishedCreatorsResponse.new instead')
  static ListPublishedCreatorsResponse create() =>
      ListPublishedCreatorsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedCreatorsResponse._();
  @$core.override
  ListPublishedCreatorsResponse createEmptyInstance() =>
      ListPublishedCreatorsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedCreatorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedCreatorsResponse>(
          ListPublishedCreatorsResponse.$_createMessage);
  static ListPublishedCreatorsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedCreator> get creators => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination for the creator's published series. Field shape and token
/// rules: proto/README.md. Sorted by title, then id. There is no order field:
/// title order is the only series list the creator page needs, and a later
/// selectable order would have to carry its name in the token.
class GetPublishedCreatorDetailRequest extends $pb.GeneratedMessage {
  factory GetPublishedCreatorDetailRequest({
    $0.TenantContext? tenant,
    $core.String? publicId,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = GetPublishedCreatorDetailRequest._();
    if (tenant != null) result.tenant = tenant;
    if (publicId != null) result.publicId = publicId;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetPublishedCreatorDetailRequest._();

  factory GetPublishedCreatorDetailRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedCreatorDetailRequest()..mergeFromBuffer(data, registry);
  factory GetPublishedCreatorDetailRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedCreatorDetailRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedCreatorDetailRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedCreatorDetailRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedCreatorDetailRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedCreatorDetailRequest copyWith(
          void Function(GetPublishedCreatorDetailRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetPublishedCreatorDetailRequest))
          as GetPublishedCreatorDetailRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedCreatorDetailRequest() / GetPublishedCreatorDetailRequest.new instead')
  static GetPublishedCreatorDetailRequest create() =>
      GetPublishedCreatorDetailRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPublishedCreatorDetailRequest._();
  @$core.override
  GetPublishedCreatorDetailRequest createEmptyInstance() =>
      GetPublishedCreatorDetailRequest._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedCreatorDetailRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedCreatorDetailRequest>(
          GetPublishedCreatorDetailRequest.$_createMessage);
  static GetPublishedCreatorDetailRequest? _defaultInstance;

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
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// Max series in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  /// The series are sorted by those titles, so a token carries the locale as
  /// well, and sending it in another locale is invalid_argument.
  @$pb.TagNumber(6)
  $core.String get locale => $_getSZ(5);
  @$pb.TagNumber(6)
  set locale($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasLocale() => $_has(5);
  @$pb.TagNumber(6)
  void clearLocale() => $_clearField(6);
}

class GetPublishedCreatorDetailResponse extends $pb.GeneratedMessage {
  factory GetPublishedCreatorDetailResponse({
    PublishedCreator? creator,
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = GetPublishedCreatorDetailResponse._();
    if (creator != null) result.creator = creator;
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  GetPublishedCreatorDetailResponse._();

  factory GetPublishedCreatorDetailResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedCreatorDetailResponse()..mergeFromBuffer(data, registry);
  factory GetPublishedCreatorDetailResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedCreatorDetailResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedCreatorDetailResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedCreatorDetailResponse.$_createMessage)
    ..aOM<PublishedCreator>(1, _omitFieldNames ? '' : 'creator',
        subBuilder: PublishedCreator.$_createMessage)
    ..pPM<$0.Series>(2, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'previousToken')
    ..aOS(4, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedCreatorDetailResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedCreatorDetailResponse copyWith(
          void Function(GetPublishedCreatorDetailResponse) updates) =>
      super.copyWith((message) =>
              updates(message as GetPublishedCreatorDetailResponse))
          as GetPublishedCreatorDetailResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedCreatorDetailResponse() / GetPublishedCreatorDetailResponse.new instead')
  static GetPublishedCreatorDetailResponse create() =>
      GetPublishedCreatorDetailResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPublishedCreatorDetailResponse._();
  @$core.override
  GetPublishedCreatorDetailResponse createEmptyInstance() =>
      GetPublishedCreatorDetailResponse._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedCreatorDetailResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedCreatorDetailResponse>(
          GetPublishedCreatorDetailResponse.$_createMessage);
  static GetPublishedCreatorDetailResponse? _defaultInstance;

  @$pb.TagNumber(1)
  PublishedCreator get creator => $_getN(0);
  @$pb.TagNumber(1)
  set creator(PublishedCreator value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasCreator() => $_has(0);
  @$pb.TagNumber(1)
  void clearCreator() => $_clearField(1);
  @$pb.TagNumber(1)
  PublishedCreator ensureCreator() => $_ensure(0);

  /// One page of published series credited to this creator, title ascending.
  @$pb.TagNumber(2)
  $pb.PbList<$0.Series> get series => $_getList(1);

  /// Token for the previous series page. Empty on the first page.
  @$pb.TagNumber(3)
  $core.String get previousToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set previousToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPreviousToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearPreviousToken() => $_clearField(3);

  /// Token for the next series page. Empty on the last page.
  @$pb.TagNumber(4)
  $core.String get nextToken => $_getSZ(3);
  @$pb.TagNumber(4)
  set nextToken($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNextToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearNextToken() => $_clearField(4);
}

/// A label that belongs to the requested tenant, plus how many of its series
/// are currently published on the calling surface. Labels have no unpublished
/// state of their own; a label with zero published series is still returned
/// by GetPublishedLabelDetail and ListPublishedLabels, so a shareable detail
/// URL stays valid after its last series is taken down. SearchPublishedLabels,
/// and ListPublishedLabels with has_published_series, answer only labels whose
/// count is above zero.
class PublishedLabel extends $pb.GeneratedMessage {
  factory PublishedLabel({
    $core.String? publicId,
    $core.String? name,
    $core.String? eyeCatchImageUpdatedAt,
    $core.Iterable<$0.SeriesEyeCatchVariant>? eyeCatchImageVariants,
    $core.int? publishedSeriesCount,
  }) {
    final result = PublishedLabel._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (eyeCatchImageUpdatedAt != null)
      result.eyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    if (publishedSeriesCount != null)
      result.publishedSeriesCount = publishedSeriesCount;
    return result;
  }

  PublishedLabel._();

  factory PublishedLabel.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedLabel()..mergeFromBuffer(data, registry);
  factory PublishedLabel.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedLabel()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishedLabel',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PublishedLabel.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'eyeCatchImageUpdatedAt')
    ..pPM<$0.SeriesEyeCatchVariant>(
        4, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: $0.SeriesEyeCatchVariant.$_createMessage)
    ..aI(5, _omitFieldNames ? '' : 'publishedSeriesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedLabel clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedLabel copyWith(void Function(PublishedLabel) updates) =>
      super.copyWith((message) => updates(message as PublishedLabel))
          as PublishedLabel;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PublishedLabel() / PublishedLabel.new instead')
  static PublishedLabel create() => PublishedLabel._();
  static $pb.GeneratedMessage $_createMessage() => PublishedLabel._();
  @$core.override
  PublishedLabel createEmptyInstance() => PublishedLabel._();
  @$core.pragma('dart2js:noInline')
  static PublishedLabel getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PublishedLabel>(
          PublishedLabel.$_createMessage);
  static PublishedLabel? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get eyeCatchImageUpdatedAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set eyeCatchImageUpdatedAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEyeCatchImageUpdatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearEyeCatchImageUpdatedAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<$0.SeriesEyeCatchVariant> get eyeCatchImageVariants =>
      $_getList(3);

  @$pb.TagNumber(5)
  $core.int get publishedSeriesCount => $_getIZ(4);
  @$pb.TagNumber(5)
  set publishedSeriesCount($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPublishedSeriesCount() => $_has(4);
  @$pb.TagNumber(5)
  void clearPublishedSeriesCount() => $_clearField(5);
}

/// Cursor pagination for the label's published series. Field shape and token
/// rules: proto/README.md. Sorted by title, then id. There is no order field:
/// title order is the only series list the label page needs, and a later
/// selectable order would have to carry its name in the token.
class GetPublishedLabelDetailRequest extends $pb.GeneratedMessage {
  factory GetPublishedLabelDetailRequest({
    $0.TenantContext? tenant,
    $core.String? publicId,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = GetPublishedLabelDetailRequest._();
    if (tenant != null) result.tenant = tenant;
    if (publicId != null) result.publicId = publicId;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetPublishedLabelDetailRequest._();

  factory GetPublishedLabelDetailRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedLabelDetailRequest()..mergeFromBuffer(data, registry);
  factory GetPublishedLabelDetailRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedLabelDetailRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedLabelDetailRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedLabelDetailRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedLabelDetailRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedLabelDetailRequest copyWith(
          void Function(GetPublishedLabelDetailRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetPublishedLabelDetailRequest))
          as GetPublishedLabelDetailRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedLabelDetailRequest() / GetPublishedLabelDetailRequest.new instead')
  static GetPublishedLabelDetailRequest create() =>
      GetPublishedLabelDetailRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPublishedLabelDetailRequest._();
  @$core.override
  GetPublishedLabelDetailRequest createEmptyInstance() =>
      GetPublishedLabelDetailRequest._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedLabelDetailRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedLabelDetailRequest>(
          GetPublishedLabelDetailRequest.$_createMessage);
  static GetPublishedLabelDetailRequest? _defaultInstance;

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
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// Max series in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  /// The series are sorted by those titles, so a token carries the locale as
  /// well, and sending it in another locale is invalid_argument.
  @$pb.TagNumber(6)
  $core.String get locale => $_getSZ(5);
  @$pb.TagNumber(6)
  set locale($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasLocale() => $_has(5);
  @$pb.TagNumber(6)
  void clearLocale() => $_clearField(6);
}

class GetPublishedLabelDetailResponse extends $pb.GeneratedMessage {
  factory GetPublishedLabelDetailResponse({
    PublishedLabel? label,
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = GetPublishedLabelDetailResponse._();
    if (label != null) result.label = label;
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  GetPublishedLabelDetailResponse._();

  factory GetPublishedLabelDetailResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedLabelDetailResponse()..mergeFromBuffer(data, registry);
  factory GetPublishedLabelDetailResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedLabelDetailResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedLabelDetailResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedLabelDetailResponse.$_createMessage)
    ..aOM<PublishedLabel>(1, _omitFieldNames ? '' : 'label',
        subBuilder: PublishedLabel.$_createMessage)
    ..pPM<$0.Series>(2, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'previousToken')
    ..aOS(4, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedLabelDetailResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedLabelDetailResponse copyWith(
          void Function(GetPublishedLabelDetailResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetPublishedLabelDetailResponse))
          as GetPublishedLabelDetailResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedLabelDetailResponse() / GetPublishedLabelDetailResponse.new instead')
  static GetPublishedLabelDetailResponse create() =>
      GetPublishedLabelDetailResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPublishedLabelDetailResponse._();
  @$core.override
  GetPublishedLabelDetailResponse createEmptyInstance() =>
      GetPublishedLabelDetailResponse._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedLabelDetailResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedLabelDetailResponse>(
          GetPublishedLabelDetailResponse.$_createMessage);
  static GetPublishedLabelDetailResponse? _defaultInstance;

  @$pb.TagNumber(1)
  PublishedLabel get label => $_getN(0);
  @$pb.TagNumber(1)
  set label(PublishedLabel value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasLabel() => $_has(0);
  @$pb.TagNumber(1)
  void clearLabel() => $_clearField(1);
  @$pb.TagNumber(1)
  PublishedLabel ensureLabel() => $_ensure(0);

  /// One page of published series on this label, title ascending.
  @$pb.TagNumber(2)
  $pb.PbList<$0.Series> get series => $_getList(1);

  /// Token for the previous series page. Empty on the first page.
  @$pb.TagNumber(3)
  $core.String get previousToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set previousToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPreviousToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearPreviousToken() => $_clearField(3);

  /// Token for the next series page. Empty on the last page.
  @$pb.TagNumber(4)
  $core.String get nextToken => $_getSZ(3);
  @$pb.TagNumber(4)
  set nextToken($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNextToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearNextToken() => $_clearField(4);
}

/// A genre the tenant curates, next to how many of its series are published
/// right now. The count is what a browse page puts beside the name; it is
/// counted per read rather than stored, so a series taken down stops counting
/// the moment it does.
class PublishedGenre extends $pb.GeneratedMessage {
  factory PublishedGenre({
    $core.String? publicId,
    $core.String? name,
    $core.String? slug,
    $core.int? publishedSeriesCount,
    $core.Iterable<PublishedGenreFeaturedSeries>? featuredSeries,
    $core.Iterable<$0.SeriesEyeCatchVariant>? eyeCatchImageVariants,
  }) {
    final result = PublishedGenre._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (slug != null) result.slug = slug;
    if (publishedSeriesCount != null)
      result.publishedSeriesCount = publishedSeriesCount;
    if (featuredSeries != null) result.featuredSeries.addAll(featuredSeries);
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    return result;
  }

  PublishedGenre._();

  factory PublishedGenre.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedGenre()..mergeFromBuffer(data, registry);
  factory PublishedGenre.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedGenre()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishedGenre',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PublishedGenre.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'slug')
    ..aI(4, _omitFieldNames ? '' : 'publishedSeriesCount')
    ..pPM<PublishedGenreFeaturedSeries>(
        5, _omitFieldNames ? '' : 'featuredSeries',
        subBuilder: PublishedGenreFeaturedSeries.$_createMessage)
    ..pPM<$0.SeriesEyeCatchVariant>(
        6, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: $0.SeriesEyeCatchVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedGenre clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedGenre copyWith(void Function(PublishedGenre) updates) =>
      super.copyWith((message) => updates(message as PublishedGenre))
          as PublishedGenre;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PublishedGenre() / PublishedGenre.new instead')
  static PublishedGenre create() => PublishedGenre._();
  static $pb.GeneratedMessage $_createMessage() => PublishedGenre._();
  @$core.override
  PublishedGenre createEmptyInstance() => PublishedGenre._();
  @$core.pragma('dart2js:noInline')
  static PublishedGenre getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PublishedGenre>(
          PublishedGenre.$_createMessage);
  static PublishedGenre? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get slug => $_getSZ(2);
  @$pb.TagNumber(3)
  set slug($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSlug() => $_has(2);
  @$pb.TagNumber(3)
  void clearSlug() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get publishedSeriesCount => $_getIZ(3);
  @$pb.TagNumber(4)
  set publishedSeriesCount($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPublishedSeriesCount() => $_has(3);
  @$pb.TagNumber(4)
  void clearPublishedSeriesCount() => $_clearField(4);

  /// Up to four series to draw the genre's tile from: the genre's weekly
  /// leaderboard first, in its order, then its newest published series. Each
  /// is published now, visible on the requested surface, and rated all-ages.
  /// Empty when the genre has no such series.
  @$pb.TagNumber(5)
  $pb.PbList<PublishedGenreFeaturedSeries> get featuredSeries => $_getList(4);

  /// The eye-catch the console uploaded for the genre. Empty when it has none.
  @$pb.TagNumber(6)
  $pb.PbList<$0.SeriesEyeCatchVariant> get eyeCatchImageVariants =>
      $_getList(5);
}

/// A series on a genre's tile. The title is what a frame shows for a work with
/// no artwork.
class PublishedGenreFeaturedSeries extends $pb.GeneratedMessage {
  factory PublishedGenreFeaturedSeries({
    $core.String? publicId,
    $core.String? title,
    $core.Iterable<$0.SeriesEyeCatchVariant>? eyeCatchImageVariants,
  }) {
    final result = PublishedGenreFeaturedSeries._();
    if (publicId != null) result.publicId = publicId;
    if (title != null) result.title = title;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    return result;
  }

  PublishedGenreFeaturedSeries._();

  factory PublishedGenreFeaturedSeries.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedGenreFeaturedSeries()..mergeFromBuffer(data, registry);
  factory PublishedGenreFeaturedSeries.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedGenreFeaturedSeries()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishedGenreFeaturedSeries',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PublishedGenreFeaturedSeries.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..pPM<$0.SeriesEyeCatchVariant>(
        3, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: $0.SeriesEyeCatchVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedGenreFeaturedSeries clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedGenreFeaturedSeries copyWith(
          void Function(PublishedGenreFeaturedSeries) updates) =>
      super.copyWith(
              (message) => updates(message as PublishedGenreFeaturedSeries))
          as PublishedGenreFeaturedSeries;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use PublishedGenreFeaturedSeries() / PublishedGenreFeaturedSeries.new instead')
  static PublishedGenreFeaturedSeries create() =>
      PublishedGenreFeaturedSeries._();
  static $pb.GeneratedMessage $_createMessage() =>
      PublishedGenreFeaturedSeries._();
  @$core.override
  PublishedGenreFeaturedSeries createEmptyInstance() =>
      PublishedGenreFeaturedSeries._();
  @$core.pragma('dart2js:noInline')
  static PublishedGenreFeaturedSeries getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PublishedGenreFeaturedSeries>(
          PublishedGenreFeaturedSeries.$_createMessage);
  static PublishedGenreFeaturedSeries? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $pb.PbList<$0.SeriesEyeCatchVariant> get eyeCatchImageVariants =>
      $_getList(2);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Sorted by the tenant's own genre order, then id. There is no order field:
/// the console decides where a genre sits, and a browse page that reordered
/// them would be showing a list the tenant did not arrange.
/// A genre no published series carries is still listed, for the reason a label
/// with no published series is: the URL of its page has to keep working after
/// its last series is taken down.
class ListPublishedGenresRequest extends $pb.GeneratedMessage {
  factory ListPublishedGenresRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListPublishedGenresRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListPublishedGenresRequest._();

  factory ListPublishedGenresRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedGenresRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedGenresRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedGenresRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedGenresRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedGenresRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedGenresRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedGenresRequest copyWith(
          void Function(ListPublishedGenresRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedGenresRequest))
          as ListPublishedGenresRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedGenresRequest() / ListPublishedGenresRequest.new instead')
  static ListPublishedGenresRequest create() => ListPublishedGenresRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedGenresRequest._();
  @$core.override
  ListPublishedGenresRequest createEmptyInstance() =>
      ListPublishedGenresRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedGenresRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedGenresRequest>(
          ListPublishedGenresRequest.$_createMessage);
  static ListPublishedGenresRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListPublishedGenresResponse extends $pb.GeneratedMessage {
  factory ListPublishedGenresResponse({
    $core.Iterable<PublishedGenre>? genres,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListPublishedGenresResponse._();
    if (genres != null) result.genres.addAll(genres);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListPublishedGenresResponse._();

  factory ListPublishedGenresResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedGenresResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedGenresResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedGenresResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedGenresResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedGenresResponse.$_createMessage)
    ..pPM<PublishedGenre>(1, _omitFieldNames ? '' : 'genres',
        subBuilder: PublishedGenre.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedGenresResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedGenresResponse copyWith(
          void Function(ListPublishedGenresResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedGenresResponse))
          as ListPublishedGenresResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedGenresResponse() / ListPublishedGenresResponse.new instead')
  static ListPublishedGenresResponse create() =>
      ListPublishedGenresResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedGenresResponse._();
  @$core.override
  ListPublishedGenresResponse createEmptyInstance() =>
      ListPublishedGenresResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedGenresResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedGenresResponse>(
          ListPublishedGenresResponse.$_createMessage);
  static ListPublishedGenresResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedGenre> get genres => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// A tag at least one published series carries, next to how many carry it. A
/// tag is addressed by slug, which is why it has no public ID of its own.
class PublishedTag extends $pb.GeneratedMessage {
  factory PublishedTag({
    $core.String? name,
    $core.String? slug,
    $core.int? publishedSeriesCount,
  }) {
    final result = PublishedTag._();
    if (name != null) result.name = name;
    if (slug != null) result.slug = slug;
    if (publishedSeriesCount != null)
      result.publishedSeriesCount = publishedSeriesCount;
    return result;
  }

  PublishedTag._();

  factory PublishedTag.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedTag()..mergeFromBuffer(data, registry);
  factory PublishedTag.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PublishedTag()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PublishedTag',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PublishedTag.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'slug')
    ..aI(3, _omitFieldNames ? '' : 'publishedSeriesCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedTag clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PublishedTag copyWith(void Function(PublishedTag) updates) =>
      super.copyWith((message) => updates(message as PublishedTag))
          as PublishedTag;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PublishedTag() / PublishedTag.new instead')
  static PublishedTag create() => PublishedTag._();
  static $pb.GeneratedMessage $_createMessage() => PublishedTag._();
  @$core.override
  PublishedTag createEmptyInstance() => PublishedTag._();
  @$core.pragma('dart2js:noInline')
  static PublishedTag getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PublishedTag>(
          PublishedTag.$_createMessage);
  static PublishedTag? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get slug => $_getSZ(1);
  @$pb.TagNumber(2)
  set slug($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSlug() => $_has(1);
  @$pb.TagNumber(2)
  void clearSlug() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get publishedSeriesCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set publishedSeriesCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPublishedSeriesCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearPublishedSeriesCount() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Sorted by how many published series carry the tag, most first, then by slug,
/// which is unique within the tenant and therefore breaks every tie. There is
/// no order field: a tag cloud has one order, the one that puts the tags a
/// storefront actually uses in front.
/// Unlike a genre, a tag nothing published carries is not listed: a tag exists
/// because a series carries it, so one no published series carries has no page
/// to keep working.
class ListPublishedTagsRequest extends $pb.GeneratedMessage {
  factory ListPublishedTagsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = ListPublishedTagsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  ListPublishedTagsRequest._();

  factory ListPublishedTagsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedTagsRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedTagsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedTagsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedTagsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedTagsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedTagsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedTagsRequest copyWith(
          void Function(ListPublishedTagsRequest) updates) =>
      super.copyWith((message) => updates(message as ListPublishedTagsRequest))
          as ListPublishedTagsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedTagsRequest() / ListPublishedTagsRequest.new instead')
  static ListPublishedTagsRequest create() => ListPublishedTagsRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListPublishedTagsRequest._();
  @$core.override
  ListPublishedTagsRequest createEmptyInstance() =>
      ListPublishedTagsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedTagsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedTagsRequest>(
          ListPublishedTagsRequest.$_createMessage);
  static ListPublishedTagsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);
}

class ListPublishedTagsResponse extends $pb.GeneratedMessage {
  factory ListPublishedTagsResponse({
    $core.Iterable<PublishedTag>? tags,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListPublishedTagsResponse._();
    if (tags != null) result.tags.addAll(tags);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListPublishedTagsResponse._();

  factory ListPublishedTagsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedTagsResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedTagsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedTagsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedTagsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedTagsResponse.$_createMessage)
    ..pPM<PublishedTag>(1, _omitFieldNames ? '' : 'tags',
        subBuilder: PublishedTag.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedTagsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedTagsResponse copyWith(
          void Function(ListPublishedTagsResponse) updates) =>
      super.copyWith((message) => updates(message as ListPublishedTagsResponse))
          as ListPublishedTagsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedTagsResponse() / ListPublishedTagsResponse.new instead')
  static ListPublishedTagsResponse create() => ListPublishedTagsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedTagsResponse._();
  @$core.override
  ListPublishedTagsResponse createEmptyInstance() =>
      ListPublishedTagsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedTagsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedTagsResponse>(
          ListPublishedTagsResponse.$_createMessage);
  static ListPublishedTagsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedTag> get tags => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Matches published series whose title or synopsis contains `query`
/// (case-insensitive substring), narrowed and sorted the way
/// ListPublishedSeries narrows and sorts the catalogue.
/// The token carries the Unicode-lowercased query it was built for; that same
/// string is the ILIKE pattern. Sending the token with a query that lowers to
/// a different string is invalid_argument. ASCII case changes of the same
/// query are the same search. Changing to a different query restarts at page 1.
/// The token carries the order and the filters as well, under the rule
/// ListPublishedSeriesRequest states for them: sending it with a different
/// order or filter is invalid_argument, and changing either restarts at page 1.
/// The query is matched against the title and the synopsis in the tenant's
/// default locale whatever `locale` asks for, until #4401 makes the search
/// match the reader's language.
class SearchPublishedSeriesRequest extends $pb.GeneratedMessage {
  factory SearchPublishedSeriesRequest({
    $0.TenantContext? tenant,
    $core.String? query,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    SeriesOrder? order,
    $core.bool? hasFreeEpisodes,
    $core.String? genrePublicId,
    $core.String? tagSlug,
    $0.SeriesStatus? status,
    $core.int? weekday,
    $core.String? locale,
  }) {
    final result = SearchPublishedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (order != null) result.order = order;
    if (hasFreeEpisodes != null) result.hasFreeEpisodes = hasFreeEpisodes;
    if (genrePublicId != null) result.genrePublicId = genrePublicId;
    if (tagSlug != null) result.tagSlug = tagSlug;
    if (status != null) result.status = status;
    if (weekday != null) result.weekday = weekday;
    if (locale != null) result.locale = locale;
    return result;
  }

  SearchPublishedSeriesRequest._();

  factory SearchPublishedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedSeriesRequest()..mergeFromBuffer(data, registry);
  factory SearchPublishedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'query')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aE<SeriesOrder>(6, _omitFieldNames ? '' : 'order',
        enumValues: SeriesOrder.values)
    ..aOB(7, _omitFieldNames ? '' : 'hasFreeEpisodes')
    ..aOS(8, _omitFieldNames ? '' : 'genrePublicId')
    ..aOS(9, _omitFieldNames ? '' : 'tagSlug')
    ..aE<$0.SeriesStatus>(10, _omitFieldNames ? '' : 'status',
        enumValues: $0.SeriesStatus.values)
    ..aI(11, _omitFieldNames ? '' : 'weekday')
    ..aOS(12, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedSeriesRequest copyWith(
          void Function(SearchPublishedSeriesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedSeriesRequest))
          as SearchPublishedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedSeriesRequest() / SearchPublishedSeriesRequest.new instead')
  static SearchPublishedSeriesRequest create() =>
      SearchPublishedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedSeriesRequest._();
  @$core.override
  SearchPublishedSeriesRequest createEmptyInstance() =>
      SearchPublishedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedSeriesRequest>(
          SearchPublishedSeriesRequest.$_createMessage);
  static SearchPublishedSeriesRequest? _defaultInstance;

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

  /// Trimmed keyword. Empty after trim is invalid_argument. Max 100 runes.
  /// Not restricted to ASCII; Japanese titles are the expected input.
  @$pb.TagNumber(2)
  $core.String get query => $_getSZ(1);
  @$pb.TagNumber(2)
  set query($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasQuery() => $_has(1);
  @$pb.TagNumber(2)
  void clearQuery() => $_clearField(2);

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// Sort order. Unspecified is the search's own order rather than the newest
  /// first a list falls back to: by relevance on a search backend that ranks
  /// its hits, and by title, then id, on one that does not. Every other value
  /// sorts the hits exactly as it sorts ListPublishedSeries.
  @$pb.TagNumber(6)
  SeriesOrder get order => $_getN(5);
  @$pb.TagNumber(6)
  set order(SeriesOrder value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasOrder() => $_has(5);
  @$pb.TagNumber(6)
  void clearOrder() => $_clearField(6);

  /// Keep only the series a reader can start without paying, as
  /// ListPublishedSeriesRequest.has_free_episodes does.
  @$pb.TagNumber(7)
  $core.bool get hasFreeEpisodes => $_getBF(6);
  @$pb.TagNumber(7)
  set hasFreeEpisodes($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasHasFreeEpisodes() => $_has(6);
  @$pb.TagNumber(7)
  void clearHasFreeEpisodes() => $_clearField(7);

  /// Keep only the series carrying this genre, as
  /// ListPublishedSeriesRequest.genre_public_id does. A public ID naming no
  /// genre of the tenant is not_found.
  @$pb.TagNumber(8)
  $core.String get genrePublicId => $_getSZ(7);
  @$pb.TagNumber(8)
  set genrePublicId($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasGenrePublicId() => $_has(7);
  @$pb.TagNumber(8)
  void clearGenrePublicId() => $_clearField(8);

  /// Keep only the series carrying this tag, as
  /// ListPublishedSeriesRequest.tag_slug does. A slug naming no tag of the
  /// tenant is not_found.
  @$pb.TagNumber(9)
  $core.String get tagSlug => $_getSZ(8);
  @$pb.TagNumber(9)
  set tagSlug($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasTagSlug() => $_has(8);
  @$pb.TagNumber(9)
  void clearTagSlug() => $_clearField(9);

  /// Keep only the series in this serialization state, as
  /// ListPublishedSeriesRequest.status does; unspecified applies no filter.
  @$pb.TagNumber(10)
  $0.SeriesStatus get status => $_getN(9);
  @$pb.TagNumber(10)
  set status($0.SeriesStatus value) => $_setField(10, value);
  @$pb.TagNumber(10)
  $core.bool hasStatus() => $_has(9);
  @$pb.TagNumber(10)
  void clearStatus() => $_clearField(10);

  /// Keep only the series expecting an episode on this weekday, as
  /// ListPublishedSeriesRequest.weekday does: 0 is Sunday, and a weekday
  /// outside 0 to 6 is invalid_argument.
  @$pb.TagNumber(11)
  $core.int get weekday => $_getIZ(10);
  @$pb.TagNumber(11)
  set weekday($core.int value) => $_setSignedInt32(10, value);
  @$pb.TagNumber(11)
  $core.bool hasWeekday() => $_has(10);
  @$pb.TagNumber(11)
  void clearWeekday() => $_clearField(11);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(12)
  $core.String get locale => $_getSZ(11);
  @$pb.TagNumber(12)
  set locale($core.String value) => $_setString(11, value);
  @$pb.TagNumber(12)
  $core.bool hasLocale() => $_has(11);
  @$pb.TagNumber(12)
  void clearLocale() => $_clearField(12);
}

class SearchPublishedSeriesResponse extends $pb.GeneratedMessage {
  factory SearchPublishedSeriesResponse({
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = SearchPublishedSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  SearchPublishedSeriesResponse._();

  factory SearchPublishedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedSeriesResponse()..mergeFromBuffer(data, registry);
  factory SearchPublishedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedSeriesResponse.$_createMessage)
    ..pPM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedSeriesResponse copyWith(
          void Function(SearchPublishedSeriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedSeriesResponse))
          as SearchPublishedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedSeriesResponse() / SearchPublishedSeriesResponse.new instead')
  static SearchPublishedSeriesResponse create() =>
      SearchPublishedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedSeriesResponse._();
  @$core.override
  SearchPublishedSeriesResponse createEmptyInstance() =>
      SearchPublishedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedSeriesResponse>(
          SearchPublishedSeriesResponse.$_createMessage);
  static SearchPublishedSeriesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$0.Series> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Matches creators whose name contains `query` (case-insensitive substring)
/// and who hold at least one currently published series, the same population
/// ListPublishedCreators shows. Sorted by name, then id. There is no order
/// field: name order is the only creator list the storefront needs.
/// Only the name is matched. A biography mentioning another creator answers a
/// name search with someone the reader did not ask for.
/// The token carries the Unicode-lowercased query it was built for, exactly as
/// SearchPublishedSeries does; sending it with a query that lowers to a
/// different string is invalid_argument.
class SearchPublishedCreatorsRequest extends $pb.GeneratedMessage {
  factory SearchPublishedCreatorsRequest({
    $0.TenantContext? tenant,
    $core.String? query,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = SearchPublishedCreatorsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  SearchPublishedCreatorsRequest._();

  factory SearchPublishedCreatorsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedCreatorsRequest()..mergeFromBuffer(data, registry);
  factory SearchPublishedCreatorsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedCreatorsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedCreatorsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedCreatorsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'query')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedCreatorsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedCreatorsRequest copyWith(
          void Function(SearchPublishedCreatorsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedCreatorsRequest))
          as SearchPublishedCreatorsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedCreatorsRequest() / SearchPublishedCreatorsRequest.new instead')
  static SearchPublishedCreatorsRequest create() =>
      SearchPublishedCreatorsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedCreatorsRequest._();
  @$core.override
  SearchPublishedCreatorsRequest createEmptyInstance() =>
      SearchPublishedCreatorsRequest._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedCreatorsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedCreatorsRequest>(
          SearchPublishedCreatorsRequest.$_createMessage);
  static SearchPublishedCreatorsRequest? _defaultInstance;

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

  /// Trimmed keyword. Empty after trim is invalid_argument. Max 100 runes.
  /// Not restricted to ASCII; Japanese names are the expected input.
  @$pb.TagNumber(2)
  $core.String get query => $_getSZ(1);
  @$pb.TagNumber(2)
  set query($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasQuery() => $_has(1);
  @$pb.TagNumber(2)
  void clearQuery() => $_clearField(2);

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);
}

class SearchPublishedCreatorsResponse extends $pb.GeneratedMessage {
  factory SearchPublishedCreatorsResponse({
    $core.Iterable<PublishedCreator>? creators,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = SearchPublishedCreatorsResponse._();
    if (creators != null) result.creators.addAll(creators);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  SearchPublishedCreatorsResponse._();

  factory SearchPublishedCreatorsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedCreatorsResponse()..mergeFromBuffer(data, registry);
  factory SearchPublishedCreatorsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedCreatorsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedCreatorsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedCreatorsResponse.$_createMessage)
    ..pPM<PublishedCreator>(1, _omitFieldNames ? '' : 'creators',
        subBuilder: PublishedCreator.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedCreatorsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedCreatorsResponse copyWith(
          void Function(SearchPublishedCreatorsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedCreatorsResponse))
          as SearchPublishedCreatorsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedCreatorsResponse() / SearchPublishedCreatorsResponse.new instead')
  static SearchPublishedCreatorsResponse create() =>
      SearchPublishedCreatorsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedCreatorsResponse._();
  @$core.override
  SearchPublishedCreatorsResponse createEmptyInstance() =>
      SearchPublishedCreatorsResponse._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedCreatorsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedCreatorsResponse>(
          SearchPublishedCreatorsResponse.$_createMessage);
  static SearchPublishedCreatorsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedCreator> get creators => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Matches labels whose name contains `query` (case-insensitive substring) and
/// that hold at least one currently published series. Sorted by name, then id.
/// There is no order field: name order is the only label search the storefront
/// needs.
/// The published-series requirement is what separates this from
/// GetPublishedLabelDetail, which keeps answering for a label whose last series
/// was taken down so a shared URL stays valid. Nothing links to a search hit
/// that has nothing behind it.
/// The token carries the Unicode-lowercased query it was built for, exactly as
/// SearchPublishedSeries does; sending it with a query that lowers to a
/// different string is invalid_argument.
class SearchPublishedLabelsRequest extends $pb.GeneratedMessage {
  factory SearchPublishedLabelsRequest({
    $0.TenantContext? tenant,
    $core.String? query,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = SearchPublishedLabelsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (query != null) result.query = query;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  SearchPublishedLabelsRequest._();

  factory SearchPublishedLabelsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedLabelsRequest()..mergeFromBuffer(data, registry);
  factory SearchPublishedLabelsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedLabelsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedLabelsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedLabelsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'query')
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedLabelsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedLabelsRequest copyWith(
          void Function(SearchPublishedLabelsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedLabelsRequest))
          as SearchPublishedLabelsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedLabelsRequest() / SearchPublishedLabelsRequest.new instead')
  static SearchPublishedLabelsRequest create() =>
      SearchPublishedLabelsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedLabelsRequest._();
  @$core.override
  SearchPublishedLabelsRequest createEmptyInstance() =>
      SearchPublishedLabelsRequest._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedLabelsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedLabelsRequest>(
          SearchPublishedLabelsRequest.$_createMessage);
  static SearchPublishedLabelsRequest? _defaultInstance;

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

  /// Trimmed keyword. Empty after trim is invalid_argument. Max 100 runes.
  /// Not restricted to ASCII; Japanese names are the expected input.
  @$pb.TagNumber(2)
  $core.String get query => $_getSZ(1);
  @$pb.TagNumber(2)
  set query($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasQuery() => $_has(1);
  @$pb.TagNumber(2)
  void clearQuery() => $_clearField(2);

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);
}

class SearchPublishedLabelsResponse extends $pb.GeneratedMessage {
  factory SearchPublishedLabelsResponse({
    $core.Iterable<PublishedLabel>? labels,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = SearchPublishedLabelsResponse._();
    if (labels != null) result.labels.addAll(labels);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  SearchPublishedLabelsResponse._();

  factory SearchPublishedLabelsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedLabelsResponse()..mergeFromBuffer(data, registry);
  factory SearchPublishedLabelsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SearchPublishedLabelsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SearchPublishedLabelsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SearchPublishedLabelsResponse.$_createMessage)
    ..pPM<PublishedLabel>(1, _omitFieldNames ? '' : 'labels',
        subBuilder: PublishedLabel.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedLabelsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SearchPublishedLabelsResponse copyWith(
          void Function(SearchPublishedLabelsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as SearchPublishedLabelsResponse))
          as SearchPublishedLabelsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SearchPublishedLabelsResponse() / SearchPublishedLabelsResponse.new instead')
  static SearchPublishedLabelsResponse create() =>
      SearchPublishedLabelsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      SearchPublishedLabelsResponse._();
  @$core.override
  SearchPublishedLabelsResponse createEmptyInstance() =>
      SearchPublishedLabelsResponse._();
  @$core.pragma('dart2js:noInline')
  static SearchPublishedLabelsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SearchPublishedLabelsResponse>(
          SearchPublishedLabelsResponse.$_createMessage);
  static SearchPublishedLabelsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<PublishedLabel> get labels => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: the recommendation order is the one this RPC exists
/// to produce.
class ListRecommendedSeriesRequest extends $pb.GeneratedMessage {
  factory ListRecommendedSeriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListRecommendedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListRecommendedSeriesRequest._();

  factory ListRecommendedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRecommendedSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListRecommendedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRecommendedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRecommendedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRecommendedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRecommendedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRecommendedSeriesRequest copyWith(
          void Function(ListRecommendedSeriesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListRecommendedSeriesRequest))
          as ListRecommendedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRecommendedSeriesRequest() / ListRecommendedSeriesRequest.new instead')
  static ListRecommendedSeriesRequest create() =>
      ListRecommendedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListRecommendedSeriesRequest._();
  @$core.override
  ListRecommendedSeriesRequest createEmptyInstance() =>
      ListRecommendedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListRecommendedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRecommendedSeriesRequest>(
          ListRecommendedSeriesRequest.$_createMessage);
  static ListRecommendedSeriesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListRecommendedSeriesResponse extends $pb.GeneratedMessage {
  factory ListRecommendedSeriesResponse({
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
    RecommendationSource? source,
  }) {
    final result = ListRecommendedSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    if (source != null) result.source = source;
    return result;
  }

  ListRecommendedSeriesResponse._();

  factory ListRecommendedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRecommendedSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListRecommendedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRecommendedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRecommendedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRecommendedSeriesResponse.$_createMessage)
    ..pPM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..aE<RecommendationSource>(4, _omitFieldNames ? '' : 'source',
        enumValues: RecommendationSource.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRecommendedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRecommendedSeriesResponse copyWith(
          void Function(ListRecommendedSeriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListRecommendedSeriesResponse))
          as ListRecommendedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRecommendedSeriesResponse() / ListRecommendedSeriesResponse.new instead')
  static ListRecommendedSeriesResponse create() =>
      ListRecommendedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListRecommendedSeriesResponse._();
  @$core.override
  ListRecommendedSeriesResponse createEmptyInstance() =>
      ListRecommendedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListRecommendedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRecommendedSeriesResponse>(
          ListRecommendedSeriesResponse.$_createMessage);
  static ListRecommendedSeriesResponse? _defaultInstance;

  /// Ranked series first, in ranking order, then every other published series
  /// newest first.
  @$pb.TagNumber(1)
  $pb.PbList<$0.Series> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);

  @$pb.TagNumber(4)
  RecommendationSource get source => $_getN(3);
  @$pb.TagNumber(4)
  set source(RecommendationSource value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSource() => $_has(3);
  @$pb.TagNumber(4)
  void clearSource() => $_clearField(4);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: the recommendation order is the one this RPC exists
/// to produce. The token carries which of the two orders it was built in — the
/// reader's own, or the tenant-wide one a reader without features gets — and a
/// token from the other one is invalid_argument. That happens when the daily
/// batch writes or drops the reader's features between two pages, and the
/// client starts again at the first page.
class ListMyRecommendedSeriesRequest extends $pb.GeneratedMessage {
  factory ListMyRecommendedSeriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListMyRecommendedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListMyRecommendedSeriesRequest._();

  factory ListMyRecommendedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecommendedSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListMyRecommendedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecommendedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyRecommendedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyRecommendedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecommendedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecommendedSeriesRequest copyWith(
          void Function(ListMyRecommendedSeriesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyRecommendedSeriesRequest))
          as ListMyRecommendedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyRecommendedSeriesRequest() / ListMyRecommendedSeriesRequest.new instead')
  static ListMyRecommendedSeriesRequest create() =>
      ListMyRecommendedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyRecommendedSeriesRequest._();
  @$core.override
  ListMyRecommendedSeriesRequest createEmptyInstance() =>
      ListMyRecommendedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyRecommendedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyRecommendedSeriesRequest>(
          ListMyRecommendedSeriesRequest.$_createMessage);
  static ListMyRecommendedSeriesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListMyRecommendedSeriesResponse extends $pb.GeneratedMessage {
  factory ListMyRecommendedSeriesResponse({
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
    RecommendationSource? source,
  }) {
    final result = ListMyRecommendedSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    if (source != null) result.source = source;
    return result;
  }

  ListMyRecommendedSeriesResponse._();

  factory ListMyRecommendedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecommendedSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListMyRecommendedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecommendedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyRecommendedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyRecommendedSeriesResponse.$_createMessage)
    ..pPM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..aE<RecommendationSource>(4, _omitFieldNames ? '' : 'source',
        enumValues: RecommendationSource.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecommendedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecommendedSeriesResponse copyWith(
          void Function(ListMyRecommendedSeriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyRecommendedSeriesResponse))
          as ListMyRecommendedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyRecommendedSeriesResponse() / ListMyRecommendedSeriesResponse.new instead')
  static ListMyRecommendedSeriesResponse create() =>
      ListMyRecommendedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyRecommendedSeriesResponse._();
  @$core.override
  ListMyRecommendedSeriesResponse createEmptyInstance() =>
      ListMyRecommendedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyRecommendedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyRecommendedSeriesResponse>(
          ListMyRecommendedSeriesResponse.$_createMessage);
  static ListMyRecommendedSeriesResponse? _defaultInstance;

  /// Every published series, in the order ListMyRecommendedSeries describes.
  @$pb.TagNumber(1)
  $pb.PbList<$0.Series> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);

  /// READER_FEATURES when the reader's own features ordered the list, and
  /// otherwise whatever ListRecommendedSeries answers for the tenant.
  @$pb.TagNumber(4)
  RecommendationSource get source => $_getN(3);
  @$pb.TagNumber(4)
  set source(RecommendationSource value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSource() => $_has(3);
  @$pb.TagNumber(4)
  void clearSource() => $_clearField(4);
}

/// One series at the position a ranking snapshot gave it.
class RankedSeries extends $pb.GeneratedMessage {
  factory RankedSeries({
    $core.int? rank,
    $0.Series? series,
    $core.int? previousRank,
  }) {
    final result = RankedSeries._();
    if (rank != null) result.rank = rank;
    if (series != null) result.series = series;
    if (previousRank != null) result.previousRank = previousRank;
    return result;
  }

  RankedSeries._();

  factory RankedSeries.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RankedSeries()..mergeFromBuffer(data, registry);
  factory RankedSeries.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RankedSeries()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RankedSeries',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RankedSeries.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'rank')
    ..aOM<$0.Series>(2, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'previousRank')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RankedSeries clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RankedSeries copyWith(void Function(RankedSeries) updates) =>
      super.copyWith((message) => updates(message as RankedSeries))
          as RankedSeries;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use RankedSeries() / RankedSeries.new instead')
  static RankedSeries create() => RankedSeries._();
  static $pb.GeneratedMessage $_createMessage() => RankedSeries._();
  @$core.override
  RankedSeries createEmptyInstance() => RankedSeries._();
  @$core.pragma('dart2js:noInline')
  static RankedSeries getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<RankedSeries>(
          RankedSeries.$_createMessage);
  static RankedSeries? _defaultInstance;

  /// The position in the snapshot, counting from 1. Positions are the
  /// snapshot's own, so they stay put when a series between them is
  /// unpublished: a page can run 1, 2, 4.
  @$pb.TagNumber(1)
  $core.int get rank => $_getIZ(0);
  @$pb.TagNumber(1)
  set rank($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRank() => $_has(0);
  @$pb.TagNumber(1)
  void clearRank() => $_clearField(1);

  @$pb.TagNumber(2)
  $0.Series get series => $_getN(1);
  @$pb.TagNumber(2)
  set series($0.Series value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSeries() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeries() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Series ensureSeries() => $_ensure(1);

  /// The position this series held in the snapshot before the current one, for
  /// an up / down marker. Absent when there is no earlier snapshot, or when
  /// that snapshot did not rank this series — a new entry has no movement to
  /// draw, which is not the same as having moved from position 0.
  @$pb.TagNumber(3)
  $core.int get previousRank => $_getIZ(2);
  @$pb.TagNumber(3)
  set previousRank($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPreviousRank() => $_has(2);
  @$pb.TagNumber(3)
  void clearPreviousRank() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: a ranking has one order, the one it was computed
/// in. The token carries the period, the age rating, and the genre it was
/// built for, because the same position names a different series in another
/// ranking; sending it with a different period, rating, or genre — a genre's
/// token with none, or the tenant-wide token with a genre, included — is
/// invalid_argument.
/// It also pins the snapshot the first page came from, so the rest of a
/// traversal keeps the positions of one ranking even when the batch writes a
/// new one in between. A token whose snapshot has since been dropped by the
/// retention purge is invalid_argument: the page it names no longer exists, and
/// the client starts again at the first page of the current ranking.
class ListRankedSeriesRequest extends $pb.GeneratedMessage {
  factory ListRankedSeriesRequest({
    $0.TenantContext? tenant,
    RankingPeriod? period,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $0.SeriesAgeRating? ageRating,
    $core.String? genrePublicId,
    $core.String? locale,
  }) {
    final result = ListRankedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (period != null) result.period = period;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (ageRating != null) result.ageRating = ageRating;
    if (genrePublicId != null) result.genrePublicId = genrePublicId;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListRankedSeriesRequest._();

  factory ListRankedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRankedSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListRankedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRankedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRankedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRankedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<RankingPeriod>(2, _omitFieldNames ? '' : 'period',
        enumValues: RankingPeriod.values)
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aE<$0.SeriesAgeRating>(6, _omitFieldNames ? '' : 'ageRating',
        enumValues: $0.SeriesAgeRating.values)
    ..aOS(7, _omitFieldNames ? '' : 'genrePublicId')
    ..aOS(8, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRankedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRankedSeriesRequest copyWith(
          void Function(ListRankedSeriesRequest) updates) =>
      super.copyWith((message) => updates(message as ListRankedSeriesRequest))
          as ListRankedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRankedSeriesRequest() / ListRankedSeriesRequest.new instead')
  static ListRankedSeriesRequest create() => ListRankedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListRankedSeriesRequest._();
  @$core.override
  ListRankedSeriesRequest createEmptyInstance() => ListRankedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListRankedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRankedSeriesRequest>(
          ListRankedSeriesRequest.$_createMessage);
  static ListRankedSeriesRequest? _defaultInstance;

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

  /// Which period to rank. Unspecified is the daily ranking.
  @$pb.TagNumber(2)
  RankingPeriod get period => $_getN(1);
  @$pb.TagNumber(2)
  set period(RankingPeriod value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPeriod() => $_has(1);
  @$pb.TagNumber(2)
  void clearPeriod() => $_clearField(2);

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(2);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(2);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(3);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(4);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(4);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// Which age rating to rank. Each rating is a leaderboard of its own, and
  /// unspecified is the all-ages one, which every reader may see. A series with
  /// no rating is ranked as all-ages.
  ///
  /// A rating the tenant's age verification rule covers is answered only to a
  /// signed-in reader whose birth date clears it, and that answer is private to
  /// them. Anyone else gets permission_denied, as a rated body is withheld from
  /// them, rather than an empty page. A rating the rule does not cover is as
  /// public as the all-ages ranking.
  @$pb.TagNumber(6)
  $0.SeriesAgeRating get ageRating => $_getN(5);
  @$pb.TagNumber(6)
  set ageRating($0.SeriesAgeRating value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasAgeRating() => $_has(5);
  @$pb.TagNumber(6)
  void clearAgeRating() => $_clearField(6);

  /// Rank only this genre's series, named by the public ID ListPublishedGenres
  /// reports. Each genre is a leaderboard of its own, so a position and its
  /// previous_rank are both counted within the genre: a series can climb in its
  /// genre without moving in the tenant-wide ranking. Empty is the tenant-wide
  /// ranking. A public ID naming no genre of the tenant is not_found, for the
  /// reason ListPublishedSeriesRequest.genre_public_id is.
  ///
  /// A genre's ranking admits all-ages series alone, so naming a genre together
  /// with any other age_rating is invalid_argument rather than an empty chart
  /// that would read as a genre nobody has engaged with.
  @$pb.TagNumber(7)
  $core.String get genrePublicId => $_getSZ(6);
  @$pb.TagNumber(7)
  set genrePublicId($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasGenrePublicId() => $_has(6);
  @$pb.TagNumber(7)
  void clearGenrePublicId() => $_clearField(7);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(8)
  $core.String get locale => $_getSZ(7);
  @$pb.TagNumber(8)
  set locale($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasLocale() => $_has(7);
  @$pb.TagNumber(8)
  void clearLocale() => $_clearField(8);
}

class ListRankedSeriesResponse extends $pb.GeneratedMessage {
  factory ListRankedSeriesResponse({
    $core.Iterable<RankedSeries>? rankedSeries,
    $core.String? previousToken,
    $core.String? nextToken,
    $core.String? computedAt,
    $core.String? periodStart,
    $core.String? periodEnd,
  }) {
    final result = ListRankedSeriesResponse._();
    if (rankedSeries != null) result.rankedSeries.addAll(rankedSeries);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    if (computedAt != null) result.computedAt = computedAt;
    if (periodStart != null) result.periodStart = periodStart;
    if (periodEnd != null) result.periodEnd = periodEnd;
    return result;
  }

  ListRankedSeriesResponse._();

  factory ListRankedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRankedSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListRankedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRankedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRankedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRankedSeriesResponse.$_createMessage)
    ..pPM<RankedSeries>(1, _omitFieldNames ? '' : 'rankedSeries',
        subBuilder: RankedSeries.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..aOS(4, _omitFieldNames ? '' : 'computedAt')
    ..aOS(5, _omitFieldNames ? '' : 'periodStart')
    ..aOS(6, _omitFieldNames ? '' : 'periodEnd')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRankedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRankedSeriesResponse copyWith(
          void Function(ListRankedSeriesResponse) updates) =>
      super.copyWith((message) => updates(message as ListRankedSeriesResponse))
          as ListRankedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRankedSeriesResponse() / ListRankedSeriesResponse.new instead')
  static ListRankedSeriesResponse create() => ListRankedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListRankedSeriesResponse._();
  @$core.override
  ListRankedSeriesResponse createEmptyInstance() =>
      ListRankedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListRankedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRankedSeriesResponse>(
          ListRankedSeriesResponse.$_createMessage);
  static ListRankedSeriesResponse? _defaultInstance;

  /// One page of the snapshot, in ranking order.
  @$pb.TagNumber(1)
  $pb.PbList<RankedSeries> get rankedSeries => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);

  /// When the batch computed the snapshot this page comes from (RFC 3339).
  /// Every page of one traversal reports the same instant, because they are all
  /// pages of the same snapshot. Empty when the tenant has no snapshot yet.
  @$pb.TagNumber(4)
  $core.String get computedAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set computedAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasComputedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearComputedAt() => $_clearField(4);

  /// The ranked period, as inclusive calendar dates (YYYY-MM-DD) in the
  /// tenant's time zone, which is the zone the daily stats behind the ranking
  /// are counted in. Empty when the tenant has no snapshot yet.
  @$pb.TagNumber(5)
  $core.String get periodStart => $_getSZ(4);
  @$pb.TagNumber(5)
  set periodStart($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPeriodStart() => $_has(4);
  @$pb.TagNumber(5)
  void clearPeriodStart() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get periodEnd => $_getSZ(5);
  @$pb.TagNumber(6)
  set periodEnd($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasPeriodEnd() => $_has(5);
  @$pb.TagNumber(6)
  void clearPeriodEnd() => $_clearField(6);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: relatedness to one series is the order this RPC
/// exists to produce. The token carries the series it was built for, because a
/// score means nothing outside the list it was scored against; sending it with
/// a different series is invalid_argument, and changing the series restarts at
/// page 1.
class ListRelatedSeriesRequest extends $pb.GeneratedMessage {
  factory ListRelatedSeriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? seriesId,
    $core.String? locale,
  }) {
    final result = ListRelatedSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (seriesId != null) result.seriesId = seriesId;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListRelatedSeriesRequest._();

  factory ListRelatedSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRelatedSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListRelatedSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRelatedSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRelatedSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRelatedSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'seriesId')
    ..aOS(7, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRelatedSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRelatedSeriesRequest copyWith(
          void Function(ListRelatedSeriesRequest) updates) =>
      super.copyWith((message) => updates(message as ListRelatedSeriesRequest))
          as ListRelatedSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRelatedSeriesRequest() / ListRelatedSeriesRequest.new instead')
  static ListRelatedSeriesRequest create() => ListRelatedSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListRelatedSeriesRequest._();
  @$core.override
  ListRelatedSeriesRequest createEmptyInstance() =>
      ListRelatedSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListRelatedSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRelatedSeriesRequest>(
          ListRelatedSeriesRequest.$_createMessage);
  static ListRelatedSeriesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 12, which is what a
  /// "more like this" strip on the series page and the end-of-episode panel
  /// show.
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  /// The series to find neighbours for. Unpublished, cross-tenant, and missing
  /// series, and a series the calling surface may not show, are all surfaced as
  /// not_found, the way every other public read of a series is.
  @$pb.TagNumber(6)
  $core.String get seriesId => $_getSZ(4);
  @$pb.TagNumber(6)
  set seriesId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(6)
  $core.bool hasSeriesId() => $_has(4);
  @$pb.TagNumber(6)
  void clearSeriesId() => $_clearField(6);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(7)
  $core.String get locale => $_getSZ(5);
  @$pb.TagNumber(7)
  set locale($core.String value) => $_setString(5, value);
  @$pb.TagNumber(7)
  $core.bool hasLocale() => $_has(5);
  @$pb.TagNumber(7)
  void clearLocale() => $_clearField(7);
}

class ListRelatedSeriesResponse extends $pb.GeneratedMessage {
  factory ListRelatedSeriesResponse({
    $core.Iterable<$0.Series>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListRelatedSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListRelatedSeriesResponse._();

  factory ListRelatedSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRelatedSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListRelatedSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListRelatedSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListRelatedSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListRelatedSeriesResponse.$_createMessage)
    ..pPM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRelatedSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListRelatedSeriesResponse copyWith(
          void Function(ListRelatedSeriesResponse) updates) =>
      super.copyWith((message) => updates(message as ListRelatedSeriesResponse))
          as ListRelatedSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListRelatedSeriesResponse() / ListRelatedSeriesResponse.new instead')
  static ListRelatedSeriesResponse create() => ListRelatedSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListRelatedSeriesResponse._();
  @$core.override
  ListRelatedSeriesResponse createEmptyInstance() =>
      ListRelatedSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListRelatedSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListRelatedSeriesResponse>(
          ListRelatedSeriesResponse.$_createMessage);
  static ListRelatedSeriesResponse? _defaultInstance;

  /// One page of the tenant's other published series, most related first.
  @$pb.TagNumber(1)
  $pb.PbList<$0.Series> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// One page of the web storefront, named by the identifiers its URL is made of.
class SitemapEntry extends $pb.GeneratedMessage {
  factory SitemapEntry({
    SitemapEntryKind? kind,
    $core.String? publicId,
    $core.String? seriesPublicId,
    $core.String? slug,
    $core.String? lastModifiedAt,
  }) {
    final result = SitemapEntry._();
    if (kind != null) result.kind = kind;
    if (publicId != null) result.publicId = publicId;
    if (seriesPublicId != null) result.seriesPublicId = seriesPublicId;
    if (slug != null) result.slug = slug;
    if (lastModifiedAt != null) result.lastModifiedAt = lastModifiedAt;
    return result;
  }

  SitemapEntry._();

  factory SitemapEntry.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SitemapEntry()..mergeFromBuffer(data, registry);
  factory SitemapEntry.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SitemapEntry()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SitemapEntry',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SitemapEntry.$_createMessage)
    ..aE<SitemapEntryKind>(1, _omitFieldNames ? '' : 'kind',
        enumValues: SitemapEntryKind.values)
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aOS(3, _omitFieldNames ? '' : 'seriesPublicId')
    ..aOS(4, _omitFieldNames ? '' : 'slug')
    ..aOS(5, _omitFieldNames ? '' : 'lastModifiedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SitemapEntry clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SitemapEntry copyWith(void Function(SitemapEntry) updates) =>
      super.copyWith((message) => updates(message as SitemapEntry))
          as SitemapEntry;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use SitemapEntry() / SitemapEntry.new instead')
  static SitemapEntry create() => SitemapEntry._();
  static $pb.GeneratedMessage $_createMessage() => SitemapEntry._();
  @$core.override
  SitemapEntry createEmptyInstance() => SitemapEntry._();
  @$core.pragma('dart2js:noInline')
  static SitemapEntry getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<SitemapEntry>(
          SitemapEntry.$_createMessage);
  static SitemapEntry? _defaultInstance;

  @$pb.TagNumber(1)
  SitemapEntryKind get kind => $_getN(0);
  @$pb.TagNumber(1)
  set kind(SitemapEntryKind value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasKind() => $_has(0);
  @$pb.TagNumber(1)
  void clearKind() => $_clearField(1);

  /// The public ID of the series, episode, label, creator, or genre. Empty for a
  /// page, which is addressed by slug.
  @$pb.TagNumber(2)
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// The public ID of the series an episode belongs to. Empty for every other
  /// kind.
  @$pb.TagNumber(3)
  $core.String get seriesPublicId => $_getSZ(2);
  @$pb.TagNumber(3)
  set seriesPublicId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSeriesPublicId() => $_has(2);
  @$pb.TagNumber(3)
  void clearSeriesPublicId() => $_clearField(3);

  /// A page's slug in storage form ("/privacy"). Empty for every other kind.
  @$pb.TagNumber(4)
  $core.String get slug => $_getSZ(3);
  @$pb.TagNumber(4)
  set slug($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasSlug() => $_has(3);
  @$pb.TagNumber(4)
  void clearSlug() => $_clearField(4);

  /// When what the page shows last changed, RFC 3339. A series counts its
  /// newest published episode, since its page lists them, and a page counts
  /// its published translations. Empty for a label, a creator, and a genre,
  /// whose rows keep no such time.
  @$pb.TagNumber(5)
  $core.String get lastModifiedAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set lastModifiedAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLastModifiedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearLastModifiedAt() => $_clearField(5);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// Every page the web storefront publishes for the tenant: its published series
/// and their published episodes, the labels and creators ListPublishedLabels and
/// ListPublishedCreators list, every genre, and every page with a published
/// translation. Sorted by kind in SitemapEntryKind order, then by id. There is
/// no surface field: a sitemap is for the web, so the read answers for the web
/// storefront.
class ListSitemapEntriesRequest extends $pb.GeneratedMessage {
  factory ListSitemapEntriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
  }) {
    final result = ListSitemapEntriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    return result;
  }

  ListSitemapEntriesRequest._();

  factory ListSitemapEntriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSitemapEntriesRequest()..mergeFromBuffer(data, registry);
  factory ListSitemapEntriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSitemapEntriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSitemapEntriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListSitemapEntriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSitemapEntriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSitemapEntriesRequest copyWith(
          void Function(ListSitemapEntriesRequest) updates) =>
      super.copyWith((message) => updates(message as ListSitemapEntriesRequest))
          as ListSitemapEntriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListSitemapEntriesRequest() / ListSitemapEntriesRequest.new instead')
  static ListSitemapEntriesRequest create() => ListSitemapEntriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListSitemapEntriesRequest._();
  @$core.override
  ListSitemapEntriesRequest createEmptyInstance() =>
      ListSitemapEntriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListSitemapEntriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSitemapEntriesRequest>(
          ListSitemapEntriesRequest.$_createMessage);
  static ListSitemapEntriesRequest? _defaultInstance;

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

  /// Max entries in one page. <= 0 or > 1000 falls back to 1000: a sitemap is
  /// walked to the end rather than browsed, so a page holds as much as a
  /// response comfortably carries.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);
}

class ListSitemapEntriesResponse extends $pb.GeneratedMessage {
  factory ListSitemapEntriesResponse({
    $core.Iterable<SitemapEntry>? entries,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListSitemapEntriesResponse._();
    if (entries != null) result.entries.addAll(entries);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListSitemapEntriesResponse._();

  factory ListSitemapEntriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSitemapEntriesResponse()..mergeFromBuffer(data, registry);
  factory ListSitemapEntriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListSitemapEntriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListSitemapEntriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListSitemapEntriesResponse.$_createMessage)
    ..pPM<SitemapEntry>(1, _omitFieldNames ? '' : 'entries',
        subBuilder: SitemapEntry.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSitemapEntriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListSitemapEntriesResponse copyWith(
          void Function(ListSitemapEntriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListSitemapEntriesResponse))
          as ListSitemapEntriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListSitemapEntriesResponse() / ListSitemapEntriesResponse.new instead')
  static ListSitemapEntriesResponse create() => ListSitemapEntriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListSitemapEntriesResponse._();
  @$core.override
  ListSitemapEntriesResponse createEmptyInstance() =>
      ListSitemapEntriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListSitemapEntriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListSitemapEntriesResponse>(
          ListSitemapEntriesResponse.$_createMessage);
  static ListSitemapEntriesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<SitemapEntry> get entries => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

class MarkEpisodeAsReadRequest extends $pb.GeneratedMessage {
  factory MarkEpisodeAsReadRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = MarkEpisodeAsReadRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  MarkEpisodeAsReadRequest._();

  factory MarkEpisodeAsReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkEpisodeAsReadRequest()..mergeFromBuffer(data, registry);
  factory MarkEpisodeAsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkEpisodeAsReadRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkEpisodeAsReadRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkEpisodeAsReadRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkEpisodeAsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkEpisodeAsReadRequest copyWith(
          void Function(MarkEpisodeAsReadRequest) updates) =>
      super.copyWith((message) => updates(message as MarkEpisodeAsReadRequest))
          as MarkEpisodeAsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkEpisodeAsReadRequest() / MarkEpisodeAsReadRequest.new instead')
  static MarkEpisodeAsReadRequest create() => MarkEpisodeAsReadRequest._();
  static $pb.GeneratedMessage $_createMessage() => MarkEpisodeAsReadRequest._();
  @$core.override
  MarkEpisodeAsReadRequest createEmptyInstance() =>
      MarkEpisodeAsReadRequest._();
  @$core.pragma('dart2js:noInline')
  static MarkEpisodeAsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkEpisodeAsReadRequest>(
          MarkEpisodeAsReadRequest.$_createMessage);
  static MarkEpisodeAsReadRequest? _defaultInstance;

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

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  /// The episode the signed-in member finished reading.
  @$pb.TagNumber(4)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(4)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(4)
  void clearEpisodeId() => $_clearField(4);
}

class MarkEpisodeAsReadResponse extends $pb.GeneratedMessage {
  factory MarkEpisodeAsReadResponse({
    $core.String? readAt,
  }) {
    final result = MarkEpisodeAsReadResponse._();
    if (readAt != null) result.readAt = readAt;
    return result;
  }

  MarkEpisodeAsReadResponse._();

  factory MarkEpisodeAsReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkEpisodeAsReadResponse()..mergeFromBuffer(data, registry);
  factory MarkEpisodeAsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkEpisodeAsReadResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkEpisodeAsReadResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkEpisodeAsReadResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'readAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkEpisodeAsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkEpisodeAsReadResponse copyWith(
          void Function(MarkEpisodeAsReadResponse) updates) =>
      super.copyWith((message) => updates(message as MarkEpisodeAsReadResponse))
          as MarkEpisodeAsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkEpisodeAsReadResponse() / MarkEpisodeAsReadResponse.new instead')
  static MarkEpisodeAsReadResponse create() => MarkEpisodeAsReadResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkEpisodeAsReadResponse._();
  @$core.override
  MarkEpisodeAsReadResponse createEmptyInstance() =>
      MarkEpisodeAsReadResponse._();
  @$core.pragma('dart2js:noInline')
  static MarkEpisodeAsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkEpisodeAsReadResponse>(
          MarkEpisodeAsReadResponse.$_createMessage);
  static MarkEpisodeAsReadResponse? _defaultInstance;

  /// The first time this member marked the episode as read. Repeated calls keep
  /// this value unchanged.
  @$pb.TagNumber(1)
  $core.String get readAt => $_getSZ(0);
  @$pb.TagNumber(1)
  set readAt($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasReadAt() => $_has(0);
  @$pb.TagNumber(1)
  void clearReadAt() => $_clearField(1);
}

/// Where a reader stopped inside one episode. page_index is zero-based, so the
/// last page is page_count - 1; page_count is what the episode held when the
/// position was saved, which is what lets a client show progress without
/// reading the episode itself.
class ReadingPosition extends $pb.GeneratedMessage {
  factory ReadingPosition({
    $core.String? episodePublicId,
    $core.int? pageIndex,
    $core.int? pageCount,
    $core.String? updatedAt,
  }) {
    final result = ReadingPosition._();
    if (episodePublicId != null) result.episodePublicId = episodePublicId;
    if (pageIndex != null) result.pageIndex = pageIndex;
    if (pageCount != null) result.pageCount = pageCount;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  ReadingPosition._();

  factory ReadingPosition.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReadingPosition()..mergeFromBuffer(data, registry);
  factory ReadingPosition.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReadingPosition()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReadingPosition',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ReadingPosition.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'episodePublicId')
    ..aI(2, _omitFieldNames ? '' : 'pageIndex')
    ..aI(3, _omitFieldNames ? '' : 'pageCount')
    ..aOS(4, _omitFieldNames ? '' : 'updatedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadingPosition clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReadingPosition copyWith(void Function(ReadingPosition) updates) =>
      super.copyWith((message) => updates(message as ReadingPosition))
          as ReadingPosition;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use ReadingPosition() / ReadingPosition.new instead')
  static ReadingPosition create() => ReadingPosition._();
  static $pb.GeneratedMessage $_createMessage() => ReadingPosition._();
  @$core.override
  ReadingPosition createEmptyInstance() => ReadingPosition._();
  @$core.pragma('dart2js:noInline')
  static ReadingPosition getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ReadingPosition>(
          ReadingPosition.$_createMessage);
  static ReadingPosition? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get episodePublicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set episodePublicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEpisodePublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpisodePublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get pageIndex => $_getIZ(1);
  @$pb.TagNumber(2)
  set pageIndex($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPageIndex() => $_has(1);
  @$pb.TagNumber(2)
  void clearPageIndex() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get pageCount => $_getIZ(2);
  @$pb.TagNumber(3)
  set pageCount($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPageCount() => $_has(2);
  @$pb.TagNumber(3)
  void clearPageCount() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get updatedAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set updatedAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUpdatedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearUpdatedAt() => $_clearField(4);
}

class SaveReadingPositionRequest extends $pb.GeneratedMessage {
  factory SaveReadingPositionRequest({
    $0.TenantContext? tenant,
    $core.int? pageIndex,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = SaveReadingPositionRequest._();
    if (tenant != null) result.tenant = tenant;
    if (pageIndex != null) result.pageIndex = pageIndex;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  SaveReadingPositionRequest._();

  factory SaveReadingPositionRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SaveReadingPositionRequest()..mergeFromBuffer(data, registry);
  factory SaveReadingPositionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SaveReadingPositionRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SaveReadingPositionRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SaveReadingPositionRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'pageIndex')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SaveReadingPositionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SaveReadingPositionRequest copyWith(
          void Function(SaveReadingPositionRequest) updates) =>
      super.copyWith(
              (message) => updates(message as SaveReadingPositionRequest))
          as SaveReadingPositionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SaveReadingPositionRequest() / SaveReadingPositionRequest.new instead')
  static SaveReadingPositionRequest create() => SaveReadingPositionRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      SaveReadingPositionRequest._();
  @$core.override
  SaveReadingPositionRequest createEmptyInstance() =>
      SaveReadingPositionRequest._();
  @$core.pragma('dart2js:noInline')
  static SaveReadingPositionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SaveReadingPositionRequest>(
          SaveReadingPositionRequest.$_createMessage);
  static SaveReadingPositionRequest? _defaultInstance;

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

  /// The zero-based page the member stopped on. A page outside the episode is
  /// invalid_argument.
  @$pb.TagNumber(3)
  $core.int get pageIndex => $_getIZ(1);
  @$pb.TagNumber(3)
  set pageIndex($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(3)
  $core.bool hasPageIndex() => $_has(1);
  @$pb.TagNumber(3)
  void clearPageIndex() => $_clearField(3);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The episode the signed-in member is reading.
  @$pb.TagNumber(5)
  $core.String get episodeId => $_getSZ(3);
  @$pb.TagNumber(5)
  set episodeId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasEpisodeId() => $_has(3);
  @$pb.TagNumber(5)
  void clearEpisodeId() => $_clearField(5);
}

class SaveReadingPositionResponse extends $pb.GeneratedMessage {
  factory SaveReadingPositionResponse({
    ReadingPosition? position,
  }) {
    final result = SaveReadingPositionResponse._();
    if (position != null) result.position = position;
    return result;
  }

  SaveReadingPositionResponse._();

  factory SaveReadingPositionResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SaveReadingPositionResponse()..mergeFromBuffer(data, registry);
  factory SaveReadingPositionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SaveReadingPositionResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SaveReadingPositionResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SaveReadingPositionResponse.$_createMessage)
    ..aOM<ReadingPosition>(1, _omitFieldNames ? '' : 'position',
        subBuilder: ReadingPosition.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SaveReadingPositionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SaveReadingPositionResponse copyWith(
          void Function(SaveReadingPositionResponse) updates) =>
      super.copyWith(
              (message) => updates(message as SaveReadingPositionResponse))
          as SaveReadingPositionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SaveReadingPositionResponse() / SaveReadingPositionResponse.new instead')
  static SaveReadingPositionResponse create() =>
      SaveReadingPositionResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      SaveReadingPositionResponse._();
  @$core.override
  SaveReadingPositionResponse createEmptyInstance() =>
      SaveReadingPositionResponse._();
  @$core.pragma('dart2js:noInline')
  static SaveReadingPositionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SaveReadingPositionResponse>(
          SaveReadingPositionResponse.$_createMessage);
  static SaveReadingPositionResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ReadingPosition get position => $_getN(0);
  @$pb.TagNumber(1)
  set position(ReadingPosition value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPosition() => $_has(0);
  @$pb.TagNumber(1)
  void clearPosition() => $_clearField(1);
  @$pb.TagNumber(1)
  ReadingPosition ensurePosition() => $_ensure(0);
}

class GetMyReadingPositionRequest extends $pb.GeneratedMessage {
  factory GetMyReadingPositionRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = GetMyReadingPositionRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  GetMyReadingPositionRequest._();

  factory GetMyReadingPositionRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyReadingPositionRequest()..mergeFromBuffer(data, registry);
  factory GetMyReadingPositionRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyReadingPositionRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyReadingPositionRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyReadingPositionRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyReadingPositionRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyReadingPositionRequest copyWith(
          void Function(GetMyReadingPositionRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyReadingPositionRequest))
          as GetMyReadingPositionRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyReadingPositionRequest() / GetMyReadingPositionRequest.new instead')
  static GetMyReadingPositionRequest create() =>
      GetMyReadingPositionRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyReadingPositionRequest._();
  @$core.override
  GetMyReadingPositionRequest createEmptyInstance() =>
      GetMyReadingPositionRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyReadingPositionRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyReadingPositionRequest>(
          GetMyReadingPositionRequest.$_createMessage);
  static GetMyReadingPositionRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(4)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(4)
  void clearEpisodeId() => $_clearField(4);
}

class GetMyReadingPositionResponse extends $pb.GeneratedMessage {
  factory GetMyReadingPositionResponse({
    ReadingPosition? position,
  }) {
    final result = GetMyReadingPositionResponse._();
    if (position != null) result.position = position;
    return result;
  }

  GetMyReadingPositionResponse._();

  factory GetMyReadingPositionResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyReadingPositionResponse()..mergeFromBuffer(data, registry);
  factory GetMyReadingPositionResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyReadingPositionResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyReadingPositionResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyReadingPositionResponse.$_createMessage)
    ..aOM<ReadingPosition>(1, _omitFieldNames ? '' : 'position',
        subBuilder: ReadingPosition.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyReadingPositionResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyReadingPositionResponse copyWith(
          void Function(GetMyReadingPositionResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyReadingPositionResponse))
          as GetMyReadingPositionResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyReadingPositionResponse() / GetMyReadingPositionResponse.new instead')
  static GetMyReadingPositionResponse create() =>
      GetMyReadingPositionResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyReadingPositionResponse._();
  @$core.override
  GetMyReadingPositionResponse createEmptyInstance() =>
      GetMyReadingPositionResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyReadingPositionResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyReadingPositionResponse>(
          GetMyReadingPositionResponse.$_createMessage);
  static GetMyReadingPositionResponse? _defaultInstance;

  /// Unset when this member has no saved position in the episode, which is what
  /// a viewer opening it for the first time gets.
  @$pb.TagNumber(1)
  ReadingPosition get position => $_getN(0);
  @$pb.TagNumber(1)
  set position(ReadingPosition value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPosition() => $_has(0);
  @$pb.TagNumber(1)
  void clearPosition() => $_clearField(1);
  @$pb.TagNumber(1)
  ReadingPosition ensurePosition() => $_ensure(0);
}

class GetMySeriesProgressRequest extends $pb.GeneratedMessage {
  factory GetMySeriesProgressRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? seriesId,
    $core.String? locale,
  }) {
    final result = GetMySeriesProgressRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (seriesId != null) result.seriesId = seriesId;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetMySeriesProgressRequest._();

  factory GetMySeriesProgressRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesProgressRequest()..mergeFromBuffer(data, registry);
  factory GetMySeriesProgressRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesProgressRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySeriesProgressRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySeriesProgressRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'seriesId')
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesProgressRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesProgressRequest copyWith(
          void Function(GetMySeriesProgressRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetMySeriesProgressRequest))
          as GetMySeriesProgressRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySeriesProgressRequest() / GetMySeriesProgressRequest.new instead')
  static GetMySeriesProgressRequest create() => GetMySeriesProgressRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMySeriesProgressRequest._();
  @$core.override
  GetMySeriesProgressRequest createEmptyInstance() =>
      GetMySeriesProgressRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMySeriesProgressRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySeriesProgressRequest>(
          GetMySeriesProgressRequest.$_createMessage);
  static GetMySeriesProgressRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get seriesId => $_getSZ(2);
  @$pb.TagNumber(4)
  set seriesId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasSeriesId() => $_has(2);
  @$pb.TagNumber(4)
  void clearSeriesId() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

/// The member's standing in one series: the episode they last moved in, where
/// they stopped in it, and whether they already finished it. A series page
/// turns these three into "continue from here" or "start the next episode".
class SeriesProgress extends $pb.GeneratedMessage {
  factory SeriesProgress({
    $0.Episode? episode,
    ReadingPosition? position,
    $core.bool? isFinished,
  }) {
    final result = SeriesProgress._();
    if (episode != null) result.episode = episode;
    if (position != null) result.position = position;
    if (isFinished != null) result.isFinished = isFinished;
    return result;
  }

  SeriesProgress._();

  factory SeriesProgress.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesProgress()..mergeFromBuffer(data, registry);
  factory SeriesProgress.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesProgress()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SeriesProgress',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SeriesProgress.$_createMessage)
    ..aOM<$0.Episode>(1, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOM<ReadingPosition>(2, _omitFieldNames ? '' : 'position',
        subBuilder: ReadingPosition.$_createMessage)
    ..aOB(3, _omitFieldNames ? '' : 'isFinished')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesProgress clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesProgress copyWith(void Function(SeriesProgress) updates) =>
      super.copyWith((message) => updates(message as SeriesProgress))
          as SeriesProgress;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use SeriesProgress() / SeriesProgress.new instead')
  static SeriesProgress create() => SeriesProgress._();
  static $pb.GeneratedMessage $_createMessage() => SeriesProgress._();
  @$core.override
  SeriesProgress createEmptyInstance() => SeriesProgress._();
  @$core.pragma('dart2js:noInline')
  static SeriesProgress getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<SeriesProgress>(
          SeriesProgress.$_createMessage);
  static SeriesProgress? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Episode get episode => $_getN(0);
  @$pb.TagNumber(1)
  set episode($0.Episode value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasEpisode() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpisode() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Episode ensureEpisode() => $_ensure(0);

  @$pb.TagNumber(2)
  ReadingPosition get position => $_getN(1);
  @$pb.TagNumber(2)
  set position(ReadingPosition value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPosition() => $_has(1);
  @$pb.TagNumber(2)
  void clearPosition() => $_clearField(2);
  @$pb.TagNumber(2)
  ReadingPosition ensurePosition() => $_ensure(1);

  @$pb.TagNumber(3)
  $core.bool get isFinished => $_getBF(2);
  @$pb.TagNumber(3)
  set isFinished($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIsFinished() => $_has(2);
  @$pb.TagNumber(3)
  void clearIsFinished() => $_clearField(3);
}

class GetMySeriesProgressResponse extends $pb.GeneratedMessage {
  factory GetMySeriesProgressResponse({
    SeriesProgress? progress,
    $core.Iterable<$core.String>? finishedEpisodePublicIds,
  }) {
    final result = GetMySeriesProgressResponse._();
    if (progress != null) result.progress = progress;
    if (finishedEpisodePublicIds != null)
      result.finishedEpisodePublicIds.addAll(finishedEpisodePublicIds);
    return result;
  }

  GetMySeriesProgressResponse._();

  factory GetMySeriesProgressResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesProgressResponse()..mergeFromBuffer(data, registry);
  factory GetMySeriesProgressResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesProgressResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySeriesProgressResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySeriesProgressResponse.$_createMessage)
    ..aOM<SeriesProgress>(1, _omitFieldNames ? '' : 'progress',
        subBuilder: SeriesProgress.$_createMessage)
    ..pPS(2, _omitFieldNames ? '' : 'finishedEpisodePublicIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesProgressResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesProgressResponse copyWith(
          void Function(GetMySeriesProgressResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetMySeriesProgressResponse))
          as GetMySeriesProgressResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySeriesProgressResponse() / GetMySeriesProgressResponse.new instead')
  static GetMySeriesProgressResponse create() =>
      GetMySeriesProgressResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMySeriesProgressResponse._();
  @$core.override
  GetMySeriesProgressResponse createEmptyInstance() =>
      GetMySeriesProgressResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMySeriesProgressResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySeriesProgressResponse>(
          GetMySeriesProgressResponse.$_createMessage);
  static GetMySeriesProgressResponse? _defaultInstance;

  /// Unset when the member has opened no episode of the series they can still
  /// read.
  @$pb.TagNumber(1)
  SeriesProgress get progress => $_getN(0);
  @$pb.TagNumber(1)
  set progress(SeriesProgress value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProgress() => $_has(0);
  @$pb.TagNumber(1)
  void clearProgress() => $_clearField(1);
  @$pb.TagNumber(1)
  SeriesProgress ensureProgress() => $_ensure(0);

  /// The public IDs of this series' episodes the member has already finished,
  /// in the order the series detail lists them. It rides on this response
  /// rather than on GetSeriesDetail because it is the member's own state, and
  /// rather than on an RPC of its own because the series page already makes
  /// this one private read; the episode list marks its rows from it.
  ///
  /// It is not derived from `progress`: a member is marked as having finished
  /// an episode by MarkEpisodeAsRead, which is a different write from the
  /// position SaveReadingPosition stores, so a reader can have finished
  /// episodes while `progress` is unset.
  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get finishedEpisodePublicIds => $_getList(1);
}

/// One series in the reader's "continue reading" row: the series itself, the
/// episode the offer points at, and where they stopped in that episode.
class RecentSeries extends $pb.GeneratedMessage {
  factory RecentSeries({
    $0.Series? series,
    $0.Episode? episode,
    ReadingPosition? position,
    $core.String? lastActivityAt,
  }) {
    final result = RecentSeries._();
    if (series != null) result.series = series;
    if (episode != null) result.episode = episode;
    if (position != null) result.position = position;
    if (lastActivityAt != null) result.lastActivityAt = lastActivityAt;
    return result;
  }

  RecentSeries._();

  factory RecentSeries.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecentSeries()..mergeFromBuffer(data, registry);
  factory RecentSeries.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecentSeries()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecentSeries',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RecentSeries.$_createMessage)
    ..aOM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOM<$0.Episode>(2, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOM<ReadingPosition>(3, _omitFieldNames ? '' : 'position',
        subBuilder: ReadingPosition.$_createMessage)
    ..aOS(4, _omitFieldNames ? '' : 'lastActivityAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecentSeries clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecentSeries copyWith(void Function(RecentSeries) updates) =>
      super.copyWith((message) => updates(message as RecentSeries))
          as RecentSeries;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use RecentSeries() / RecentSeries.new instead')
  static RecentSeries create() => RecentSeries._();
  static $pb.GeneratedMessage $_createMessage() => RecentSeries._();
  @$core.override
  RecentSeries createEmptyInstance() => RecentSeries._();
  @$core.pragma('dart2js:noInline')
  static RecentSeries getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<RecentSeries>(
          RecentSeries.$_createMessage);
  static RecentSeries? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Series get series => $_getN(0);
  @$pb.TagNumber(1)
  set series($0.Series value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSeries() => $_has(0);
  @$pb.TagNumber(1)
  void clearSeries() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Series ensureSeries() => $_ensure(0);

  /// The episode to open: the one the reader last moved in while it is still
  /// unfinished, and otherwise the first published episode after it they have
  /// not finished. It is offered whatever the reader may do with its body, so a
  /// paid episode they have not bought is the episode they are sent to buy.
  @$pb.TagNumber(2)
  $0.Episode get episode => $_getN(1);
  @$pb.TagNumber(2)
  set episode($0.Episode value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisode() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisode() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Episode ensureEpisode() => $_ensure(1);

  /// Where the reader stopped in that episode. Unset when they have never
  /// opened it, and also when they can no longer open its body: a page they
  /// cannot reach is not a place to resume, which is the answer
  /// GetMyReadingPosition gives for the same episode.
  @$pb.TagNumber(3)
  ReadingPosition get position => $_getN(2);
  @$pb.TagNumber(3)
  set position(ReadingPosition value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasPosition() => $_has(2);
  @$pb.TagNumber(3)
  void clearPosition() => $_clearField(3);
  @$pb.TagNumber(3)
  ReadingPosition ensurePosition() => $_ensure(2);

  /// The last time the reader moved in this series, over every published
  /// episode of it they saved a position in or finished. It is the sort key of
  /// the list.
  @$pb.TagNumber(4)
  $core.String get lastActivityAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set lastActivityAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLastActivityAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearLastActivityAt() => $_clearField(4);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: the reader's own most recent activity is the one
/// order a "continue reading" row has.
class ListMyRecentSeriesRequest extends $pb.GeneratedMessage {
  factory ListMyRecentSeriesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListMyRecentSeriesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListMyRecentSeriesRequest._();

  factory ListMyRecentSeriesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecentSeriesRequest()..mergeFromBuffer(data, registry);
  factory ListMyRecentSeriesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecentSeriesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyRecentSeriesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyRecentSeriesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecentSeriesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecentSeriesRequest copyWith(
          void Function(ListMyRecentSeriesRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyRecentSeriesRequest))
          as ListMyRecentSeriesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyRecentSeriesRequest() / ListMyRecentSeriesRequest.new instead')
  static ListMyRecentSeriesRequest create() => ListMyRecentSeriesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyRecentSeriesRequest._();
  @$core.override
  ListMyRecentSeriesRequest createEmptyInstance() =>
      ListMyRecentSeriesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyRecentSeriesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyRecentSeriesRequest>(
          ListMyRecentSeriesRequest.$_createMessage);
  static ListMyRecentSeriesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListMyRecentSeriesResponse extends $pb.GeneratedMessage {
  factory ListMyRecentSeriesResponse({
    $core.Iterable<RecentSeries>? series,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyRecentSeriesResponse._();
    if (series != null) result.series.addAll(series);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyRecentSeriesResponse._();

  factory ListMyRecentSeriesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecentSeriesResponse()..mergeFromBuffer(data, registry);
  factory ListMyRecentSeriesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyRecentSeriesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyRecentSeriesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyRecentSeriesResponse.$_createMessage)
    ..pPM<RecentSeries>(1, _omitFieldNames ? '' : 'series',
        subBuilder: RecentSeries.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecentSeriesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyRecentSeriesResponse copyWith(
          void Function(ListMyRecentSeriesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyRecentSeriesResponse))
          as ListMyRecentSeriesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyRecentSeriesResponse() / ListMyRecentSeriesResponse.new instead')
  static ListMyRecentSeriesResponse create() => ListMyRecentSeriesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyRecentSeriesResponse._();
  @$core.override
  ListMyRecentSeriesResponse createEmptyInstance() =>
      ListMyRecentSeriesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyRecentSeriesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyRecentSeriesResponse>(
          ListMyRecentSeriesResponse.$_createMessage);
  static ListMyRecentSeriesResponse? _defaultInstance;

  /// Newest activity first.
  @$pb.TagNumber(1)
  $pb.PbList<RecentSeries> get series => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// One episode the reader has finished, with the series it belongs to, which is
/// what a reading history entry links to and names.
class MyEpisodeRead extends $pb.GeneratedMessage {
  factory MyEpisodeRead({
    $0.Series? series,
    $0.Episode? episode,
    $core.String? readAt,
  }) {
    final result = MyEpisodeRead._();
    if (series != null) result.series = series;
    if (episode != null) result.episode = episode;
    if (readAt != null) result.readAt = readAt;
    return result;
  }

  MyEpisodeRead._();

  factory MyEpisodeRead.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyEpisodeRead()..mergeFromBuffer(data, registry);
  factory MyEpisodeRead.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyEpisodeRead()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyEpisodeRead',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyEpisodeRead.$_createMessage)
    ..aOM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOM<$0.Episode>(2, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'readAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyEpisodeRead clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyEpisodeRead copyWith(void Function(MyEpisodeRead) updates) =>
      super.copyWith((message) => updates(message as MyEpisodeRead))
          as MyEpisodeRead;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyEpisodeRead() / MyEpisodeRead.new instead')
  static MyEpisodeRead create() => MyEpisodeRead._();
  static $pb.GeneratedMessage $_createMessage() => MyEpisodeRead._();
  @$core.override
  MyEpisodeRead createEmptyInstance() => MyEpisodeRead._();
  @$core.pragma('dart2js:noInline')
  static MyEpisodeRead getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MyEpisodeRead>(
          MyEpisodeRead.$_createMessage);
  static MyEpisodeRead? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Series get series => $_getN(0);
  @$pb.TagNumber(1)
  set series($0.Series value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSeries() => $_has(0);
  @$pb.TagNumber(1)
  void clearSeries() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Series ensureSeries() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.Episode get episode => $_getN(1);
  @$pb.TagNumber(2)
  set episode($0.Episode value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisode() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisode() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Episode ensureEpisode() => $_ensure(1);

  /// When the reader first finished it. A re-read keeps this instant, so the
  /// history is ordered by when each episode was finished rather than by when
  /// it was last opened.
  @$pb.TagNumber(3)
  $core.String get readAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set readAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasReadAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearReadAt() => $_clearField(3);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: a reading history is read newest first, and the
/// reader has no second order to ask for.
class ListMyEpisodeReadsRequest extends $pb.GeneratedMessage {
  factory ListMyEpisodeReadsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListMyEpisodeReadsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListMyEpisodeReadsRequest._();

  factory ListMyEpisodeReadsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeReadsRequest()..mergeFromBuffer(data, registry);
  factory ListMyEpisodeReadsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeReadsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyEpisodeReadsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyEpisodeReadsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeReadsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeReadsRequest copyWith(
          void Function(ListMyEpisodeReadsRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyEpisodeReadsRequest))
          as ListMyEpisodeReadsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyEpisodeReadsRequest() / ListMyEpisodeReadsRequest.new instead')
  static ListMyEpisodeReadsRequest create() => ListMyEpisodeReadsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyEpisodeReadsRequest._();
  @$core.override
  ListMyEpisodeReadsRequest createEmptyInstance() =>
      ListMyEpisodeReadsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyEpisodeReadsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyEpisodeReadsRequest>(
          ListMyEpisodeReadsRequest.$_createMessage);
  static ListMyEpisodeReadsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListMyEpisodeReadsResponse extends $pb.GeneratedMessage {
  factory ListMyEpisodeReadsResponse({
    $core.Iterable<MyEpisodeRead>? reads,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyEpisodeReadsResponse._();
    if (reads != null) result.reads.addAll(reads);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyEpisodeReadsResponse._();

  factory ListMyEpisodeReadsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeReadsResponse()..mergeFromBuffer(data, registry);
  factory ListMyEpisodeReadsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeReadsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyEpisodeReadsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyEpisodeReadsResponse.$_createMessage)
    ..pPM<MyEpisodeRead>(1, _omitFieldNames ? '' : 'reads',
        subBuilder: MyEpisodeRead.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeReadsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeReadsResponse copyWith(
          void Function(ListMyEpisodeReadsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyEpisodeReadsResponse))
          as ListMyEpisodeReadsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyEpisodeReadsResponse() / ListMyEpisodeReadsResponse.new instead')
  static ListMyEpisodeReadsResponse create() => ListMyEpisodeReadsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyEpisodeReadsResponse._();
  @$core.override
  ListMyEpisodeReadsResponse createEmptyInstance() =>
      ListMyEpisodeReadsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyEpisodeReadsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyEpisodeReadsResponse>(
          ListMyEpisodeReadsResponse.$_createMessage);
  static ListMyEpisodeReadsResponse? _defaultInstance;

  /// Most recently finished first.
  @$pb.TagNumber(1)
  $pb.PbList<MyEpisodeRead> get reads => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// A public catalog target. The ID is interpreted according to type.
class FollowTarget extends $pb.GeneratedMessage {
  factory FollowTarget({
    FollowTargetType? type,
    $core.String? id,
  }) {
    final result = FollowTarget._();
    if (type != null) result.type = type;
    if (id != null) result.id = id;
    return result;
  }

  FollowTarget._();

  factory FollowTarget.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowTarget()..mergeFromBuffer(data, registry);
  factory FollowTarget.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowTarget()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowTarget',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FollowTarget.$_createMessage)
    ..aE<FollowTargetType>(1, _omitFieldNames ? '' : 'type',
        enumValues: FollowTargetType.values)
    ..aOS(3, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowTarget clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowTarget copyWith(void Function(FollowTarget) updates) =>
      super.copyWith((message) => updates(message as FollowTarget))
          as FollowTarget;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use FollowTarget() / FollowTarget.new instead')
  static FollowTarget create() => FollowTarget._();
  static $pb.GeneratedMessage $_createMessage() => FollowTarget._();
  @$core.override
  FollowTarget createEmptyInstance() => FollowTarget._();
  @$core.pragma('dart2js:noInline')
  static FollowTarget getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<FollowTarget>(
          FollowTarget.$_createMessage);
  static FollowTarget? _defaultInstance;

  @$pb.TagNumber(1)
  FollowTargetType get type => $_getN(0);
  @$pb.TagNumber(1)
  set type(FollowTargetType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasType() => $_has(0);
  @$pb.TagNumber(1)
  void clearType() => $_clearField(1);

  @$pb.TagNumber(3)
  $core.String get id => $_getSZ(1);
  @$pb.TagNumber(3)
  set id($core.String value) => $_setString(1, value);
  @$pb.TagNumber(3)
  $core.bool hasId() => $_has(1);
  @$pb.TagNumber(3)
  void clearId() => $_clearField(3);
}

/// The current member's state for one public target. This is deliberately kept
/// separate from CatalogService so catalog reads remain shared-cacheable.
class GetMyFollowStatusRequest extends $pb.GeneratedMessage {
  factory GetMyFollowStatusRequest({
    $0.TenantContext? tenant,
    FollowTarget? target,
    $0.ClientSurface? surface,
  }) {
    final result = GetMyFollowStatusRequest._();
    if (tenant != null) result.tenant = tenant;
    if (target != null) result.target = target;
    if (surface != null) result.surface = surface;
    return result;
  }

  GetMyFollowStatusRequest._();

  factory GetMyFollowStatusRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyFollowStatusRequest()..mergeFromBuffer(data, registry);
  factory GetMyFollowStatusRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyFollowStatusRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyFollowStatusRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyFollowStatusRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOM<FollowTarget>(2, _omitFieldNames ? '' : 'target',
        subBuilder: FollowTarget.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyFollowStatusRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyFollowStatusRequest copyWith(
          void Function(GetMyFollowStatusRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyFollowStatusRequest))
          as GetMyFollowStatusRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyFollowStatusRequest() / GetMyFollowStatusRequest.new instead')
  static GetMyFollowStatusRequest create() => GetMyFollowStatusRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMyFollowStatusRequest._();
  @$core.override
  GetMyFollowStatusRequest createEmptyInstance() =>
      GetMyFollowStatusRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyFollowStatusRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyFollowStatusRequest>(
          GetMyFollowStatusRequest.$_createMessage);
  static GetMyFollowStatusRequest? _defaultInstance;

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
  FollowTarget get target => $_getN(1);
  @$pb.TagNumber(2)
  set target(FollowTarget value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);
  @$pb.TagNumber(2)
  FollowTarget ensureTarget() => $_ensure(1);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

class GetMyFollowStatusResponse extends $pb.GeneratedMessage {
  factory GetMyFollowStatusResponse({
    $core.bool? isFollowing,
  }) {
    final result = GetMyFollowStatusResponse._();
    if (isFollowing != null) result.isFollowing = isFollowing;
    return result;
  }

  GetMyFollowStatusResponse._();

  factory GetMyFollowStatusResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyFollowStatusResponse()..mergeFromBuffer(data, registry);
  factory GetMyFollowStatusResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyFollowStatusResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyFollowStatusResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyFollowStatusResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'isFollowing')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyFollowStatusResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyFollowStatusResponse copyWith(
          void Function(GetMyFollowStatusResponse) updates) =>
      super.copyWith((message) => updates(message as GetMyFollowStatusResponse))
          as GetMyFollowStatusResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyFollowStatusResponse() / GetMyFollowStatusResponse.new instead')
  static GetMyFollowStatusResponse create() => GetMyFollowStatusResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyFollowStatusResponse._();
  @$core.override
  GetMyFollowStatusResponse createEmptyInstance() =>
      GetMyFollowStatusResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyFollowStatusResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyFollowStatusResponse>(
          GetMyFollowStatusResponse.$_createMessage);
  static GetMyFollowStatusResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get isFollowing => $_getBF(0);
  @$pb.TagNumber(1)
  set isFollowing($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIsFollowing() => $_has(0);
  @$pb.TagNumber(1)
  void clearIsFollowing() => $_clearField(1);
}

class FollowRequest extends $pb.GeneratedMessage {
  factory FollowRequest({
    $0.TenantContext? tenant,
    FollowTarget? target,
    $0.ClientSurface? surface,
  }) {
    final result = FollowRequest._();
    if (tenant != null) result.tenant = tenant;
    if (target != null) result.target = target;
    if (surface != null) result.surface = surface;
    return result;
  }

  FollowRequest._();

  factory FollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowRequest()..mergeFromBuffer(data, registry);
  factory FollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FollowRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOM<FollowTarget>(2, _omitFieldNames ? '' : 'target',
        subBuilder: FollowTarget.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowRequest copyWith(void Function(FollowRequest) updates) =>
      super.copyWith((message) => updates(message as FollowRequest))
          as FollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use FollowRequest() / FollowRequest.new instead')
  static FollowRequest create() => FollowRequest._();
  static $pb.GeneratedMessage $_createMessage() => FollowRequest._();
  @$core.override
  FollowRequest createEmptyInstance() => FollowRequest._();
  @$core.pragma('dart2js:noInline')
  static FollowRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<FollowRequest>(
          FollowRequest.$_createMessage);
  static FollowRequest? _defaultInstance;

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
  FollowTarget get target => $_getN(1);
  @$pb.TagNumber(2)
  set target(FollowTarget value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);
  @$pb.TagNumber(2)
  FollowTarget ensureTarget() => $_ensure(1);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

class FollowResponse extends $pb.GeneratedMessage {
  factory FollowResponse({
    $core.bool? isFollowing,
  }) {
    final result = FollowResponse._();
    if (isFollowing != null) result.isFollowing = isFollowing;
    return result;
  }

  FollowResponse._();

  factory FollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowResponse()..mergeFromBuffer(data, registry);
  factory FollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FollowResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'isFollowing')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowResponse copyWith(void Function(FollowResponse) updates) =>
      super.copyWith((message) => updates(message as FollowResponse))
          as FollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use FollowResponse() / FollowResponse.new instead')
  static FollowResponse create() => FollowResponse._();
  static $pb.GeneratedMessage $_createMessage() => FollowResponse._();
  @$core.override
  FollowResponse createEmptyInstance() => FollowResponse._();
  @$core.pragma('dart2js:noInline')
  static FollowResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<FollowResponse>(
          FollowResponse.$_createMessage);
  static FollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get isFollowing => $_getBF(0);
  @$pb.TagNumber(1)
  set isFollowing($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIsFollowing() => $_has(0);
  @$pb.TagNumber(1)
  void clearIsFollowing() => $_clearField(1);
}

class UnfollowRequest extends $pb.GeneratedMessage {
  factory UnfollowRequest({
    $0.TenantContext? tenant,
    FollowTarget? target,
    $0.ClientSurface? surface,
  }) {
    final result = UnfollowRequest._();
    if (tenant != null) result.tenant = tenant;
    if (target != null) result.target = target;
    if (surface != null) result.surface = surface;
    return result;
  }

  UnfollowRequest._();

  factory UnfollowRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnfollowRequest()..mergeFromBuffer(data, registry);
  factory UnfollowRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnfollowRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnfollowRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOM<FollowTarget>(2, _omitFieldNames ? '' : 'target',
        subBuilder: FollowTarget.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowRequest copyWith(void Function(UnfollowRequest) updates) =>
      super.copyWith((message) => updates(message as UnfollowRequest))
          as UnfollowRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UnfollowRequest() / UnfollowRequest.new instead')
  static UnfollowRequest create() => UnfollowRequest._();
  static $pb.GeneratedMessage $_createMessage() => UnfollowRequest._();
  @$core.override
  UnfollowRequest createEmptyInstance() => UnfollowRequest._();
  @$core.pragma('dart2js:noInline')
  static UnfollowRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UnfollowRequest>(
          UnfollowRequest.$_createMessage);
  static UnfollowRequest? _defaultInstance;

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
  FollowTarget get target => $_getN(1);
  @$pb.TagNumber(2)
  set target(FollowTarget value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);
  @$pb.TagNumber(2)
  FollowTarget ensureTarget() => $_ensure(1);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

class UnfollowResponse extends $pb.GeneratedMessage {
  factory UnfollowResponse({
    $core.bool? isFollowing,
  }) {
    final result = UnfollowResponse._();
    if (isFollowing != null) result.isFollowing = isFollowing;
    return result;
  }

  UnfollowResponse._();

  factory UnfollowResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnfollowResponse()..mergeFromBuffer(data, registry);
  factory UnfollowResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnfollowResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnfollowResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnfollowResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'isFollowing')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnfollowResponse copyWith(void Function(UnfollowResponse) updates) =>
      super.copyWith((message) => updates(message as UnfollowResponse))
          as UnfollowResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UnfollowResponse() / UnfollowResponse.new instead')
  static UnfollowResponse create() => UnfollowResponse._();
  static $pb.GeneratedMessage $_createMessage() => UnfollowResponse._();
  @$core.override
  UnfollowResponse createEmptyInstance() => UnfollowResponse._();
  @$core.pragma('dart2js:noInline')
  static UnfollowResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UnfollowResponse>(
          UnfollowResponse.$_createMessage);
  static UnfollowResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get isFollowing => $_getBF(0);
  @$pb.TagNumber(1)
  set isFollowing($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIsFollowing() => $_has(0);
  @$pb.TagNumber(1)
  void clearIsFollowing() => $_clearField(1);
}

/// One currently public target followed by the authenticated member.
class MyFollow extends $pb.GeneratedMessage {
  factory MyFollow({
    FollowTargetType? targetType,
    $core.String? targetPublicId,
    $core.String? followedAt,
    $core.String? targetId,
  }) {
    final result = MyFollow._();
    if (targetType != null) result.targetType = targetType;
    if (targetPublicId != null) result.targetPublicId = targetPublicId;
    if (followedAt != null) result.followedAt = followedAt;
    if (targetId != null) result.targetId = targetId;
    return result;
  }

  MyFollow._();

  factory MyFollow.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyFollow()..mergeFromBuffer(data, registry);
  factory MyFollow.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyFollow()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyFollow',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyFollow.$_createMessage)
    ..aE<FollowTargetType>(1, _omitFieldNames ? '' : 'targetType',
        enumValues: FollowTargetType.values)
    ..aOS(2, _omitFieldNames ? '' : 'targetPublicId')
    ..aOS(3, _omitFieldNames ? '' : 'followedAt')
    ..aOS(4, _omitFieldNames ? '' : 'targetId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyFollow clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyFollow copyWith(void Function(MyFollow) updates) =>
      super.copyWith((message) => updates(message as MyFollow)) as MyFollow;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyFollow() / MyFollow.new instead')
  static MyFollow create() => MyFollow._();
  static $pb.GeneratedMessage $_createMessage() => MyFollow._();
  @$core.override
  MyFollow createEmptyInstance() => MyFollow._();
  @$core.pragma('dart2js:noInline')
  static MyFollow getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyFollow>(MyFollow.$_createMessage);
  static MyFollow? _defaultInstance;

  /// Explicitly distinguishes episode, creator, and series follows in a mixed timeline.
  @$pb.TagNumber(1)
  FollowTargetType get targetType => $_getN(0);
  @$pb.TagNumber(1)
  set targetType(FollowTargetType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTargetType() => $_has(0);
  @$pb.TagNumber(1)
  void clearTargetType() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get targetPublicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set targetPublicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTargetPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearTargetPublicId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get followedAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set followedAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasFollowedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearFollowedAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get targetId => $_getSZ(3);
  @$pb.TagNumber(4)
  set targetId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasTargetId() => $_has(3);
  @$pb.TagNumber(4)
  void clearTargetId() => $_clearField(4);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListMyFollowsRequest extends $pb.GeneratedMessage {
  factory ListMyFollowsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = ListMyFollowsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  ListMyFollowsRequest._();

  factory ListMyFollowsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowsRequest()..mergeFromBuffer(data, registry);
  factory ListMyFollowsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyFollowsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyFollowsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowsRequest copyWith(void Function(ListMyFollowsRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyFollowsRequest))
          as ListMyFollowsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyFollowsRequest() / ListMyFollowsRequest.new instead')
  static ListMyFollowsRequest create() => ListMyFollowsRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListMyFollowsRequest._();
  @$core.override
  ListMyFollowsRequest createEmptyInstance() => ListMyFollowsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyFollowsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyFollowsRequest>(
          ListMyFollowsRequest.$_createMessage);
  static ListMyFollowsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);
}

class ListMyFollowsResponse extends $pb.GeneratedMessage {
  factory ListMyFollowsResponse({
    $core.Iterable<MyFollow>? follows,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyFollowsResponse._();
    if (follows != null) result.follows.addAll(follows);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyFollowsResponse._();

  factory ListMyFollowsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowsResponse()..mergeFromBuffer(data, registry);
  factory ListMyFollowsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyFollowsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyFollowsResponse.$_createMessage)
    ..pPM<MyFollow>(1, _omitFieldNames ? '' : 'follows',
        subBuilder: MyFollow.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowsResponse copyWith(
          void Function(ListMyFollowsResponse) updates) =>
      super.copyWith((message) => updates(message as ListMyFollowsResponse))
          as ListMyFollowsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyFollowsResponse() / ListMyFollowsResponse.new instead')
  static ListMyFollowsResponse create() => ListMyFollowsResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListMyFollowsResponse._();
  @$core.override
  ListMyFollowsResponse createEmptyInstance() => ListMyFollowsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyFollowsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyFollowsResponse>(
          ListMyFollowsResponse.$_createMessage);
  static ListMyFollowsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<MyFollow> get follows => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// One episode that has arrived in what a member follows: the episode, and the
/// series it belongs to, which is what the row links to and names.
class FollowUpdate extends $pb.GeneratedMessage {
  factory FollowUpdate({
    $0.Series? series,
    $0.Episode? episode,
  }) {
    final result = FollowUpdate._();
    if (series != null) result.series = series;
    if (episode != null) result.episode = episode;
    return result;
  }

  FollowUpdate._();

  factory FollowUpdate.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowUpdate()..mergeFromBuffer(data, registry);
  factory FollowUpdate.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FollowUpdate()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FollowUpdate',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FollowUpdate.$_createMessage)
    ..aOM<$0.Series>(1, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aOM<$0.Episode>(2, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowUpdate clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FollowUpdate copyWith(void Function(FollowUpdate) updates) =>
      super.copyWith((message) => updates(message as FollowUpdate))
          as FollowUpdate;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use FollowUpdate() / FollowUpdate.new instead')
  static FollowUpdate create() => FollowUpdate._();
  static $pb.GeneratedMessage $_createMessage() => FollowUpdate._();
  @$core.override
  FollowUpdate createEmptyInstance() => FollowUpdate._();
  @$core.pragma('dart2js:noInline')
  static FollowUpdate getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<FollowUpdate>(
          FollowUpdate.$_createMessage);
  static FollowUpdate? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Series get series => $_getN(0);
  @$pb.TagNumber(1)
  set series($0.Series value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSeries() => $_has(0);
  @$pb.TagNumber(1)
  void clearSeries() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Series ensureSeries() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.Episode get episode => $_getN(1);
  @$pb.TagNumber(2)
  set episode($0.Episode value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisode() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisode() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Episode ensureEpisode() => $_ensure(1);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
/// There is no order field: what is new is read newest first, and a member has
/// no second order to ask for.
class ListMyFollowUpdatesRequest extends $pb.GeneratedMessage {
  factory ListMyFollowUpdatesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListMyFollowUpdatesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListMyFollowUpdatesRequest._();

  factory ListMyFollowUpdatesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowUpdatesRequest()..mergeFromBuffer(data, registry);
  factory ListMyFollowUpdatesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowUpdatesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyFollowUpdatesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyFollowUpdatesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowUpdatesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowUpdatesRequest copyWith(
          void Function(ListMyFollowUpdatesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyFollowUpdatesRequest))
          as ListMyFollowUpdatesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyFollowUpdatesRequest() / ListMyFollowUpdatesRequest.new instead')
  static ListMyFollowUpdatesRequest create() => ListMyFollowUpdatesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyFollowUpdatesRequest._();
  @$core.override
  ListMyFollowUpdatesRequest createEmptyInstance() =>
      ListMyFollowUpdatesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyFollowUpdatesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyFollowUpdatesRequest>(
          ListMyFollowUpdatesRequest.$_createMessage);
  static ListMyFollowUpdatesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListMyFollowUpdatesResponse extends $pb.GeneratedMessage {
  factory ListMyFollowUpdatesResponse({
    $core.Iterable<FollowUpdate>? updates,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyFollowUpdatesResponse._();
    if (updates != null) result.updates.addAll(updates);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyFollowUpdatesResponse._();

  factory ListMyFollowUpdatesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowUpdatesResponse()..mergeFromBuffer(data, registry);
  factory ListMyFollowUpdatesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyFollowUpdatesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyFollowUpdatesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyFollowUpdatesResponse.$_createMessage)
    ..pPM<FollowUpdate>(1, _omitFieldNames ? '' : 'updates',
        subBuilder: FollowUpdate.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowUpdatesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyFollowUpdatesResponse copyWith(
          void Function(ListMyFollowUpdatesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyFollowUpdatesResponse))
          as ListMyFollowUpdatesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyFollowUpdatesResponse() / ListMyFollowUpdatesResponse.new instead')
  static ListMyFollowUpdatesResponse create() =>
      ListMyFollowUpdatesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyFollowUpdatesResponse._();
  @$core.override
  ListMyFollowUpdatesResponse createEmptyInstance() =>
      ListMyFollowUpdatesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyFollowUpdatesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyFollowUpdatesResponse>(
          ListMyFollowUpdatesResponse.$_createMessage);
  static ListMyFollowUpdatesResponse? _defaultInstance;

  /// Most recently published first.
  @$pb.TagNumber(1)
  $pb.PbList<FollowUpdate> get updates => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// Records the authenticated reader's reaction to one episode, on the 1-5 scale
/// with no neutral point: more is better, and there is no way to call an episode
/// bad. A rating cannot be taken back or lowered, so there is no RPC for either,
/// and pressing again only ever raises the score towards its ceiling.
class RateEpisodeRequest extends $pb.GeneratedMessage {
  factory RateEpisodeRequest({
    $0.TenantContext? tenant,
    $core.int? presses,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = RateEpisodeRequest._();
    if (tenant != null) result.tenant = tenant;
    if (presses != null) result.presses = presses;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  RateEpisodeRequest._();

  factory RateEpisodeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RateEpisodeRequest()..mergeFromBuffer(data, registry);
  factory RateEpisodeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RateEpisodeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RateEpisodeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RateEpisodeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'presses')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RateEpisodeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RateEpisodeRequest copyWith(void Function(RateEpisodeRequest) updates) =>
      super.copyWith((message) => updates(message as RateEpisodeRequest))
          as RateEpisodeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use RateEpisodeRequest() / RateEpisodeRequest.new instead')
  static RateEpisodeRequest create() => RateEpisodeRequest._();
  static $pb.GeneratedMessage $_createMessage() => RateEpisodeRequest._();
  @$core.override
  RateEpisodeRequest createEmptyInstance() => RateEpisodeRequest._();
  @$core.pragma('dart2js:noInline')
  static RateEpisodeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RateEpisodeRequest>(
          RateEpisodeRequest.$_createMessage);
  static RateEpisodeRequest? _defaultInstance;

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

  /// How many presses this call reports, so a client that batched a burst of
  /// them makes one request. <= 0 counts as one, and anything above 5 is capped.
  /// Ignored in EPISODE_RATING_MODE_SINGLE, where one press is the whole rating.
  @$pb.TagNumber(3)
  $core.int get presses => $_getIZ(1);
  @$pb.TagNumber(3)
  set presses($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(3)
  $core.bool hasPresses() => $_has(1);
  @$pb.TagNumber(3)
  void clearPresses() => $_clearField(3);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get episodeId => $_getSZ(3);
  @$pb.TagNumber(5)
  set episodeId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasEpisodeId() => $_has(3);
  @$pb.TagNumber(5)
  void clearEpisodeId() => $_clearField(5);
}

class RateEpisodeResponse extends $pb.GeneratedMessage {
  factory RateEpisodeResponse({
    $core.int? score,
    $fixnum.Int64? ratingCount,
    EpisodeRatingMode? mode,
  }) {
    final result = RateEpisodeResponse._();
    if (score != null) result.score = score;
    if (ratingCount != null) result.ratingCount = ratingCount;
    if (mode != null) result.mode = mode;
    return result;
  }

  RateEpisodeResponse._();

  factory RateEpisodeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RateEpisodeResponse()..mergeFromBuffer(data, registry);
  factory RateEpisodeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RateEpisodeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RateEpisodeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RateEpisodeResponse.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'score')
    ..aInt64(2, _omitFieldNames ? '' : 'ratingCount')
    ..aE<EpisodeRatingMode>(3, _omitFieldNames ? '' : 'mode',
        enumValues: EpisodeRatingMode.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RateEpisodeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RateEpisodeResponse copyWith(void Function(RateEpisodeResponse) updates) =>
      super.copyWith((message) => updates(message as RateEpisodeResponse))
          as RateEpisodeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use RateEpisodeResponse() / RateEpisodeResponse.new instead')
  static RateEpisodeResponse create() => RateEpisodeResponse._();
  static $pb.GeneratedMessage $_createMessage() => RateEpisodeResponse._();
  @$core.override
  RateEpisodeResponse createEmptyInstance() => RateEpisodeResponse._();
  @$core.pragma('dart2js:noInline')
  static RateEpisodeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RateEpisodeResponse>(
          RateEpisodeResponse.$_createMessage);
  static RateEpisodeResponse? _defaultInstance;

  /// The reader's score after this call, 1 to 5.
  @$pb.TagNumber(1)
  $core.int get score => $_getIZ(0);
  @$pb.TagNumber(1)
  set score($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasScore() => $_has(0);
  @$pb.TagNumber(1)
  void clearScore() => $_clearField(1);

  /// How many readers have rated this episode, the same figure
  /// `publira.types.v1.Episode.rating_count` carries. It counts readers rather
  /// than presses, so it means the same thing whichever mode the tenant chose.
  @$pb.TagNumber(2)
  $fixnum.Int64 get ratingCount => $_getI64(1);
  @$pb.TagNumber(2)
  set ratingCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRatingCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearRatingCount() => $_clearField(2);

  @$pb.TagNumber(3)
  EpisodeRatingMode get mode => $_getN(2);
  @$pb.TagNumber(3)
  set mode(EpisodeRatingMode value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasMode() => $_has(2);
  @$pb.TagNumber(3)
  void clearMode() => $_clearField(3);
}

class GetMyEpisodeRatingRequest extends $pb.GeneratedMessage {
  factory GetMyEpisodeRatingRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = GetMyEpisodeRatingRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  GetMyEpisodeRatingRequest._();

  factory GetMyEpisodeRatingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyEpisodeRatingRequest()..mergeFromBuffer(data, registry);
  factory GetMyEpisodeRatingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyEpisodeRatingRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyEpisodeRatingRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyEpisodeRatingRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyEpisodeRatingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyEpisodeRatingRequest copyWith(
          void Function(GetMyEpisodeRatingRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyEpisodeRatingRequest))
          as GetMyEpisodeRatingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyEpisodeRatingRequest() / GetMyEpisodeRatingRequest.new instead')
  static GetMyEpisodeRatingRequest create() => GetMyEpisodeRatingRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyEpisodeRatingRequest._();
  @$core.override
  GetMyEpisodeRatingRequest createEmptyInstance() =>
      GetMyEpisodeRatingRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyEpisodeRatingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyEpisodeRatingRequest>(
          GetMyEpisodeRatingRequest.$_createMessage);
  static GetMyEpisodeRatingRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(4)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(4)
  void clearEpisodeId() => $_clearField(4);
}

class GetMyEpisodeRatingResponse extends $pb.GeneratedMessage {
  factory GetMyEpisodeRatingResponse({
    $core.int? score,
    $fixnum.Int64? ratingCount,
    EpisodeRatingMode? mode,
    $core.bool? readerCredited,
  }) {
    final result = GetMyEpisodeRatingResponse._();
    if (score != null) result.score = score;
    if (ratingCount != null) result.ratingCount = ratingCount;
    if (mode != null) result.mode = mode;
    if (readerCredited != null) result.readerCredited = readerCredited;
    return result;
  }

  GetMyEpisodeRatingResponse._();

  factory GetMyEpisodeRatingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyEpisodeRatingResponse()..mergeFromBuffer(data, registry);
  factory GetMyEpisodeRatingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyEpisodeRatingResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyEpisodeRatingResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyEpisodeRatingResponse.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'score')
    ..aInt64(2, _omitFieldNames ? '' : 'ratingCount')
    ..aE<EpisodeRatingMode>(3, _omitFieldNames ? '' : 'mode',
        enumValues: EpisodeRatingMode.values)
    ..aOB(4, _omitFieldNames ? '' : 'readerCredited')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyEpisodeRatingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyEpisodeRatingResponse copyWith(
          void Function(GetMyEpisodeRatingResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyEpisodeRatingResponse))
          as GetMyEpisodeRatingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyEpisodeRatingResponse() / GetMyEpisodeRatingResponse.new instead')
  static GetMyEpisodeRatingResponse create() => GetMyEpisodeRatingResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyEpisodeRatingResponse._();
  @$core.override
  GetMyEpisodeRatingResponse createEmptyInstance() =>
      GetMyEpisodeRatingResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyEpisodeRatingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyEpisodeRatingResponse>(
          GetMyEpisodeRatingResponse.$_createMessage);
  static GetMyEpisodeRatingResponse? _defaultInstance;

  /// 0 when this reader has not rated the episode, 1 to 5 once they have.
  @$pb.TagNumber(1)
  $core.int get score => $_getIZ(0);
  @$pb.TagNumber(1)
  set score($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasScore() => $_has(0);
  @$pb.TagNumber(1)
  void clearScore() => $_clearField(1);

  @$pb.TagNumber(2)
  $fixnum.Int64 get ratingCount => $_getI64(1);
  @$pb.TagNumber(2)
  set ratingCount($fixnum.Int64 value) => $_setInt64(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRatingCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearRatingCount() => $_clearField(2);

  @$pb.TagNumber(3)
  EpisodeRatingMode get mode => $_getN(2);
  @$pb.TagNumber(3)
  set mode(EpisodeRatingMode value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasMode() => $_has(2);
  @$pb.TagNumber(3)
  void clearMode() => $_clearField(3);

  /// Whether the reader's account is linked to a creator the episode credits,
  /// free or not. RateEpisode refuses such a reader, so a client can withhold
  /// the control instead of offering a press that ends in that refusal.
  @$pb.TagNumber(4)
  $core.bool get readerCredited => $_getBF(3);
  @$pb.TagNumber(4)
  set readerCredited($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasReaderCredited() => $_has(3);
  @$pb.TagNumber(4)
  void clearReaderCredited() => $_clearField(4);
}

class GetMySeriesRatingRequest extends $pb.GeneratedMessage {
  factory GetMySeriesRatingRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
    $core.String? seriesId,
  }) {
    final result = GetMySeriesRatingRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    if (seriesId != null) result.seriesId = seriesId;
    return result;
  }

  GetMySeriesRatingRequest._();

  factory GetMySeriesRatingRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesRatingRequest()..mergeFromBuffer(data, registry);
  factory GetMySeriesRatingRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesRatingRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySeriesRatingRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySeriesRatingRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(4, _omitFieldNames ? '' : 'seriesId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesRatingRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesRatingRequest copyWith(
          void Function(GetMySeriesRatingRequest) updates) =>
      super.copyWith((message) => updates(message as GetMySeriesRatingRequest))
          as GetMySeriesRatingRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySeriesRatingRequest() / GetMySeriesRatingRequest.new instead')
  static GetMySeriesRatingRequest create() => GetMySeriesRatingRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMySeriesRatingRequest._();
  @$core.override
  GetMySeriesRatingRequest createEmptyInstance() =>
      GetMySeriesRatingRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMySeriesRatingRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySeriesRatingRequest>(
          GetMySeriesRatingRequest.$_createMessage);
  static GetMySeriesRatingRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get seriesId => $_getSZ(2);
  @$pb.TagNumber(4)
  set seriesId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasSeriesId() => $_has(2);
  @$pb.TagNumber(4)
  void clearSeriesId() => $_clearField(4);
}

class GetMySeriesRatingResponse extends $pb.GeneratedMessage {
  factory GetMySeriesRatingResponse({
    $core.double? ratingAverage,
    $core.int? ratedEpisodeCount,
  }) {
    final result = GetMySeriesRatingResponse._();
    if (ratingAverage != null) result.ratingAverage = ratingAverage;
    if (ratedEpisodeCount != null) result.ratedEpisodeCount = ratedEpisodeCount;
    return result;
  }

  GetMySeriesRatingResponse._();

  factory GetMySeriesRatingResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesRatingResponse()..mergeFromBuffer(data, registry);
  factory GetMySeriesRatingResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMySeriesRatingResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMySeriesRatingResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMySeriesRatingResponse.$_createMessage)
    ..aD(1, _omitFieldNames ? '' : 'ratingAverage')
    ..aI(2, _omitFieldNames ? '' : 'ratedEpisodeCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesRatingResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMySeriesRatingResponse copyWith(
          void Function(GetMySeriesRatingResponse) updates) =>
      super.copyWith((message) => updates(message as GetMySeriesRatingResponse))
          as GetMySeriesRatingResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMySeriesRatingResponse() / GetMySeriesRatingResponse.new instead')
  static GetMySeriesRatingResponse create() => GetMySeriesRatingResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMySeriesRatingResponse._();
  @$core.override
  GetMySeriesRatingResponse createEmptyInstance() =>
      GetMySeriesRatingResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMySeriesRatingResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMySeriesRatingResponse>(
          GetMySeriesRatingResponse.$_createMessage);
  static GetMySeriesRatingResponse? _defaultInstance;

  /// The mean of the scores this reader gave the series' episodes, to one
  /// decimal, and 0 when they have reacted to none of them. It is the reader's
  /// own statement rather than a rate over a cohort, so it is neither pulled
  /// towards a mean nor held to the bottom of the scale the way
  /// `publira.types.v1.Series.rating_average` is.
  @$pb.TagNumber(1)
  $core.double get ratingAverage => $_getN(0);
  @$pb.TagNumber(1)
  set ratingAverage($core.double value) => $_setDouble(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRatingAverage() => $_has(0);
  @$pb.TagNumber(1)
  void clearRatingAverage() => $_clearField(1);

  /// How many of the series' episodes this reader has reacted to, which is what
  /// the figure above is the mean of.
  @$pb.TagNumber(2)
  $core.int get ratedEpisodeCount => $_getIZ(1);
  @$pb.TagNumber(2)
  set ratedEpisodeCount($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasRatedEpisodeCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearRatedEpisodeCount() => $_clearField(2);
}

/// A public catalog target. The ID is interpreted according to type.
class ContentViewTarget extends $pb.GeneratedMessage {
  factory ContentViewTarget({
    ContentViewTargetType? type,
    $core.String? id,
  }) {
    final result = ContentViewTarget._();
    if (type != null) result.type = type;
    if (id != null) result.id = id;
    return result;
  }

  ContentViewTarget._();

  factory ContentViewTarget.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ContentViewTarget()..mergeFromBuffer(data, registry);
  factory ContentViewTarget.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ContentViewTarget()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ContentViewTarget',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ContentViewTarget.$_createMessage)
    ..aE<ContentViewTargetType>(1, _omitFieldNames ? '' : 'type',
        enumValues: ContentViewTargetType.values)
    ..aOS(3, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ContentViewTarget clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ContentViewTarget copyWith(void Function(ContentViewTarget) updates) =>
      super.copyWith((message) => updates(message as ContentViewTarget))
          as ContentViewTarget;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use ContentViewTarget() / ContentViewTarget.new instead')
  static ContentViewTarget create() => ContentViewTarget._();
  static $pb.GeneratedMessage $_createMessage() => ContentViewTarget._();
  @$core.override
  ContentViewTarget createEmptyInstance() => ContentViewTarget._();
  @$core.pragma('dart2js:noInline')
  static ContentViewTarget getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ContentViewTarget>(
          ContentViewTarget.$_createMessage);
  static ContentViewTarget? _defaultInstance;

  @$pb.TagNumber(1)
  ContentViewTargetType get type => $_getN(0);
  @$pb.TagNumber(1)
  set type(ContentViewTargetType value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasType() => $_has(0);
  @$pb.TagNumber(1)
  void clearType() => $_clearField(1);

  @$pb.TagNumber(3)
  $core.String get id => $_getSZ(1);
  @$pb.TagNumber(3)
  set id($core.String value) => $_setString(1, value);
  @$pb.TagNumber(3)
  $core.bool hasId() => $_has(1);
  @$pb.TagNumber(3)
  void clearId() => $_clearField(3);
}

/// Records that a reader opened the target's detail page.
class RecordContentViewRequest extends $pb.GeneratedMessage {
  factory RecordContentViewRequest({
    $0.TenantContext? tenant,
    ContentViewTarget? target,
    $0.ClientSurface? surface,
  }) {
    final result = RecordContentViewRequest._();
    if (tenant != null) result.tenant = tenant;
    if (target != null) result.target = target;
    if (surface != null) result.surface = surface;
    return result;
  }

  RecordContentViewRequest._();

  factory RecordContentViewRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecordContentViewRequest()..mergeFromBuffer(data, registry);
  factory RecordContentViewRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecordContentViewRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecordContentViewRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RecordContentViewRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOM<ContentViewTarget>(2, _omitFieldNames ? '' : 'target',
        subBuilder: ContentViewTarget.$_createMessage)
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordContentViewRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordContentViewRequest copyWith(
          void Function(RecordContentViewRequest) updates) =>
      super.copyWith((message) => updates(message as RecordContentViewRequest))
          as RecordContentViewRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RecordContentViewRequest() / RecordContentViewRequest.new instead')
  static RecordContentViewRequest create() => RecordContentViewRequest._();
  static $pb.GeneratedMessage $_createMessage() => RecordContentViewRequest._();
  @$core.override
  RecordContentViewRequest createEmptyInstance() =>
      RecordContentViewRequest._();
  @$core.pragma('dart2js:noInline')
  static RecordContentViewRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecordContentViewRequest>(
          RecordContentViewRequest.$_createMessage);
  static RecordContentViewRequest? _defaultInstance;

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
  ContentViewTarget get target => $_getN(1);
  @$pb.TagNumber(2)
  set target(ContentViewTarget value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasTarget() => $_has(1);
  @$pb.TagNumber(2)
  void clearTarget() => $_clearField(2);
  @$pb.TagNumber(2)
  ContentViewTarget ensureTarget() => $_ensure(1);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

/// Deliberately empty. The caller reports a view it already rendered, so there
/// is nothing for it to learn back; whether the view was recorded, deduplicated,
/// or dropped is not the reader's concern.
class RecordContentViewResponse extends $pb.GeneratedMessage {
  factory RecordContentViewResponse() => RecordContentViewResponse._();

  RecordContentViewResponse._();

  factory RecordContentViewResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecordContentViewResponse()..mergeFromBuffer(data, registry);
  factory RecordContentViewResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RecordContentViewResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RecordContentViewResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RecordContentViewResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordContentViewResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RecordContentViewResponse copyWith(
          void Function(RecordContentViewResponse) updates) =>
      super.copyWith((message) => updates(message as RecordContentViewResponse))
          as RecordContentViewResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RecordContentViewResponse() / RecordContentViewResponse.new instead')
  static RecordContentViewResponse create() => RecordContentViewResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      RecordContentViewResponse._();
  @$core.override
  RecordContentViewResponse createEmptyInstance() =>
      RecordContentViewResponse._();
  @$core.pragma('dart2js:noInline')
  static RecordContentViewResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RecordContentViewResponse>(
          RecordContentViewResponse.$_createMessage);
  static RecordContentViewResponse? _defaultInstance;
}

/// A one-time paid-episode checkout on the tenant's payment provider, answered
/// as the URL of the provider's checkout page. Purchases are created only by the
/// provider's webhook after a successful payment, never by the browser's return
/// URL.
///
/// `client` also names the surface the checkout is started from: CLIENT_MOBILE
/// is the app, and every other value the storefront. An episode that surface
/// may not show is not_found, as it is in the catalog, and one it shows but may
/// not sell (Episode.purchase_availability) is failed_precondition. An episode
/// that credits a creator the reader's account is linked to is
/// permission_denied with the ErrorInfo reason READER_CREDITED_ON_EPISODE.
class StartEpisodeCheckoutRequest extends $pb.GeneratedMessage {
  factory StartEpisodeCheckoutRequest({
    $0.TenantContext? tenant,
    StartEpisodeCheckoutRequest_Client? client,
    $core.String? episodeId,
    $core.String? locale,
    $0.PurchaseKind? kind,
  }) {
    final result = StartEpisodeCheckoutRequest._();
    if (tenant != null) result.tenant = tenant;
    if (client != null) result.client = client;
    if (episodeId != null) result.episodeId = episodeId;
    if (locale != null) result.locale = locale;
    if (kind != null) result.kind = kind;
    return result;
  }

  StartEpisodeCheckoutRequest._();

  factory StartEpisodeCheckoutRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartEpisodeCheckoutRequest()..mergeFromBuffer(data, registry);
  factory StartEpisodeCheckoutRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartEpisodeCheckoutRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartEpisodeCheckoutRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartEpisodeCheckoutRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<StartEpisodeCheckoutRequest_Client>(3, _omitFieldNames ? '' : 'client',
        enumValues: StartEpisodeCheckoutRequest_Client.values)
    ..aOS(4, _omitFieldNames ? '' : 'episodeId')
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..aE<$0.PurchaseKind>(6, _omitFieldNames ? '' : 'kind',
        enumValues: $0.PurchaseKind.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartEpisodeCheckoutRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartEpisodeCheckoutRequest copyWith(
          void Function(StartEpisodeCheckoutRequest) updates) =>
      super.copyWith(
              (message) => updates(message as StartEpisodeCheckoutRequest))
          as StartEpisodeCheckoutRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartEpisodeCheckoutRequest() / StartEpisodeCheckoutRequest.new instead')
  static StartEpisodeCheckoutRequest create() =>
      StartEpisodeCheckoutRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartEpisodeCheckoutRequest._();
  @$core.override
  StartEpisodeCheckoutRequest createEmptyInstance() =>
      StartEpisodeCheckoutRequest._();
  @$core.pragma('dart2js:noInline')
  static StartEpisodeCheckoutRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartEpisodeCheckoutRequest>(
          StartEpisodeCheckoutRequest.$_createMessage);
  static StartEpisodeCheckoutRequest? _defaultInstance;

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

  /// Where the provider should return the reader after checkout, and the
  /// surface the episode has to be sold on. Unspecified is the storefront.
  @$pb.TagNumber(3)
  StartEpisodeCheckoutRequest_Client get client => $_getN(1);
  @$pb.TagNumber(3)
  set client(StartEpisodeCheckoutRequest_Client value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasClient() => $_has(1);
  @$pb.TagNumber(3)
  void clearClient() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(4)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(4)
  void clearEpisodeId() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);

  /// Which of the episode's sales the checkout is for. Unspecified is the
  /// permanent copy. A rental of an episode that is not rented is
  /// failed_precondition. A reader who holds an active permanent copy is
  /// already_exists for either kind, and one who holds an active rental for
  /// another rental, but may still buy the permanent copy.
  @$pb.TagNumber(6)
  $0.PurchaseKind get kind => $_getN(4);
  @$pb.TagNumber(6)
  set kind($0.PurchaseKind value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasKind() => $_has(4);
  @$pb.TagNumber(6)
  void clearKind() => $_clearField(6);
}

class StartEpisodeCheckoutResponse extends $pb.GeneratedMessage {
  factory StartEpisodeCheckoutResponse({
    $core.String? checkoutUrl,
  }) {
    final result = StartEpisodeCheckoutResponse._();
    if (checkoutUrl != null) result.checkoutUrl = checkoutUrl;
    return result;
  }

  StartEpisodeCheckoutResponse._();

  factory StartEpisodeCheckoutResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartEpisodeCheckoutResponse()..mergeFromBuffer(data, registry);
  factory StartEpisodeCheckoutResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartEpisodeCheckoutResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartEpisodeCheckoutResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartEpisodeCheckoutResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'checkoutUrl')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartEpisodeCheckoutResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartEpisodeCheckoutResponse copyWith(
          void Function(StartEpisodeCheckoutResponse) updates) =>
      super.copyWith(
              (message) => updates(message as StartEpisodeCheckoutResponse))
          as StartEpisodeCheckoutResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartEpisodeCheckoutResponse() / StartEpisodeCheckoutResponse.new instead')
  static StartEpisodeCheckoutResponse create() =>
      StartEpisodeCheckoutResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartEpisodeCheckoutResponse._();
  @$core.override
  StartEpisodeCheckoutResponse createEmptyInstance() =>
      StartEpisodeCheckoutResponse._();
  @$core.pragma('dart2js:noInline')
  static StartEpisodeCheckoutResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartEpisodeCheckoutResponse>(
          StartEpisodeCheckoutResponse.$_createMessage);
  static StartEpisodeCheckoutResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get checkoutUrl => $_getSZ(0);
  @$pb.TagNumber(1)
  set checkoutUrl($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCheckoutUrl() => $_has(0);
  @$pb.TagNumber(1)
  void clearCheckoutUrl() => $_clearField(1);
}

/// One purchase belonging to the signed-in reader. `is_active` is evaluated by
/// the API at read time: a purchase is active until it is revoked or its
/// expiry passes, and one without an expiry stays active until it is revoked.
class MyPurchase extends $pb.GeneratedMessage {
  factory MyPurchase({
    $core.String? id,
    $0.Episode? episode,
    $0.Series? series,
    $core.int? priceAtPurchase,
    $core.String? purchasedAt,
    $core.String? expiresAt,
    $core.bool? isActive,
    $core.String? currency,
    $core.int? refundedAmount,
    $core.String? refundedAt,
    $core.String? revokedAt,
    $0.PurchaseKind? kind,
  }) {
    final result = MyPurchase._();
    if (id != null) result.id = id;
    if (episode != null) result.episode = episode;
    if (series != null) result.series = series;
    if (priceAtPurchase != null) result.priceAtPurchase = priceAtPurchase;
    if (purchasedAt != null) result.purchasedAt = purchasedAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (isActive != null) result.isActive = isActive;
    if (currency != null) result.currency = currency;
    if (refundedAmount != null) result.refundedAmount = refundedAmount;
    if (refundedAt != null) result.refundedAt = refundedAt;
    if (revokedAt != null) result.revokedAt = revokedAt;
    if (kind != null) result.kind = kind;
    return result;
  }

  MyPurchase._();

  factory MyPurchase.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyPurchase()..mergeFromBuffer(data, registry);
  factory MyPurchase.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyPurchase()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyPurchase',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyPurchase.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOM<$0.Episode>(2, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOM<$0.Series>(3, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..aI(4, _omitFieldNames ? '' : 'priceAtPurchase')
    ..aOS(5, _omitFieldNames ? '' : 'purchasedAt')
    ..aOS(6, _omitFieldNames ? '' : 'expiresAt')
    ..aOB(7, _omitFieldNames ? '' : 'isActive')
    ..aOS(8, _omitFieldNames ? '' : 'currency')
    ..aI(9, _omitFieldNames ? '' : 'refundedAmount')
    ..aOS(10, _omitFieldNames ? '' : 'refundedAt')
    ..aOS(11, _omitFieldNames ? '' : 'revokedAt')
    ..aE<$0.PurchaseKind>(12, _omitFieldNames ? '' : 'kind',
        enumValues: $0.PurchaseKind.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyPurchase clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyPurchase copyWith(void Function(MyPurchase) updates) =>
      super.copyWith((message) => updates(message as MyPurchase)) as MyPurchase;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyPurchase() / MyPurchase.new instead')
  static MyPurchase create() => MyPurchase._();
  static $pb.GeneratedMessage $_createMessage() => MyPurchase._();
  @$core.override
  MyPurchase createEmptyInstance() => MyPurchase._();
  @$core.pragma('dart2js:noInline')
  static MyPurchase getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MyPurchase>(MyPurchase.$_createMessage);
  static MyPurchase? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $0.Episode get episode => $_getN(1);
  @$pb.TagNumber(2)
  set episode($0.Episode value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisode() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisode() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.Episode ensureEpisode() => $_ensure(1);

  @$pb.TagNumber(3)
  $0.Series get series => $_getN(2);
  @$pb.TagNumber(3)
  set series($0.Series value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSeries() => $_has(2);
  @$pb.TagNumber(3)
  void clearSeries() => $_clearField(3);
  @$pb.TagNumber(3)
  $0.Series ensureSeries() => $_ensure(2);

  /// What the reader paid, in the minor unit of currency.
  @$pb.TagNumber(4)
  $core.int get priceAtPurchase => $_getIZ(3);
  @$pb.TagNumber(4)
  set priceAtPurchase($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPriceAtPurchase() => $_has(3);
  @$pb.TagNumber(4)
  void clearPriceAtPurchase() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get purchasedAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set purchasedAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPurchasedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearPurchasedAt() => $_clearField(5);

  /// Empty when this purchase does not expire.
  @$pb.TagNumber(6)
  $core.String get expiresAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set expiresAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasExpiresAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearExpiresAt() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get isActive => $_getBF(6);
  @$pb.TagNumber(7)
  set isActive($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasIsActive() => $_has(6);
  @$pb.TagNumber(7)
  void clearIsActive() => $_clearField(7);

  /// The ISO 4217 code, in capitals, of the currency price_at_purchase is in:
  /// the one the reader paid in, which is the tenant's unless the payment was
  /// started before the tenant changed it.
  @$pb.TagNumber(8)
  $core.String get currency => $_getSZ(7);
  @$pb.TagNumber(8)
  set currency($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCurrency() => $_has(7);
  @$pb.TagNumber(8)
  void clearCurrency() => $_clearField(8);

  /// The total the payment provider has reported refunded to the reader so
  /// far, in the same minor unit as price_at_purchase. Zero while no refund
  /// has been reported.
  @$pb.TagNumber(9)
  $core.int get refundedAmount => $_getIZ(8);
  @$pb.TagNumber(9)
  set refundedAmount($core.int value) => $_setSignedInt32(8, value);
  @$pb.TagNumber(9)
  $core.bool hasRefundedAmount() => $_has(8);
  @$pb.TagNumber(9)
  void clearRefundedAmount() => $_clearField(9);

  /// RFC3339; set once refunded_amount reaches price_at_purchase. A purchase
  /// refunded in full is never active.
  @$pb.TagNumber(10)
  $core.String get refundedAt => $_getSZ(9);
  @$pb.TagNumber(10)
  set refundedAt($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasRefundedAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearRefundedAt() => $_clearField(10);

  /// RFC3339; set once the purchase stops opening its episode before its
  /// reading period runs out: refunded in full, disputed with the reader's
  /// bank, or refunded by staff, which revokes it before the provider reports
  /// the refund. A purchase revoked here is never active.
  @$pb.TagNumber(11)
  $core.String get revokedAt => $_getSZ(10);
  @$pb.TagNumber(11)
  set revokedAt($core.String value) => $_setString(10, value);
  @$pb.TagNumber(11)
  $core.bool hasRevokedAt() => $_has(10);
  @$pb.TagNumber(11)
  void clearRevokedAt() => $_clearField(11);

  /// Which of the episode's sales the reader bought, never unspecified. A
  /// rental always carries expires_at.
  @$pb.TagNumber(12)
  $0.PurchaseKind get kind => $_getN(11);
  @$pb.TagNumber(12)
  set kind($0.PurchaseKind value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasKind() => $_has(11);
  @$pb.TagNumber(12)
  void clearKind() => $_clearField(12);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListMyPurchasesRequest extends $pb.GeneratedMessage {
  factory ListMyPurchasesRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListMyPurchasesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListMyPurchasesRequest._();

  factory ListMyPurchasesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPurchasesRequest()..mergeFromBuffer(data, registry);
  factory ListMyPurchasesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPurchasesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyPurchasesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyPurchasesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPurchasesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPurchasesRequest copyWith(
          void Function(ListMyPurchasesRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyPurchasesRequest))
          as ListMyPurchasesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyPurchasesRequest() / ListMyPurchasesRequest.new instead')
  static ListMyPurchasesRequest create() => ListMyPurchasesRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListMyPurchasesRequest._();
  @$core.override
  ListMyPurchasesRequest createEmptyInstance() => ListMyPurchasesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyPurchasesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyPurchasesRequest>(
          ListMyPurchasesRequest.$_createMessage);
  static ListMyPurchasesRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListMyPurchasesResponse extends $pb.GeneratedMessage {
  factory ListMyPurchasesResponse({
    $core.Iterable<MyPurchase>? purchases,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyPurchasesResponse._();
    if (purchases != null) result.purchases.addAll(purchases);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyPurchasesResponse._();

  factory ListMyPurchasesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPurchasesResponse()..mergeFromBuffer(data, registry);
  factory ListMyPurchasesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPurchasesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyPurchasesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyPurchasesResponse.$_createMessage)
    ..pPM<MyPurchase>(1, _omitFieldNames ? '' : 'purchases',
        subBuilder: MyPurchase.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPurchasesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPurchasesResponse copyWith(
          void Function(ListMyPurchasesResponse) updates) =>
      super.copyWith((message) => updates(message as ListMyPurchasesResponse))
          as ListMyPurchasesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyPurchasesResponse() / ListMyPurchasesResponse.new instead')
  static ListMyPurchasesResponse create() => ListMyPurchasesResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListMyPurchasesResponse._();
  @$core.override
  ListMyPurchasesResponse createEmptyInstance() => ListMyPurchasesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyPurchasesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyPurchasesResponse>(
          ListMyPurchasesResponse.$_createMessage);
  static ListMyPurchasesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<MyPurchase> get purchases => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);
}

/// `web-storefront` forwards a payment provider's raw request body and headers
/// to this RPC. Signature verification and all purchase validation stay on the
/// API server, which reads the signature from the header the provider declares.
class ProcessPaymentWebhookRequest extends $pb.GeneratedMessage {
  factory ProcessPaymentWebhookRequest({
    $0.TenantContext? tenant,
    $core.String? provider,
    $core.List<$core.int>? payload,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? headers,
  }) {
    final result = ProcessPaymentWebhookRequest._();
    if (tenant != null) result.tenant = tenant;
    if (provider != null) result.provider = provider;
    if (payload != null) result.payload = payload;
    if (headers != null) result.headers.addEntries(headers);
    return result;
  }

  ProcessPaymentWebhookRequest._();

  factory ProcessPaymentWebhookRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessPaymentWebhookRequest()..mergeFromBuffer(data, registry);
  factory ProcessPaymentWebhookRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessPaymentWebhookRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessPaymentWebhookRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessPaymentWebhookRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'provider')
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..m<$core.String, $core.String>(4, _omitFieldNames ? '' : 'headers',
        entryClassName: 'ProcessPaymentWebhookRequest.HeadersEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('publira.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessPaymentWebhookRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessPaymentWebhookRequest copyWith(
          void Function(ProcessPaymentWebhookRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ProcessPaymentWebhookRequest))
          as ProcessPaymentWebhookRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessPaymentWebhookRequest() / ProcessPaymentWebhookRequest.new instead')
  static ProcessPaymentWebhookRequest create() =>
      ProcessPaymentWebhookRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessPaymentWebhookRequest._();
  @$core.override
  ProcessPaymentWebhookRequest createEmptyInstance() =>
      ProcessPaymentWebhookRequest._();
  @$core.pragma('dart2js:noInline')
  static ProcessPaymentWebhookRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProcessPaymentWebhookRequest>(
          ProcessPaymentWebhookRequest.$_createMessage);
  static ProcessPaymentWebhookRequest? _defaultInstance;

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

  /// The id of the provider the notification came from, such as `stripe`.
  @$pb.TagNumber(2)
  $core.String get provider => $_getSZ(1);
  @$pb.TagNumber(2)
  set provider($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasProvider() => $_has(1);
  @$pb.TagNumber(2)
  void clearProvider() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.List<$core.int> get payload => $_getN(2);
  @$pb.TagNumber(3)
  set payload($core.List<$core.int> value) => $_setBytes(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPayload() => $_has(2);
  @$pb.TagNumber(3)
  void clearPayload() => $_clearField(3);

  /// The request headers, keyed by name. Names are matched case-insensitively.
  @$pb.TagNumber(4)
  $pb.PbMap<$core.String, $core.String> get headers => $_getMap(3);
}

class ProcessPaymentWebhookResponse extends $pb.GeneratedMessage {
  factory ProcessPaymentWebhookResponse() => ProcessPaymentWebhookResponse._();

  ProcessPaymentWebhookResponse._();

  factory ProcessPaymentWebhookResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessPaymentWebhookResponse()..mergeFromBuffer(data, registry);
  factory ProcessPaymentWebhookResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessPaymentWebhookResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessPaymentWebhookResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessPaymentWebhookResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessPaymentWebhookResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessPaymentWebhookResponse copyWith(
          void Function(ProcessPaymentWebhookResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ProcessPaymentWebhookResponse))
          as ProcessPaymentWebhookResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessPaymentWebhookResponse() / ProcessPaymentWebhookResponse.new instead')
  static ProcessPaymentWebhookResponse create() =>
      ProcessPaymentWebhookResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessPaymentWebhookResponse._();
  @$core.override
  ProcessPaymentWebhookResponse createEmptyInstance() =>
      ProcessPaymentWebhookResponse._();
  @$core.pragma('dart2js:noInline')
  static ProcessPaymentWebhookResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProcessPaymentWebhookResponse>(
          ProcessPaymentWebhookResponse.$_createMessage);
  static ProcessPaymentWebhookResponse? _defaultInstance;
}

/// Opens a purchase through the App Store's or Google Play's in-app purchase,
/// for a tenant whose app sells through the store. The app buys `product_id`
/// with `intent_id` as the transaction's account token (`appAccountToken` on
/// iOS, `obfuscatedAccountId` on Android), which is how ConfirmStorePurchase
/// learns which episode the transaction pays for. The intent keeps the price and
/// the reading period the episode is sold with at this moment, and the purchase
/// is recorded on those terms.
///
/// Signed-in readers only. An episode the app may not show is not_found; one it
/// may not sell, a free one, a tenant whose app does not sell through the
/// store, and a `store` that is not ready are failed_precondition, and an
/// episode the reader already holds is already_exists. An episode that credits
/// a creator the reader's account is linked to is permission_denied with the
/// ErrorInfo reason READER_CREDITED_ON_EPISODE. Asking again for the same
/// episode at the same price answers the same intent.
class StartStorePurchaseRequest extends $pb.GeneratedMessage {
  factory StartStorePurchaseRequest({
    $0.TenantContext? tenant,
    InAppPurchaseStore? store,
    $core.String? episodeId,
  }) {
    final result = StartStorePurchaseRequest._();
    if (tenant != null) result.tenant = tenant;
    if (store != null) result.store = store;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  StartStorePurchaseRequest._();

  factory StartStorePurchaseRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartStorePurchaseRequest()..mergeFromBuffer(data, registry);
  factory StartStorePurchaseRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartStorePurchaseRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartStorePurchaseRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartStorePurchaseRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<InAppPurchaseStore>(3, _omitFieldNames ? '' : 'store',
        enumValues: InAppPurchaseStore.values)
    ..aOS(4, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartStorePurchaseRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartStorePurchaseRequest copyWith(
          void Function(StartStorePurchaseRequest) updates) =>
      super.copyWith((message) => updates(message as StartStorePurchaseRequest))
          as StartStorePurchaseRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartStorePurchaseRequest() / StartStorePurchaseRequest.new instead')
  static StartStorePurchaseRequest create() => StartStorePurchaseRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartStorePurchaseRequest._();
  @$core.override
  StartStorePurchaseRequest createEmptyInstance() =>
      StartStorePurchaseRequest._();
  @$core.pragma('dart2js:noInline')
  static StartStorePurchaseRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartStorePurchaseRequest>(
          StartStorePurchaseRequest.$_createMessage);
  static StartStorePurchaseRequest? _defaultInstance;

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

  /// The store the app is about to charge through. Required.
  @$pb.TagNumber(3)
  InAppPurchaseStore get store => $_getN(1);
  @$pb.TagNumber(3)
  set store(InAppPurchaseStore value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasStore() => $_has(1);
  @$pb.TagNumber(3)
  void clearStore() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get episodeId => $_getSZ(2);
  @$pb.TagNumber(4)
  set episodeId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasEpisodeId() => $_has(2);
  @$pb.TagNumber(4)
  void clearEpisodeId() => $_clearField(4);
}

class StartStorePurchaseResponse extends $pb.GeneratedMessage {
  factory StartStorePurchaseResponse({
    $core.String? intentId,
    $core.String? productId,
  }) {
    final result = StartStorePurchaseResponse._();
    if (intentId != null) result.intentId = intentId;
    if (productId != null) result.productId = productId;
    return result;
  }

  StartStorePurchaseResponse._();

  factory StartStorePurchaseResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartStorePurchaseResponse()..mergeFromBuffer(data, registry);
  factory StartStorePurchaseResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      StartStorePurchaseResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'StartStorePurchaseResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: StartStorePurchaseResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'intentId')
    ..aOS(2, _omitFieldNames ? '' : 'productId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartStorePurchaseResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  StartStorePurchaseResponse copyWith(
          void Function(StartStorePurchaseResponse) updates) =>
      super.copyWith(
              (message) => updates(message as StartStorePurchaseResponse))
          as StartStorePurchaseResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use StartStorePurchaseResponse() / StartStorePurchaseResponse.new instead')
  static StartStorePurchaseResponse create() => StartStorePurchaseResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      StartStorePurchaseResponse._();
  @$core.override
  StartStorePurchaseResponse createEmptyInstance() =>
      StartStorePurchaseResponse._();
  @$core.pragma('dart2js:noInline')
  static StartStorePurchaseResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<StartStorePurchaseResponse>(
          StartStorePurchaseResponse.$_createMessage);
  static StartStorePurchaseResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get intentId => $_getSZ(0);
  @$pb.TagNumber(1)
  set intentId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIntentId() => $_has(0);
  @$pb.TagNumber(1)
  void clearIntentId() => $_clearField(1);

  /// The store product the episode's price is sold as, such as `episode_300`.
  @$pb.TagNumber(2)
  $core.String get productId => $_getSZ(1);
  @$pb.TagNumber(2)
  set productId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasProductId() => $_has(1);
  @$pb.TagNumber(2)
  void clearProductId() => $_clearField(2);
}

/// Hands a transaction the store charged to the server, which verifies it with
/// the store and records it as a purchase.
///
/// The transaction's account token has to name an open intent the caller
/// opened, for the product the transaction bought, in the tenant's own app:
/// anything else is invalid_argument, or permission_denied for another reader's
/// intent, and creates nothing. A transaction the store has not settled (Ask to
/// Buy, a Play pending purchase) is failed_precondition, and a store the server
/// cannot reach is unavailable; the app confirms again later either way.
/// Confirming a recorded transaction again answers the same purchase. Each
/// call spends the reader's allowance for store confirmations, and a reader past
/// it is resource_exhausted before the store is asked.
class ConfirmStorePurchaseRequest extends $pb.GeneratedMessage {
  factory ConfirmStorePurchaseRequest({
    $0.TenantContext? tenant,
    InAppPurchaseStore? store,
    $core.String? transaction,
    $core.String? productId,
    $core.String? locale,
  }) {
    final result = ConfirmStorePurchaseRequest._();
    if (tenant != null) result.tenant = tenant;
    if (store != null) result.store = store;
    if (transaction != null) result.transaction = transaction;
    if (productId != null) result.productId = productId;
    if (locale != null) result.locale = locale;
    return result;
  }

  ConfirmStorePurchaseRequest._();

  factory ConfirmStorePurchaseRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmStorePurchaseRequest()..mergeFromBuffer(data, registry);
  factory ConfirmStorePurchaseRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmStorePurchaseRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmStorePurchaseRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmStorePurchaseRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<InAppPurchaseStore>(2, _omitFieldNames ? '' : 'store',
        enumValues: InAppPurchaseStore.values)
    ..aOS(3, _omitFieldNames ? '' : 'transaction')
    ..aOS(4, _omitFieldNames ? '' : 'productId')
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmStorePurchaseRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmStorePurchaseRequest copyWith(
          void Function(ConfirmStorePurchaseRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ConfirmStorePurchaseRequest))
          as ConfirmStorePurchaseRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmStorePurchaseRequest() / ConfirmStorePurchaseRequest.new instead')
  static ConfirmStorePurchaseRequest create() =>
      ConfirmStorePurchaseRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmStorePurchaseRequest._();
  @$core.override
  ConfirmStorePurchaseRequest createEmptyInstance() =>
      ConfirmStorePurchaseRequest._();
  @$core.pragma('dart2js:noInline')
  static ConfirmStorePurchaseRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmStorePurchaseRequest>(
          ConfirmStorePurchaseRequest.$_createMessage);
  static ConfirmStorePurchaseRequest? _defaultInstance;

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
  InAppPurchaseStore get store => $_getN(1);
  @$pb.TagNumber(2)
  set store(InAppPurchaseStore value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasStore() => $_has(1);
  @$pb.TagNumber(2)
  void clearStore() => $_clearField(2);

  /// IN_APP_PURCHASE_STORE_APP_STORE: the JWS signed transaction StoreKit 2
  /// reports. IN_APP_PURCHASE_STORE_GOOGLE_PLAY: the purchase token.
  @$pb.TagNumber(3)
  $core.String get transaction => $_getSZ(2);
  @$pb.TagNumber(3)
  set transaction($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTransaction() => $_has(2);
  @$pb.TagNumber(3)
  void clearTransaction() => $_clearField(3);

  /// IN_APP_PURCHASE_STORE_GOOGLE_PLAY: the product the token was bought as,
  /// which the Google Play Developer API looks a purchase up by. Unused for the
  /// App Store, whose signed transaction names its product.
  @$pb.TagNumber(4)
  $core.String get productId => $_getSZ(3);
  @$pb.TagNumber(4)
  set productId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasProductId() => $_has(3);
  @$pb.TagNumber(4)
  void clearProductId() => $_clearField(4);

  /// The reader's locale. Every series and episode title and synopsis in the
  /// answer is that of the translation in this locale, else the tenant's default
  /// locale's, else the oldest one. Empty means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ConfirmStorePurchaseResponse extends $pb.GeneratedMessage {
  factory ConfirmStorePurchaseResponse({
    MyPurchase? purchase,
  }) {
    final result = ConfirmStorePurchaseResponse._();
    if (purchase != null) result.purchase = purchase;
    return result;
  }

  ConfirmStorePurchaseResponse._();

  factory ConfirmStorePurchaseResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmStorePurchaseResponse()..mergeFromBuffer(data, registry);
  factory ConfirmStorePurchaseResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmStorePurchaseResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmStorePurchaseResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmStorePurchaseResponse.$_createMessage)
    ..aOM<MyPurchase>(1, _omitFieldNames ? '' : 'purchase',
        subBuilder: MyPurchase.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmStorePurchaseResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmStorePurchaseResponse copyWith(
          void Function(ConfirmStorePurchaseResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ConfirmStorePurchaseResponse))
          as ConfirmStorePurchaseResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmStorePurchaseResponse() / ConfirmStorePurchaseResponse.new instead')
  static ConfirmStorePurchaseResponse create() =>
      ConfirmStorePurchaseResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmStorePurchaseResponse._();
  @$core.override
  ConfirmStorePurchaseResponse createEmptyInstance() =>
      ConfirmStorePurchaseResponse._();
  @$core.pragma('dart2js:noInline')
  static ConfirmStorePurchaseResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmStorePurchaseResponse>(
          ConfirmStorePurchaseResponse.$_createMessage);
  static ConfirmStorePurchaseResponse? _defaultInstance;

  @$pb.TagNumber(1)
  MyPurchase get purchase => $_getN(0);
  @$pb.TagNumber(1)
  set purchase(MyPurchase value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPurchase() => $_has(0);
  @$pb.TagNumber(1)
  void clearPurchase() => $_clearField(1);
  @$pb.TagNumber(1)
  MyPurchase ensurePurchase() => $_ensure(0);
}

/// `web-storefront` forwards the raw body of an App Store Server Notifications
/// V2 request to this RPC. The signed payload is verified against Apple's root
/// certificate here, and it has to name the tenant's own iOS app.
///
/// REFUND and REVOKE take back the purchase of the transaction they carry,
/// holding the refund until the purchase is recorded when the app has not
/// confirmed it yet; every other type is acknowledged and changes nothing. A
/// payload that does not verify, or names another app, is invalid_argument, and
/// a tenant with no iOS app is failed_precondition.
class ProcessAppStoreNotificationRequest extends $pb.GeneratedMessage {
  factory ProcessAppStoreNotificationRequest({
    $0.TenantContext? tenant,
    $core.List<$core.int>? payload,
  }) {
    final result = ProcessAppStoreNotificationRequest._();
    if (tenant != null) result.tenant = tenant;
    if (payload != null) result.payload = payload;
    return result;
  }

  ProcessAppStoreNotificationRequest._();

  factory ProcessAppStoreNotificationRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessAppStoreNotificationRequest()..mergeFromBuffer(data, registry);
  factory ProcessAppStoreNotificationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessAppStoreNotificationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessAppStoreNotificationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessAppStoreNotificationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessAppStoreNotificationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessAppStoreNotificationRequest copyWith(
          void Function(ProcessAppStoreNotificationRequest) updates) =>
      super.copyWith((message) =>
              updates(message as ProcessAppStoreNotificationRequest))
          as ProcessAppStoreNotificationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessAppStoreNotificationRequest() / ProcessAppStoreNotificationRequest.new instead')
  static ProcessAppStoreNotificationRequest create() =>
      ProcessAppStoreNotificationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessAppStoreNotificationRequest._();
  @$core.override
  ProcessAppStoreNotificationRequest createEmptyInstance() =>
      ProcessAppStoreNotificationRequest._();
  @$core.pragma('dart2js:noInline')
  static ProcessAppStoreNotificationRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProcessAppStoreNotificationRequest>(
          ProcessAppStoreNotificationRequest.$_createMessage);
  static ProcessAppStoreNotificationRequest? _defaultInstance;

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
  $core.List<$core.int> get payload => $_getN(1);
  @$pb.TagNumber(2)
  set payload($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPayload() => $_has(1);
  @$pb.TagNumber(2)
  void clearPayload() => $_clearField(2);
}

class ProcessAppStoreNotificationResponse extends $pb.GeneratedMessage {
  factory ProcessAppStoreNotificationResponse() =>
      ProcessAppStoreNotificationResponse._();

  ProcessAppStoreNotificationResponse._();

  factory ProcessAppStoreNotificationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessAppStoreNotificationResponse()..mergeFromBuffer(data, registry);
  factory ProcessAppStoreNotificationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessAppStoreNotificationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessAppStoreNotificationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessAppStoreNotificationResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessAppStoreNotificationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessAppStoreNotificationResponse copyWith(
          void Function(ProcessAppStoreNotificationResponse) updates) =>
      super.copyWith((message) =>
              updates(message as ProcessAppStoreNotificationResponse))
          as ProcessAppStoreNotificationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessAppStoreNotificationResponse() / ProcessAppStoreNotificationResponse.new instead')
  static ProcessAppStoreNotificationResponse create() =>
      ProcessAppStoreNotificationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessAppStoreNotificationResponse._();
  @$core.override
  ProcessAppStoreNotificationResponse createEmptyInstance() =>
      ProcessAppStoreNotificationResponse._();
  @$core.pragma('dart2js:noInline')
  static ProcessAppStoreNotificationResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<
              ProcessAppStoreNotificationResponse>(
          ProcessAppStoreNotificationResponse.$_createMessage);
  static ProcessAppStoreNotificationResponse? _defaultInstance;
}

class GetMyTicketStateRequest extends $pb.GeneratedMessage {
  factory GetMyTicketStateRequest({
    $0.TenantContext? tenant,
    $core.String? seriesId,
    $0.ClientSurface? surface,
  }) {
    final result = GetMyTicketStateRequest._();
    if (tenant != null) result.tenant = tenant;
    if (seriesId != null) result.seriesId = seriesId;
    if (surface != null) result.surface = surface;
    return result;
  }

  GetMyTicketStateRequest._();

  factory GetMyTicketStateRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyTicketStateRequest()..mergeFromBuffer(data, registry);
  factory GetMyTicketStateRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyTicketStateRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyTicketStateRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyTicketStateRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'seriesId')
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyTicketStateRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyTicketStateRequest copyWith(
          void Function(GetMyTicketStateRequest) updates) =>
      super.copyWith((message) => updates(message as GetMyTicketStateRequest))
          as GetMyTicketStateRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyTicketStateRequest() / GetMyTicketStateRequest.new instead')
  static GetMyTicketStateRequest create() => GetMyTicketStateRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMyTicketStateRequest._();
  @$core.override
  GetMyTicketStateRequest createEmptyInstance() => GetMyTicketStateRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyTicketStateRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyTicketStateRequest>(
          GetMyTicketStateRequest.$_createMessage);
  static GetMyTicketStateRequest? _defaultInstance;

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
  $core.String get seriesId => $_getSZ(1);
  @$pb.TagNumber(2)
  set seriesId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSeriesId() => $_has(1);
  @$pb.TagNumber(2)
  void clearSeriesId() => $_clearField(2);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

/// An episode a wait-for-free ticket opened and that is still open.
class WaitFreeTicket extends $pb.GeneratedMessage {
  factory WaitFreeTicket({
    $core.String? episodeId,
    $core.String? expiresAt,
  }) {
    final result = WaitFreeTicket._();
    if (episodeId != null) result.episodeId = episodeId;
    if (expiresAt != null) result.expiresAt = expiresAt;
    return result;
  }

  WaitFreeTicket._();

  factory WaitFreeTicket.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WaitFreeTicket()..mergeFromBuffer(data, registry);
  factory WaitFreeTicket.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WaitFreeTicket()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WaitFreeTicket',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: WaitFreeTicket.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'episodeId')
    ..aOS(2, _omitFieldNames ? '' : 'expiresAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WaitFreeTicket clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WaitFreeTicket copyWith(void Function(WaitFreeTicket) updates) =>
      super.copyWith((message) => updates(message as WaitFreeTicket))
          as WaitFreeTicket;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use WaitFreeTicket() / WaitFreeTicket.new instead')
  static WaitFreeTicket create() => WaitFreeTicket._();
  static $pb.GeneratedMessage $_createMessage() => WaitFreeTicket._();
  @$core.override
  WaitFreeTicket createEmptyInstance() => WaitFreeTicket._();
  @$core.pragma('dart2js:noInline')
  static WaitFreeTicket getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<WaitFreeTicket>(
          WaitFreeTicket.$_createMessage);
  static WaitFreeTicket? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get episodeId => $_getSZ(0);
  @$pb.TagNumber(1)
  set episodeId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEpisodeId() => $_has(0);
  @$pb.TagNumber(1)
  void clearEpisodeId() => $_clearField(1);

  /// RFC3339 instant the episode locks again.
  @$pb.TagNumber(2)
  $core.String get expiresAt => $_getSZ(1);
  @$pb.TagNumber(2)
  set expiresAt($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasExpiresAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearExpiresAt() => $_clearField(2);
}

class GetMyTicketStateResponse extends $pb.GeneratedMessage {
  factory GetMyTicketStateResponse({
    $core.String? nextAvailableAt,
    $core.Iterable<WaitFreeTicket>? openTickets,
  }) {
    final result = GetMyTicketStateResponse._();
    if (nextAvailableAt != null) result.nextAvailableAt = nextAvailableAt;
    if (openTickets != null) result.openTickets.addAll(openTickets);
    return result;
  }

  GetMyTicketStateResponse._();

  factory GetMyTicketStateResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyTicketStateResponse()..mergeFromBuffer(data, registry);
  factory GetMyTicketStateResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyTicketStateResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyTicketStateResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyTicketStateResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'nextAvailableAt')
    ..pPM<WaitFreeTicket>(2, _omitFieldNames ? '' : 'openTickets',
        subBuilder: WaitFreeTicket.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyTicketStateResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyTicketStateResponse copyWith(
          void Function(GetMyTicketStateResponse) updates) =>
      super.copyWith((message) => updates(message as GetMyTicketStateResponse))
          as GetMyTicketStateResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyTicketStateResponse() / GetMyTicketStateResponse.new instead')
  static GetMyTicketStateResponse create() => GetMyTicketStateResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetMyTicketStateResponse._();
  @$core.override
  GetMyTicketStateResponse createEmptyInstance() =>
      GetMyTicketStateResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyTicketStateResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyTicketStateResponse>(
          GetMyTicketStateResponse.$_createMessage);
  static GetMyTicketStateResponse? _defaultInstance;

  /// RFC3339 instant the reader's next ticket on the series is ready, and empty
  /// when one is ready now.
  @$pb.TagNumber(1)
  $core.String get nextAvailableAt => $_getSZ(0);
  @$pb.TagNumber(1)
  set nextAvailableAt($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasNextAvailableAt() => $_has(0);
  @$pb.TagNumber(1)
  void clearNextAvailableAt() => $_clearField(1);

  /// The reader's tickets on this series that still open their episode,
  /// soonest to close first.
  @$pb.TagNumber(2)
  $pb.PbList<WaitFreeTicket> get openTickets => $_getList(1);
}

class UseTicketRequest extends $pb.GeneratedMessage {
  factory UseTicketRequest({
    $0.TenantContext? tenant,
    $core.String? episodeId,
    $0.ClientSurface? surface,
  }) {
    final result = UseTicketRequest._();
    if (tenant != null) result.tenant = tenant;
    if (episodeId != null) result.episodeId = episodeId;
    if (surface != null) result.surface = surface;
    return result;
  }

  UseTicketRequest._();

  factory UseTicketRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UseTicketRequest()..mergeFromBuffer(data, registry);
  factory UseTicketRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UseTicketRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UseTicketRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UseTicketRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'episodeId')
    ..aE<$0.ClientSurface>(3, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UseTicketRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UseTicketRequest copyWith(void Function(UseTicketRequest) updates) =>
      super.copyWith((message) => updates(message as UseTicketRequest))
          as UseTicketRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UseTicketRequest() / UseTicketRequest.new instead')
  static UseTicketRequest create() => UseTicketRequest._();
  static $pb.GeneratedMessage $_createMessage() => UseTicketRequest._();
  @$core.override
  UseTicketRequest createEmptyInstance() => UseTicketRequest._();
  @$core.pragma('dart2js:noInline')
  static UseTicketRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UseTicketRequest>(
          UseTicketRequest.$_createMessage);
  static UseTicketRequest? _defaultInstance;

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
  $core.String get episodeId => $_getSZ(1);
  @$pb.TagNumber(2)
  set episodeId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisodeId() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisodeId() => $_clearField(2);

  /// The client making the request. Unspecified is answered as the web
  /// storefront. It decides which episodes count as the latest ones, as it
  /// decides which episodes GetSeriesDetail lists.
  @$pb.TagNumber(3)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(3)
  set surface($0.ClientSurface value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(3)
  void clearSurface() => $_clearField(3);
}

class UseTicketResponse extends $pb.GeneratedMessage {
  factory UseTicketResponse({
    WaitFreeTicket? ticket,
    $core.String? nextAvailableAt,
  }) {
    final result = UseTicketResponse._();
    if (ticket != null) result.ticket = ticket;
    if (nextAvailableAt != null) result.nextAvailableAt = nextAvailableAt;
    return result;
  }

  UseTicketResponse._();

  factory UseTicketResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UseTicketResponse()..mergeFromBuffer(data, registry);
  factory UseTicketResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UseTicketResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UseTicketResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UseTicketResponse.$_createMessage)
    ..aOM<WaitFreeTicket>(1, _omitFieldNames ? '' : 'ticket',
        subBuilder: WaitFreeTicket.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'nextAvailableAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UseTicketResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UseTicketResponse copyWith(void Function(UseTicketResponse) updates) =>
      super.copyWith((message) => updates(message as UseTicketResponse))
          as UseTicketResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UseTicketResponse() / UseTicketResponse.new instead')
  static UseTicketResponse create() => UseTicketResponse._();
  static $pb.GeneratedMessage $_createMessage() => UseTicketResponse._();
  @$core.override
  UseTicketResponse createEmptyInstance() => UseTicketResponse._();
  @$core.pragma('dart2js:noInline')
  static UseTicketResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UseTicketResponse>(
          UseTicketResponse.$_createMessage);
  static UseTicketResponse? _defaultInstance;

  @$pb.TagNumber(1)
  WaitFreeTicket get ticket => $_getN(0);
  @$pb.TagNumber(1)
  set ticket(WaitFreeTicket value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTicket() => $_has(0);
  @$pb.TagNumber(1)
  void clearTicket() => $_clearField(1);
  @$pb.TagNumber(1)
  WaitFreeTicket ensureTicket() => $_ensure(0);

  /// RFC3339 instant the reader's next ticket on the series is ready.
  @$pb.TagNumber(2)
  $core.String get nextAvailableAt => $_getSZ(1);
  @$pb.TagNumber(2)
  set nextAvailableAt($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNextAvailableAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearNextAvailableAt() => $_clearField(2);
}

class CatalogServiceApi {
  final $pb.RpcClient _client;

  CatalogServiceApi(this._client);

  /// Every label of the tenant, including one with no published series, so a
  /// label's URL keeps working after its last series is taken down. A label
  /// whose published series are all kept off the calling surface is left out.
  $async.Future<ListPublishedLabelsResponse> listPublishedLabels(
          $pb.ClientContext? ctx, ListPublishedLabelsRequest request) =>
      _client.invoke<ListPublishedLabelsResponse>(ctx, 'CatalogService',
          'ListPublishedLabels', request, ListPublishedLabelsResponse());
  $async.Future<ListPublishedSeriesResponse> listPublishedSeries(
          $pb.ClientContext? ctx, ListPublishedSeriesRequest request) =>
      _client.invoke<ListPublishedSeriesResponse>(ctx, 'CatalogService',
          'ListPublishedSeries', request, ListPublishedSeriesResponse());
  $async.Future<GetSeriesDetailResponse> getSeriesDetail(
          $pb.ClientContext? ctx, GetSeriesDetailRequest request) =>
      _client.invoke<GetSeriesDetailResponse>(ctx, 'CatalogService',
          'GetSeriesDetail', request, GetSeriesDetailResponse());

  /// The access state GetEpisodeDetail would answer for each published episode
  /// of one series, for the caller. It is separate from GetSeriesDetail so that
  /// read stays the same for every reader. Optional authentication: a guest and
  /// a bearer this server cannot verify are answered as a guest. Unpublished,
  /// cross-tenant, and missing series, and a series the calling surface may not
  /// show, are all surfaced as NotFound.
  $async.Future<GetSeriesEpisodeAccessResponse> getSeriesEpisodeAccess(
          $pb.ClientContext? ctx, GetSeriesEpisodeAccessRequest request) =>
      _client.invoke<GetSeriesEpisodeAccessResponse>(ctx, 'CatalogService',
          'GetSeriesEpisodeAccess', request, GetSeriesEpisodeAccessResponse());

  /// Returns only currently published episodes in the requested tenant.
  /// Unpublished, cross-tenant, and missing episodes, and an episode the calling
  /// surface may not show, are all surfaced as NotFound to prevent content
  /// existence leakage.
  $async.Future<GetEpisodeDetailResponse> getEpisodeDetail(
          $pb.ClientContext? ctx, GetEpisodeDetailRequest request) =>
      _client.invoke<GetEpisodeDetailResponse>(ctx, 'CatalogService',
          'GetEpisodeDetail', request, GetEpisodeDetailResponse());
  $async.Future<ListPublishedCreatorsResponse> listPublishedCreators(
          $pb.ClientContext? ctx, ListPublishedCreatorsRequest request) =>
      _client.invoke<ListPublishedCreatorsResponse>(ctx, 'CatalogService',
          'ListPublishedCreators', request, ListPublishedCreatorsResponse());

  /// Returns a creator only when they have at least one currently published
  /// series in the requested tenant that the calling surface may show. Cross-tenant, unpublished, and missing
  /// creators are all surfaced as NotFound so an unpublished creator cannot be
  /// distinguished from one that does not exist.
  $async.Future<GetPublishedCreatorDetailResponse> getPublishedCreatorDetail(
          $pb.ClientContext? ctx, GetPublishedCreatorDetailRequest request) =>
      _client.invoke<GetPublishedCreatorDetailResponse>(
          ctx,
          'CatalogService',
          'GetPublishedCreatorDetail',
          request,
          GetPublishedCreatorDetailResponse());

  /// Returns a label that belongs to the requested tenant. Cross-tenant and
  /// missing labels are surfaced as NotFound so a foreign label cannot be
  /// distinguished from one that does not exist. A label ListPublishedLabels
  /// leaves out for the calling surface is NotFound there too.
  $async.Future<GetPublishedLabelDetailResponse> getPublishedLabelDetail(
          $pb.ClientContext? ctx, GetPublishedLabelDetailRequest request) =>
      _client.invoke<GetPublishedLabelDetailResponse>(
          ctx,
          'CatalogService',
          'GetPublishedLabelDetail',
          request,
          GetPublishedLabelDetailResponse());

  /// The tenant's genres, in the order the console put them in, each with how
  /// many of its series are published right now.
  $async.Future<ListPublishedGenresResponse> listPublishedGenres(
          $pb.ClientContext? ctx, ListPublishedGenresRequest request) =>
      _client.invoke<ListPublishedGenresResponse>(ctx, 'CatalogService',
          'ListPublishedGenres', request, ListPublishedGenresResponse());

  /// The tags at least one published series carries, the most-carried first.
  $async.Future<ListPublishedTagsResponse> listPublishedTags(
          $pb.ClientContext? ctx, ListPublishedTagsRequest request) =>
      _client.invoke<ListPublishedTagsResponse>(ctx, 'CatalogService',
          'ListPublishedTags', request, ListPublishedTagsResponse());

  /// Keyword search over published series titles and synopses, narrowed and
  /// sorted by the fields ListPublishedSeries takes. An empty query is
  /// invalid_argument. A token carries the Unicode-lowercased query it was
  /// built for; sending it with a query that lowers to a different string is
  /// invalid_argument.
  $async.Future<SearchPublishedSeriesResponse> searchPublishedSeries(
          $pb.ClientContext? ctx, SearchPublishedSeriesRequest request) =>
      _client.invoke<SearchPublishedSeriesResponse>(ctx, 'CatalogService',
          'SearchPublishedSeries', request, SearchPublishedSeriesResponse());

  /// Keyword search over the names of creators who hold at least one currently
  /// published series. An empty query is invalid_argument, and the token rule
  /// is the one SearchPublishedSeries states.
  $async.Future<SearchPublishedCreatorsResponse> searchPublishedCreators(
          $pb.ClientContext? ctx, SearchPublishedCreatorsRequest request) =>
      _client.invoke<SearchPublishedCreatorsResponse>(
          ctx,
          'CatalogService',
          'SearchPublishedCreators',
          request,
          SearchPublishedCreatorsResponse());

  /// Keyword search over the names of labels that hold at least one currently
  /// published series. An empty query is invalid_argument, and the token rule
  /// is the one SearchPublishedSeries states.
  $async.Future<SearchPublishedLabelsResponse> searchPublishedLabels(
          $pb.ClientContext? ctx, SearchPublishedLabelsRequest request) =>
      _client.invoke<SearchPublishedLabelsResponse>(ctx, 'CatalogService',
          'SearchPublishedLabels', request, SearchPublishedLabelsResponse());

  /// Every published series, ordered by the latest ranking snapshot of
  /// behavioural signals and then by publication date, so a storefront slot can
  /// take the first page and a "see more" view can keep paging into the rest.
  /// A tenant whose signals have not produced a snapshot yet gets the new
  /// arrivals alone, which is what the slot showed before rankings existed.
  /// A ranking rebuilt between two pages moves the boundary the same way an
  /// unpublished series does; the token names a position, not a snapshot.
  $async.Future<ListRecommendedSeriesResponse> listRecommendedSeries(
          $pb.ClientContext? ctx, ListRecommendedSeriesRequest request) =>
      _client.invoke<ListRecommendedSeriesResponse>(ctx, 'CatalogService',
          'ListRecommendedSeries', request, ListRecommendedSeriesResponse());

  /// Every published series, ordered for the authenticated member from the
  /// features the daily batch computes out of their own last 28 days.
  ///
  /// Each series the member engaged with in that window is worth what they did
  /// with it: 100 per purchase, 50 per comment, 40 per favourite, 8 per point of
  /// each rating they gave, and 5 per view of the series or one of its episodes.
  /// Another series scores that worth times what it shares with the engaged
  /// one — 3 per creator, 2 for the label, 1 per genre and 1 per tag, the rule
  /// ListRelatedSeries scores by — summed over every series the member engaged
  /// with. A series the member has engaged with at all since that window
  /// began — counted from their own activity rather than from the features,
  /// which keep only the ten series they engaged with most — goes behind every
  /// series they have not, since a recommendation is for something they have
  /// yet to find, and is ordered among the others by the same score.
  ///
  /// Ties go to the series the tenant's readers as a whole engaged with most in
  /// the same window, weighted alike plus 10 for each day a distinct reader
  /// viewed it, and then to the newer series.
  ///
  /// A member the batch has no features for — a new account, a tenant the batch
  /// has not run for yet, or features an older build of the batch wrote — gets
  /// exactly what ListRecommendedSeries answers. The response is private to the
  /// member either way and is never shared between readers; a guest calls
  /// ListRecommendedSeries instead, whose answer is cached and shared.
  $async.Future<ListMyRecommendedSeriesResponse> listMyRecommendedSeries(
          $pb.ClientContext? ctx, ListMyRecommendedSeriesRequest request) =>
      _client.invoke<ListMyRecommendedSeriesResponse>(
          ctx,
          'CatalogService',
          'ListMyRecommendedSeries',
          request,
          ListMyRecommendedSeriesResponse());

  /// One page of the latest ranking snapshot for a period, an age rating, and
  /// optionally a genre, in the positions that snapshot recorded. A tenant or
  /// a genre the batch has not ranked yet gets an empty list rather than an
  /// error: nothing has been computed, which is not a failure. A series
  /// unpublished — or taken out of the genre — since the snapshot was written
  /// drops out and leaves a gap in the positions, because a snapshot describes
  /// a past window rather than the catalogue as it stands now.
  $async.Future<ListRankedSeriesResponse> listRankedSeries(
          $pb.ClientContext? ctx, ListRankedSeriesRequest request) =>
      _client.invoke<ListRankedSeriesResponse>(ctx, 'CatalogService',
          'ListRankedSeries', request, ListRankedSeriesResponse());

  /// The tenant's other published series, ordered by how much they share with
  /// one series: each creator they have in common counts 3, the same label 2,
  /// and each genre and each tag 1. Ties go to the better position in the
  /// latest weekly ranking, and then to the newer series.
  ///
  /// The list is never cut off at the related ones. A catalogue with more than
  /// one series always has a page to show, because a series sharing nothing
  /// still scores 0 and takes its place among the unrelated by ranking — so the
  /// section under a brand new series is the storefront ranking rather than an
  /// empty strip.
  ///
  /// Nothing here depends on who is reading, so a response can be cached and
  /// shared between readers.
  $async.Future<ListRelatedSeriesResponse> listRelatedSeries(
          $pb.ClientContext? ctx, ListRelatedSeriesRequest request) =>
      _client.invoke<ListRelatedSeriesResponse>(ctx, 'CatalogService',
          'ListRelatedSeries', request, ListRelatedSeriesResponse());

  /// Every page the web storefront publishes for the tenant, with the time each
  /// last changed, for the storefront's sitemap. It reads nothing about the
  /// caller, so a response can be cached and shared.
  $async.Future<ListSitemapEntriesResponse> listSitemapEntries(
          $pb.ClientContext? ctx, ListSitemapEntriesRequest request) =>
      _client.invoke<ListSitemapEntriesResponse>(ctx, 'CatalogService',
          'ListSitemapEntries', request, ListSitemapEntriesResponse());
}

class EpisodeReadServiceApi {
  final $pb.RpcClient _client;

  EpisodeReadServiceApi(this._client);

  /// Idempotently records that the authenticated member finished a currently
  /// published episode they may read. Unpublished, foreign, missing, and
  /// inaccessible episodes are all surfaced as NotFound.
  $async.Future<MarkEpisodeAsReadResponse> markEpisodeAsRead(
          $pb.ClientContext? ctx, MarkEpisodeAsReadRequest request) =>
      _client.invoke<MarkEpisodeAsReadResponse>(ctx, 'EpisodeReadService',
          'MarkEpisodeAsRead', request, MarkEpisodeAsReadResponse());

  /// Stores where the authenticated member stopped in an episode they may read.
  /// Saving the same page again changes nothing, and a page they went back to
  /// is accepted like any other. Unpublished, foreign, missing, and
  /// inaccessible episodes are all surfaced as NotFound.
  $async.Future<SaveReadingPositionResponse> saveReadingPosition(
          $pb.ClientContext? ctx, SaveReadingPositionRequest request) =>
      _client.invoke<SaveReadingPositionResponse>(ctx, 'EpisodeReadService',
          'SaveReadingPosition', request, SaveReadingPositionResponse());

  /// Returns where the authenticated member stopped in an episode. An episode
  /// they may no longer read has no position, the same answer as one they never
  /// opened.
  $async.Future<GetMyReadingPositionResponse> getMyReadingPosition(
          $pb.ClientContext? ctx, GetMyReadingPositionRequest request) =>
      _client.invoke<GetMyReadingPositionResponse>(ctx, 'EpisodeReadService',
          'GetMyReadingPosition', request, GetMyReadingPositionResponse());

  /// Returns the authenticated member's standing in one published series. It is
  /// separate from CatalogService.GetSeriesDetail so the series detail stays
  /// shared-cacheable while this read stays private.
  $async.Future<GetMySeriesProgressResponse> getMySeriesProgress(
          $pb.ClientContext? ctx, GetMySeriesProgressRequest request) =>
      _client.invoke<GetMySeriesProgressResponse>(ctx, 'EpisodeReadService',
          'GetMySeriesProgress', request, GetMySeriesProgressResponse());

  /// The series the authenticated member was in the middle of, newest activity
  /// first, each with the episode to continue from. A series whose published
  /// episodes the member has all finished is not in the middle of anything and
  /// drops out until another episode is published. A series that is no longer
  /// published is skipped like one the member never read, so the list never
  /// names something the storefront has taken down.
  $async.Future<ListMyRecentSeriesResponse> listMyRecentSeries(
          $pb.ClientContext? ctx, ListMyRecentSeriesRequest request) =>
      _client.invoke<ListMyRecentSeriesResponse>(ctx, 'EpisodeReadService',
          'ListMyRecentSeries', request, ListMyRecentSeriesResponse());

  /// The episodes the authenticated member has finished, most recent first. An
  /// episode whose series or listing is no longer published is skipped, the way
  /// ListMyRecentSeries skips one, so the history never names something the
  /// storefront has taken down. Body access is not re-checked: the member did
  /// read the episode, and an expired rental is still part of what they read.
  $async.Future<ListMyEpisodeReadsResponse> listMyEpisodeReads(
          $pb.ClientContext? ctx, ListMyEpisodeReadsRequest request) =>
      _client.invoke<ListMyEpisodeReadsResponse>(ctx, 'EpisodeReadService',
          'ListMyEpisodeReads', request, ListMyEpisodeReadsResponse());
}

class FollowServiceApi {
  final $pb.RpcClient _client;

  FollowServiceApi(this._client);

  /// Returns the authenticated member's relation to a currently public target.
  $async.Future<GetMyFollowStatusResponse> getMyFollowStatus(
          $pb.ClientContext? ctx, GetMyFollowStatusRequest request) =>
      _client.invoke<GetMyFollowStatusResponse>(ctx, 'FollowService',
          'GetMyFollowStatus', request, GetMyFollowStatusResponse());

  /// Idempotently follows a currently public target.
  $async.Future<FollowResponse> follow(
          $pb.ClientContext? ctx, FollowRequest request) =>
      _client.invoke<FollowResponse>(
          ctx, 'FollowService', 'Follow', request, FollowResponse());

  /// Idempotently removes the follow for a currently public target.
  $async.Future<UnfollowResponse> unfollow(
          $pb.ClientContext? ctx, UnfollowRequest request) =>
      _client.invoke<UnfollowResponse>(
          ctx, 'FollowService', 'Unfollow', request, UnfollowResponse());

  /// Lists only the authenticated member's follows whose targets remain public,
  /// newest follow first.
  $async.Future<ListMyFollowsResponse> listMyFollows(
          $pb.ClientContext? ctx, ListMyFollowsRequest request) =>
      _client.invoke<ListMyFollowsResponse>(ctx, 'FollowService',
          'ListMyFollows', request, ListMyFollowsResponse());

  /// The episodes that have arrived in what the authenticated member follows,
  /// most recently published first: the published episodes of a series they
  /// follow, and the published episodes credited to a creator they follow. A
  /// member who follows both a series and one of its creators gets one row per
  /// episode, the way ListEpisodeFollowerIDs makes them one recipient.
  ///
  /// A follow on a single episode is not one of these. It names an episode that
  /// is already there rather than one that arrives.
  ///
  /// An episode whose series or listing is no longer published is skipped, the
  /// way ListMyEpisodeReads skips one, so the list never names something the
  /// storefront has taken down.
  $async.Future<ListMyFollowUpdatesResponse> listMyFollowUpdates(
          $pb.ClientContext? ctx, ListMyFollowUpdatesRequest request) =>
      _client.invoke<ListMyFollowUpdatesResponse>(ctx, 'FollowService',
          'ListMyFollowUpdates', request, ListMyFollowUpdatesResponse());
}

class RatingServiceApi {
  final $pb.RpcClient _client;

  RatingServiceApi(this._client);

  /// Rates an episode the authenticated reader may read, or raises the rating
  /// they already gave. The score is capped at 5, so a reader who is already
  /// there presses to no effect.
  ///
  /// What a press is worth is settled by the mode of the episode's series, which
  /// the server reads rather than taking from the request.
  ///
  /// Body access is required here and not on GetMyEpisodeRating, because a
  /// rating is given to something read. A locked episode is NotFound rather than
  /// permission_denied, matching MarkEpisodeAsRead: publication, tenant, and
  /// entitlement failures share one answer so this RPC cannot be used to probe
  /// for content the reader may not have.
  ///
  /// An episode that credits a creator the reader's account is linked to is
  /// permission_denied with the ErrorInfo reason READER_CREDITED_ON_EPISODE,
  /// free or not: the credit opens the body but not the rating.
  $async.Future<RateEpisodeResponse> rateEpisode(
          $pb.ClientContext? ctx, RateEpisodeRequest request) =>
      _client.invoke<RateEpisodeResponse>(
          ctx, 'RatingService', 'RateEpisode', request, RateEpisodeResponse());

  /// Returns the authenticated reader's rating of a currently published episode,
  /// how many readers have rated it, and which press mode governs it.
  ///
  /// It asks only that the episode be published, not that this reader may open
  /// its body: the answer is about a rating they already gave, and a rental that
  /// has run out does not take it back.
  ///
  /// It also says whether the reader is credited on the episode, which is what
  /// RateEpisode refuses by and what GetEpisodeDetail reports only beside
  /// EPISODE_ACCESS_ENTITLED.
  $async.Future<GetMyEpisodeRatingResponse> getMyEpisodeRating(
          $pb.ClientContext? ctx, GetMyEpisodeRatingRequest request) =>
      _client.invoke<GetMyEpisodeRatingResponse>(ctx, 'RatingService',
          'GetMyEpisodeRating', request, GetMyEpisodeRatingResponse());

  /// Returns what the authenticated reader's own reactions say about a currently
  /// published series: the mean of the scores they gave its episodes.
  ///
  /// There is no RPC to rate a series, and there will not be one. A series is
  /// rated by reacting to the episodes it is made of, which is also why this
  /// answer covers only the episodes this reader reacted to rather than every
  /// episode of the series.
  $async.Future<GetMySeriesRatingResponse> getMySeriesRating(
          $pb.ClientContext? ctx, GetMySeriesRatingRequest request) =>
      _client.invoke<GetMySeriesRatingResponse>(ctx, 'RatingService',
          'GetMySeriesRating', request, GetMySeriesRatingResponse());
}

class ContentViewServiceApi {
  final $pb.RpcClient _client;

  ContentViewServiceApi(this._client);

  /// Records one soft page view for a currently public series or episode.
  ///
  /// A view is recorded here rather than as a side effect of GetSeriesDetail /
  /// GetEpisodeDetail, because those reads are cached by their callers: a cache
  /// fill carries no reader and would otherwise mint an actor of its own, and a
  /// cache hit never reaches this server at all. This RPC is called once per
  /// page a reader actually opened.
  ///
  /// Optional authentication. A signed-in reader is attributed to their account
  /// and everyone else to the publira_aid cookie, which is minted and returned
  /// in Set-Cookie when the request carries none. A bearer this server cannot
  /// verify does not fail the call: the view falls back to the cookie, and is
  /// recorded only if one came with it, because minting an identifier for a
  /// caller that presented a session of its own would open a new actor per
  /// request.
  ///
  /// Cross-tenant, unpublished, and missing targets are all surfaced as
  /// NotFound, matching FollowService and RatingService, so a view cannot be
  /// used to probe for hidden content.
  $async.Future<RecordContentViewResponse> recordContentView(
          $pb.ClientContext? ctx, RecordContentViewRequest request) =>
      _client.invoke<RecordContentViewResponse>(ctx, 'ContentViewService',
          'RecordContentView', request, RecordContentViewResponse());
}

class PurchaseServiceApi {
  final $pb.RpcClient _client;

  PurchaseServiceApi(this._client);

  $async.Future<StartEpisodeCheckoutResponse> startEpisodeCheckout(
          $pb.ClientContext? ctx, StartEpisodeCheckoutRequest request) =>
      _client.invoke<StartEpisodeCheckoutResponse>(ctx, 'PurchaseService',
          'StartEpisodeCheckout', request, StartEpisodeCheckoutResponse());

  /// Lists only the authenticated reader's purchases in the requested tenant.
  $async.Future<ListMyPurchasesResponse> listMyPurchases(
          $pb.ClientContext? ctx, ListMyPurchasesRequest request) =>
      _client.invoke<ListMyPurchasesResponse>(ctx, 'PurchaseService',
          'ListMyPurchases', request, ListMyPurchasesResponse());
  $async.Future<ProcessPaymentWebhookResponse> processPaymentWebhook(
          $pb.ClientContext? ctx, ProcessPaymentWebhookRequest request) =>
      _client.invoke<ProcessPaymentWebhookResponse>(ctx, 'PurchaseService',
          'ProcessPaymentWebhook', request, ProcessPaymentWebhookResponse());
  $async.Future<StartStorePurchaseResponse> startStorePurchase(
          $pb.ClientContext? ctx, StartStorePurchaseRequest request) =>
      _client.invoke<StartStorePurchaseResponse>(ctx, 'PurchaseService',
          'StartStorePurchase', request, StartStorePurchaseResponse());
  $async.Future<ConfirmStorePurchaseResponse> confirmStorePurchase(
          $pb.ClientContext? ctx, ConfirmStorePurchaseRequest request) =>
      _client.invoke<ConfirmStorePurchaseResponse>(ctx, 'PurchaseService',
          'ConfirmStorePurchase', request, ConfirmStorePurchaseResponse());
  $async.Future<ProcessAppStoreNotificationResponse>
      processAppStoreNotification($pb.ClientContext? ctx,
              ProcessAppStoreNotificationRequest request) =>
          _client.invoke<ProcessAppStoreNotificationResponse>(
              ctx,
              'PurchaseService',
              'ProcessAppStoreNotification',
              request,
              ProcessAppStoreNotificationResponse());
}

/// Wait-for-free: the reader's own tickets on a series that offers the rule
/// GetSeriesDetailResponse.wait_free describes. Both RPCs need a session, and
/// both answer not_found for a series or episode the calling surface does not
/// show and failed_precondition with ErrorInfo reason WAIT_FREE_NOT_OFFERED for
/// a series whose rule is off.
class WaitFreeServiceApi {
  final $pb.RpcClient _client;

  WaitFreeServiceApi(this._client);

  $async.Future<GetMyTicketStateResponse> getMyTicketState(
          $pb.ClientContext? ctx, GetMyTicketStateRequest request) =>
      _client.invoke<GetMyTicketStateResponse>(ctx, 'WaitFreeService',
          'GetMyTicketState', request, GetMyTicketStateResponse());

  /// Spends the reader's ticket on the episode's series and opens the episode
  /// for the series' access period, through an access ticket the episode's
  /// access then reports as EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET.
  ///
  /// Refused, without spending the ticket, with:
  /// - already_exists when the reader can already open the episode: bought, an
  ///   access ticket that has not expired (a repeated call included), or a
  ///   credit on it.
  /// - failed_precondition with ErrorInfo reason WAIT_FREE_EPISODE_FREE when the
  ///   episode is free to everyone right now.
  /// - failed_precondition with ErrorInfo reason WAIT_FREE_EPISODE_EXCLUDED for
  ///   one of WaitFreeRule.excluded_episode_ids.
  /// - failed_precondition with ErrorInfo reason WAIT_FREE_NOT_RECHARGED while
  ///   the next ticket is not ready; its metadata next_available_at is the
  ///   RFC3339 instant it will be.
  /// - permission_denied when the tenant's age rule stops this reader from
  ///   opening the series.
  ///
  /// Every request, refused or not, spends the reader's allowance in the
  /// platform policy's wait_free_ticket_use first, and one past it is
  /// resource_exhausted with Retry-After.
  $async.Future<UseTicketResponse> useTicket(
          $pb.ClientContext? ctx, UseTicketRequest request) =>
      _client.invoke<UseTicketResponse>(
          ctx, 'WaitFreeService', 'UseTicket', request, UseTicketResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
