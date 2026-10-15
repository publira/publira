// This is a generated file - do not edit.
//
// Generated from publira/v1/page.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../types/v1/types.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class ListPublishedPagesRequest extends $pb.GeneratedMessage {
  factory ListPublishedPagesRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = ListPublishedPagesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListPublishedPagesRequest._();

  factory ListPublishedPagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPagesRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedPagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPagesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedPagesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedPagesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPagesRequest copyWith(
          void Function(ListPublishedPagesRequest) updates) =>
      super.copyWith((message) => updates(message as ListPublishedPagesRequest))
          as ListPublishedPagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedPagesRequest() / ListPublishedPagesRequest.new instead')
  static ListPublishedPagesRequest create() => ListPublishedPagesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedPagesRequest._();
  @$core.override
  ListPublishedPagesRequest createEmptyInstance() =>
      ListPublishedPagesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedPagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedPagesRequest>(
          ListPublishedPagesRequest.$_createMessage);
  static ListPublishedPagesRequest? _defaultInstance;

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

  /// The reader's locale. Each page is listed in its published translation in
  /// this locale, else the tenant's default locale, else its oldest published
  /// one, and Page.locale names the one listed. Empty means the tenant's
  /// default locale.
  @$pb.TagNumber(2)
  $core.String get locale => $_getSZ(1);
  @$pb.TagNumber(2)
  set locale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocale() => $_clearField(2);
}

class ListPublishedPagesResponse extends $pb.GeneratedMessage {
  factory ListPublishedPagesResponse({
    $core.Iterable<$0.Page>? pages,
  }) {
    final result = ListPublishedPagesResponse._();
    if (pages != null) result.pages.addAll(pages);
    return result;
  }

  ListPublishedPagesResponse._();

  factory ListPublishedPagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPagesResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedPagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPagesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedPagesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedPagesResponse.$_createMessage)
    ..pPM<$0.Page>(1, _omitFieldNames ? '' : 'pages',
        subBuilder: $0.Page.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPagesResponse copyWith(
          void Function(ListPublishedPagesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedPagesResponse))
          as ListPublishedPagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedPagesResponse() / ListPublishedPagesResponse.new instead')
  static ListPublishedPagesResponse create() => ListPublishedPagesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedPagesResponse._();
  @$core.override
  ListPublishedPagesResponse createEmptyInstance() =>
      ListPublishedPagesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedPagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedPagesResponse>(
          ListPublishedPagesResponse.$_createMessage);
  static ListPublishedPagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$0.Page> get pages => $_getList(0);
}

class ListPublishedPageSlugsRequest extends $pb.GeneratedMessage {
  factory ListPublishedPageSlugsRequest({
    $0.TenantContext? tenant,
  }) {
    final result = ListPublishedPageSlugsRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  ListPublishedPageSlugsRequest._();

  factory ListPublishedPageSlugsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPageSlugsRequest()..mergeFromBuffer(data, registry);
  factory ListPublishedPageSlugsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPageSlugsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedPageSlugsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedPageSlugsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPageSlugsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPageSlugsRequest copyWith(
          void Function(ListPublishedPageSlugsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedPageSlugsRequest))
          as ListPublishedPageSlugsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedPageSlugsRequest() / ListPublishedPageSlugsRequest.new instead')
  static ListPublishedPageSlugsRequest create() =>
      ListPublishedPageSlugsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedPageSlugsRequest._();
  @$core.override
  ListPublishedPageSlugsRequest createEmptyInstance() =>
      ListPublishedPageSlugsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedPageSlugsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedPageSlugsRequest>(
          ListPublishedPageSlugsRequest.$_createMessage);
  static ListPublishedPageSlugsRequest? _defaultInstance;

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
}

/// Every published page's slug, footer or not, in storage form ("/privacy").
/// The public site's proxy holds the whole set to decide whether a path names a
/// page, so it is one unpaginated answer rather than a list to browse.
class ListPublishedPageSlugsResponse extends $pb.GeneratedMessage {
  factory ListPublishedPageSlugsResponse({
    $core.Iterable<$core.String>? slugs,
  }) {
    final result = ListPublishedPageSlugsResponse._();
    if (slugs != null) result.slugs.addAll(slugs);
    return result;
  }

  ListPublishedPageSlugsResponse._();

  factory ListPublishedPageSlugsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPageSlugsResponse()..mergeFromBuffer(data, registry);
  factory ListPublishedPageSlugsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListPublishedPageSlugsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListPublishedPageSlugsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListPublishedPageSlugsResponse.$_createMessage)
    ..pPS(1, _omitFieldNames ? '' : 'slugs')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPageSlugsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListPublishedPageSlugsResponse copyWith(
          void Function(ListPublishedPageSlugsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListPublishedPageSlugsResponse))
          as ListPublishedPageSlugsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListPublishedPageSlugsResponse() / ListPublishedPageSlugsResponse.new instead')
  static ListPublishedPageSlugsResponse create() =>
      ListPublishedPageSlugsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListPublishedPageSlugsResponse._();
  @$core.override
  ListPublishedPageSlugsResponse createEmptyInstance() =>
      ListPublishedPageSlugsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListPublishedPageSlugsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListPublishedPageSlugsResponse>(
          ListPublishedPageSlugsResponse.$_createMessage);
  static ListPublishedPageSlugsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get slugs => $_getList(0);
}

class GetPublishedPageRequest extends $pb.GeneratedMessage {
  factory GetPublishedPageRequest({
    $0.TenantContext? tenant,
    $core.String? slug,
    $core.String? locale,
  }) {
    final result = GetPublishedPageRequest._();
    if (tenant != null) result.tenant = tenant;
    if (slug != null) result.slug = slug;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetPublishedPageRequest._();

  factory GetPublishedPageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedPageRequest()..mergeFromBuffer(data, registry);
  factory GetPublishedPageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedPageRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedPageRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedPageRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'slug')
    ..aOS(3, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedPageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedPageRequest copyWith(
          void Function(GetPublishedPageRequest) updates) =>
      super.copyWith((message) => updates(message as GetPublishedPageRequest))
          as GetPublishedPageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedPageRequest() / GetPublishedPageRequest.new instead')
  static GetPublishedPageRequest create() => GetPublishedPageRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetPublishedPageRequest._();
  @$core.override
  GetPublishedPageRequest createEmptyInstance() => GetPublishedPageRequest._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedPageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedPageRequest>(
          GetPublishedPageRequest.$_createMessage);
  static GetPublishedPageRequest? _defaultInstance;

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
  $core.String get slug => $_getSZ(1);
  @$pb.TagNumber(2)
  set slug($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSlug() => $_has(1);
  @$pb.TagNumber(2)
  void clearSlug() => $_clearField(2);

  /// The reader's locale, resolved as ListPublishedPagesRequest.locale is.
  @$pb.TagNumber(3)
  $core.String get locale => $_getSZ(2);
  @$pb.TagNumber(3)
  set locale($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLocale() => $_has(2);
  @$pb.TagNumber(3)
  void clearLocale() => $_clearField(3);
}

class GetPublishedPageResponse extends $pb.GeneratedMessage {
  factory GetPublishedPageResponse({
    $0.Page? page,
    $0.PageVersion? version,
    $core.Iterable<$core.String>? publishedLocales,
  }) {
    final result = GetPublishedPageResponse._();
    if (page != null) result.page = page;
    if (version != null) result.version = version;
    if (publishedLocales != null)
      result.publishedLocales.addAll(publishedLocales);
    return result;
  }

  GetPublishedPageResponse._();

  factory GetPublishedPageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedPageResponse()..mergeFromBuffer(data, registry);
  factory GetPublishedPageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPublishedPageResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPublishedPageResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPublishedPageResponse.$_createMessage)
    ..aOM<$0.Page>(1, _omitFieldNames ? '' : 'page',
        subBuilder: $0.Page.$_createMessage)
    ..aOM<$0.PageVersion>(2, _omitFieldNames ? '' : 'version',
        subBuilder: $0.PageVersion.$_createMessage)
    ..pPS(3, _omitFieldNames ? '' : 'publishedLocales')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedPageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPublishedPageResponse copyWith(
          void Function(GetPublishedPageResponse) updates) =>
      super.copyWith((message) => updates(message as GetPublishedPageResponse))
          as GetPublishedPageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPublishedPageResponse() / GetPublishedPageResponse.new instead')
  static GetPublishedPageResponse create() => GetPublishedPageResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetPublishedPageResponse._();
  @$core.override
  GetPublishedPageResponse createEmptyInstance() =>
      GetPublishedPageResponse._();
  @$core.pragma('dart2js:noInline')
  static GetPublishedPageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPublishedPageResponse>(
          GetPublishedPageResponse.$_createMessage);
  static GetPublishedPageResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.Page get page => $_getN(0);
  @$pb.TagNumber(1)
  set page($0.Page value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPage() => $_has(0);
  @$pb.TagNumber(1)
  void clearPage() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.Page ensurePage() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.PageVersion get version => $_getN(1);
  @$pb.TagNumber(2)
  set version($0.PageVersion value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasVersion() => $_has(1);
  @$pb.TagNumber(2)
  void clearVersion() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.PageVersion ensureVersion() => $_ensure(1);

  /// Every locale the page has a published translation in, the served one
  /// included, in code order: the language alternates of the page.
  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get publishedLocales => $_getList(2);
}

class PublicPagesServiceApi {
  final $pb.RpcClient _client;

  PublicPagesServiceApi(this._client);

  $async.Future<ListPublishedPagesResponse> listPublishedPages(
          $pb.ClientContext? ctx, ListPublishedPagesRequest request) =>
      _client.invoke<ListPublishedPagesResponse>(ctx, 'PublicPagesService',
          'ListPublishedPages', request, ListPublishedPagesResponse());
  $async.Future<ListPublishedPageSlugsResponse> listPublishedPageSlugs(
          $pb.ClientContext? ctx, ListPublishedPageSlugsRequest request) =>
      _client.invoke<ListPublishedPageSlugsResponse>(ctx, 'PublicPagesService',
          'ListPublishedPageSlugs', request, ListPublishedPageSlugsResponse());
  $async.Future<GetPublishedPageResponse> getPublishedPage(
          $pb.ClientContext? ctx, GetPublishedPageRequest request) =>
      _client.invoke<GetPublishedPageResponse>(ctx, 'PublicPagesService',
          'GetPublishedPage', request, GetPublishedPageResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
