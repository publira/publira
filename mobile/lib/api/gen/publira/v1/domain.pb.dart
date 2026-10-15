// This is a generated file - do not edit.
//
// Generated from publira/v1/domain.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class GetTenantByDomainRequest extends $pb.GeneratedMessage {
  factory GetTenantByDomainRequest({
    $core.Iterable<$core.String>? domains,
  }) {
    final result = GetTenantByDomainRequest._();
    if (domains != null) result.domains.addAll(domains);
    return result;
  }

  GetTenantByDomainRequest._();

  factory GetTenantByDomainRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantByDomainRequest()..mergeFromBuffer(data, registry);
  factory GetTenantByDomainRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantByDomainRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantByDomainRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantByDomainRequest.$_createMessage)
    ..pPS(1, _omitFieldNames ? '' : 'domains')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantByDomainRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantByDomainRequest copyWith(
          void Function(GetTenantByDomainRequest) updates) =>
      super.copyWith((message) => updates(message as GetTenantByDomainRequest))
          as GetTenantByDomainRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantByDomainRequest() / GetTenantByDomainRequest.new instead')
  static GetTenantByDomainRequest create() => GetTenantByDomainRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetTenantByDomainRequest._();
  @$core.override
  GetTenantByDomainRequest createEmptyInstance() =>
      GetTenantByDomainRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantByDomainRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantByDomainRequest>(
          GetTenantByDomainRequest.$_createMessage);
  static GetTenantByDomainRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get domains => $_getList(0);
}

class GetTenantByDomainResponse extends $pb.GeneratedMessage {
  factory GetTenantByDomainResponse({
    $core.String? tenantId,
    $core.String? defaultLocale,
    $core.Iterable<$core.String>? supportedLocales,
  }) {
    final result = GetTenantByDomainResponse._();
    if (tenantId != null) result.tenantId = tenantId;
    if (defaultLocale != null) result.defaultLocale = defaultLocale;
    if (supportedLocales != null)
      result.supportedLocales.addAll(supportedLocales);
    return result;
  }

  GetTenantByDomainResponse._();

  factory GetTenantByDomainResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantByDomainResponse()..mergeFromBuffer(data, registry);
  factory GetTenantByDomainResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantByDomainResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantByDomainResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantByDomainResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'tenantId')
    ..aOS(2, _omitFieldNames ? '' : 'defaultLocale')
    ..pPS(3, _omitFieldNames ? '' : 'supportedLocales')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantByDomainResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantByDomainResponse copyWith(
          void Function(GetTenantByDomainResponse) updates) =>
      super.copyWith((message) => updates(message as GetTenantByDomainResponse))
          as GetTenantByDomainResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantByDomainResponse() / GetTenantByDomainResponse.new instead')
  static GetTenantByDomainResponse create() => GetTenantByDomainResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantByDomainResponse._();
  @$core.override
  GetTenantByDomainResponse createEmptyInstance() =>
      GetTenantByDomainResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantByDomainResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantByDomainResponse>(
          GetTenantByDomainResponse.$_createMessage);
  static GetTenantByDomainResponse? _defaultInstance;

  /// Primary key (UUID) for internal routing / TenantContext.
  @$pb.TagNumber(1)
  $core.String get tenantId => $_getSZ(0);
  @$pb.TagNumber(1)
  set tenantId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTenantId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenantId() => $_clearField(1);

  /// The tenant's saved default locale (ja, en) so the host proxy can pick a
  /// redirect in one round trip. Never empty: a stored code naming no supported
  /// locale fails this RPC rather than answering another language.
  @$pb.TagNumber(2)
  $core.String get defaultLocale => $_getSZ(1);
  @$pb.TagNumber(2)
  set defaultLocale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasDefaultLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearDefaultLocale() => $_clearField(2);

  /// The UI locale codes the tenant's site offers, in registry order, so the
  /// host proxy can tell a locale prefix the tenant serves from one it does not
  /// in the same round trip. Always holds default_locale.
  @$pb.TagNumber(3)
  $pb.PbList<$core.String> get supportedLocales => $_getList(2);
}

class DomainServiceApi {
  final $pb.RpcClient _client;

  DomainServiceApi(this._client);

  /// The tenant whose domain is the first of domains any tenant serves.
  /// not_found when none is, and failed_precondition with the ErrorInfo reason
  /// TENANT_SUSPENDED when that tenant is suspended, so a caller can tell a
  /// tenant that is not being served from a host that serves no tenant.
  $async.Future<GetTenantByDomainResponse> getTenantByDomain(
          $pb.ClientContext? ctx, GetTenantByDomainRequest request) =>
      _client.invoke<GetTenantByDomainResponse>(ctx, 'DomainService',
          'GetTenantByDomain', request, GetTenantByDomainResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
