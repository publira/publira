// This is a generated file - do not edit.
//
// Generated from publira/v1/auth.proto.

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
import 'auth.pbenum.dart';
import 'tenant.pb.dart' as $1;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'auth.pbenum.dart';

class LoginRequest extends $pb.GeneratedMessage {
  factory LoginRequest({
    $0.TenantContext? tenant,
    $core.String? email,
    $core.String? password,
  }) {
    final result = LoginRequest._();
    if (tenant != null) result.tenant = tenant;
    if (email != null) result.email = email;
    if (password != null) result.password = password;
    return result;
  }

  LoginRequest._();

  factory LoginRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginRequest()..mergeFromBuffer(data, registry);
  factory LoginRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LoginRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LoginRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..aOS(3, _omitFieldNames ? '' : 'password')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginRequest copyWith(void Function(LoginRequest) updates) =>
      super.copyWith((message) => updates(message as LoginRequest))
          as LoginRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use LoginRequest() / LoginRequest.new instead')
  static LoginRequest create() => LoginRequest._();
  static $pb.GeneratedMessage $_createMessage() => LoginRequest._();
  @$core.override
  LoginRequest createEmptyInstance() => LoginRequest._();
  @$core.pragma('dart2js:noInline')
  static LoginRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LoginRequest>(
          LoginRequest.$_createMessage);
  static LoginRequest? _defaultInstance;

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
  $core.String get email => $_getSZ(1);
  @$pb.TagNumber(2)
  set email($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmail() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get password => $_getSZ(2);
  @$pb.TagNumber(3)
  set password($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPassword() => $_has(2);
  @$pb.TagNumber(3)
  void clearPassword() => $_clearField(3);
}

class LoginResponse extends $pb.GeneratedMessage {
  factory LoginResponse({
    $0.User? user,
    $0.AccessToken? accessToken,
  }) {
    final result = LoginResponse._();
    if (user != null) result.user = user;
    if (accessToken != null) result.accessToken = accessToken;
    return result;
  }

  LoginResponse._();

  factory LoginResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginResponse()..mergeFromBuffer(data, registry);
  factory LoginResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LoginResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LoginResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..aOM<$0.AccessToken>(2, _omitFieldNames ? '' : 'accessToken',
        subBuilder: $0.AccessToken.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginResponse copyWith(void Function(LoginResponse) updates) =>
      super.copyWith((message) => updates(message as LoginResponse))
          as LoginResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use LoginResponse() / LoginResponse.new instead')
  static LoginResponse create() => LoginResponse._();
  static $pb.GeneratedMessage $_createMessage() => LoginResponse._();
  @$core.override
  LoginResponse createEmptyInstance() => LoginResponse._();
  @$core.pragma('dart2js:noInline')
  static LoginResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LoginResponse>(
          LoginResponse.$_createMessage);
  static LoginResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.AccessToken get accessToken => $_getN(1);
  @$pb.TagNumber(2)
  set accessToken($0.AccessToken value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasAccessToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearAccessToken() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.AccessToken ensureAccessToken() => $_ensure(1);
}

class LoginWithIdTokenRequest extends $pb.GeneratedMessage {
  factory LoginWithIdTokenRequest({
    $0.TenantContext? tenant,
    IdentityProvider? provider,
    $core.String? idToken,
    $core.String? nonce,
    $core.String? authorizationCode,
    $core.String? redirectUri,
    $core.String? name,
    $core.Iterable<$core.String>? agreedPageVersionIds,
    $core.String? birthDate,
  }) {
    final result = LoginWithIdTokenRequest._();
    if (tenant != null) result.tenant = tenant;
    if (provider != null) result.provider = provider;
    if (idToken != null) result.idToken = idToken;
    if (nonce != null) result.nonce = nonce;
    if (authorizationCode != null) result.authorizationCode = authorizationCode;
    if (redirectUri != null) result.redirectUri = redirectUri;
    if (name != null) result.name = name;
    if (agreedPageVersionIds != null)
      result.agreedPageVersionIds.addAll(agreedPageVersionIds);
    if (birthDate != null) result.birthDate = birthDate;
    return result;
  }

  LoginWithIdTokenRequest._();

  factory LoginWithIdTokenRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginWithIdTokenRequest()..mergeFromBuffer(data, registry);
  factory LoginWithIdTokenRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginWithIdTokenRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LoginWithIdTokenRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LoginWithIdTokenRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<IdentityProvider>(2, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..aOS(3, _omitFieldNames ? '' : 'idToken')
    ..aOS(4, _omitFieldNames ? '' : 'nonce')
    ..aOS(5, _omitFieldNames ? '' : 'authorizationCode')
    ..aOS(6, _omitFieldNames ? '' : 'redirectUri')
    ..aOS(7, _omitFieldNames ? '' : 'name')
    ..pPS(8, _omitFieldNames ? '' : 'agreedPageVersionIds')
    ..aOS(9, _omitFieldNames ? '' : 'birthDate')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginWithIdTokenRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginWithIdTokenRequest copyWith(
          void Function(LoginWithIdTokenRequest) updates) =>
      super.copyWith((message) => updates(message as LoginWithIdTokenRequest))
          as LoginWithIdTokenRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use LoginWithIdTokenRequest() / LoginWithIdTokenRequest.new instead')
  static LoginWithIdTokenRequest create() => LoginWithIdTokenRequest._();
  static $pb.GeneratedMessage $_createMessage() => LoginWithIdTokenRequest._();
  @$core.override
  LoginWithIdTokenRequest createEmptyInstance() => LoginWithIdTokenRequest._();
  @$core.pragma('dart2js:noInline')
  static LoginWithIdTokenRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LoginWithIdTokenRequest>(
          LoginWithIdTokenRequest.$_createMessage);
  static LoginWithIdTokenRequest? _defaultInstance;

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
  IdentityProvider get provider => $_getN(1);
  @$pb.TagNumber(2)
  set provider(IdentityProvider value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasProvider() => $_has(1);
  @$pb.TagNumber(2)
  void clearProvider() => $_clearField(2);

  /// The ID token the provider issued to one of the client IDs GetTenant
  /// answers for it. A token whose address an account already holds under
  /// another sub-address tag (john+shop@ for john@, or the other way round) is
  /// failed_precondition: it neither opens a second account for that inbox nor
  /// links the one there, which the reader signs in to with its own address.
  @$pb.TagNumber(3)
  $core.String get idToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set idToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIdToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearIdToken() => $_clearField(3);

  /// The nonce the client generated for this sign-in, as generated: the token
  /// carries it either as it is or as its SHA-256 in hex, which is what the
  /// iOS app hands Apple. A nonce is accepted once.
  @$pb.TagNumber(4)
  $core.String get nonce => $_getSZ(3);
  @$pb.TagNumber(4)
  set nonce($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNonce() => $_has(3);
  @$pb.TagNumber(4)
  void clearNonce() => $_clearField(4);

  /// Apple only, and optional: the authorization code issued with the token.
  /// The server exchanges it for a refresh token, which it revokes when the
  /// link or the account is deleted, as Apple requires of an app that creates
  /// accounts with it.
  @$pb.TagNumber(5)
  $core.String get authorizationCode => $_getSZ(4);
  @$pb.TagNumber(5)
  set authorizationCode($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAuthorizationCode() => $_has(4);
  @$pb.TagNumber(5)
  void clearAuthorizationCode() => $_clearField(5);

  /// The redirect_uri of Apple's web flow the code was issued through, which
  /// Apple requires to exchange it: the storefront's own callback, or the one
  /// the Android app returns through, since Android has no native Sign in with
  /// Apple. Empty from the iOS app.
  @$pb.TagNumber(6)
  $core.String get redirectUri => $_getSZ(5);
  @$pb.TagNumber(6)
  set redirectUri($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasRedirectUri() => $_has(5);
  @$pb.TagNumber(6)
  void clearRedirectUri() => $_clearField(6);

  /// Read only when no account matches the token and this sign-in creates one.
  /// The name falls back to the one the token carries, and then to the local
  /// part of the address. agreed_page_version_ids and birth_date mean what they
  /// mean in CreateUserRequest, and a missing consent is invalid_argument
  /// without spending the nonce, so the client can ask and send the same token
  /// again.
  @$pb.TagNumber(7)
  $core.String get name => $_getSZ(6);
  @$pb.TagNumber(7)
  set name($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasName() => $_has(6);
  @$pb.TagNumber(7)
  void clearName() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<$core.String> get agreedPageVersionIds => $_getList(7);

  @$pb.TagNumber(9)
  $core.String get birthDate => $_getSZ(8);
  @$pb.TagNumber(9)
  set birthDate($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasBirthDate() => $_has(8);
  @$pb.TagNumber(9)
  void clearBirthDate() => $_clearField(9);
}

class LoginWithIdTokenResponse extends $pb.GeneratedMessage {
  factory LoginWithIdTokenResponse({
    $0.User? user,
    $0.AccessToken? accessToken,
    $core.bool? accountCreated,
  }) {
    final result = LoginWithIdTokenResponse._();
    if (user != null) result.user = user;
    if (accessToken != null) result.accessToken = accessToken;
    if (accountCreated != null) result.accountCreated = accountCreated;
    return result;
  }

  LoginWithIdTokenResponse._();

  factory LoginWithIdTokenResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginWithIdTokenResponse()..mergeFromBuffer(data, registry);
  factory LoginWithIdTokenResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LoginWithIdTokenResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LoginWithIdTokenResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LoginWithIdTokenResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..aOM<$0.AccessToken>(2, _omitFieldNames ? '' : 'accessToken',
        subBuilder: $0.AccessToken.$_createMessage)
    ..aOB(3, _omitFieldNames ? '' : 'accountCreated')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginWithIdTokenResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LoginWithIdTokenResponse copyWith(
          void Function(LoginWithIdTokenResponse) updates) =>
      super.copyWith((message) => updates(message as LoginWithIdTokenResponse))
          as LoginWithIdTokenResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use LoginWithIdTokenResponse() / LoginWithIdTokenResponse.new instead')
  static LoginWithIdTokenResponse create() => LoginWithIdTokenResponse._();
  static $pb.GeneratedMessage $_createMessage() => LoginWithIdTokenResponse._();
  @$core.override
  LoginWithIdTokenResponse createEmptyInstance() =>
      LoginWithIdTokenResponse._();
  @$core.pragma('dart2js:noInline')
  static LoginWithIdTokenResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LoginWithIdTokenResponse>(
          LoginWithIdTokenResponse.$_createMessage);
  static LoginWithIdTokenResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.AccessToken get accessToken => $_getN(1);
  @$pb.TagNumber(2)
  set accessToken($0.AccessToken value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasAccessToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearAccessToken() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.AccessToken ensureAccessToken() => $_ensure(1);

  /// True when this sign-in created the account.
  @$pb.TagNumber(3)
  $core.bool get accountCreated => $_getBF(2);
  @$pb.TagNumber(3)
  set accountCreated($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAccountCreated() => $_has(2);
  @$pb.TagNumber(3)
  void clearAccountCreated() => $_clearField(3);
}

/// A provider account linked to the signed-in reader.
class LinkedIdentity extends $pb.GeneratedMessage {
  factory LinkedIdentity({
    IdentityProvider? provider,
    $core.String? email,
    $core.String? linkedAt,
  }) {
    final result = LinkedIdentity._();
    if (provider != null) result.provider = provider;
    if (email != null) result.email = email;
    if (linkedAt != null) result.linkedAt = linkedAt;
    return result;
  }

  LinkedIdentity._();

  factory LinkedIdentity.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkedIdentity()..mergeFromBuffer(data, registry);
  factory LinkedIdentity.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkedIdentity()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LinkedIdentity',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LinkedIdentity.$_createMessage)
    ..aE<IdentityProvider>(1, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..aOS(3, _omitFieldNames ? '' : 'linkedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkedIdentity clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkedIdentity copyWith(void Function(LinkedIdentity) updates) =>
      super.copyWith((message) => updates(message as LinkedIdentity))
          as LinkedIdentity;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use LinkedIdentity() / LinkedIdentity.new instead')
  static LinkedIdentity create() => LinkedIdentity._();
  static $pb.GeneratedMessage $_createMessage() => LinkedIdentity._();
  @$core.override
  LinkedIdentity createEmptyInstance() => LinkedIdentity._();
  @$core.pragma('dart2js:noInline')
  static LinkedIdentity getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LinkedIdentity>(
          LinkedIdentity.$_createMessage);
  static LinkedIdentity? _defaultInstance;

  @$pb.TagNumber(1)
  IdentityProvider get provider => $_getN(0);
  @$pb.TagNumber(1)
  set provider(IdentityProvider value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasProvider() => $_has(0);
  @$pb.TagNumber(1)
  void clearProvider() => $_clearField(1);

  /// The address the provider's token carried when the account was linked.
  @$pb.TagNumber(2)
  $core.String get email => $_getSZ(1);
  @$pb.TagNumber(2)
  set email($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmail() => $_clearField(2);

  /// RFC 3339.
  @$pb.TagNumber(3)
  $core.String get linkedAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set linkedAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLinkedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearLinkedAt() => $_clearField(3);
}

class ListMyIdentitiesRequest extends $pb.GeneratedMessage {
  factory ListMyIdentitiesRequest({
    $0.TenantContext? tenant,
  }) {
    final result = ListMyIdentitiesRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  ListMyIdentitiesRequest._();

  factory ListMyIdentitiesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyIdentitiesRequest()..mergeFromBuffer(data, registry);
  factory ListMyIdentitiesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyIdentitiesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyIdentitiesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyIdentitiesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyIdentitiesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyIdentitiesRequest copyWith(
          void Function(ListMyIdentitiesRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyIdentitiesRequest))
          as ListMyIdentitiesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyIdentitiesRequest() / ListMyIdentitiesRequest.new instead')
  static ListMyIdentitiesRequest create() => ListMyIdentitiesRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListMyIdentitiesRequest._();
  @$core.override
  ListMyIdentitiesRequest createEmptyInstance() => ListMyIdentitiesRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyIdentitiesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyIdentitiesRequest>(
          ListMyIdentitiesRequest.$_createMessage);
  static ListMyIdentitiesRequest? _defaultInstance;

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

class ListMyIdentitiesResponse extends $pb.GeneratedMessage {
  factory ListMyIdentitiesResponse({
    $core.Iterable<LinkedIdentity>? identities,
    $core.bool? hasPassword,
    $core.bool? hasPasskey,
  }) {
    final result = ListMyIdentitiesResponse._();
    if (identities != null) result.identities.addAll(identities);
    if (hasPassword != null) result.hasPassword = hasPassword;
    if (hasPasskey != null) result.hasPasskey = hasPasskey;
    return result;
  }

  ListMyIdentitiesResponse._();

  factory ListMyIdentitiesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyIdentitiesResponse()..mergeFromBuffer(data, registry);
  factory ListMyIdentitiesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyIdentitiesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyIdentitiesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyIdentitiesResponse.$_createMessage)
    ..pPM<LinkedIdentity>(1, _omitFieldNames ? '' : 'identities',
        subBuilder: LinkedIdentity.$_createMessage)
    ..aOB(2, _omitFieldNames ? '' : 'hasPassword')
    ..aOB(3, _omitFieldNames ? '' : 'hasPasskey')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyIdentitiesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyIdentitiesResponse copyWith(
          void Function(ListMyIdentitiesResponse) updates) =>
      super.copyWith((message) => updates(message as ListMyIdentitiesResponse))
          as ListMyIdentitiesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyIdentitiesResponse() / ListMyIdentitiesResponse.new instead')
  static ListMyIdentitiesResponse create() => ListMyIdentitiesResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListMyIdentitiesResponse._();
  @$core.override
  ListMyIdentitiesResponse createEmptyInstance() =>
      ListMyIdentitiesResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyIdentitiesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyIdentitiesResponse>(
          ListMyIdentitiesResponse.$_createMessage);
  static ListMyIdentitiesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<LinkedIdentity> get identities => $_getList(0);

  /// False for an account a provider sign-in created, which confirms DeleteMe
  /// with a fresh sign-in and keeps its last linked provider.
  @$pb.TagNumber(2)
  $core.bool get hasPassword => $_getBF(1);
  @$pb.TagNumber(2)
  set hasPassword($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasHasPassword() => $_has(1);
  @$pb.TagNumber(2)
  void clearHasPassword() => $_clearField(2);

  /// True when the reader holds a passkey the storefront signs them in with,
  /// which ListMyPasskeys lists and which confirms DeleteMe and an email change
  /// through BeginPasskeyConfirmation.
  @$pb.TagNumber(3)
  $core.bool get hasPasskey => $_getBF(2);
  @$pb.TagNumber(3)
  set hasPasskey($core.bool value) => $_setBool(2, value);
  @$pb.TagNumber(3)
  $core.bool hasHasPasskey() => $_has(2);
  @$pb.TagNumber(3)
  void clearHasPasskey() => $_clearField(3);
}

class UnlinkIdentityRequest extends $pb.GeneratedMessage {
  factory UnlinkIdentityRequest({
    $0.TenantContext? tenant,
    IdentityProvider? provider,
  }) {
    final result = UnlinkIdentityRequest._();
    if (tenant != null) result.tenant = tenant;
    if (provider != null) result.provider = provider;
    return result;
  }

  UnlinkIdentityRequest._();

  factory UnlinkIdentityRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnlinkIdentityRequest()..mergeFromBuffer(data, registry);
  factory UnlinkIdentityRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnlinkIdentityRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlinkIdentityRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnlinkIdentityRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<IdentityProvider>(2, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlinkIdentityRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlinkIdentityRequest copyWith(
          void Function(UnlinkIdentityRequest) updates) =>
      super.copyWith((message) => updates(message as UnlinkIdentityRequest))
          as UnlinkIdentityRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UnlinkIdentityRequest() / UnlinkIdentityRequest.new instead')
  static UnlinkIdentityRequest create() => UnlinkIdentityRequest._();
  static $pb.GeneratedMessage $_createMessage() => UnlinkIdentityRequest._();
  @$core.override
  UnlinkIdentityRequest createEmptyInstance() => UnlinkIdentityRequest._();
  @$core.pragma('dart2js:noInline')
  static UnlinkIdentityRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlinkIdentityRequest>(
          UnlinkIdentityRequest.$_createMessage);
  static UnlinkIdentityRequest? _defaultInstance;

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

  /// not_found where the reader has no account of this provider linked, and
  /// failed_precondition where it is the last way the reader signs in: an
  /// account without a password and without a passkey keeps one linked
  /// provider.
  @$pb.TagNumber(2)
  IdentityProvider get provider => $_getN(1);
  @$pb.TagNumber(2)
  set provider(IdentityProvider value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasProvider() => $_has(1);
  @$pb.TagNumber(2)
  void clearProvider() => $_clearField(2);
}

class UnlinkIdentityResponse extends $pb.GeneratedMessage {
  factory UnlinkIdentityResponse() => UnlinkIdentityResponse._();

  UnlinkIdentityResponse._();

  factory UnlinkIdentityResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnlinkIdentityResponse()..mergeFromBuffer(data, registry);
  factory UnlinkIdentityResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnlinkIdentityResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnlinkIdentityResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnlinkIdentityResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlinkIdentityResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnlinkIdentityResponse copyWith(
          void Function(UnlinkIdentityResponse) updates) =>
      super.copyWith((message) => updates(message as UnlinkIdentityResponse))
          as UnlinkIdentityResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UnlinkIdentityResponse() / UnlinkIdentityResponse.new instead')
  static UnlinkIdentityResponse create() => UnlinkIdentityResponse._();
  static $pb.GeneratedMessage $_createMessage() => UnlinkIdentityResponse._();
  @$core.override
  UnlinkIdentityResponse createEmptyInstance() => UnlinkIdentityResponse._();
  @$core.pragma('dart2js:noInline')
  static UnlinkIdentityResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnlinkIdentityResponse>(
          UnlinkIdentityResponse.$_createMessage);
  static UnlinkIdentityResponse? _defaultInstance;
}

class LinkIdentityRequest extends $pb.GeneratedMessage {
  factory LinkIdentityRequest({
    $0.TenantContext? tenant,
    IdentityProvider? provider,
    $core.String? idToken,
    $core.String? nonce,
    $core.String? authorizationCode,
    $core.String? redirectUri,
  }) {
    final result = LinkIdentityRequest._();
    if (tenant != null) result.tenant = tenant;
    if (provider != null) result.provider = provider;
    if (idToken != null) result.idToken = idToken;
    if (nonce != null) result.nonce = nonce;
    if (authorizationCode != null) result.authorizationCode = authorizationCode;
    if (redirectUri != null) result.redirectUri = redirectUri;
    return result;
  }

  LinkIdentityRequest._();

  factory LinkIdentityRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkIdentityRequest()..mergeFromBuffer(data, registry);
  factory LinkIdentityRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkIdentityRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LinkIdentityRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LinkIdentityRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<IdentityProvider>(2, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..aOS(3, _omitFieldNames ? '' : 'idToken')
    ..aOS(4, _omitFieldNames ? '' : 'nonce')
    ..aOS(5, _omitFieldNames ? '' : 'authorizationCode')
    ..aOS(6, _omitFieldNames ? '' : 'redirectUri')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkIdentityRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkIdentityRequest copyWith(void Function(LinkIdentityRequest) updates) =>
      super.copyWith((message) => updates(message as LinkIdentityRequest))
          as LinkIdentityRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use LinkIdentityRequest() / LinkIdentityRequest.new instead')
  static LinkIdentityRequest create() => LinkIdentityRequest._();
  static $pb.GeneratedMessage $_createMessage() => LinkIdentityRequest._();
  @$core.override
  LinkIdentityRequest createEmptyInstance() => LinkIdentityRequest._();
  @$core.pragma('dart2js:noInline')
  static LinkIdentityRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LinkIdentityRequest>(
          LinkIdentityRequest.$_createMessage);
  static LinkIdentityRequest? _defaultInstance;

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
  IdentityProvider get provider => $_getN(1);
  @$pb.TagNumber(2)
  set provider(IdentityProvider value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasProvider() => $_has(1);
  @$pb.TagNumber(2)
  void clearProvider() => $_clearField(2);

  /// A fresh sign-in to the provider account to link, issued to one of the
  /// client IDs GetTenant answers for a provider the tenant offers, and checked
  /// as LoginWithIdTokenRequest checks it. Whatever address the token carries,
  /// verified or not, is only recorded: the session names the account, so a
  /// provider account under another address links as well as one under the
  /// account's own. A token that does not verify is invalid_argument on
  /// id_token, and a nonce used before is invalid_argument on nonce, so a
  /// client does not mistake either for the end of its session.
  @$pb.TagNumber(3)
  $core.String get idToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set idToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIdToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearIdToken() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get nonce => $_getSZ(3);
  @$pb.TagNumber(4)
  set nonce($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNonce() => $_has(3);
  @$pb.TagNumber(4)
  void clearNonce() => $_clearField(4);

  /// As in LoginWithIdTokenRequest: Apple only, and optional.
  @$pb.TagNumber(5)
  $core.String get authorizationCode => $_getSZ(4);
  @$pb.TagNumber(5)
  set authorizationCode($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAuthorizationCode() => $_has(4);
  @$pb.TagNumber(5)
  void clearAuthorizationCode() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get redirectUri => $_getSZ(5);
  @$pb.TagNumber(6)
  set redirectUri($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasRedirectUri() => $_has(5);
  @$pb.TagNumber(6)
  void clearRedirectUri() => $_clearField(6);
}

/// Answered once the provider account is linked to the caller's account, which
/// LoginWithIdToken signs in to with it from then on. A refusal is
/// failed_precondition with an ErrorInfo reason a client can tell apart:
/// IDENTITY_LINKED_TO_ANOTHER_ACCOUNT where the provider account signs in to
/// another reader already, and PROVIDER_ALREADY_LINKED where the caller has an
/// account of this provider linked, this one or another. A suspended account
/// holds no session, so it is refused unauthenticated before either.
class LinkIdentityResponse extends $pb.GeneratedMessage {
  factory LinkIdentityResponse({
    LinkedIdentity? identity,
  }) {
    final result = LinkIdentityResponse._();
    if (identity != null) result.identity = identity;
    return result;
  }

  LinkIdentityResponse._();

  factory LinkIdentityResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkIdentityResponse()..mergeFromBuffer(data, registry);
  factory LinkIdentityResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LinkIdentityResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LinkIdentityResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LinkIdentityResponse.$_createMessage)
    ..aOM<LinkedIdentity>(1, _omitFieldNames ? '' : 'identity',
        subBuilder: LinkedIdentity.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkIdentityResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LinkIdentityResponse copyWith(void Function(LinkIdentityResponse) updates) =>
      super.copyWith((message) => updates(message as LinkIdentityResponse))
          as LinkIdentityResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use LinkIdentityResponse() / LinkIdentityResponse.new instead')
  static LinkIdentityResponse create() => LinkIdentityResponse._();
  static $pb.GeneratedMessage $_createMessage() => LinkIdentityResponse._();
  @$core.override
  LinkIdentityResponse createEmptyInstance() => LinkIdentityResponse._();
  @$core.pragma('dart2js:noInline')
  static LinkIdentityResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<LinkIdentityResponse>(
          LinkIdentityResponse.$_createMessage);
  static LinkIdentityResponse? _defaultInstance;

  @$pb.TagNumber(1)
  LinkedIdentity get identity => $_getN(0);
  @$pb.TagNumber(1)
  set identity(LinkedIdentity value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasIdentity() => $_has(0);
  @$pb.TagNumber(1)
  void clearIdentity() => $_clearField(1);
  @$pb.TagNumber(1)
  LinkedIdentity ensureIdentity() => $_ensure(0);
}

/// A passkey the reader signs in to the storefront with. The storefront and the
/// tenant's console are two relying parties, so a passkey registered on one is
/// never listed, counted, or accepted on the other.
class Passkey extends $pb.GeneratedMessage {
  factory Passkey({
    $core.String? id,
    $core.String? name,
    $core.String? createdAt,
    $core.String? lastUsedAt,
    $core.bool? backedUp,
  }) {
    final result = Passkey._();
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    if (createdAt != null) result.createdAt = createdAt;
    if (lastUsedAt != null) result.lastUsedAt = lastUsedAt;
    if (backedUp != null) result.backedUp = backedUp;
    return result;
  }

  Passkey._();

  factory Passkey.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Passkey()..mergeFromBuffer(data, registry);
  factory Passkey.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Passkey()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Passkey',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: Passkey.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'createdAt')
    ..aOS(4, _omitFieldNames ? '' : 'lastUsedAt')
    ..aOB(5, _omitFieldNames ? '' : 'backedUp')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Passkey clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Passkey copyWith(void Function(Passkey) updates) =>
      super.copyWith((message) => updates(message as Passkey)) as Passkey;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Passkey() / Passkey.new instead')
  static Passkey create() => Passkey._();
  static $pb.GeneratedMessage $_createMessage() => Passkey._();
  @$core.override
  Passkey createEmptyInstance() => Passkey._();
  @$core.pragma('dart2js:noInline')
  static Passkey getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Passkey>(Passkey.$_createMessage);
  static Passkey? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  /// What its owner called it. Empty until they name it.
  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// RFC 3339.
  @$pb.TagNumber(3)
  $core.String get createdAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set createdAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);

  /// RFC 3339. Empty until it first signs the reader in or confirms a step.
  @$pb.TagNumber(4)
  $core.String get lastUsedAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set lastUsedAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLastUsedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearLastUsedAt() => $_clearField(4);

  /// The authenticator syncs it to the owner's other devices, as a passkey in
  /// a password manager does; false for one bound to a single device, such as
  /// a security key.
  @$pb.TagNumber(5)
  $core.bool get backedUp => $_getBF(4);
  @$pb.TagNumber(5)
  set backedUp($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasBackedUp() => $_has(4);
  @$pb.TagNumber(5)
  void clearBackedUp() => $_clearField(5);
}

/// Begins a sign-in with a passkey alone. The options name no account and
/// allow no credential in particular, so the browser offers whichever passkey
/// the reader holds for the storefront, and the credential the reader picks is
/// what names the account. A begin spends none of the caller's sign-in
/// attempts, so a page may begin one whenever it opens, to offer the reader's
/// passkeys in the browser's autofill; only so many of the sign-ins one caller
/// begins stay open at once, and a passkey presented to one dropped for a newer
/// one is refused as one presented after it expired.
class BeginPasskeyLoginRequest extends $pb.GeneratedMessage {
  factory BeginPasskeyLoginRequest({
    $0.TenantContext? tenant,
  }) {
    final result = BeginPasskeyLoginRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  BeginPasskeyLoginRequest._();

  factory BeginPasskeyLoginRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyLoginRequest()..mergeFromBuffer(data, registry);
  factory BeginPasskeyLoginRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyLoginRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyLoginRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyLoginRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyLoginRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyLoginRequest copyWith(
          void Function(BeginPasskeyLoginRequest) updates) =>
      super.copyWith((message) => updates(message as BeginPasskeyLoginRequest))
          as BeginPasskeyLoginRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyLoginRequest() / BeginPasskeyLoginRequest.new instead')
  static BeginPasskeyLoginRequest create() => BeginPasskeyLoginRequest._();
  static $pb.GeneratedMessage $_createMessage() => BeginPasskeyLoginRequest._();
  @$core.override
  BeginPasskeyLoginRequest createEmptyInstance() =>
      BeginPasskeyLoginRequest._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyLoginRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyLoginRequest>(
          BeginPasskeyLoginRequest.$_createMessage);
  static BeginPasskeyLoginRequest? _defaultInstance;

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

class BeginPasskeyLoginResponse extends $pb.GeneratedMessage {
  factory BeginPasskeyLoginResponse({
    $core.String? requestOptionsJson,
  }) {
    final result = BeginPasskeyLoginResponse._();
    if (requestOptionsJson != null)
      result.requestOptionsJson = requestOptionsJson;
    return result;
  }

  BeginPasskeyLoginResponse._();

  factory BeginPasskeyLoginResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyLoginResponse()..mergeFromBuffer(data, registry);
  factory BeginPasskeyLoginResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyLoginResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyLoginResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyLoginResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'requestOptionsJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyLoginResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyLoginResponse copyWith(
          void Function(BeginPasskeyLoginResponse) updates) =>
      super.copyWith((message) => updates(message as BeginPasskeyLoginResponse))
          as BeginPasskeyLoginResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyLoginResponse() / BeginPasskeyLoginResponse.new instead')
  static BeginPasskeyLoginResponse create() => BeginPasskeyLoginResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      BeginPasskeyLoginResponse._();
  @$core.override
  BeginPasskeyLoginResponse createEmptyInstance() =>
      BeginPasskeyLoginResponse._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyLoginResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyLoginResponse>(
          BeginPasskeyLoginResponse.$_createMessage);
  static BeginPasskeyLoginResponse? _defaultInstance;

  /// PublicKeyCredentialRequestOptionsJSON, for
  /// PublicKeyCredential.parseRequestOptionsFromJSON. User verification is
  /// required. The challenge is good for five minutes and one finish.
  @$pb.TagNumber(1)
  $core.String get requestOptionsJson => $_getSZ(0);
  @$pb.TagNumber(1)
  set requestOptionsJson($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRequestOptionsJson() => $_has(0);
  @$pb.TagNumber(1)
  void clearRequestOptionsJson() => $_clearField(1);
}

class FinishPasskeyLoginRequest extends $pb.GeneratedMessage {
  factory FinishPasskeyLoginRequest({
    $0.TenantContext? tenant,
    $core.String? credentialJson,
  }) {
    final result = FinishPasskeyLoginRequest._();
    if (tenant != null) result.tenant = tenant;
    if (credentialJson != null) result.credentialJson = credentialJson;
    return result;
  }

  FinishPasskeyLoginRequest._();

  factory FinishPasskeyLoginRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyLoginRequest()..mergeFromBuffer(data, registry);
  factory FinishPasskeyLoginRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyLoginRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FinishPasskeyLoginRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FinishPasskeyLoginRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'credentialJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyLoginRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyLoginRequest copyWith(
          void Function(FinishPasskeyLoginRequest) updates) =>
      super.copyWith((message) => updates(message as FinishPasskeyLoginRequest))
          as FinishPasskeyLoginRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use FinishPasskeyLoginRequest() / FinishPasskeyLoginRequest.new instead')
  static FinishPasskeyLoginRequest create() => FinishPasskeyLoginRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      FinishPasskeyLoginRequest._();
  @$core.override
  FinishPasskeyLoginRequest createEmptyInstance() =>
      FinishPasskeyLoginRequest._();
  @$core.pragma('dart2js:noInline')
  static FinishPasskeyLoginRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FinishPasskeyLoginRequest>(
          FinishPasskeyLoginRequest.$_createMessage);
  static FinishPasskeyLoginRequest? _defaultInstance;

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

  /// The PublicKeyCredential the authenticator asserted with, as its toJSON()
  /// serializes it. Unauthenticated, as a wrong password is, when the
  /// assertion was not made on the storefront's origin over a challenge
  /// BeginPasskeyLogin issued and no finish has spent, when the passkey is not
  /// one this tenant's storefront registered, when the user handle it carries
  /// is not its account's, or when its signature counter did not move forward.
  /// An account that is suspended, or whose address was never verified, is
  /// failed_precondition as Login answers it: a passkey proves the reader holds
  /// an authenticator registered from a session, not that the address is
  /// theirs, so it confirms no address.
  @$pb.TagNumber(2)
  $core.String get credentialJson => $_getSZ(1);
  @$pb.TagNumber(2)
  set credentialJson($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCredentialJson() => $_has(1);
  @$pb.TagNumber(2)
  void clearCredentialJson() => $_clearField(2);
}

class FinishPasskeyLoginResponse extends $pb.GeneratedMessage {
  factory FinishPasskeyLoginResponse({
    $0.User? user,
    $0.AccessToken? accessToken,
  }) {
    final result = FinishPasskeyLoginResponse._();
    if (user != null) result.user = user;
    if (accessToken != null) result.accessToken = accessToken;
    return result;
  }

  FinishPasskeyLoginResponse._();

  factory FinishPasskeyLoginResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyLoginResponse()..mergeFromBuffer(data, registry);
  factory FinishPasskeyLoginResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyLoginResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FinishPasskeyLoginResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FinishPasskeyLoginResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..aOM<$0.AccessToken>(2, _omitFieldNames ? '' : 'accessToken',
        subBuilder: $0.AccessToken.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyLoginResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyLoginResponse copyWith(
          void Function(FinishPasskeyLoginResponse) updates) =>
      super.copyWith(
              (message) => updates(message as FinishPasskeyLoginResponse))
          as FinishPasskeyLoginResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use FinishPasskeyLoginResponse() / FinishPasskeyLoginResponse.new instead')
  static FinishPasskeyLoginResponse create() => FinishPasskeyLoginResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      FinishPasskeyLoginResponse._();
  @$core.override
  FinishPasskeyLoginResponse createEmptyInstance() =>
      FinishPasskeyLoginResponse._();
  @$core.pragma('dart2js:noInline')
  static FinishPasskeyLoginResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FinishPasskeyLoginResponse>(
          FinishPasskeyLoginResponse.$_createMessage);
  static FinishPasskeyLoginResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);

  @$pb.TagNumber(2)
  $0.AccessToken get accessToken => $_getN(1);
  @$pb.TagNumber(2)
  set accessToken($0.AccessToken value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasAccessToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearAccessToken() => $_clearField(2);
  @$pb.TagNumber(2)
  $0.AccessToken ensureAccessToken() => $_ensure(1);
}

class BeginPasskeyRegistrationRequest extends $pb.GeneratedMessage {
  factory BeginPasskeyRegistrationRequest({
    $0.TenantContext? tenant,
  }) {
    final result = BeginPasskeyRegistrationRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  BeginPasskeyRegistrationRequest._();

  factory BeginPasskeyRegistrationRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyRegistrationRequest()..mergeFromBuffer(data, registry);
  factory BeginPasskeyRegistrationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyRegistrationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyRegistrationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyRegistrationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyRegistrationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyRegistrationRequest copyWith(
          void Function(BeginPasskeyRegistrationRequest) updates) =>
      super.copyWith(
              (message) => updates(message as BeginPasskeyRegistrationRequest))
          as BeginPasskeyRegistrationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyRegistrationRequest() / BeginPasskeyRegistrationRequest.new instead')
  static BeginPasskeyRegistrationRequest create() =>
      BeginPasskeyRegistrationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      BeginPasskeyRegistrationRequest._();
  @$core.override
  BeginPasskeyRegistrationRequest createEmptyInstance() =>
      BeginPasskeyRegistrationRequest._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyRegistrationRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyRegistrationRequest>(
          BeginPasskeyRegistrationRequest.$_createMessage);
  static BeginPasskeyRegistrationRequest? _defaultInstance;

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

class BeginPasskeyRegistrationResponse extends $pb.GeneratedMessage {
  factory BeginPasskeyRegistrationResponse({
    $core.String? creationOptionsJson,
  }) {
    final result = BeginPasskeyRegistrationResponse._();
    if (creationOptionsJson != null)
      result.creationOptionsJson = creationOptionsJson;
    return result;
  }

  BeginPasskeyRegistrationResponse._();

  factory BeginPasskeyRegistrationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyRegistrationResponse()..mergeFromBuffer(data, registry);
  factory BeginPasskeyRegistrationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyRegistrationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyRegistrationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyRegistrationResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'creationOptionsJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyRegistrationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyRegistrationResponse copyWith(
          void Function(BeginPasskeyRegistrationResponse) updates) =>
      super.copyWith(
              (message) => updates(message as BeginPasskeyRegistrationResponse))
          as BeginPasskeyRegistrationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyRegistrationResponse() / BeginPasskeyRegistrationResponse.new instead')
  static BeginPasskeyRegistrationResponse create() =>
      BeginPasskeyRegistrationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      BeginPasskeyRegistrationResponse._();
  @$core.override
  BeginPasskeyRegistrationResponse createEmptyInstance() =>
      BeginPasskeyRegistrationResponse._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyRegistrationResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyRegistrationResponse>(
          BeginPasskeyRegistrationResponse.$_createMessage);
  static BeginPasskeyRegistrationResponse? _defaultInstance;

  /// PublicKeyCredentialCreationOptionsJSON, for
  /// PublicKeyCredential.parseCreationOptionsFromJSON. A resident key and user
  /// verification are required, since the passkey has to sign the reader in
  /// without an address typed, and the reader's existing passkeys are
  /// excluded. failed_precondition once the reader holds as many passkeys as an
  /// account may.
  @$pb.TagNumber(1)
  $core.String get creationOptionsJson => $_getSZ(0);
  @$pb.TagNumber(1)
  set creationOptionsJson($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCreationOptionsJson() => $_has(0);
  @$pb.TagNumber(1)
  void clearCreationOptionsJson() => $_clearField(1);
}

class FinishPasskeyRegistrationRequest extends $pb.GeneratedMessage {
  factory FinishPasskeyRegistrationRequest({
    $0.TenantContext? tenant,
    $core.String? credentialJson,
    $core.String? name,
  }) {
    final result = FinishPasskeyRegistrationRequest._();
    if (tenant != null) result.tenant = tenant;
    if (credentialJson != null) result.credentialJson = credentialJson;
    if (name != null) result.name = name;
    return result;
  }

  FinishPasskeyRegistrationRequest._();

  factory FinishPasskeyRegistrationRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyRegistrationRequest()..mergeFromBuffer(data, registry);
  factory FinishPasskeyRegistrationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyRegistrationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FinishPasskeyRegistrationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FinishPasskeyRegistrationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'credentialJson')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyRegistrationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyRegistrationRequest copyWith(
          void Function(FinishPasskeyRegistrationRequest) updates) =>
      super.copyWith(
              (message) => updates(message as FinishPasskeyRegistrationRequest))
          as FinishPasskeyRegistrationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use FinishPasskeyRegistrationRequest() / FinishPasskeyRegistrationRequest.new instead')
  static FinishPasskeyRegistrationRequest create() =>
      FinishPasskeyRegistrationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      FinishPasskeyRegistrationRequest._();
  @$core.override
  FinishPasskeyRegistrationRequest createEmptyInstance() =>
      FinishPasskeyRegistrationRequest._();
  @$core.pragma('dart2js:noInline')
  static FinishPasskeyRegistrationRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FinishPasskeyRegistrationRequest>(
          FinishPasskeyRegistrationRequest.$_createMessage);
  static FinishPasskeyRegistrationRequest? _defaultInstance;

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

  /// The PublicKeyCredential the authenticator created, as its toJSON()
  /// serializes it. invalid_argument on credential_json when it does not
  /// verify against a ceremony BeginPasskeyRegistration began for the caller,
  /// and already_exists when the tenant holds the credential already.
  @$pb.TagNumber(2)
  $core.String get credentialJson => $_getSZ(1);
  @$pb.TagNumber(2)
  set credentialJson($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCredentialJson() => $_has(1);
  @$pb.TagNumber(2)
  void clearCredentialJson() => $_clearField(2);

  /// At most 64 characters; empty leaves it unnamed.
  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);
}

class FinishPasskeyRegistrationResponse extends $pb.GeneratedMessage {
  factory FinishPasskeyRegistrationResponse({
    Passkey? passkey,
  }) {
    final result = FinishPasskeyRegistrationResponse._();
    if (passkey != null) result.passkey = passkey;
    return result;
  }

  FinishPasskeyRegistrationResponse._();

  factory FinishPasskeyRegistrationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyRegistrationResponse()..mergeFromBuffer(data, registry);
  factory FinishPasskeyRegistrationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      FinishPasskeyRegistrationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'FinishPasskeyRegistrationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: FinishPasskeyRegistrationResponse.$_createMessage)
    ..aOM<Passkey>(1, _omitFieldNames ? '' : 'passkey',
        subBuilder: Passkey.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyRegistrationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  FinishPasskeyRegistrationResponse copyWith(
          void Function(FinishPasskeyRegistrationResponse) updates) =>
      super.copyWith((message) =>
              updates(message as FinishPasskeyRegistrationResponse))
          as FinishPasskeyRegistrationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use FinishPasskeyRegistrationResponse() / FinishPasskeyRegistrationResponse.new instead')
  static FinishPasskeyRegistrationResponse create() =>
      FinishPasskeyRegistrationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      FinishPasskeyRegistrationResponse._();
  @$core.override
  FinishPasskeyRegistrationResponse createEmptyInstance() =>
      FinishPasskeyRegistrationResponse._();
  @$core.pragma('dart2js:noInline')
  static FinishPasskeyRegistrationResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<FinishPasskeyRegistrationResponse>(
          FinishPasskeyRegistrationResponse.$_createMessage);
  static FinishPasskeyRegistrationResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Passkey get passkey => $_getN(0);
  @$pb.TagNumber(1)
  set passkey(Passkey value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPasskey() => $_has(0);
  @$pb.TagNumber(1)
  void clearPasskey() => $_clearField(1);
  @$pb.TagNumber(1)
  Passkey ensurePasskey() => $_ensure(0);
}

class ListMyPasskeysRequest extends $pb.GeneratedMessage {
  factory ListMyPasskeysRequest({
    $0.TenantContext? tenant,
  }) {
    final result = ListMyPasskeysRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  ListMyPasskeysRequest._();

  factory ListMyPasskeysRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPasskeysRequest()..mergeFromBuffer(data, registry);
  factory ListMyPasskeysRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPasskeysRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyPasskeysRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyPasskeysRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPasskeysRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPasskeysRequest copyWith(
          void Function(ListMyPasskeysRequest) updates) =>
      super.copyWith((message) => updates(message as ListMyPasskeysRequest))
          as ListMyPasskeysRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyPasskeysRequest() / ListMyPasskeysRequest.new instead')
  static ListMyPasskeysRequest create() => ListMyPasskeysRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListMyPasskeysRequest._();
  @$core.override
  ListMyPasskeysRequest createEmptyInstance() => ListMyPasskeysRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyPasskeysRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyPasskeysRequest>(
          ListMyPasskeysRequest.$_createMessage);
  static ListMyPasskeysRequest? _defaultInstance;

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

class ListMyPasskeysResponse extends $pb.GeneratedMessage {
  factory ListMyPasskeysResponse({
    $core.Iterable<Passkey>? passkeys,
  }) {
    final result = ListMyPasskeysResponse._();
    if (passkeys != null) result.passkeys.addAll(passkeys);
    return result;
  }

  ListMyPasskeysResponse._();

  factory ListMyPasskeysResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPasskeysResponse()..mergeFromBuffer(data, registry);
  factory ListMyPasskeysResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyPasskeysResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyPasskeysResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyPasskeysResponse.$_createMessage)
    ..pPM<Passkey>(1, _omitFieldNames ? '' : 'passkeys',
        subBuilder: Passkey.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPasskeysResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyPasskeysResponse copyWith(
          void Function(ListMyPasskeysResponse) updates) =>
      super.copyWith((message) => updates(message as ListMyPasskeysResponse))
          as ListMyPasskeysResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyPasskeysResponse() / ListMyPasskeysResponse.new instead')
  static ListMyPasskeysResponse create() => ListMyPasskeysResponse._();
  static $pb.GeneratedMessage $_createMessage() => ListMyPasskeysResponse._();
  @$core.override
  ListMyPasskeysResponse createEmptyInstance() => ListMyPasskeysResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyPasskeysResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyPasskeysResponse>(
          ListMyPasskeysResponse.$_createMessage);
  static ListMyPasskeysResponse? _defaultInstance;

  /// Oldest first.
  @$pb.TagNumber(1)
  $pb.PbList<Passkey> get passkeys => $_getList(0);
}

class RenamePasskeyRequest extends $pb.GeneratedMessage {
  factory RenamePasskeyRequest({
    $0.TenantContext? tenant,
    $core.String? id,
    $core.String? name,
  }) {
    final result = RenamePasskeyRequest._();
    if (tenant != null) result.tenant = tenant;
    if (id != null) result.id = id;
    if (name != null) result.name = name;
    return result;
  }

  RenamePasskeyRequest._();

  factory RenamePasskeyRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RenamePasskeyRequest()..mergeFromBuffer(data, registry);
  factory RenamePasskeyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RenamePasskeyRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RenamePasskeyRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RenamePasskeyRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'id')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RenamePasskeyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RenamePasskeyRequest copyWith(void Function(RenamePasskeyRequest) updates) =>
      super.copyWith((message) => updates(message as RenamePasskeyRequest))
          as RenamePasskeyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RenamePasskeyRequest() / RenamePasskeyRequest.new instead')
  static RenamePasskeyRequest create() => RenamePasskeyRequest._();
  static $pb.GeneratedMessage $_createMessage() => RenamePasskeyRequest._();
  @$core.override
  RenamePasskeyRequest createEmptyInstance() => RenamePasskeyRequest._();
  @$core.pragma('dart2js:noInline')
  static RenamePasskeyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RenamePasskeyRequest>(
          RenamePasskeyRequest.$_createMessage);
  static RenamePasskeyRequest? _defaultInstance;

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

  /// not_found for a passkey that is not the caller's.
  @$pb.TagNumber(2)
  $core.String get id => $_getSZ(1);
  @$pb.TagNumber(2)
  set id($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasId() => $_has(1);
  @$pb.TagNumber(2)
  void clearId() => $_clearField(2);

  /// At most 64 characters; empty leaves it unnamed.
  @$pb.TagNumber(3)
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);
}

class RenamePasskeyResponse extends $pb.GeneratedMessage {
  factory RenamePasskeyResponse({
    Passkey? passkey,
  }) {
    final result = RenamePasskeyResponse._();
    if (passkey != null) result.passkey = passkey;
    return result;
  }

  RenamePasskeyResponse._();

  factory RenamePasskeyResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RenamePasskeyResponse()..mergeFromBuffer(data, registry);
  factory RenamePasskeyResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RenamePasskeyResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RenamePasskeyResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RenamePasskeyResponse.$_createMessage)
    ..aOM<Passkey>(1, _omitFieldNames ? '' : 'passkey',
        subBuilder: Passkey.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RenamePasskeyResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RenamePasskeyResponse copyWith(
          void Function(RenamePasskeyResponse) updates) =>
      super.copyWith((message) => updates(message as RenamePasskeyResponse))
          as RenamePasskeyResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RenamePasskeyResponse() / RenamePasskeyResponse.new instead')
  static RenamePasskeyResponse create() => RenamePasskeyResponse._();
  static $pb.GeneratedMessage $_createMessage() => RenamePasskeyResponse._();
  @$core.override
  RenamePasskeyResponse createEmptyInstance() => RenamePasskeyResponse._();
  @$core.pragma('dart2js:noInline')
  static RenamePasskeyResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RenamePasskeyResponse>(
          RenamePasskeyResponse.$_createMessage);
  static RenamePasskeyResponse? _defaultInstance;

  @$pb.TagNumber(1)
  Passkey get passkey => $_getN(0);
  @$pb.TagNumber(1)
  set passkey(Passkey value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPasskey() => $_has(0);
  @$pb.TagNumber(1)
  void clearPasskey() => $_clearField(1);
  @$pb.TagNumber(1)
  Passkey ensurePasskey() => $_ensure(0);
}

class DeletePasskeyRequest extends $pb.GeneratedMessage {
  factory DeletePasskeyRequest({
    $0.TenantContext? tenant,
    $core.String? id,
  }) {
    final result = DeletePasskeyRequest._();
    if (tenant != null) result.tenant = tenant;
    if (id != null) result.id = id;
    return result;
  }

  DeletePasskeyRequest._();

  factory DeletePasskeyRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletePasskeyRequest()..mergeFromBuffer(data, registry);
  factory DeletePasskeyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletePasskeyRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeletePasskeyRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeletePasskeyRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePasskeyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePasskeyRequest copyWith(void Function(DeletePasskeyRequest) updates) =>
      super.copyWith((message) => updates(message as DeletePasskeyRequest))
          as DeletePasskeyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use DeletePasskeyRequest() / DeletePasskeyRequest.new instead')
  static DeletePasskeyRequest create() => DeletePasskeyRequest._();
  static $pb.GeneratedMessage $_createMessage() => DeletePasskeyRequest._();
  @$core.override
  DeletePasskeyRequest createEmptyInstance() => DeletePasskeyRequest._();
  @$core.pragma('dart2js:noInline')
  static DeletePasskeyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeletePasskeyRequest>(
          DeletePasskeyRequest.$_createMessage);
  static DeletePasskeyRequest? _defaultInstance;

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

  /// not_found for a passkey that is not the caller's, and
  /// failed_precondition where it is the last way the reader signs in: an
  /// account without a password and without a linked provider keeps one
  /// passkey.
  @$pb.TagNumber(2)
  $core.String get id => $_getSZ(1);
  @$pb.TagNumber(2)
  set id($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasId() => $_has(1);
  @$pb.TagNumber(2)
  void clearId() => $_clearField(2);
}

class DeletePasskeyResponse extends $pb.GeneratedMessage {
  factory DeletePasskeyResponse() => DeletePasskeyResponse._();

  DeletePasskeyResponse._();

  factory DeletePasskeyResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletePasskeyResponse()..mergeFromBuffer(data, registry);
  factory DeletePasskeyResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeletePasskeyResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeletePasskeyResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeletePasskeyResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePasskeyResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeletePasskeyResponse copyWith(
          void Function(DeletePasskeyResponse) updates) =>
      super.copyWith((message) => updates(message as DeletePasskeyResponse))
          as DeletePasskeyResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use DeletePasskeyResponse() / DeletePasskeyResponse.new instead')
  static DeletePasskeyResponse create() => DeletePasskeyResponse._();
  static $pb.GeneratedMessage $_createMessage() => DeletePasskeyResponse._();
  @$core.override
  DeletePasskeyResponse createEmptyInstance() => DeletePasskeyResponse._();
  @$core.pragma('dart2js:noInline')
  static DeletePasskeyResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeletePasskeyResponse>(
          DeletePasskeyResponse.$_createMessage);
  static DeletePasskeyResponse? _defaultInstance;
}

/// Begins the fresh assertion that confirms DeleteMe or RequestEmailChange in
/// place of a password, allowing the caller's own passkeys alone.
/// failed_precondition for a reader who holds none.
class BeginPasskeyConfirmationRequest extends $pb.GeneratedMessage {
  factory BeginPasskeyConfirmationRequest({
    $0.TenantContext? tenant,
  }) {
    final result = BeginPasskeyConfirmationRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  BeginPasskeyConfirmationRequest._();

  factory BeginPasskeyConfirmationRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyConfirmationRequest()..mergeFromBuffer(data, registry);
  factory BeginPasskeyConfirmationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyConfirmationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyConfirmationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyConfirmationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyConfirmationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyConfirmationRequest copyWith(
          void Function(BeginPasskeyConfirmationRequest) updates) =>
      super.copyWith(
              (message) => updates(message as BeginPasskeyConfirmationRequest))
          as BeginPasskeyConfirmationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyConfirmationRequest() / BeginPasskeyConfirmationRequest.new instead')
  static BeginPasskeyConfirmationRequest create() =>
      BeginPasskeyConfirmationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      BeginPasskeyConfirmationRequest._();
  @$core.override
  BeginPasskeyConfirmationRequest createEmptyInstance() =>
      BeginPasskeyConfirmationRequest._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyConfirmationRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyConfirmationRequest>(
          BeginPasskeyConfirmationRequest.$_createMessage);
  static BeginPasskeyConfirmationRequest? _defaultInstance;

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

class BeginPasskeyConfirmationResponse extends $pb.GeneratedMessage {
  factory BeginPasskeyConfirmationResponse({
    $core.String? requestOptionsJson,
  }) {
    final result = BeginPasskeyConfirmationResponse._();
    if (requestOptionsJson != null)
      result.requestOptionsJson = requestOptionsJson;
    return result;
  }

  BeginPasskeyConfirmationResponse._();

  factory BeginPasskeyConfirmationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyConfirmationResponse()..mergeFromBuffer(data, registry);
  factory BeginPasskeyConfirmationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      BeginPasskeyConfirmationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'BeginPasskeyConfirmationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: BeginPasskeyConfirmationResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'requestOptionsJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyConfirmationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  BeginPasskeyConfirmationResponse copyWith(
          void Function(BeginPasskeyConfirmationResponse) updates) =>
      super.copyWith(
              (message) => updates(message as BeginPasskeyConfirmationResponse))
          as BeginPasskeyConfirmationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use BeginPasskeyConfirmationResponse() / BeginPasskeyConfirmationResponse.new instead')
  static BeginPasskeyConfirmationResponse create() =>
      BeginPasskeyConfirmationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      BeginPasskeyConfirmationResponse._();
  @$core.override
  BeginPasskeyConfirmationResponse createEmptyInstance() =>
      BeginPasskeyConfirmationResponse._();
  @$core.pragma('dart2js:noInline')
  static BeginPasskeyConfirmationResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<BeginPasskeyConfirmationResponse>(
          BeginPasskeyConfirmationResponse.$_createMessage);
  static BeginPasskeyConfirmationResponse? _defaultInstance;

  /// PublicKeyCredentialRequestOptionsJSON, as BeginPasskeyLoginResponse
  /// answers it. The assertion made over it goes in the passkey_credential_json
  /// of the request it confirms, and confirms that one request.
  @$pb.TagNumber(1)
  $core.String get requestOptionsJson => $_getSZ(0);
  @$pb.TagNumber(1)
  set requestOptionsJson($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRequestOptionsJson() => $_has(0);
  @$pb.TagNumber(1)
  void clearRequestOptionsJson() => $_clearField(1);
}

class CreateUserRequest extends $pb.GeneratedMessage {
  factory CreateUserRequest({
    $0.TenantContext? tenant,
    $core.String? name,
    $core.String? email,
    $core.String? password,
    $core.String? birthDate,
    $core.Iterable<$core.String>? agreedPageVersionIds,
  }) {
    final result = CreateUserRequest._();
    if (tenant != null) result.tenant = tenant;
    if (name != null) result.name = name;
    if (email != null) result.email = email;
    if (password != null) result.password = password;
    if (birthDate != null) result.birthDate = birthDate;
    if (agreedPageVersionIds != null)
      result.agreedPageVersionIds.addAll(agreedPageVersionIds);
    return result;
  }

  CreateUserRequest._();

  factory CreateUserRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateUserRequest()..mergeFromBuffer(data, registry);
  factory CreateUserRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateUserRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateUserRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CreateUserRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'email')
    ..aOS(4, _omitFieldNames ? '' : 'password')
    ..aOS(5, _omitFieldNames ? '' : 'birthDate')
    ..pPS(6, _omitFieldNames ? '' : 'agreedPageVersionIds')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateUserRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateUserRequest copyWith(void Function(CreateUserRequest) updates) =>
      super.copyWith((message) => updates(message as CreateUserRequest))
          as CreateUserRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CreateUserRequest() / CreateUserRequest.new instead')
  static CreateUserRequest create() => CreateUserRequest._();
  static $pb.GeneratedMessage $_createMessage() => CreateUserRequest._();
  @$core.override
  CreateUserRequest createEmptyInstance() => CreateUserRequest._();
  @$core.pragma('dart2js:noInline')
  static CreateUserRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CreateUserRequest>(
          CreateUserRequest.$_createMessage);
  static CreateUserRequest? _defaultInstance;

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
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// An address the tenant refuses is invalid_argument on email, with the field
  /// violation's reason EMAIL_DISPOSABLE_DOMAIN for a domain on the disposable
  /// list and EMAIL_REFUSED for one the tenant listed. The refusal depends on
  /// the address alone and never on whether it is registered, so it is not
  /// folded into the uniform accepted answer.
  @$pb.TagNumber(3)
  $core.String get email => $_getSZ(2);
  @$pb.TagNumber(3)
  set email($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEmail() => $_has(2);
  @$pb.TagNumber(3)
  void clearEmail() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get password => $_getSZ(3);
  @$pb.TagNumber(4)
  set password($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPassword() => $_has(3);
  @$pb.TagNumber(4)
  void clearPassword() => $_clearField(4);

  /// The reader's birth date as YYYY-MM-DD, and empty from a form that did not
  /// ask. It is accepted here rather than only after the first sign-in because
  /// a tenant that verifies ages asks for it on the sign-up form: collecting it
  /// later would leave the account that just agreed to give it unable to open
  /// the work it signed up for until it has verified an address and signed in.
  @$pb.TagNumber(5)
  $core.String get birthDate => $_getSZ(4);
  @$pb.TagNumber(5)
  set birthDate($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasBirthDate() => $_has(4);
  @$pb.TagNumber(5)
  void clearBirthDate() => $_clearField(5);

  /// The version of each page the reader agreed to, as TenantLegalPage.version_id
  /// reported it. Required for every page GetTenantLegalPages reports as the
  /// tenant's terms or privacy policy, and refused when one names any other
  /// page. A published version of any translation of the page is accepted, and
  /// so is one the page has since superseded, since it is the text the reader
  /// was shown.
  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get agreedPageVersionIds => $_getList(5);
}

class CreateUserResponse extends $pb.GeneratedMessage {
  factory CreateUserResponse({
    $core.bool? accepted,
  }) {
    final result = CreateUserResponse._();
    if (accepted != null) result.accepted = accepted;
    return result;
  }

  CreateUserResponse._();

  factory CreateUserResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateUserResponse()..mergeFromBuffer(data, registry);
  factory CreateUserResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreateUserResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreateUserResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CreateUserResponse.$_createMessage)
    ..aOB(3, _omitFieldNames ? '' : 'accepted')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateUserResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreateUserResponse copyWith(void Function(CreateUserResponse) updates) =>
      super.copyWith((message) => updates(message as CreateUserResponse))
          as CreateUserResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CreateUserResponse() / CreateUserResponse.new instead')
  static CreateUserResponse create() => CreateUserResponse._();
  static $pb.GeneratedMessage $_createMessage() => CreateUserResponse._();
  @$core.override
  CreateUserResponse createEmptyInstance() => CreateUserResponse._();
  @$core.pragma('dart2js:noInline')
  static CreateUserResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CreateUserResponse>(
          CreateUserResponse.$_createMessage);
  static CreateUserResponse? _defaultInstance;

  /// Every accepted sign-up answers the same way, whether it created an account
  /// or found the address taken. Naming the account here would tell a stranger
  /// which of the two happened. An address is taken when an account holds the
  /// inbox it reaches under any sub-address tag: a sign-up as john+2@ with
  /// john@ registered opens nothing, and the notice a taken address gets goes
  /// to john+2@.
  @$pb.TagNumber(3)
  $core.bool get accepted => $_getBF(0);
  @$pb.TagNumber(3)
  set accepted($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(3)
  $core.bool hasAccepted() => $_has(0);
  @$pb.TagNumber(3)
  void clearAccepted() => $_clearField(3);
}

class VerifyUserEmailRequest extends $pb.GeneratedMessage {
  factory VerifyUserEmailRequest({
    $0.TenantContext? tenant,
    $core.String? token,
  }) {
    final result = VerifyUserEmailRequest._();
    if (tenant != null) result.tenant = tenant;
    if (token != null) result.token = token;
    return result;
  }

  VerifyUserEmailRequest._();

  factory VerifyUserEmailRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      VerifyUserEmailRequest()..mergeFromBuffer(data, registry);
  factory VerifyUserEmailRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      VerifyUserEmailRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VerifyUserEmailRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: VerifyUserEmailRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyUserEmailRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyUserEmailRequest copyWith(
          void Function(VerifyUserEmailRequest) updates) =>
      super.copyWith((message) => updates(message as VerifyUserEmailRequest))
          as VerifyUserEmailRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use VerifyUserEmailRequest() / VerifyUserEmailRequest.new instead')
  static VerifyUserEmailRequest create() => VerifyUserEmailRequest._();
  static $pb.GeneratedMessage $_createMessage() => VerifyUserEmailRequest._();
  @$core.override
  VerifyUserEmailRequest createEmptyInstance() => VerifyUserEmailRequest._();
  @$core.pragma('dart2js:noInline')
  static VerifyUserEmailRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VerifyUserEmailRequest>(
          VerifyUserEmailRequest.$_createMessage);
  static VerifyUserEmailRequest? _defaultInstance;

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
  $core.String get token => $_getSZ(1);
  @$pb.TagNumber(2)
  set token($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearToken() => $_clearField(2);
}

class VerifyUserEmailResponse extends $pb.GeneratedMessage {
  factory VerifyUserEmailResponse({
    $core.bool? verified,
  }) {
    final result = VerifyUserEmailResponse._();
    if (verified != null) result.verified = verified;
    return result;
  }

  VerifyUserEmailResponse._();

  factory VerifyUserEmailResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      VerifyUserEmailResponse()..mergeFromBuffer(data, registry);
  factory VerifyUserEmailResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      VerifyUserEmailResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'VerifyUserEmailResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: VerifyUserEmailResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'verified')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyUserEmailResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  VerifyUserEmailResponse copyWith(
          void Function(VerifyUserEmailResponse) updates) =>
      super.copyWith((message) => updates(message as VerifyUserEmailResponse))
          as VerifyUserEmailResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use VerifyUserEmailResponse() / VerifyUserEmailResponse.new instead')
  static VerifyUserEmailResponse create() => VerifyUserEmailResponse._();
  static $pb.GeneratedMessage $_createMessage() => VerifyUserEmailResponse._();
  @$core.override
  VerifyUserEmailResponse createEmptyInstance() => VerifyUserEmailResponse._();
  @$core.pragma('dart2js:noInline')
  static VerifyUserEmailResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<VerifyUserEmailResponse>(
          VerifyUserEmailResponse.$_createMessage);
  static VerifyUserEmailResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get verified => $_getBF(0);
  @$pb.TagNumber(1)
  set verified($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasVerified() => $_has(0);
  @$pb.TagNumber(1)
  void clearVerified() => $_clearField(1);
}

class RequestEmailVerificationRequest extends $pb.GeneratedMessage {
  factory RequestEmailVerificationRequest({
    $0.TenantContext? tenant,
    $core.String? email,
  }) {
    final result = RequestEmailVerificationRequest._();
    if (tenant != null) result.tenant = tenant;
    if (email != null) result.email = email;
    return result;
  }

  RequestEmailVerificationRequest._();

  factory RequestEmailVerificationRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailVerificationRequest()..mergeFromBuffer(data, registry);
  factory RequestEmailVerificationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailVerificationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestEmailVerificationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestEmailVerificationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailVerificationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailVerificationRequest copyWith(
          void Function(RequestEmailVerificationRequest) updates) =>
      super.copyWith(
              (message) => updates(message as RequestEmailVerificationRequest))
          as RequestEmailVerificationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestEmailVerificationRequest() / RequestEmailVerificationRequest.new instead')
  static RequestEmailVerificationRequest create() =>
      RequestEmailVerificationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestEmailVerificationRequest._();
  @$core.override
  RequestEmailVerificationRequest createEmptyInstance() =>
      RequestEmailVerificationRequest._();
  @$core.pragma('dart2js:noInline')
  static RequestEmailVerificationRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestEmailVerificationRequest>(
          RequestEmailVerificationRequest.$_createMessage);
  static RequestEmailVerificationRequest? _defaultInstance;

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
  $core.String get email => $_getSZ(1);
  @$pb.TagNumber(2)
  set email($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmail() => $_clearField(2);
}

class RequestEmailVerificationResponse extends $pb.GeneratedMessage {
  factory RequestEmailVerificationResponse({
    $core.bool? requested,
  }) {
    final result = RequestEmailVerificationResponse._();
    if (requested != null) result.requested = requested;
    return result;
  }

  RequestEmailVerificationResponse._();

  factory RequestEmailVerificationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailVerificationResponse()..mergeFromBuffer(data, registry);
  factory RequestEmailVerificationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailVerificationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestEmailVerificationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestEmailVerificationResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'requested')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailVerificationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailVerificationResponse copyWith(
          void Function(RequestEmailVerificationResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RequestEmailVerificationResponse))
          as RequestEmailVerificationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestEmailVerificationResponse() / RequestEmailVerificationResponse.new instead')
  static RequestEmailVerificationResponse create() =>
      RequestEmailVerificationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestEmailVerificationResponse._();
  @$core.override
  RequestEmailVerificationResponse createEmptyInstance() =>
      RequestEmailVerificationResponse._();
  @$core.pragma('dart2js:noInline')
  static RequestEmailVerificationResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestEmailVerificationResponse>(
          RequestEmailVerificationResponse.$_createMessage);
  static RequestEmailVerificationResponse? _defaultInstance;

  /// Every request answers the same way, whether the address has an unverified
  /// account, a verified one, or no account at all. Reporting which of the three
  /// it was would tell a stranger who is registered.
  @$pb.TagNumber(1)
  $core.bool get requested => $_getBF(0);
  @$pb.TagNumber(1)
  set requested($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRequested() => $_has(0);
  @$pb.TagNumber(1)
  void clearRequested() => $_clearField(1);
}

class RequestEmailChangeRequest extends $pb.GeneratedMessage {
  factory RequestEmailChangeRequest({
    $0.TenantContext? tenant,
    $core.String? currentEmail,
    $core.String? newEmail,
    $core.String? currentPassword,
    IdentityProvider? provider,
    $core.String? idToken,
    $core.String? nonce,
    $core.String? passkeyCredentialJson,
  }) {
    final result = RequestEmailChangeRequest._();
    if (tenant != null) result.tenant = tenant;
    if (currentEmail != null) result.currentEmail = currentEmail;
    if (newEmail != null) result.newEmail = newEmail;
    if (currentPassword != null) result.currentPassword = currentPassword;
    if (provider != null) result.provider = provider;
    if (idToken != null) result.idToken = idToken;
    if (nonce != null) result.nonce = nonce;
    if (passkeyCredentialJson != null)
      result.passkeyCredentialJson = passkeyCredentialJson;
    return result;
  }

  RequestEmailChangeRequest._();

  factory RequestEmailChangeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailChangeRequest()..mergeFromBuffer(data, registry);
  factory RequestEmailChangeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailChangeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestEmailChangeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestEmailChangeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'currentEmail')
    ..aOS(3, _omitFieldNames ? '' : 'newEmail')
    ..aOS(4, _omitFieldNames ? '' : 'currentPassword')
    ..aE<IdentityProvider>(5, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..aOS(6, _omitFieldNames ? '' : 'idToken')
    ..aOS(7, _omitFieldNames ? '' : 'nonce')
    ..aOS(8, _omitFieldNames ? '' : 'passkeyCredentialJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailChangeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailChangeRequest copyWith(
          void Function(RequestEmailChangeRequest) updates) =>
      super.copyWith((message) => updates(message as RequestEmailChangeRequest))
          as RequestEmailChangeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestEmailChangeRequest() / RequestEmailChangeRequest.new instead')
  static RequestEmailChangeRequest create() => RequestEmailChangeRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestEmailChangeRequest._();
  @$core.override
  RequestEmailChangeRequest createEmptyInstance() =>
      RequestEmailChangeRequest._();
  @$core.pragma('dart2js:noInline')
  static RequestEmailChangeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestEmailChangeRequest>(
          RequestEmailChangeRequest.$_createMessage);
  static RequestEmailChangeRequest? _defaultInstance;

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
  $core.String get currentEmail => $_getSZ(1);
  @$pb.TagNumber(2)
  set currentEmail($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCurrentEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearCurrentEmail() => $_clearField(2);

  /// Refused on new_email for the reasons CreateUserRequest.email is, and
  /// already_exists when another account holds the inbox it reaches under any
  /// sub-address tag. A move between tags of the reader's own inbox is not
  /// refused.
  @$pb.TagNumber(3)
  $core.String get newEmail => $_getSZ(2);
  @$pb.TagNumber(3)
  set newEmail($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNewEmail() => $_has(2);
  @$pb.TagNumber(3)
  void clearNewEmail() => $_clearField(3);

  /// The account's password. An account without one confirms with a fresh
  /// sign-in instead: an ID token and its nonce, as LoginWithIdTokenRequest
  /// takes them, from a provider linked to the account, or an assertion made
  /// with one of its passkeys over a challenge BeginPasskeyConfirmation issued,
  /// as its toJSON() serializes it. Exactly one of the three is sent. An
  /// assertion that does not verify is invalid_argument on
  /// passkey_credential_json, so a client does not mistake it for the end of
  /// its session.
  @$pb.TagNumber(4)
  $core.String get currentPassword => $_getSZ(3);
  @$pb.TagNumber(4)
  set currentPassword($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCurrentPassword() => $_has(3);
  @$pb.TagNumber(4)
  void clearCurrentPassword() => $_clearField(4);

  @$pb.TagNumber(5)
  IdentityProvider get provider => $_getN(4);
  @$pb.TagNumber(5)
  set provider(IdentityProvider value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasProvider() => $_has(4);
  @$pb.TagNumber(5)
  void clearProvider() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get idToken => $_getSZ(5);
  @$pb.TagNumber(6)
  set idToken($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIdToken() => $_has(5);
  @$pb.TagNumber(6)
  void clearIdToken() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get nonce => $_getSZ(6);
  @$pb.TagNumber(7)
  set nonce($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasNonce() => $_has(6);
  @$pb.TagNumber(7)
  void clearNonce() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get passkeyCredentialJson => $_getSZ(7);
  @$pb.TagNumber(8)
  set passkeyCredentialJson($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasPasskeyCredentialJson() => $_has(7);
  @$pb.TagNumber(8)
  void clearPasskeyCredentialJson() => $_clearField(8);
}

class RequestEmailChangeResponse extends $pb.GeneratedMessage {
  factory RequestEmailChangeResponse({
    $core.bool? requested,
  }) {
    final result = RequestEmailChangeResponse._();
    if (requested != null) result.requested = requested;
    return result;
  }

  RequestEmailChangeResponse._();

  factory RequestEmailChangeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailChangeResponse()..mergeFromBuffer(data, registry);
  factory RequestEmailChangeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestEmailChangeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestEmailChangeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestEmailChangeResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'requested')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailChangeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestEmailChangeResponse copyWith(
          void Function(RequestEmailChangeResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RequestEmailChangeResponse))
          as RequestEmailChangeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestEmailChangeResponse() / RequestEmailChangeResponse.new instead')
  static RequestEmailChangeResponse create() => RequestEmailChangeResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestEmailChangeResponse._();
  @$core.override
  RequestEmailChangeResponse createEmptyInstance() =>
      RequestEmailChangeResponse._();
  @$core.pragma('dart2js:noInline')
  static RequestEmailChangeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestEmailChangeResponse>(
          RequestEmailChangeResponse.$_createMessage);
  static RequestEmailChangeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get requested => $_getBF(0);
  @$pb.TagNumber(1)
  set requested($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRequested() => $_has(0);
  @$pb.TagNumber(1)
  void clearRequested() => $_clearField(1);
}

class ConfirmEmailChangeRequest extends $pb.GeneratedMessage {
  factory ConfirmEmailChangeRequest({
    $0.TenantContext? tenant,
    $core.String? token,
  }) {
    final result = ConfirmEmailChangeRequest._();
    if (tenant != null) result.tenant = tenant;
    if (token != null) result.token = token;
    return result;
  }

  ConfirmEmailChangeRequest._();

  factory ConfirmEmailChangeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmEmailChangeRequest()..mergeFromBuffer(data, registry);
  factory ConfirmEmailChangeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmEmailChangeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmEmailChangeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmEmailChangeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmEmailChangeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmEmailChangeRequest copyWith(
          void Function(ConfirmEmailChangeRequest) updates) =>
      super.copyWith((message) => updates(message as ConfirmEmailChangeRequest))
          as ConfirmEmailChangeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmEmailChangeRequest() / ConfirmEmailChangeRequest.new instead')
  static ConfirmEmailChangeRequest create() => ConfirmEmailChangeRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmEmailChangeRequest._();
  @$core.override
  ConfirmEmailChangeRequest createEmptyInstance() =>
      ConfirmEmailChangeRequest._();
  @$core.pragma('dart2js:noInline')
  static ConfirmEmailChangeRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmEmailChangeRequest>(
          ConfirmEmailChangeRequest.$_createMessage);
  static ConfirmEmailChangeRequest? _defaultInstance;

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
  $core.String get token => $_getSZ(1);
  @$pb.TagNumber(2)
  set token($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearToken() => $_clearField(2);
}

class ConfirmEmailChangeResponse extends $pb.GeneratedMessage {
  factory ConfirmEmailChangeResponse({
    $core.bool? confirmed,
    $core.bool? changed,
    $core.String? pendingConfirmationFor,
  }) {
    final result = ConfirmEmailChangeResponse._();
    if (confirmed != null) result.confirmed = confirmed;
    if (changed != null) result.changed = changed;
    if (pendingConfirmationFor != null)
      result.pendingConfirmationFor = pendingConfirmationFor;
    return result;
  }

  ConfirmEmailChangeResponse._();

  factory ConfirmEmailChangeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmEmailChangeResponse()..mergeFromBuffer(data, registry);
  factory ConfirmEmailChangeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmEmailChangeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmEmailChangeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmEmailChangeResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'confirmed')
    ..aOB(2, _omitFieldNames ? '' : 'changed')
    ..aOS(3, _omitFieldNames ? '' : 'pendingConfirmationFor')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmEmailChangeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmEmailChangeResponse copyWith(
          void Function(ConfirmEmailChangeResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ConfirmEmailChangeResponse))
          as ConfirmEmailChangeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmEmailChangeResponse() / ConfirmEmailChangeResponse.new instead')
  static ConfirmEmailChangeResponse create() => ConfirmEmailChangeResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmEmailChangeResponse._();
  @$core.override
  ConfirmEmailChangeResponse createEmptyInstance() =>
      ConfirmEmailChangeResponse._();
  @$core.pragma('dart2js:noInline')
  static ConfirmEmailChangeResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmEmailChangeResponse>(
          ConfirmEmailChangeResponse.$_createMessage);
  static ConfirmEmailChangeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get confirmed => $_getBF(0);
  @$pb.TagNumber(1)
  set confirmed($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConfirmed() => $_has(0);
  @$pb.TagNumber(1)
  void clearConfirmed() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.bool get changed => $_getBF(1);
  @$pb.TagNumber(2)
  set changed($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasChanged() => $_has(1);
  @$pb.TagNumber(2)
  void clearChanged() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get pendingConfirmationFor => $_getSZ(2);
  @$pb.TagNumber(3)
  set pendingConfirmationFor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPendingConfirmationFor() => $_has(2);
  @$pb.TagNumber(3)
  void clearPendingConfirmationFor() => $_clearField(3);
}

class RequestPasswordResetRequest extends $pb.GeneratedMessage {
  factory RequestPasswordResetRequest({
    $0.TenantContext? tenant,
    $core.String? email,
  }) {
    final result = RequestPasswordResetRequest._();
    if (tenant != null) result.tenant = tenant;
    if (email != null) result.email = email;
    return result;
  }

  RequestPasswordResetRequest._();

  factory RequestPasswordResetRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestPasswordResetRequest()..mergeFromBuffer(data, registry);
  factory RequestPasswordResetRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestPasswordResetRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestPasswordResetRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestPasswordResetRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'email')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestPasswordResetRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestPasswordResetRequest copyWith(
          void Function(RequestPasswordResetRequest) updates) =>
      super.copyWith(
              (message) => updates(message as RequestPasswordResetRequest))
          as RequestPasswordResetRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestPasswordResetRequest() / RequestPasswordResetRequest.new instead')
  static RequestPasswordResetRequest create() =>
      RequestPasswordResetRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestPasswordResetRequest._();
  @$core.override
  RequestPasswordResetRequest createEmptyInstance() =>
      RequestPasswordResetRequest._();
  @$core.pragma('dart2js:noInline')
  static RequestPasswordResetRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestPasswordResetRequest>(
          RequestPasswordResetRequest.$_createMessage);
  static RequestPasswordResetRequest? _defaultInstance;

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
  $core.String get email => $_getSZ(1);
  @$pb.TagNumber(2)
  set email($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmail() => $_clearField(2);
}

class RequestPasswordResetResponse extends $pb.GeneratedMessage {
  factory RequestPasswordResetResponse({
    $core.bool? requested,
  }) {
    final result = RequestPasswordResetResponse._();
    if (requested != null) result.requested = requested;
    return result;
  }

  RequestPasswordResetResponse._();

  factory RequestPasswordResetResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestPasswordResetResponse()..mergeFromBuffer(data, registry);
  factory RequestPasswordResetResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RequestPasswordResetResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RequestPasswordResetResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RequestPasswordResetResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'requested')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestPasswordResetResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RequestPasswordResetResponse copyWith(
          void Function(RequestPasswordResetResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RequestPasswordResetResponse))
          as RequestPasswordResetResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RequestPasswordResetResponse() / RequestPasswordResetResponse.new instead')
  static RequestPasswordResetResponse create() =>
      RequestPasswordResetResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      RequestPasswordResetResponse._();
  @$core.override
  RequestPasswordResetResponse createEmptyInstance() =>
      RequestPasswordResetResponse._();
  @$core.pragma('dart2js:noInline')
  static RequestPasswordResetResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RequestPasswordResetResponse>(
          RequestPasswordResetResponse.$_createMessage);
  static RequestPasswordResetResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get requested => $_getBF(0);
  @$pb.TagNumber(1)
  set requested($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRequested() => $_has(0);
  @$pb.TagNumber(1)
  void clearRequested() => $_clearField(1);
}

class ConfirmPasswordResetRequest extends $pb.GeneratedMessage {
  factory ConfirmPasswordResetRequest({
    $0.TenantContext? tenant,
    $core.String? token,
    $core.String? newPassword,
  }) {
    final result = ConfirmPasswordResetRequest._();
    if (tenant != null) result.tenant = tenant;
    if (token != null) result.token = token;
    if (newPassword != null) result.newPassword = newPassword;
    return result;
  }

  ConfirmPasswordResetRequest._();

  factory ConfirmPasswordResetRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmPasswordResetRequest()..mergeFromBuffer(data, registry);
  factory ConfirmPasswordResetRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmPasswordResetRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmPasswordResetRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmPasswordResetRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'token')
    ..aOS(3, _omitFieldNames ? '' : 'newPassword')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmPasswordResetRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmPasswordResetRequest copyWith(
          void Function(ConfirmPasswordResetRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ConfirmPasswordResetRequest))
          as ConfirmPasswordResetRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmPasswordResetRequest() / ConfirmPasswordResetRequest.new instead')
  static ConfirmPasswordResetRequest create() =>
      ConfirmPasswordResetRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmPasswordResetRequest._();
  @$core.override
  ConfirmPasswordResetRequest createEmptyInstance() =>
      ConfirmPasswordResetRequest._();
  @$core.pragma('dart2js:noInline')
  static ConfirmPasswordResetRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmPasswordResetRequest>(
          ConfirmPasswordResetRequest.$_createMessage);
  static ConfirmPasswordResetRequest? _defaultInstance;

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
  $core.String get token => $_getSZ(1);
  @$pb.TagNumber(2)
  set token($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearToken() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get newPassword => $_getSZ(2);
  @$pb.TagNumber(3)
  set newPassword($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNewPassword() => $_has(2);
  @$pb.TagNumber(3)
  void clearNewPassword() => $_clearField(3);
}

class ConfirmPasswordResetResponse extends $pb.GeneratedMessage {
  factory ConfirmPasswordResetResponse({
    $core.bool? confirmed,
  }) {
    final result = ConfirmPasswordResetResponse._();
    if (confirmed != null) result.confirmed = confirmed;
    return result;
  }

  ConfirmPasswordResetResponse._();

  factory ConfirmPasswordResetResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmPasswordResetResponse()..mergeFromBuffer(data, registry);
  factory ConfirmPasswordResetResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ConfirmPasswordResetResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ConfirmPasswordResetResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ConfirmPasswordResetResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'confirmed')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmPasswordResetResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ConfirmPasswordResetResponse copyWith(
          void Function(ConfirmPasswordResetResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ConfirmPasswordResetResponse))
          as ConfirmPasswordResetResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ConfirmPasswordResetResponse() / ConfirmPasswordResetResponse.new instead')
  static ConfirmPasswordResetResponse create() =>
      ConfirmPasswordResetResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ConfirmPasswordResetResponse._();
  @$core.override
  ConfirmPasswordResetResponse createEmptyInstance() =>
      ConfirmPasswordResetResponse._();
  @$core.pragma('dart2js:noInline')
  static ConfirmPasswordResetResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ConfirmPasswordResetResponse>(
          ConfirmPasswordResetResponse.$_createMessage);
  static ConfirmPasswordResetResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get confirmed => $_getBF(0);
  @$pb.TagNumber(1)
  set confirmed($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasConfirmed() => $_has(0);
  @$pb.TagNumber(1)
  void clearConfirmed() => $_clearField(1);
}

class ChangePasswordRequest extends $pb.GeneratedMessage {
  factory ChangePasswordRequest({
    $0.TenantContext? tenant,
    $core.String? currentPassword,
    $core.String? newPassword,
  }) {
    final result = ChangePasswordRequest._();
    if (tenant != null) result.tenant = tenant;
    if (currentPassword != null) result.currentPassword = currentPassword;
    if (newPassword != null) result.newPassword = newPassword;
    return result;
  }

  ChangePasswordRequest._();

  factory ChangePasswordRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ChangePasswordRequest()..mergeFromBuffer(data, registry);
  factory ChangePasswordRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ChangePasswordRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChangePasswordRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ChangePasswordRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'currentPassword')
    ..aOS(3, _omitFieldNames ? '' : 'newPassword')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChangePasswordRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChangePasswordRequest copyWith(
          void Function(ChangePasswordRequest) updates) =>
      super.copyWith((message) => updates(message as ChangePasswordRequest))
          as ChangePasswordRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ChangePasswordRequest() / ChangePasswordRequest.new instead')
  static ChangePasswordRequest create() => ChangePasswordRequest._();
  static $pb.GeneratedMessage $_createMessage() => ChangePasswordRequest._();
  @$core.override
  ChangePasswordRequest createEmptyInstance() => ChangePasswordRequest._();
  @$core.pragma('dart2js:noInline')
  static ChangePasswordRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChangePasswordRequest>(
          ChangePasswordRequest.$_createMessage);
  static ChangePasswordRequest? _defaultInstance;

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
  $core.String get currentPassword => $_getSZ(1);
  @$pb.TagNumber(2)
  set currentPassword($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCurrentPassword() => $_has(1);
  @$pb.TagNumber(2)
  void clearCurrentPassword() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get newPassword => $_getSZ(2);
  @$pb.TagNumber(3)
  set newPassword($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNewPassword() => $_has(2);
  @$pb.TagNumber(3)
  void clearNewPassword() => $_clearField(3);
}

class ChangePasswordResponse extends $pb.GeneratedMessage {
  factory ChangePasswordResponse({
    $0.AccessToken? accessToken,
  }) {
    final result = ChangePasswordResponse._();
    if (accessToken != null) result.accessToken = accessToken;
    return result;
  }

  ChangePasswordResponse._();

  factory ChangePasswordResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ChangePasswordResponse()..mergeFromBuffer(data, registry);
  factory ChangePasswordResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ChangePasswordResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ChangePasswordResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ChangePasswordResponse.$_createMessage)
    ..aOM<$0.AccessToken>(1, _omitFieldNames ? '' : 'accessToken',
        subBuilder: $0.AccessToken.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChangePasswordResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ChangePasswordResponse copyWith(
          void Function(ChangePasswordResponse) updates) =>
      super.copyWith((message) => updates(message as ChangePasswordResponse))
          as ChangePasswordResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ChangePasswordResponse() / ChangePasswordResponse.new instead')
  static ChangePasswordResponse create() => ChangePasswordResponse._();
  static $pb.GeneratedMessage $_createMessage() => ChangePasswordResponse._();
  @$core.override
  ChangePasswordResponse createEmptyInstance() => ChangePasswordResponse._();
  @$core.pragma('dart2js:noInline')
  static ChangePasswordResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ChangePasswordResponse>(
          ChangePasswordResponse.$_createMessage);
  static ChangePasswordResponse? _defaultInstance;

  /// A change bumps credentials_version, which ends every token minted before
  /// it — including the one that carried this request. The replacement is handed
  /// back here so the reader who made the change keeps the session they made it
  /// from, while every other device has to sign in again.
  @$pb.TagNumber(1)
  $0.AccessToken get accessToken => $_getN(0);
  @$pb.TagNumber(1)
  set accessToken($0.AccessToken value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAccessToken() => $_has(0);
  @$pb.TagNumber(1)
  void clearAccessToken() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.AccessToken ensureAccessToken() => $_ensure(0);
}

class LogoutRequest extends $pb.GeneratedMessage {
  factory LogoutRequest({
    $0.TenantContext? tenant,
  }) {
    final result = LogoutRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  LogoutRequest._();

  factory LogoutRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LogoutRequest()..mergeFromBuffer(data, registry);
  factory LogoutRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LogoutRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LogoutRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LogoutRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LogoutRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LogoutRequest copyWith(void Function(LogoutRequest) updates) =>
      super.copyWith((message) => updates(message as LogoutRequest))
          as LogoutRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use LogoutRequest() / LogoutRequest.new instead')
  static LogoutRequest create() => LogoutRequest._();
  static $pb.GeneratedMessage $_createMessage() => LogoutRequest._();
  @$core.override
  LogoutRequest createEmptyInstance() => LogoutRequest._();
  @$core.pragma('dart2js:noInline')
  static LogoutRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LogoutRequest>(
          LogoutRequest.$_createMessage);
  static LogoutRequest? _defaultInstance;

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

class LogoutResponse extends $pb.GeneratedMessage {
  factory LogoutResponse() => LogoutResponse._();

  LogoutResponse._();

  factory LogoutResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LogoutResponse()..mergeFromBuffer(data, registry);
  factory LogoutResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      LogoutResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'LogoutResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: LogoutResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LogoutResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  LogoutResponse copyWith(void Function(LogoutResponse) updates) =>
      super.copyWith((message) => updates(message as LogoutResponse))
          as LogoutResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use LogoutResponse() / LogoutResponse.new instead')
  static LogoutResponse create() => LogoutResponse._();
  static $pb.GeneratedMessage $_createMessage() => LogoutResponse._();
  @$core.override
  LogoutResponse createEmptyInstance() => LogoutResponse._();
  @$core.pragma('dart2js:noInline')
  static LogoutResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<LogoutResponse>(
          LogoutResponse.$_createMessage);
  static LogoutResponse? _defaultInstance;
}

class GetMeRequest extends $pb.GeneratedMessage {
  factory GetMeRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetMeRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetMeRequest._();

  factory GetMeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMeRequest()..mergeFromBuffer(data, registry);
  factory GetMeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMeRequest copyWith(void Function(GetMeRequest) updates) =>
      super.copyWith((message) => updates(message as GetMeRequest))
          as GetMeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use GetMeRequest() / GetMeRequest.new instead')
  static GetMeRequest create() => GetMeRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetMeRequest._();
  @$core.override
  GetMeRequest createEmptyInstance() => GetMeRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMeRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetMeRequest>(
          GetMeRequest.$_createMessage);
  static GetMeRequest? _defaultInstance;

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

class GetMeResponse extends $pb.GeneratedMessage {
  factory GetMeResponse({
    $0.User? user,
  }) {
    final result = GetMeResponse._();
    if (user != null) result.user = user;
    return result;
  }

  GetMeResponse._();

  factory GetMeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMeResponse()..mergeFromBuffer(data, registry);
  factory GetMeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMeResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMeResponse copyWith(void Function(GetMeResponse) updates) =>
      super.copyWith((message) => updates(message as GetMeResponse))
          as GetMeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use GetMeResponse() / GetMeResponse.new instead')
  static GetMeResponse create() => GetMeResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetMeResponse._();
  @$core.override
  GetMeResponse createEmptyInstance() => GetMeResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMeResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetMeResponse>(
          GetMeResponse.$_createMessage);
  static GetMeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);
}

class UpdateMeRequest extends $pb.GeneratedMessage {
  factory UpdateMeRequest({
    $0.TenantContext? tenant,
    $core.String? name,
    $core.String? birthDate,
  }) {
    final result = UpdateMeRequest._();
    if (tenant != null) result.tenant = tenant;
    if (name != null) result.name = name;
    if (birthDate != null) result.birthDate = birthDate;
    return result;
  }

  UpdateMeRequest._();

  factory UpdateMeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateMeRequest()..mergeFromBuffer(data, registry);
  factory UpdateMeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateMeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateMeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'birthDate')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMeRequest copyWith(void Function(UpdateMeRequest) updates) =>
      super.copyWith((message) => updates(message as UpdateMeRequest))
          as UpdateMeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UpdateMeRequest() / UpdateMeRequest.new instead')
  static UpdateMeRequest create() => UpdateMeRequest._();
  static $pb.GeneratedMessage $_createMessage() => UpdateMeRequest._();
  @$core.override
  UpdateMeRequest createEmptyInstance() => UpdateMeRequest._();
  @$core.pragma('dart2js:noInline')
  static UpdateMeRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UpdateMeRequest>(
          UpdateMeRequest.$_createMessage);
  static UpdateMeRequest? _defaultInstance;

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
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// The reader's birth date as YYYY-MM-DD. Empty leaves the stored one alone,
  /// which is what the profile form sends when it is only renaming the account.
  ///
  /// It is written once. A reader who gives a date and then wants it changed
  /// goes through support, because a date a reader can rewrite at will proves
  /// nothing about their age: the second write is refused rather than applied.
  @$pb.TagNumber(3)
  $core.String get birthDate => $_getSZ(2);
  @$pb.TagNumber(3)
  set birthDate($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasBirthDate() => $_has(2);
  @$pb.TagNumber(3)
  void clearBirthDate() => $_clearField(3);
}

class UpdateMeResponse extends $pb.GeneratedMessage {
  factory UpdateMeResponse({
    $0.User? user,
  }) {
    final result = UpdateMeResponse._();
    if (user != null) result.user = user;
    return result;
  }

  UpdateMeResponse._();

  factory UpdateMeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateMeResponse()..mergeFromBuffer(data, registry);
  factory UpdateMeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateMeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateMeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateMeResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateMeResponse copyWith(void Function(UpdateMeResponse) updates) =>
      super.copyWith((message) => updates(message as UpdateMeResponse))
          as UpdateMeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UpdateMeResponse() / UpdateMeResponse.new instead')
  static UpdateMeResponse create() => UpdateMeResponse._();
  static $pb.GeneratedMessage $_createMessage() => UpdateMeResponse._();
  @$core.override
  UpdateMeResponse createEmptyInstance() => UpdateMeResponse._();
  @$core.pragma('dart2js:noInline')
  static UpdateMeResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UpdateMeResponse>(
          UpdateMeResponse.$_createMessage);
  static UpdateMeResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);
}

/// Uploading again replaces the icon, so there is no separate replace RPC. The
/// upload is held to what the admin API's icon uploads are: an image/* of at
/// most 10 MiB, cut to a square of at least 128 px. Either refusal is
/// invalid_argument on icon_data, or on icon_crop when the rectangle is at
/// fault.
class UploadMyIconRequest extends $pb.GeneratedMessage {
  factory UploadMyIconRequest({
    $0.TenantContext? tenant,
    $core.List<$core.int>? iconData,
    $core.String? iconContentType,
    $0.ImageCropRect? iconCrop,
  }) {
    final result = UploadMyIconRequest._();
    if (tenant != null) result.tenant = tenant;
    if (iconData != null) result.iconData = iconData;
    if (iconContentType != null) result.iconContentType = iconContentType;
    if (iconCrop != null) result.iconCrop = iconCrop;
    return result;
  }

  UploadMyIconRequest._();

  factory UploadMyIconRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UploadMyIconRequest()..mergeFromBuffer(data, registry);
  factory UploadMyIconRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UploadMyIconRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UploadMyIconRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UploadMyIconRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..a<$core.List<$core.int>>(
        2, _omitFieldNames ? '' : 'iconData', $pb.PbFieldType.OY)
    ..aOS(3, _omitFieldNames ? '' : 'iconContentType')
    ..aOM<$0.ImageCropRect>(4, _omitFieldNames ? '' : 'iconCrop',
        subBuilder: $0.ImageCropRect.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadMyIconRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadMyIconRequest copyWith(void Function(UploadMyIconRequest) updates) =>
      super.copyWith((message) => updates(message as UploadMyIconRequest))
          as UploadMyIconRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use UploadMyIconRequest() / UploadMyIconRequest.new instead')
  static UploadMyIconRequest create() => UploadMyIconRequest._();
  static $pb.GeneratedMessage $_createMessage() => UploadMyIconRequest._();
  @$core.override
  UploadMyIconRequest createEmptyInstance() => UploadMyIconRequest._();
  @$core.pragma('dart2js:noInline')
  static UploadMyIconRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UploadMyIconRequest>(
          UploadMyIconRequest.$_createMessage);
  static UploadMyIconRequest? _defaultInstance;

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
  $core.List<$core.int> get iconData => $_getN(1);
  @$pb.TagNumber(2)
  set iconData($core.List<$core.int> value) => $_setBytes(1, value);
  @$pb.TagNumber(2)
  $core.bool hasIconData() => $_has(1);
  @$pb.TagNumber(2)
  void clearIconData() => $_clearField(2);

  /// Empty is detected from icon_data.
  @$pb.TagNumber(3)
  $core.String get iconContentType => $_getSZ(2);
  @$pb.TagNumber(3)
  set iconContentType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasIconContentType() => $_has(2);
  @$pb.TagNumber(3)
  void clearIconContentType() => $_clearField(3);

  /// Where in the upload the square icon is cut. Omitted, it is cut from the
  /// centre.
  @$pb.TagNumber(4)
  $0.ImageCropRect get iconCrop => $_getN(3);
  @$pb.TagNumber(4)
  set iconCrop($0.ImageCropRect value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasIconCrop() => $_has(3);
  @$pb.TagNumber(4)
  void clearIconCrop() => $_clearField(4);
  @$pb.TagNumber(4)
  $0.ImageCropRect ensureIconCrop() => $_ensure(3);
}

/// The caller's account with the icon it shows now.
class UploadMyIconResponse extends $pb.GeneratedMessage {
  factory UploadMyIconResponse({
    $0.User? user,
  }) {
    final result = UploadMyIconResponse._();
    if (user != null) result.user = user;
    return result;
  }

  UploadMyIconResponse._();

  factory UploadMyIconResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UploadMyIconResponse()..mergeFromBuffer(data, registry);
  factory UploadMyIconResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UploadMyIconResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UploadMyIconResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UploadMyIconResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadMyIconResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UploadMyIconResponse copyWith(void Function(UploadMyIconResponse) updates) =>
      super.copyWith((message) => updates(message as UploadMyIconResponse))
          as UploadMyIconResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UploadMyIconResponse() / UploadMyIconResponse.new instead')
  static UploadMyIconResponse create() => UploadMyIconResponse._();
  static $pb.GeneratedMessage $_createMessage() => UploadMyIconResponse._();
  @$core.override
  UploadMyIconResponse createEmptyInstance() => UploadMyIconResponse._();
  @$core.pragma('dart2js:noInline')
  static UploadMyIconResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UploadMyIconResponse>(
          UploadMyIconResponse.$_createMessage);
  static UploadMyIconResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);
}

/// Leaves the caller's account with no icon. An account that shows none is
/// answered as it is.
class DeleteMyIconRequest extends $pb.GeneratedMessage {
  factory DeleteMyIconRequest({
    $0.TenantContext? tenant,
  }) {
    final result = DeleteMyIconRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  DeleteMyIconRequest._();

  factory DeleteMyIconRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMyIconRequest()..mergeFromBuffer(data, registry);
  factory DeleteMyIconRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMyIconRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteMyIconRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeleteMyIconRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMyIconRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMyIconRequest copyWith(void Function(DeleteMyIconRequest) updates) =>
      super.copyWith((message) => updates(message as DeleteMyIconRequest))
          as DeleteMyIconRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use DeleteMyIconRequest() / DeleteMyIconRequest.new instead')
  static DeleteMyIconRequest create() => DeleteMyIconRequest._();
  static $pb.GeneratedMessage $_createMessage() => DeleteMyIconRequest._();
  @$core.override
  DeleteMyIconRequest createEmptyInstance() => DeleteMyIconRequest._();
  @$core.pragma('dart2js:noInline')
  static DeleteMyIconRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteMyIconRequest>(
          DeleteMyIconRequest.$_createMessage);
  static DeleteMyIconRequest? _defaultInstance;

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

class DeleteMyIconResponse extends $pb.GeneratedMessage {
  factory DeleteMyIconResponse({
    $0.User? user,
  }) {
    final result = DeleteMyIconResponse._();
    if (user != null) result.user = user;
    return result;
  }

  DeleteMyIconResponse._();

  factory DeleteMyIconResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMyIconResponse()..mergeFromBuffer(data, registry);
  factory DeleteMyIconResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMyIconResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteMyIconResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeleteMyIconResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMyIconResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMyIconResponse copyWith(void Function(DeleteMyIconResponse) updates) =>
      super.copyWith((message) => updates(message as DeleteMyIconResponse))
          as DeleteMyIconResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use DeleteMyIconResponse() / DeleteMyIconResponse.new instead')
  static DeleteMyIconResponse create() => DeleteMyIconResponse._();
  static $pb.GeneratedMessage $_createMessage() => DeleteMyIconResponse._();
  @$core.override
  DeleteMyIconResponse createEmptyInstance() => DeleteMyIconResponse._();
  @$core.pragma('dart2js:noInline')
  static DeleteMyIconResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<DeleteMyIconResponse>(
          DeleteMyIconResponse.$_createMessage);
  static DeleteMyIconResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);
}

/// Shows one of the tenant's presets as the caller's icon, in place of the one
/// it showed.
class SelectMyIconRequest extends $pb.GeneratedMessage {
  factory SelectMyIconRequest({
    $0.TenantContext? tenant,
    $core.String? presetId,
  }) {
    final result = SelectMyIconRequest._();
    if (tenant != null) result.tenant = tenant;
    if (presetId != null) result.presetId = presetId;
    return result;
  }

  SelectMyIconRequest._();

  factory SelectMyIconRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SelectMyIconRequest()..mergeFromBuffer(data, registry);
  factory SelectMyIconRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SelectMyIconRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SelectMyIconRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SelectMyIconRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'presetId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SelectMyIconRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SelectMyIconRequest copyWith(void Function(SelectMyIconRequest) updates) =>
      super.copyWith((message) => updates(message as SelectMyIconRequest))
          as SelectMyIconRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core
      .Deprecated('Use SelectMyIconRequest() / SelectMyIconRequest.new instead')
  static SelectMyIconRequest create() => SelectMyIconRequest._();
  static $pb.GeneratedMessage $_createMessage() => SelectMyIconRequest._();
  @$core.override
  SelectMyIconRequest createEmptyInstance() => SelectMyIconRequest._();
  @$core.pragma('dart2js:noInline')
  static SelectMyIconRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SelectMyIconRequest>(
          SelectMyIconRequest.$_createMessage);
  static SelectMyIconRequest? _defaultInstance;

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

  /// A ReaderIconPreset.id from TenantService.GetTenantReaderIconPolicy.
  @$pb.TagNumber(2)
  $core.String get presetId => $_getSZ(1);
  @$pb.TagNumber(2)
  set presetId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPresetId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPresetId() => $_clearField(2);
}

class SelectMyIconResponse extends $pb.GeneratedMessage {
  factory SelectMyIconResponse({
    $0.User? user,
  }) {
    final result = SelectMyIconResponse._();
    if (user != null) result.user = user;
    return result;
  }

  SelectMyIconResponse._();

  factory SelectMyIconResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SelectMyIconResponse()..mergeFromBuffer(data, registry);
  factory SelectMyIconResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SelectMyIconResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SelectMyIconResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SelectMyIconResponse.$_createMessage)
    ..aOM<$0.User>(1, _omitFieldNames ? '' : 'user',
        subBuilder: $0.User.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SelectMyIconResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SelectMyIconResponse copyWith(void Function(SelectMyIconResponse) updates) =>
      super.copyWith((message) => updates(message as SelectMyIconResponse))
          as SelectMyIconResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SelectMyIconResponse() / SelectMyIconResponse.new instead')
  static SelectMyIconResponse create() => SelectMyIconResponse._();
  static $pb.GeneratedMessage $_createMessage() => SelectMyIconResponse._();
  @$core.override
  SelectMyIconResponse createEmptyInstance() => SelectMyIconResponse._();
  @$core.pragma('dart2js:noInline')
  static SelectMyIconResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SelectMyIconResponse>(
          SelectMyIconResponse.$_createMessage);
  static SelectMyIconResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $0.User get user => $_getN(0);
  @$pb.TagNumber(1)
  set user($0.User value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasUser() => $_has(0);
  @$pb.TagNumber(1)
  void clearUser() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.User ensureUser() => $_ensure(0);
}

class DeleteMeRequest extends $pb.GeneratedMessage {
  factory DeleteMeRequest({
    $0.TenantContext? tenant,
    $core.String? password,
    IdentityProvider? provider,
    $core.String? idToken,
    $core.String? nonce,
    $core.String? passkeyCredentialJson,
  }) {
    final result = DeleteMeRequest._();
    if (tenant != null) result.tenant = tenant;
    if (password != null) result.password = password;
    if (provider != null) result.provider = provider;
    if (idToken != null) result.idToken = idToken;
    if (nonce != null) result.nonce = nonce;
    if (passkeyCredentialJson != null)
      result.passkeyCredentialJson = passkeyCredentialJson;
    return result;
  }

  DeleteMeRequest._();

  factory DeleteMeRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMeRequest()..mergeFromBuffer(data, registry);
  factory DeleteMeRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMeRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteMeRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeleteMeRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'password')
    ..aE<IdentityProvider>(3, _omitFieldNames ? '' : 'provider',
        enumValues: IdentityProvider.values)
    ..aOS(4, _omitFieldNames ? '' : 'idToken')
    ..aOS(5, _omitFieldNames ? '' : 'nonce')
    ..aOS(6, _omitFieldNames ? '' : 'passkeyCredentialJson')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMeRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMeRequest copyWith(void Function(DeleteMeRequest) updates) =>
      super.copyWith((message) => updates(message as DeleteMeRequest))
          as DeleteMeRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use DeleteMeRequest() / DeleteMeRequest.new instead')
  static DeleteMeRequest create() => DeleteMeRequest._();
  static $pb.GeneratedMessage $_createMessage() => DeleteMeRequest._();
  @$core.override
  DeleteMeRequest createEmptyInstance() => DeleteMeRequest._();
  @$core.pragma('dart2js:noInline')
  static DeleteMeRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<DeleteMeRequest>(
          DeleteMeRequest.$_createMessage);
  static DeleteMeRequest? _defaultInstance;

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

  /// The account's password. An account without one confirms with a fresh
  /// sign-in instead, as RequestEmailChangeRequest describes: an ID token and
  /// its nonce from a provider linked to the account, or an assertion made
  /// with one of its passkeys.
  @$pb.TagNumber(2)
  $core.String get password => $_getSZ(1);
  @$pb.TagNumber(2)
  set password($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPassword() => $_has(1);
  @$pb.TagNumber(2)
  void clearPassword() => $_clearField(2);

  @$pb.TagNumber(3)
  IdentityProvider get provider => $_getN(2);
  @$pb.TagNumber(3)
  set provider(IdentityProvider value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasProvider() => $_has(2);
  @$pb.TagNumber(3)
  void clearProvider() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get idToken => $_getSZ(3);
  @$pb.TagNumber(4)
  set idToken($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIdToken() => $_has(3);
  @$pb.TagNumber(4)
  void clearIdToken() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get nonce => $_getSZ(4);
  @$pb.TagNumber(5)
  set nonce($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasNonce() => $_has(4);
  @$pb.TagNumber(5)
  void clearNonce() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get passkeyCredentialJson => $_getSZ(5);
  @$pb.TagNumber(6)
  set passkeyCredentialJson($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasPasskeyCredentialJson() => $_has(5);
  @$pb.TagNumber(6)
  void clearPasskeyCredentialJson() => $_clearField(6);
}

class DeleteMeResponse extends $pb.GeneratedMessage {
  factory DeleteMeResponse() => DeleteMeResponse._();

  DeleteMeResponse._();

  factory DeleteMeResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMeResponse()..mergeFromBuffer(data, registry);
  factory DeleteMeResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      DeleteMeResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'DeleteMeResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: DeleteMeResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMeResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  DeleteMeResponse copyWith(void Function(DeleteMeResponse) updates) =>
      super.copyWith((message) => updates(message as DeleteMeResponse))
          as DeleteMeResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use DeleteMeResponse() / DeleteMeResponse.new instead')
  static DeleteMeResponse create() => DeleteMeResponse._();
  static $pb.GeneratedMessage $_createMessage() => DeleteMeResponse._();
  @$core.override
  DeleteMeResponse createEmptyInstance() => DeleteMeResponse._();
  @$core.pragma('dart2js:noInline')
  static DeleteMeResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<DeleteMeResponse>(
          DeleteMeResponse.$_createMessage);
  static DeleteMeResponse? _defaultInstance;
}

class GetNotificationSettingsRequest extends $pb.GeneratedMessage {
  factory GetNotificationSettingsRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetNotificationSettingsRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetNotificationSettingsRequest._();

  factory GetNotificationSettingsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetNotificationSettingsRequest()..mergeFromBuffer(data, registry);
  factory GetNotificationSettingsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetNotificationSettingsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNotificationSettingsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetNotificationSettingsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationSettingsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationSettingsRequest copyWith(
          void Function(GetNotificationSettingsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetNotificationSettingsRequest))
          as GetNotificationSettingsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetNotificationSettingsRequest() / GetNotificationSettingsRequest.new instead')
  static GetNotificationSettingsRequest create() =>
      GetNotificationSettingsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetNotificationSettingsRequest._();
  @$core.override
  GetNotificationSettingsRequest createEmptyInstance() =>
      GetNotificationSettingsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetNotificationSettingsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNotificationSettingsRequest>(
          GetNotificationSettingsRequest.$_createMessage);
  static GetNotificationSettingsRequest? _defaultInstance;

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

class GetNotificationSettingsResponse extends $pb.GeneratedMessage {
  factory GetNotificationSettingsResponse({
    $core.bool? emailNotificationsEnabled,
  }) {
    final result = GetNotificationSettingsResponse._();
    if (emailNotificationsEnabled != null)
      result.emailNotificationsEnabled = emailNotificationsEnabled;
    return result;
  }

  GetNotificationSettingsResponse._();

  factory GetNotificationSettingsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetNotificationSettingsResponse()..mergeFromBuffer(data, registry);
  factory GetNotificationSettingsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetNotificationSettingsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetNotificationSettingsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetNotificationSettingsResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'emailNotificationsEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationSettingsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetNotificationSettingsResponse copyWith(
          void Function(GetNotificationSettingsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetNotificationSettingsResponse))
          as GetNotificationSettingsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetNotificationSettingsResponse() / GetNotificationSettingsResponse.new instead')
  static GetNotificationSettingsResponse create() =>
      GetNotificationSettingsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetNotificationSettingsResponse._();
  @$core.override
  GetNotificationSettingsResponse createEmptyInstance() =>
      GetNotificationSettingsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetNotificationSettingsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetNotificationSettingsResponse>(
          GetNotificationSettingsResponse.$_createMessage);
  static GetNotificationSettingsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get emailNotificationsEnabled => $_getBF(0);
  @$pb.TagNumber(1)
  set emailNotificationsEnabled($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEmailNotificationsEnabled() => $_has(0);
  @$pb.TagNumber(1)
  void clearEmailNotificationsEnabled() => $_clearField(1);
}

class UpdateNotificationSettingsRequest extends $pb.GeneratedMessage {
  factory UpdateNotificationSettingsRequest({
    $0.TenantContext? tenant,
    $core.bool? emailNotificationsEnabled,
  }) {
    final result = UpdateNotificationSettingsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (emailNotificationsEnabled != null)
      result.emailNotificationsEnabled = emailNotificationsEnabled;
    return result;
  }

  UpdateNotificationSettingsRequest._();

  factory UpdateNotificationSettingsRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateNotificationSettingsRequest()..mergeFromBuffer(data, registry);
  factory UpdateNotificationSettingsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateNotificationSettingsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateNotificationSettingsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateNotificationSettingsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOB(2, _omitFieldNames ? '' : 'emailNotificationsEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationSettingsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationSettingsRequest copyWith(
          void Function(UpdateNotificationSettingsRequest) updates) =>
      super.copyWith((message) =>
              updates(message as UpdateNotificationSettingsRequest))
          as UpdateNotificationSettingsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UpdateNotificationSettingsRequest() / UpdateNotificationSettingsRequest.new instead')
  static UpdateNotificationSettingsRequest create() =>
      UpdateNotificationSettingsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      UpdateNotificationSettingsRequest._();
  @$core.override
  UpdateNotificationSettingsRequest createEmptyInstance() =>
      UpdateNotificationSettingsRequest._();
  @$core.pragma('dart2js:noInline')
  static UpdateNotificationSettingsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateNotificationSettingsRequest>(
          UpdateNotificationSettingsRequest.$_createMessage);
  static UpdateNotificationSettingsRequest? _defaultInstance;

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
  $core.bool get emailNotificationsEnabled => $_getBF(1);
  @$pb.TagNumber(2)
  set emailNotificationsEnabled($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEmailNotificationsEnabled() => $_has(1);
  @$pb.TagNumber(2)
  void clearEmailNotificationsEnabled() => $_clearField(2);
}

class UpdateNotificationSettingsResponse extends $pb.GeneratedMessage {
  factory UpdateNotificationSettingsResponse({
    $core.bool? emailNotificationsEnabled,
  }) {
    final result = UpdateNotificationSettingsResponse._();
    if (emailNotificationsEnabled != null)
      result.emailNotificationsEnabled = emailNotificationsEnabled;
    return result;
  }

  UpdateNotificationSettingsResponse._();

  factory UpdateNotificationSettingsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateNotificationSettingsResponse()..mergeFromBuffer(data, registry);
  factory UpdateNotificationSettingsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateNotificationSettingsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateNotificationSettingsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateNotificationSettingsResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'emailNotificationsEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationSettingsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateNotificationSettingsResponse copyWith(
          void Function(UpdateNotificationSettingsResponse) updates) =>
      super.copyWith((message) =>
              updates(message as UpdateNotificationSettingsResponse))
          as UpdateNotificationSettingsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UpdateNotificationSettingsResponse() / UpdateNotificationSettingsResponse.new instead')
  static UpdateNotificationSettingsResponse create() =>
      UpdateNotificationSettingsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      UpdateNotificationSettingsResponse._();
  @$core.override
  UpdateNotificationSettingsResponse createEmptyInstance() =>
      UpdateNotificationSettingsResponse._();
  @$core.pragma('dart2js:noInline')
  static UpdateNotificationSettingsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateNotificationSettingsResponse>(
          UpdateNotificationSettingsResponse.$_createMessage);
  static UpdateNotificationSettingsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get emailNotificationsEnabled => $_getBF(0);
  @$pb.TagNumber(1)
  set emailNotificationsEnabled($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasEmailNotificationsEnabled() => $_has(0);
  @$pb.TagNumber(1)
  void clearEmailNotificationsEnabled() => $_clearField(1);
}

/// A reader's own choices about how the viewer is laid out, stored against the
/// account so the choice follows them to the next device. Every field carries a
/// value: a reader who has saved nothing reads the defaults rather than an
/// absent message, so a client never has to tell "unset" from "off".
///
/// The next viewer setting is a field here and a column behind it, not a second
/// pair of RPCs.
class ViewerPreferences extends $pb.GeneratedMessage {
  factory ViewerPreferences({
    $core.bool? wideViewerEnabled,
  }) {
    final result = ViewerPreferences._();
    if (wideViewerEnabled != null) result.wideViewerEnabled = wideViewerEnabled;
    return result;
  }

  ViewerPreferences._();

  factory ViewerPreferences.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ViewerPreferences()..mergeFromBuffer(data, registry);
  factory ViewerPreferences.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ViewerPreferences()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ViewerPreferences',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ViewerPreferences.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'wideViewerEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ViewerPreferences clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ViewerPreferences copyWith(void Function(ViewerPreferences) updates) =>
      super.copyWith((message) => updates(message as ViewerPreferences))
          as ViewerPreferences;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use ViewerPreferences() / ViewerPreferences.new instead')
  static ViewerPreferences create() => ViewerPreferences._();
  static $pb.GeneratedMessage $_createMessage() => ViewerPreferences._();
  @$core.override
  ViewerPreferences createEmptyInstance() => ViewerPreferences._();
  @$core.pragma('dart2js:noInline')
  static ViewerPreferences getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ViewerPreferences>(
          ViewerPreferences.$_createMessage);
  static ViewerPreferences? _defaultInstance;

  /// The viewer takes the full window width.
  @$pb.TagNumber(1)
  $core.bool get wideViewerEnabled => $_getBF(0);
  @$pb.TagNumber(1)
  set wideViewerEnabled($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasWideViewerEnabled() => $_has(0);
  @$pb.TagNumber(1)
  void clearWideViewerEnabled() => $_clearField(1);
}

class GetViewerPreferencesRequest extends $pb.GeneratedMessage {
  factory GetViewerPreferencesRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetViewerPreferencesRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetViewerPreferencesRequest._();

  factory GetViewerPreferencesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetViewerPreferencesRequest()..mergeFromBuffer(data, registry);
  factory GetViewerPreferencesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetViewerPreferencesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetViewerPreferencesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetViewerPreferencesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetViewerPreferencesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetViewerPreferencesRequest copyWith(
          void Function(GetViewerPreferencesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetViewerPreferencesRequest))
          as GetViewerPreferencesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetViewerPreferencesRequest() / GetViewerPreferencesRequest.new instead')
  static GetViewerPreferencesRequest create() =>
      GetViewerPreferencesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetViewerPreferencesRequest._();
  @$core.override
  GetViewerPreferencesRequest createEmptyInstance() =>
      GetViewerPreferencesRequest._();
  @$core.pragma('dart2js:noInline')
  static GetViewerPreferencesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetViewerPreferencesRequest>(
          GetViewerPreferencesRequest.$_createMessage);
  static GetViewerPreferencesRequest? _defaultInstance;

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

class GetViewerPreferencesResponse extends $pb.GeneratedMessage {
  factory GetViewerPreferencesResponse({
    ViewerPreferences? preferences,
  }) {
    final result = GetViewerPreferencesResponse._();
    if (preferences != null) result.preferences = preferences;
    return result;
  }

  GetViewerPreferencesResponse._();

  factory GetViewerPreferencesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetViewerPreferencesResponse()..mergeFromBuffer(data, registry);
  factory GetViewerPreferencesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetViewerPreferencesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetViewerPreferencesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetViewerPreferencesResponse.$_createMessage)
    ..aOM<ViewerPreferences>(1, _omitFieldNames ? '' : 'preferences',
        subBuilder: ViewerPreferences.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetViewerPreferencesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetViewerPreferencesResponse copyWith(
          void Function(GetViewerPreferencesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetViewerPreferencesResponse))
          as GetViewerPreferencesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetViewerPreferencesResponse() / GetViewerPreferencesResponse.new instead')
  static GetViewerPreferencesResponse create() =>
      GetViewerPreferencesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetViewerPreferencesResponse._();
  @$core.override
  GetViewerPreferencesResponse createEmptyInstance() =>
      GetViewerPreferencesResponse._();
  @$core.pragma('dart2js:noInline')
  static GetViewerPreferencesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetViewerPreferencesResponse>(
          GetViewerPreferencesResponse.$_createMessage);
  static GetViewerPreferencesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ViewerPreferences get preferences => $_getN(0);
  @$pb.TagNumber(1)
  set preferences(ViewerPreferences value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPreferences() => $_has(0);
  @$pb.TagNumber(1)
  void clearPreferences() => $_clearField(1);
  @$pb.TagNumber(1)
  ViewerPreferences ensurePreferences() => $_ensure(0);
}

class UpdateViewerPreferencesRequest extends $pb.GeneratedMessage {
  factory UpdateViewerPreferencesRequest({
    $0.TenantContext? tenant,
    $core.bool? wideViewerEnabled,
  }) {
    final result = UpdateViewerPreferencesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (wideViewerEnabled != null) result.wideViewerEnabled = wideViewerEnabled;
    return result;
  }

  UpdateViewerPreferencesRequest._();

  factory UpdateViewerPreferencesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateViewerPreferencesRequest()..mergeFromBuffer(data, registry);
  factory UpdateViewerPreferencesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateViewerPreferencesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateViewerPreferencesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateViewerPreferencesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOB(2, _omitFieldNames ? '' : 'wideViewerEnabled')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateViewerPreferencesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateViewerPreferencesRequest copyWith(
          void Function(UpdateViewerPreferencesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as UpdateViewerPreferencesRequest))
          as UpdateViewerPreferencesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UpdateViewerPreferencesRequest() / UpdateViewerPreferencesRequest.new instead')
  static UpdateViewerPreferencesRequest create() =>
      UpdateViewerPreferencesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      UpdateViewerPreferencesRequest._();
  @$core.override
  UpdateViewerPreferencesRequest createEmptyInstance() =>
      UpdateViewerPreferencesRequest._();
  @$core.pragma('dart2js:noInline')
  static UpdateViewerPreferencesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateViewerPreferencesRequest>(
          UpdateViewerPreferencesRequest.$_createMessage);
  static UpdateViewerPreferencesRequest? _defaultInstance;

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

  /// Omitted preferences keep the stored value, so a viewer writing the one
  /// control the reader pressed does not reset the ones it knows nothing about
  /// (proto3 non-optional bool maps an omitted field to false).
  @$pb.TagNumber(2)
  $core.bool get wideViewerEnabled => $_getBF(1);
  @$pb.TagNumber(2)
  set wideViewerEnabled($core.bool value) => $_setBool(1, value);
  @$pb.TagNumber(2)
  $core.bool hasWideViewerEnabled() => $_has(1);
  @$pb.TagNumber(2)
  void clearWideViewerEnabled() => $_clearField(2);
}

class UpdateViewerPreferencesResponse extends $pb.GeneratedMessage {
  factory UpdateViewerPreferencesResponse({
    ViewerPreferences? preferences,
  }) {
    final result = UpdateViewerPreferencesResponse._();
    if (preferences != null) result.preferences = preferences;
    return result;
  }

  UpdateViewerPreferencesResponse._();

  factory UpdateViewerPreferencesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateViewerPreferencesResponse()..mergeFromBuffer(data, registry);
  factory UpdateViewerPreferencesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UpdateViewerPreferencesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UpdateViewerPreferencesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UpdateViewerPreferencesResponse.$_createMessage)
    ..aOM<ViewerPreferences>(1, _omitFieldNames ? '' : 'preferences',
        subBuilder: ViewerPreferences.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateViewerPreferencesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UpdateViewerPreferencesResponse copyWith(
          void Function(UpdateViewerPreferencesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as UpdateViewerPreferencesResponse))
          as UpdateViewerPreferencesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UpdateViewerPreferencesResponse() / UpdateViewerPreferencesResponse.new instead')
  static UpdateViewerPreferencesResponse create() =>
      UpdateViewerPreferencesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      UpdateViewerPreferencesResponse._();
  @$core.override
  UpdateViewerPreferencesResponse createEmptyInstance() =>
      UpdateViewerPreferencesResponse._();
  @$core.pragma('dart2js:noInline')
  static UpdateViewerPreferencesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UpdateViewerPreferencesResponse>(
          UpdateViewerPreferencesResponse.$_createMessage);
  static UpdateViewerPreferencesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  ViewerPreferences get preferences => $_getN(0);
  @$pb.TagNumber(1)
  set preferences(ViewerPreferences value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPreferences() => $_has(0);
  @$pb.TagNumber(1)
  void clearPreferences() => $_clearField(1);
  @$pb.TagNumber(1)
  ViewerPreferences ensurePreferences() => $_ensure(0);
}

class AnnouncementItem extends $pb.GeneratedMessage {
  factory AnnouncementItem({
    $core.String? id,
    $core.String? announcementType,
    $core.String? title,
    $core.String? body,
    $core.String? linkUrl,
    $core.bool? isRead,
    $core.String? readAt,
    $core.String? createdAt,
    $core.bool? pinned,
    $core.String? pinnedUntil,
  }) {
    final result = AnnouncementItem._();
    if (id != null) result.id = id;
    if (announcementType != null) result.announcementType = announcementType;
    if (title != null) result.title = title;
    if (body != null) result.body = body;
    if (linkUrl != null) result.linkUrl = linkUrl;
    if (isRead != null) result.isRead = isRead;
    if (readAt != null) result.readAt = readAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (pinned != null) result.pinned = pinned;
    if (pinnedUntil != null) result.pinnedUntil = pinnedUntil;
    return result;
  }

  AnnouncementItem._();

  factory AnnouncementItem.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AnnouncementItem()..mergeFromBuffer(data, registry);
  factory AnnouncementItem.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AnnouncementItem()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AnnouncementItem',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: AnnouncementItem.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'announcementType')
    ..aOS(3, _omitFieldNames ? '' : 'title')
    ..aOS(4, _omitFieldNames ? '' : 'body')
    ..aOS(5, _omitFieldNames ? '' : 'linkUrl')
    ..aOB(6, _omitFieldNames ? '' : 'isRead')
    ..aOS(7, _omitFieldNames ? '' : 'readAt')
    ..aOS(8, _omitFieldNames ? '' : 'createdAt')
    ..aOB(9, _omitFieldNames ? '' : 'pinned')
    ..aOS(10, _omitFieldNames ? '' : 'pinnedUntil')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AnnouncementItem clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AnnouncementItem copyWith(void Function(AnnouncementItem) updates) =>
      super.copyWith((message) => updates(message as AnnouncementItem))
          as AnnouncementItem;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use AnnouncementItem() / AnnouncementItem.new instead')
  static AnnouncementItem create() => AnnouncementItem._();
  static $pb.GeneratedMessage $_createMessage() => AnnouncementItem._();
  @$core.override
  AnnouncementItem createEmptyInstance() => AnnouncementItem._();
  @$core.pragma('dart2js:noInline')
  static AnnouncementItem getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AnnouncementItem>(
          AnnouncementItem.$_createMessage);
  static AnnouncementItem? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get announcementType => $_getSZ(1);
  @$pb.TagNumber(2)
  set announcementType($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAnnouncementType() => $_has(1);
  @$pb.TagNumber(2)
  void clearAnnouncementType() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get title => $_getSZ(2);
  @$pb.TagNumber(3)
  set title($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearTitle() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get body => $_getSZ(3);
  @$pb.TagNumber(4)
  set body($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBody() => $_has(3);
  @$pb.TagNumber(4)
  void clearBody() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get linkUrl => $_getSZ(4);
  @$pb.TagNumber(5)
  set linkUrl($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLinkUrl() => $_has(4);
  @$pb.TagNumber(5)
  void clearLinkUrl() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.bool get isRead => $_getBF(5);
  @$pb.TagNumber(6)
  set isRead($core.bool value) => $_setBool(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIsRead() => $_has(5);
  @$pb.TagNumber(6)
  void clearIsRead() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get readAt => $_getSZ(6);
  @$pb.TagNumber(7)
  set readAt($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasReadAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearReadAt() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get createdAt => $_getSZ(7);
  @$pb.TagNumber(8)
  set createdAt($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);

  /// Whether the site shows this announcement as a banner above every page.
  @$pb.TagNumber(9)
  $core.bool get pinned => $_getBF(8);
  @$pb.TagNumber(9)
  set pinned($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPinned() => $_has(8);
  @$pb.TagNumber(9)
  void clearPinned() => $_clearField(9);

  /// RFC 3339 instant the banner stops at. Empty leaves it up until the console
  /// takes it down.
  @$pb.TagNumber(10)
  $core.String get pinnedUntil => $_getSZ(9);
  @$pb.TagNumber(10)
  set pinnedUntil($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasPinnedUntil() => $_has(9);
  @$pb.TagNumber(10)
  void clearPinnedUntil() => $_clearField(10);
}

/// What the site shows as a banner above every page: the newest tenant-wide
/// announcement still inside its pinned window. It carries no session, because
/// an announcement is the tenant's word to everyone who opens the site.
class GetPinnedAnnouncementRequest extends $pb.GeneratedMessage {
  factory GetPinnedAnnouncementRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetPinnedAnnouncementRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetPinnedAnnouncementRequest._();

  factory GetPinnedAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPinnedAnnouncementRequest()..mergeFromBuffer(data, registry);
  factory GetPinnedAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPinnedAnnouncementRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPinnedAnnouncementRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPinnedAnnouncementRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPinnedAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPinnedAnnouncementRequest copyWith(
          void Function(GetPinnedAnnouncementRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetPinnedAnnouncementRequest))
          as GetPinnedAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPinnedAnnouncementRequest() / GetPinnedAnnouncementRequest.new instead')
  static GetPinnedAnnouncementRequest create() =>
      GetPinnedAnnouncementRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPinnedAnnouncementRequest._();
  @$core.override
  GetPinnedAnnouncementRequest createEmptyInstance() =>
      GetPinnedAnnouncementRequest._();
  @$core.pragma('dart2js:noInline')
  static GetPinnedAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPinnedAnnouncementRequest>(
          GetPinnedAnnouncementRequest.$_createMessage);
  static GetPinnedAnnouncementRequest? _defaultInstance;

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

class GetPinnedAnnouncementResponse extends $pb.GeneratedMessage {
  factory GetPinnedAnnouncementResponse({
    AnnouncementItem? announcement,
  }) {
    final result = GetPinnedAnnouncementResponse._();
    if (announcement != null) result.announcement = announcement;
    return result;
  }

  GetPinnedAnnouncementResponse._();

  factory GetPinnedAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPinnedAnnouncementResponse()..mergeFromBuffer(data, registry);
  factory GetPinnedAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetPinnedAnnouncementResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetPinnedAnnouncementResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetPinnedAnnouncementResponse.$_createMessage)
    ..aOM<AnnouncementItem>(1, _omitFieldNames ? '' : 'announcement',
        subBuilder: AnnouncementItem.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPinnedAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetPinnedAnnouncementResponse copyWith(
          void Function(GetPinnedAnnouncementResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetPinnedAnnouncementResponse))
          as GetPinnedAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetPinnedAnnouncementResponse() / GetPinnedAnnouncementResponse.new instead')
  static GetPinnedAnnouncementResponse create() =>
      GetPinnedAnnouncementResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetPinnedAnnouncementResponse._();
  @$core.override
  GetPinnedAnnouncementResponse createEmptyInstance() =>
      GetPinnedAnnouncementResponse._();
  @$core.pragma('dart2js:noInline')
  static GetPinnedAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetPinnedAnnouncementResponse>(
          GetPinnedAnnouncementResponse.$_createMessage);
  static GetPinnedAnnouncementResponse? _defaultInstance;

  /// Unset when the tenant has nothing pinned right now.
  @$pb.TagNumber(1)
  AnnouncementItem get announcement => $_getN(0);
  @$pb.TagNumber(1)
  set announcement(AnnouncementItem value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncement() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncement() => $_clearField(1);
  @$pb.TagNumber(1)
  AnnouncementItem ensureAnnouncement() => $_ensure(0);
}

/// Get-by-id. A signed-in reader gets their own row with its read state; a
/// caller with no session gets the tenant-wide row with none. Missing,
/// other-user, and other-tenant rows are the same not_found.
class GetAnnouncementRequest extends $pb.GeneratedMessage {
  factory GetAnnouncementRequest({
    $0.TenantContext? tenant,
    $core.String? announcementId,
  }) {
    final result = GetAnnouncementRequest._();
    if (tenant != null) result.tenant = tenant;
    if (announcementId != null) result.announcementId = announcementId;
    return result;
  }

  GetAnnouncementRequest._();

  factory GetAnnouncementRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetAnnouncementRequest()..mergeFromBuffer(data, registry);
  factory GetAnnouncementRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetAnnouncementRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetAnnouncementRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'announcementId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementRequest copyWith(
          void Function(GetAnnouncementRequest) updates) =>
      super.copyWith((message) => updates(message as GetAnnouncementRequest))
          as GetAnnouncementRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetAnnouncementRequest() / GetAnnouncementRequest.new instead')
  static GetAnnouncementRequest create() => GetAnnouncementRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetAnnouncementRequest._();
  @$core.override
  GetAnnouncementRequest createEmptyInstance() => GetAnnouncementRequest._();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementRequest>(
          GetAnnouncementRequest.$_createMessage);
  static GetAnnouncementRequest? _defaultInstance;

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
  $core.String get announcementId => $_getSZ(1);
  @$pb.TagNumber(2)
  set announcementId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAnnouncementId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAnnouncementId() => $_clearField(2);
}

class GetAnnouncementResponse extends $pb.GeneratedMessage {
  factory GetAnnouncementResponse({
    AnnouncementItem? announcement,
  }) {
    final result = GetAnnouncementResponse._();
    if (announcement != null) result.announcement = announcement;
    return result;
  }

  GetAnnouncementResponse._();

  factory GetAnnouncementResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetAnnouncementResponse()..mergeFromBuffer(data, registry);
  factory GetAnnouncementResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetAnnouncementResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetAnnouncementResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetAnnouncementResponse.$_createMessage)
    ..aOM<AnnouncementItem>(1, _omitFieldNames ? '' : 'announcement',
        subBuilder: AnnouncementItem.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetAnnouncementResponse copyWith(
          void Function(GetAnnouncementResponse) updates) =>
      super.copyWith((message) => updates(message as GetAnnouncementResponse))
          as GetAnnouncementResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetAnnouncementResponse() / GetAnnouncementResponse.new instead')
  static GetAnnouncementResponse create() => GetAnnouncementResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetAnnouncementResponse._();
  @$core.override
  GetAnnouncementResponse createEmptyInstance() => GetAnnouncementResponse._();
  @$core.pragma('dart2js:noInline')
  static GetAnnouncementResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetAnnouncementResponse>(
          GetAnnouncementResponse.$_createMessage);
  static GetAnnouncementResponse? _defaultInstance;

  @$pb.TagNumber(1)
  AnnouncementItem get announcement => $_getN(0);
  @$pb.TagNumber(1)
  set announcement(AnnouncementItem value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAnnouncement() => $_has(0);
  @$pb.TagNumber(1)
  void clearAnnouncement() => $_clearField(1);
  @$pb.TagNumber(1)
  AnnouncementItem ensureAnnouncement() => $_ensure(0);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListAnnouncementsRequest extends $pb.GeneratedMessage {
  factory ListAnnouncementsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
  }) {
    final result = ListAnnouncementsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    return result;
  }

  ListAnnouncementsRequest._();

  factory ListAnnouncementsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListAnnouncementsRequest()..mergeFromBuffer(data, registry);
  factory ListAnnouncementsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListAnnouncementsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAnnouncementsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListAnnouncementsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsRequest copyWith(
          void Function(ListAnnouncementsRequest) updates) =>
      super.copyWith((message) => updates(message as ListAnnouncementsRequest))
          as ListAnnouncementsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListAnnouncementsRequest() / ListAnnouncementsRequest.new instead')
  static ListAnnouncementsRequest create() => ListAnnouncementsRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListAnnouncementsRequest._();
  @$core.override
  ListAnnouncementsRequest createEmptyInstance() =>
      ListAnnouncementsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAnnouncementsRequest>(
          ListAnnouncementsRequest.$_createMessage);
  static ListAnnouncementsRequest? _defaultInstance;

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
}

class ListAnnouncementsResponse extends $pb.GeneratedMessage {
  factory ListAnnouncementsResponse({
    $core.Iterable<AnnouncementItem>? announcements,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListAnnouncementsResponse._();
    if (announcements != null) result.announcements.addAll(announcements);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListAnnouncementsResponse._();

  factory ListAnnouncementsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListAnnouncementsResponse()..mergeFromBuffer(data, registry);
  factory ListAnnouncementsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListAnnouncementsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListAnnouncementsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListAnnouncementsResponse.$_createMessage)
    ..pPM<AnnouncementItem>(1, _omitFieldNames ? '' : 'announcements',
        subBuilder: AnnouncementItem.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListAnnouncementsResponse copyWith(
          void Function(ListAnnouncementsResponse) updates) =>
      super.copyWith((message) => updates(message as ListAnnouncementsResponse))
          as ListAnnouncementsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListAnnouncementsResponse() / ListAnnouncementsResponse.new instead')
  static ListAnnouncementsResponse create() => ListAnnouncementsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListAnnouncementsResponse._();
  @$core.override
  ListAnnouncementsResponse createEmptyInstance() =>
      ListAnnouncementsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListAnnouncementsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListAnnouncementsResponse>(
          ListAnnouncementsResponse.$_createMessage);
  static ListAnnouncementsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<AnnouncementItem> get announcements => $_getList(0);

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

class MarkAnnouncementAsReadRequest extends $pb.GeneratedMessage {
  factory MarkAnnouncementAsReadRequest({
    $0.TenantContext? tenant,
    $core.String? announcementId,
  }) {
    final result = MarkAnnouncementAsReadRequest._();
    if (tenant != null) result.tenant = tenant;
    if (announcementId != null) result.announcementId = announcementId;
    return result;
  }

  MarkAnnouncementAsReadRequest._();

  factory MarkAnnouncementAsReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAnnouncementAsReadRequest()..mergeFromBuffer(data, registry);
  factory MarkAnnouncementAsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAnnouncementAsReadRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAnnouncementAsReadRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAnnouncementAsReadRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'announcementId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementAsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementAsReadRequest copyWith(
          void Function(MarkAnnouncementAsReadRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAnnouncementAsReadRequest))
          as MarkAnnouncementAsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAnnouncementAsReadRequest() / MarkAnnouncementAsReadRequest.new instead')
  static MarkAnnouncementAsReadRequest create() =>
      MarkAnnouncementAsReadRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAnnouncementAsReadRequest._();
  @$core.override
  MarkAnnouncementAsReadRequest createEmptyInstance() =>
      MarkAnnouncementAsReadRequest._();
  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementAsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAnnouncementAsReadRequest>(
          MarkAnnouncementAsReadRequest.$_createMessage);
  static MarkAnnouncementAsReadRequest? _defaultInstance;

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
  $core.String get announcementId => $_getSZ(1);
  @$pb.TagNumber(2)
  set announcementId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasAnnouncementId() => $_has(1);
  @$pb.TagNumber(2)
  void clearAnnouncementId() => $_clearField(2);
}

class MarkAnnouncementAsReadResponse extends $pb.GeneratedMessage {
  factory MarkAnnouncementAsReadResponse({
    $core.bool? marked,
  }) {
    final result = MarkAnnouncementAsReadResponse._();
    if (marked != null) result.marked = marked;
    return result;
  }

  MarkAnnouncementAsReadResponse._();

  factory MarkAnnouncementAsReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAnnouncementAsReadResponse()..mergeFromBuffer(data, registry);
  factory MarkAnnouncementAsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAnnouncementAsReadResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAnnouncementAsReadResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAnnouncementAsReadResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'marked')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementAsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAnnouncementAsReadResponse copyWith(
          void Function(MarkAnnouncementAsReadResponse) updates) =>
      super.copyWith(
              (message) => updates(message as MarkAnnouncementAsReadResponse))
          as MarkAnnouncementAsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAnnouncementAsReadResponse() / MarkAnnouncementAsReadResponse.new instead')
  static MarkAnnouncementAsReadResponse create() =>
      MarkAnnouncementAsReadResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAnnouncementAsReadResponse._();
  @$core.override
  MarkAnnouncementAsReadResponse createEmptyInstance() =>
      MarkAnnouncementAsReadResponse._();
  @$core.pragma('dart2js:noInline')
  static MarkAnnouncementAsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAnnouncementAsReadResponse>(
          MarkAnnouncementAsReadResponse.$_createMessage);
  static MarkAnnouncementAsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get marked => $_getBF(0);
  @$pb.TagNumber(1)
  set marked($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMarked() => $_has(0);
  @$pb.TagNumber(1)
  void clearMarked() => $_clearField(1);
}

class MarkAllAnnouncementsAsReadRequest extends $pb.GeneratedMessage {
  factory MarkAllAnnouncementsAsReadRequest({
    $0.TenantContext? tenant,
  }) {
    final result = MarkAllAnnouncementsAsReadRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  MarkAllAnnouncementsAsReadRequest._();

  factory MarkAllAnnouncementsAsReadRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllAnnouncementsAsReadRequest()..mergeFromBuffer(data, registry);
  factory MarkAllAnnouncementsAsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllAnnouncementsAsReadRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllAnnouncementsAsReadRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAllAnnouncementsAsReadRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllAnnouncementsAsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllAnnouncementsAsReadRequest copyWith(
          void Function(MarkAllAnnouncementsAsReadRequest) updates) =>
      super.copyWith((message) =>
              updates(message as MarkAllAnnouncementsAsReadRequest))
          as MarkAllAnnouncementsAsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAllAnnouncementsAsReadRequest() / MarkAllAnnouncementsAsReadRequest.new instead')
  static MarkAllAnnouncementsAsReadRequest create() =>
      MarkAllAnnouncementsAsReadRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAllAnnouncementsAsReadRequest._();
  @$core.override
  MarkAllAnnouncementsAsReadRequest createEmptyInstance() =>
      MarkAllAnnouncementsAsReadRequest._();
  @$core.pragma('dart2js:noInline')
  static MarkAllAnnouncementsAsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllAnnouncementsAsReadRequest>(
          MarkAllAnnouncementsAsReadRequest.$_createMessage);
  static MarkAllAnnouncementsAsReadRequest? _defaultInstance;

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

class MarkAllAnnouncementsAsReadResponse extends $pb.GeneratedMessage {
  factory MarkAllAnnouncementsAsReadResponse({
    $core.int? markedCount,
  }) {
    final result = MarkAllAnnouncementsAsReadResponse._();
    if (markedCount != null) result.markedCount = markedCount;
    return result;
  }

  MarkAllAnnouncementsAsReadResponse._();

  factory MarkAllAnnouncementsAsReadResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllAnnouncementsAsReadResponse()..mergeFromBuffer(data, registry);
  factory MarkAllAnnouncementsAsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllAnnouncementsAsReadResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllAnnouncementsAsReadResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAllAnnouncementsAsReadResponse.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'markedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllAnnouncementsAsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllAnnouncementsAsReadResponse copyWith(
          void Function(MarkAllAnnouncementsAsReadResponse) updates) =>
      super.copyWith((message) =>
              updates(message as MarkAllAnnouncementsAsReadResponse))
          as MarkAllAnnouncementsAsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAllAnnouncementsAsReadResponse() / MarkAllAnnouncementsAsReadResponse.new instead')
  static MarkAllAnnouncementsAsReadResponse create() =>
      MarkAllAnnouncementsAsReadResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAllAnnouncementsAsReadResponse._();
  @$core.override
  MarkAllAnnouncementsAsReadResponse createEmptyInstance() =>
      MarkAllAnnouncementsAsReadResponse._();
  @$core.pragma('dart2js:noInline')
  static MarkAllAnnouncementsAsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllAnnouncementsAsReadResponse>(
          MarkAllAnnouncementsAsReadResponse.$_createMessage);
  static MarkAllAnnouncementsAsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get markedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set markedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMarkedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearMarkedCount() => $_clearField(1);
}

class GetMyLegalPageAgreementsRequest extends $pb.GeneratedMessage {
  factory GetMyLegalPageAgreementsRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = GetMyLegalPageAgreementsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetMyLegalPageAgreementsRequest._();

  factory GetMyLegalPageAgreementsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyLegalPageAgreementsRequest()..mergeFromBuffer(data, registry);
  factory GetMyLegalPageAgreementsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyLegalPageAgreementsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyLegalPageAgreementsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyLegalPageAgreementsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyLegalPageAgreementsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyLegalPageAgreementsRequest copyWith(
          void Function(GetMyLegalPageAgreementsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyLegalPageAgreementsRequest))
          as GetMyLegalPageAgreementsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyLegalPageAgreementsRequest() / GetMyLegalPageAgreementsRequest.new instead')
  static GetMyLegalPageAgreementsRequest create() =>
      GetMyLegalPageAgreementsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyLegalPageAgreementsRequest._();
  @$core.override
  GetMyLegalPageAgreementsRequest createEmptyInstance() =>
      GetMyLegalPageAgreementsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetMyLegalPageAgreementsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyLegalPageAgreementsRequest>(
          GetMyLegalPageAgreementsRequest.$_createMessage);
  static GetMyLegalPageAgreementsRequest? _defaultInstance;

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

  /// The reader's locale, read as GetTenantLegalPagesRequest.locale reads it.
  @$pb.TagNumber(2)
  $core.String get locale => $_getSZ(1);
  @$pb.TagNumber(2)
  set locale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocale() => $_clearField(2);
}

/// The pages the signed-in reader has still to agree to, each in the version
/// currently in force for the locale, as GetTenantLegalPages reports it. A role
/// is absent where the reader owes it nothing: the tenant names no published
/// page for it, no publication of that page has asked readers to agree again,
/// or the reader has agreed to a version published since the last one that did
/// in its translation. A response with neither role means the reader may use
/// the site.
class GetMyLegalPageAgreementsResponse extends $pb.GeneratedMessage {
  factory GetMyLegalPageAgreementsResponse({
    $1.TenantLegalPage? termsPage,
    $1.TenantLegalPage? privacyPage,
  }) {
    final result = GetMyLegalPageAgreementsResponse._();
    if (termsPage != null) result.termsPage = termsPage;
    if (privacyPage != null) result.privacyPage = privacyPage;
    return result;
  }

  GetMyLegalPageAgreementsResponse._();

  factory GetMyLegalPageAgreementsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyLegalPageAgreementsResponse()..mergeFromBuffer(data, registry);
  factory GetMyLegalPageAgreementsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetMyLegalPageAgreementsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetMyLegalPageAgreementsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetMyLegalPageAgreementsResponse.$_createMessage)
    ..aOM<$1.TenantLegalPage>(1, _omitFieldNames ? '' : 'termsPage',
        subBuilder: $1.TenantLegalPage.$_createMessage)
    ..aOM<$1.TenantLegalPage>(2, _omitFieldNames ? '' : 'privacyPage',
        subBuilder: $1.TenantLegalPage.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyLegalPageAgreementsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetMyLegalPageAgreementsResponse copyWith(
          void Function(GetMyLegalPageAgreementsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetMyLegalPageAgreementsResponse))
          as GetMyLegalPageAgreementsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetMyLegalPageAgreementsResponse() / GetMyLegalPageAgreementsResponse.new instead')
  static GetMyLegalPageAgreementsResponse create() =>
      GetMyLegalPageAgreementsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetMyLegalPageAgreementsResponse._();
  @$core.override
  GetMyLegalPageAgreementsResponse createEmptyInstance() =>
      GetMyLegalPageAgreementsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetMyLegalPageAgreementsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetMyLegalPageAgreementsResponse>(
          GetMyLegalPageAgreementsResponse.$_createMessage);
  static GetMyLegalPageAgreementsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantLegalPage get termsPage => $_getN(0);
  @$pb.TagNumber(1)
  set termsPage($1.TenantLegalPage value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTermsPage() => $_has(0);
  @$pb.TagNumber(1)
  void clearTermsPage() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantLegalPage ensureTermsPage() => $_ensure(0);

  @$pb.TagNumber(2)
  $1.TenantLegalPage get privacyPage => $_getN(1);
  @$pb.TagNumber(2)
  set privacyPage($1.TenantLegalPage value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPrivacyPage() => $_has(1);
  @$pb.TagNumber(2)
  void clearPrivacyPage() => $_clearField(2);
  @$pb.TagNumber(2)
  $1.TenantLegalPage ensurePrivacyPage() => $_ensure(1);
}

class AgreeToLegalPagesRequest extends $pb.GeneratedMessage {
  factory AgreeToLegalPagesRequest({
    $0.TenantContext? tenant,
    $core.Iterable<$core.String>? agreedPageVersionIds,
    $core.String? locale,
  }) {
    final result = AgreeToLegalPagesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (agreedPageVersionIds != null)
      result.agreedPageVersionIds.addAll(agreedPageVersionIds);
    if (locale != null) result.locale = locale;
    return result;
  }

  AgreeToLegalPagesRequest._();

  factory AgreeToLegalPagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AgreeToLegalPagesRequest()..mergeFromBuffer(data, registry);
  factory AgreeToLegalPagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AgreeToLegalPagesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AgreeToLegalPagesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: AgreeToLegalPagesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..pPS(2, _omitFieldNames ? '' : 'agreedPageVersionIds')
    ..aOS(3, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgreeToLegalPagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgreeToLegalPagesRequest copyWith(
          void Function(AgreeToLegalPagesRequest) updates) =>
      super.copyWith((message) => updates(message as AgreeToLegalPagesRequest))
          as AgreeToLegalPagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use AgreeToLegalPagesRequest() / AgreeToLegalPagesRequest.new instead')
  static AgreeToLegalPagesRequest create() => AgreeToLegalPagesRequest._();
  static $pb.GeneratedMessage $_createMessage() => AgreeToLegalPagesRequest._();
  @$core.override
  AgreeToLegalPagesRequest createEmptyInstance() =>
      AgreeToLegalPagesRequest._();
  @$core.pragma('dart2js:noInline')
  static AgreeToLegalPagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AgreeToLegalPagesRequest>(
          AgreeToLegalPagesRequest.$_createMessage);
  static AgreeToLegalPagesRequest? _defaultInstance;

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

  /// The versions the reader agreed to, as GetMyLegalPageAgreements reported
  /// them in TenantLegalPage.version_id. Each has to be a published version of
  /// the page the tenant names as its terms or its privacy policy, and there may
  /// be at most one per page; anything else is invalid_argument. A version the
  /// page has since superseded is recorded, since it is the text the reader was
  /// shown, but it does not settle a request made after it, so the response
  /// reports the page again.
  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get agreedPageVersionIds => $_getList(1);

  /// The locale the response reads the pages in, as in
  /// GetMyLegalPageAgreementsRequest.
  @$pb.TagNumber(3)
  $core.String get locale => $_getSZ(2);
  @$pb.TagNumber(3)
  set locale($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasLocale() => $_has(2);
  @$pb.TagNumber(3)
  void clearLocale() => $_clearField(3);
}

/// What GetMyLegalPageAgreements answers once the agreement is recorded.
class AgreeToLegalPagesResponse extends $pb.GeneratedMessage {
  factory AgreeToLegalPagesResponse({
    $1.TenantLegalPage? termsPage,
    $1.TenantLegalPage? privacyPage,
  }) {
    final result = AgreeToLegalPagesResponse._();
    if (termsPage != null) result.termsPage = termsPage;
    if (privacyPage != null) result.privacyPage = privacyPage;
    return result;
  }

  AgreeToLegalPagesResponse._();

  factory AgreeToLegalPagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AgreeToLegalPagesResponse()..mergeFromBuffer(data, registry);
  factory AgreeToLegalPagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AgreeToLegalPagesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AgreeToLegalPagesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: AgreeToLegalPagesResponse.$_createMessage)
    ..aOM<$1.TenantLegalPage>(1, _omitFieldNames ? '' : 'termsPage',
        subBuilder: $1.TenantLegalPage.$_createMessage)
    ..aOM<$1.TenantLegalPage>(2, _omitFieldNames ? '' : 'privacyPage',
        subBuilder: $1.TenantLegalPage.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgreeToLegalPagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AgreeToLegalPagesResponse copyWith(
          void Function(AgreeToLegalPagesResponse) updates) =>
      super.copyWith((message) => updates(message as AgreeToLegalPagesResponse))
          as AgreeToLegalPagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use AgreeToLegalPagesResponse() / AgreeToLegalPagesResponse.new instead')
  static AgreeToLegalPagesResponse create() => AgreeToLegalPagesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      AgreeToLegalPagesResponse._();
  @$core.override
  AgreeToLegalPagesResponse createEmptyInstance() =>
      AgreeToLegalPagesResponse._();
  @$core.pragma('dart2js:noInline')
  static AgreeToLegalPagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<AgreeToLegalPagesResponse>(
          AgreeToLegalPagesResponse.$_createMessage);
  static AgreeToLegalPagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $1.TenantLegalPage get termsPage => $_getN(0);
  @$pb.TagNumber(1)
  set termsPage($1.TenantLegalPage value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTermsPage() => $_has(0);
  @$pb.TagNumber(1)
  void clearTermsPage() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.TenantLegalPage ensureTermsPage() => $_ensure(0);

  @$pb.TagNumber(2)
  $1.TenantLegalPage get privacyPage => $_getN(1);
  @$pb.TagNumber(2)
  set privacyPage($1.TenantLegalPage value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPrivacyPage() => $_has(1);
  @$pb.TagNumber(2)
  void clearPrivacyPage() => $_clearField(2);
  @$pb.TagNumber(2)
  $1.TenantLegalPage ensurePrivacyPage() => $_ensure(1);
}

class AuthServiceApi {
  final $pb.RpcClient _client;

  AuthServiceApi(this._client);

  $async.Future<LoginResponse> login(
          $pb.ClientContext? ctx, LoginRequest request) =>
      _client.invoke<LoginResponse>(
          ctx, 'AuthService', 'Login', request, LoginResponse());
  $async.Future<LoginWithIdTokenResponse> loginWithIdToken(
          $pb.ClientContext? ctx, LoginWithIdTokenRequest request) =>
      _client.invoke<LoginWithIdTokenResponse>(ctx, 'AuthService',
          'LoginWithIdToken', request, LoginWithIdTokenResponse());
  $async.Future<ListMyIdentitiesResponse> listMyIdentities(
          $pb.ClientContext? ctx, ListMyIdentitiesRequest request) =>
      _client.invoke<ListMyIdentitiesResponse>(ctx, 'AuthService',
          'ListMyIdentities', request, ListMyIdentitiesResponse());
  $async.Future<UnlinkIdentityResponse> unlinkIdentity(
          $pb.ClientContext? ctx, UnlinkIdentityRequest request) =>
      _client.invoke<UnlinkIdentityResponse>(ctx, 'AuthService',
          'UnlinkIdentity', request, UnlinkIdentityResponse());
  $async.Future<LinkIdentityResponse> linkIdentity(
          $pb.ClientContext? ctx, LinkIdentityRequest request) =>
      _client.invoke<LinkIdentityResponse>(
          ctx, 'AuthService', 'LinkIdentity', request, LinkIdentityResponse());
  $async.Future<BeginPasskeyLoginResponse> beginPasskeyLogin(
          $pb.ClientContext? ctx, BeginPasskeyLoginRequest request) =>
      _client.invoke<BeginPasskeyLoginResponse>(ctx, 'AuthService',
          'BeginPasskeyLogin', request, BeginPasskeyLoginResponse());
  $async.Future<FinishPasskeyLoginResponse> finishPasskeyLogin(
          $pb.ClientContext? ctx, FinishPasskeyLoginRequest request) =>
      _client.invoke<FinishPasskeyLoginResponse>(ctx, 'AuthService',
          'FinishPasskeyLogin', request, FinishPasskeyLoginResponse());
  $async.Future<BeginPasskeyRegistrationResponse> beginPasskeyRegistration(
          $pb.ClientContext? ctx, BeginPasskeyRegistrationRequest request) =>
      _client.invoke<BeginPasskeyRegistrationResponse>(
          ctx,
          'AuthService',
          'BeginPasskeyRegistration',
          request,
          BeginPasskeyRegistrationResponse());
  $async.Future<FinishPasskeyRegistrationResponse> finishPasskeyRegistration(
          $pb.ClientContext? ctx, FinishPasskeyRegistrationRequest request) =>
      _client.invoke<FinishPasskeyRegistrationResponse>(
          ctx,
          'AuthService',
          'FinishPasskeyRegistration',
          request,
          FinishPasskeyRegistrationResponse());
  $async.Future<ListMyPasskeysResponse> listMyPasskeys(
          $pb.ClientContext? ctx, ListMyPasskeysRequest request) =>
      _client.invoke<ListMyPasskeysResponse>(ctx, 'AuthService',
          'ListMyPasskeys', request, ListMyPasskeysResponse());
  $async.Future<RenamePasskeyResponse> renamePasskey(
          $pb.ClientContext? ctx, RenamePasskeyRequest request) =>
      _client.invoke<RenamePasskeyResponse>(ctx, 'AuthService', 'RenamePasskey',
          request, RenamePasskeyResponse());
  $async.Future<DeletePasskeyResponse> deletePasskey(
          $pb.ClientContext? ctx, DeletePasskeyRequest request) =>
      _client.invoke<DeletePasskeyResponse>(ctx, 'AuthService', 'DeletePasskey',
          request, DeletePasskeyResponse());
  $async.Future<BeginPasskeyConfirmationResponse> beginPasskeyConfirmation(
          $pb.ClientContext? ctx, BeginPasskeyConfirmationRequest request) =>
      _client.invoke<BeginPasskeyConfirmationResponse>(
          ctx,
          'AuthService',
          'BeginPasskeyConfirmation',
          request,
          BeginPasskeyConfirmationResponse());
  $async.Future<CreateUserResponse> createUser(
          $pb.ClientContext? ctx, CreateUserRequest request) =>
      _client.invoke<CreateUserResponse>(
          ctx, 'AuthService', 'CreateUser', request, CreateUserResponse());
  $async.Future<VerifyUserEmailResponse> verifyUserEmail(
          $pb.ClientContext? ctx, VerifyUserEmailRequest request) =>
      _client.invoke<VerifyUserEmailResponse>(ctx, 'AuthService',
          'VerifyUserEmail', request, VerifyUserEmailResponse());
  $async.Future<RequestEmailVerificationResponse> requestEmailVerification(
          $pb.ClientContext? ctx, RequestEmailVerificationRequest request) =>
      _client.invoke<RequestEmailVerificationResponse>(
          ctx,
          'AuthService',
          'RequestEmailVerification',
          request,
          RequestEmailVerificationResponse());
  $async.Future<RequestEmailChangeResponse> requestEmailChange(
          $pb.ClientContext? ctx, RequestEmailChangeRequest request) =>
      _client.invoke<RequestEmailChangeResponse>(ctx, 'AuthService',
          'RequestEmailChange', request, RequestEmailChangeResponse());
  $async.Future<ConfirmEmailChangeResponse> confirmEmailChange(
          $pb.ClientContext? ctx, ConfirmEmailChangeRequest request) =>
      _client.invoke<ConfirmEmailChangeResponse>(ctx, 'AuthService',
          'ConfirmEmailChange', request, ConfirmEmailChangeResponse());
  $async.Future<RequestPasswordResetResponse> requestPasswordReset(
          $pb.ClientContext? ctx, RequestPasswordResetRequest request) =>
      _client.invoke<RequestPasswordResetResponse>(ctx, 'AuthService',
          'RequestPasswordReset', request, RequestPasswordResetResponse());
  $async.Future<ConfirmPasswordResetResponse> confirmPasswordReset(
          $pb.ClientContext? ctx, ConfirmPasswordResetRequest request) =>
      _client.invoke<ConfirmPasswordResetResponse>(ctx, 'AuthService',
          'ConfirmPasswordReset', request, ConfirmPasswordResetResponse());
  $async.Future<ChangePasswordResponse> changePassword(
          $pb.ClientContext? ctx, ChangePasswordRequest request) =>
      _client.invoke<ChangePasswordResponse>(ctx, 'AuthService',
          'ChangePassword', request, ChangePasswordResponse());
  $async.Future<LogoutResponse> logout(
          $pb.ClientContext? ctx, LogoutRequest request) =>
      _client.invoke<LogoutResponse>(
          ctx, 'AuthService', 'Logout', request, LogoutResponse());
  $async.Future<GetMeResponse> getMe(
          $pb.ClientContext? ctx, GetMeRequest request) =>
      _client.invoke<GetMeResponse>(
          ctx, 'AuthService', 'GetMe', request, GetMeResponse());
  $async.Future<UpdateMeResponse> updateMe(
          $pb.ClientContext? ctx, UpdateMeRequest request) =>
      _client.invoke<UpdateMeResponse>(
          ctx, 'AuthService', 'UpdateMe', request, UpdateMeResponse());

  /// Sets the caller's icon, replacing the one it showed. failed_precondition,
  /// with the STORAGE_NOT_CONFIGURED reason, while the platform has no object
  /// store, and with READER_ICON_NOT_ALLOWED unless the tenant's reader icon
  /// policy is READER_ICON_POLICY_UPLOAD.
  $async.Future<UploadMyIconResponse> uploadMyIcon(
          $pb.ClientContext? ctx, UploadMyIconRequest request) =>
      _client.invoke<UploadMyIconResponse>(
          ctx, 'AuthService', 'UploadMyIcon', request, UploadMyIconResponse());

  /// failed_precondition, with the READER_ICON_NOT_ALLOWED reason, unless the
  /// tenant's reader icon policy is READER_ICON_POLICY_PRESET; not_found for a
  /// preset the tenant does not hold.
  $async.Future<SelectMyIconResponse> selectMyIcon(
          $pb.ClientContext? ctx, SelectMyIconRequest request) =>
      _client.invoke<SelectMyIconResponse>(
          ctx, 'AuthService', 'SelectMyIcon', request, SelectMyIconResponse());

  /// Accepted under every reader icon policy.
  $async.Future<DeleteMyIconResponse> deleteMyIcon(
          $pb.ClientContext? ctx, DeleteMyIconRequest request) =>
      _client.invoke<DeleteMyIconResponse>(
          ctx, 'AuthService', 'DeleteMyIcon', request, DeleteMyIconResponse());

  /// Deletes the caller's account. A staff account is deleted too; the tenant's
  /// audit entries keep its name and public ID. failed_precondition, with the
  /// LAST_TENANT_ADMIN reason, for the tenant's last active tenant_admin.
  $async.Future<DeleteMeResponse> deleteMe(
          $pb.ClientContext? ctx, DeleteMeRequest request) =>
      _client.invoke<DeleteMeResponse>(
          ctx, 'AuthService', 'DeleteMe', request, DeleteMeResponse());
  $async.Future<GetNotificationSettingsResponse> getNotificationSettings(
          $pb.ClientContext? ctx, GetNotificationSettingsRequest request) =>
      _client.invoke<GetNotificationSettingsResponse>(
          ctx,
          'AuthService',
          'GetNotificationSettings',
          request,
          GetNotificationSettingsResponse());
  $async.Future<UpdateNotificationSettingsResponse> updateNotificationSettings(
          $pb.ClientContext? ctx, UpdateNotificationSettingsRequest request) =>
      _client.invoke<UpdateNotificationSettingsResponse>(
          ctx,
          'AuthService',
          'UpdateNotificationSettings',
          request,
          UpdateNotificationSettingsResponse());
  $async.Future<GetViewerPreferencesResponse> getViewerPreferences(
          $pb.ClientContext? ctx, GetViewerPreferencesRequest request) =>
      _client.invoke<GetViewerPreferencesResponse>(ctx, 'AuthService',
          'GetViewerPreferences', request, GetViewerPreferencesResponse());
  $async.Future<UpdateViewerPreferencesResponse> updateViewerPreferences(
          $pb.ClientContext? ctx, UpdateViewerPreferencesRequest request) =>
      _client.invoke<UpdateViewerPreferencesResponse>(
          ctx,
          'AuthService',
          'UpdateViewerPreferences',
          request,
          UpdateViewerPreferencesResponse());
  $async.Future<GetAnnouncementResponse> getAnnouncement(
          $pb.ClientContext? ctx, GetAnnouncementRequest request) =>
      _client.invoke<GetAnnouncementResponse>(ctx, 'AuthService',
          'GetAnnouncement', request, GetAnnouncementResponse());
  $async.Future<GetPinnedAnnouncementResponse> getPinnedAnnouncement(
          $pb.ClientContext? ctx, GetPinnedAnnouncementRequest request) =>
      _client.invoke<GetPinnedAnnouncementResponse>(ctx, 'AuthService',
          'GetPinnedAnnouncement', request, GetPinnedAnnouncementResponse());
  $async.Future<ListAnnouncementsResponse> listAnnouncements(
          $pb.ClientContext? ctx, ListAnnouncementsRequest request) =>
      _client.invoke<ListAnnouncementsResponse>(ctx, 'AuthService',
          'ListAnnouncements', request, ListAnnouncementsResponse());
  $async.Future<MarkAnnouncementAsReadResponse> markAnnouncementAsRead(
          $pb.ClientContext? ctx, MarkAnnouncementAsReadRequest request) =>
      _client.invoke<MarkAnnouncementAsReadResponse>(ctx, 'AuthService',
          'MarkAnnouncementAsRead', request, MarkAnnouncementAsReadResponse());
  $async.Future<MarkAllAnnouncementsAsReadResponse> markAllAnnouncementsAsRead(
          $pb.ClientContext? ctx, MarkAllAnnouncementsAsReadRequest request) =>
      _client.invoke<MarkAllAnnouncementsAsReadResponse>(
          ctx,
          'AuthService',
          'MarkAllAnnouncementsAsRead',
          request,
          MarkAllAnnouncementsAsReadResponse());

  /// Which of the tenant's terms of service and privacy policy the signed-in
  /// reader has still to agree to.
  ///
  /// A reader who owes an agreement may still read — the catalog, the episodes
  /// they own, and their own account, library, and history — finish a store
  /// purchase already paid for, sign out, and delete their account. Every other
  /// RPC that requires a session refuses them with failed_precondition and the
  /// ErrorInfo reason LEGAL_PAGE_AGREEMENT_REQUIRED, which is the one answer a
  /// client has to recognize to send them to agree.
  $async.Future<GetMyLegalPageAgreementsResponse> getMyLegalPageAgreements(
          $pb.ClientContext? ctx, GetMyLegalPageAgreementsRequest request) =>
      _client.invoke<GetMyLegalPageAgreementsResponse>(
          ctx,
          'AuthService',
          'GetMyLegalPageAgreements',
          request,
          GetMyLegalPageAgreementsResponse());

  /// Records the signed-in reader's agreement to the versions they were shown.
  $async.Future<AgreeToLegalPagesResponse> agreeToLegalPages(
          $pb.ClientContext? ctx, AgreeToLegalPagesRequest request) =>
      _client.invoke<AgreeToLegalPagesResponse>(ctx, 'AuthService',
          'AgreeToLegalPages', request, AgreeToLegalPagesResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
