// This is a generated file - do not edit.
//
// Generated from publira/v1/notification.proto.

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
import 'notification.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'notification.pbenum.dart';

class NotificationItem extends $pb.GeneratedMessage {
  factory NotificationItem({
    $core.String? id,
    $core.String? notificationType,
    $core.String? payload,
    $core.bool? isRead,
    $core.String? readAt,
    $core.String? createdAt,
  }) {
    final result = NotificationItem._();
    if (id != null) result.id = id;
    if (notificationType != null) result.notificationType = notificationType;
    if (payload != null) result.payload = payload;
    if (isRead != null) result.isRead = isRead;
    if (readAt != null) result.readAt = readAt;
    if (createdAt != null) result.createdAt = createdAt;
    return result;
  }

  NotificationItem._();

  factory NotificationItem.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      NotificationItem()..mergeFromBuffer(data, registry);
  factory NotificationItem.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      NotificationItem()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'NotificationItem',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: NotificationItem.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'notificationType')
    ..aOS(3, _omitFieldNames ? '' : 'payload')
    ..aOB(4, _omitFieldNames ? '' : 'isRead')
    ..aOS(5, _omitFieldNames ? '' : 'readAt')
    ..aOS(6, _omitFieldNames ? '' : 'createdAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationItem clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  NotificationItem copyWith(void Function(NotificationItem) updates) =>
      super.copyWith((message) => updates(message as NotificationItem))
          as NotificationItem;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use NotificationItem() / NotificationItem.new instead')
  static NotificationItem create() => NotificationItem._();
  static $pb.GeneratedMessage $_createMessage() => NotificationItem._();
  @$core.override
  NotificationItem createEmptyInstance() => NotificationItem._();
  @$core.pragma('dart2js:noInline')
  static NotificationItem getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<NotificationItem>(
          NotificationItem.$_createMessage);
  static NotificationItem? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get notificationType => $_getSZ(1);
  @$pb.TagNumber(2)
  set notificationType($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNotificationType() => $_has(1);
  @$pb.TagNumber(2)
  void clearNotificationType() => $_clearField(2);

  /// JSON object. Display copy is derived from notification_type + payload.
  @$pb.TagNumber(3)
  $core.String get payload => $_getSZ(2);
  @$pb.TagNumber(3)
  set payload($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasPayload() => $_has(2);
  @$pb.TagNumber(3)
  void clearPayload() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.bool get isRead => $_getBF(3);
  @$pb.TagNumber(4)
  set isRead($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasIsRead() => $_has(3);
  @$pb.TagNumber(4)
  void clearIsRead() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get readAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set readAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasReadAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearReadAt() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get createdAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set createdAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCreatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreatedAt() => $_clearField(6);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListNotificationsRequest extends $pb.GeneratedMessage {
  factory ListNotificationsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
  }) {
    final result = ListNotificationsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    return result;
  }

  ListNotificationsRequest._();

  factory ListNotificationsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListNotificationsRequest()..mergeFromBuffer(data, registry);
  factory ListNotificationsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListNotificationsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNotificationsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListNotificationsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsRequest copyWith(
          void Function(ListNotificationsRequest) updates) =>
      super.copyWith((message) => updates(message as ListNotificationsRequest))
          as ListNotificationsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListNotificationsRequest() / ListNotificationsRequest.new instead')
  static ListNotificationsRequest create() => ListNotificationsRequest._();
  static $pb.GeneratedMessage $_createMessage() => ListNotificationsRequest._();
  @$core.override
  ListNotificationsRequest createEmptyInstance() =>
      ListNotificationsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListNotificationsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNotificationsRequest>(
          ListNotificationsRequest.$_createMessage);
  static ListNotificationsRequest? _defaultInstance;

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
  /// A notification about an episode is listed only on the surfaces the episode
  /// was shown on when the notification was written.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);
}

class ListNotificationsResponse extends $pb.GeneratedMessage {
  factory ListNotificationsResponse({
    $core.Iterable<NotificationItem>? notifications,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListNotificationsResponse._();
    if (notifications != null) result.notifications.addAll(notifications);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListNotificationsResponse._();

  factory ListNotificationsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListNotificationsResponse()..mergeFromBuffer(data, registry);
  factory ListNotificationsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListNotificationsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListNotificationsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListNotificationsResponse.$_createMessage)
    ..pPM<NotificationItem>(1, _omitFieldNames ? '' : 'notifications',
        subBuilder: NotificationItem.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListNotificationsResponse copyWith(
          void Function(ListNotificationsResponse) updates) =>
      super.copyWith((message) => updates(message as ListNotificationsResponse))
          as ListNotificationsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListNotificationsResponse() / ListNotificationsResponse.new instead')
  static ListNotificationsResponse create() => ListNotificationsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListNotificationsResponse._();
  @$core.override
  ListNotificationsResponse createEmptyInstance() =>
      ListNotificationsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListNotificationsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListNotificationsResponse>(
          ListNotificationsResponse.$_createMessage);
  static ListNotificationsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<NotificationItem> get notifications => $_getList(0);

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

/// A device registers the FCM token it holds right now. The token is the
/// identity, so registering one that another reader left behind moves it to the
/// caller rather than adding a second row.
class RegisterPushDeviceRequest extends $pb.GeneratedMessage {
  factory RegisterPushDeviceRequest({
    $0.TenantContext? tenant,
    $core.String? token,
    PushPlatform? platform,
    $core.String? endpoint,
    $core.String? p256dh,
    $core.String? auth,
  }) {
    final result = RegisterPushDeviceRequest._();
    if (tenant != null) result.tenant = tenant;
    if (token != null) result.token = token;
    if (platform != null) result.platform = platform;
    if (endpoint != null) result.endpoint = endpoint;
    if (p256dh != null) result.p256dh = p256dh;
    if (auth != null) result.auth = auth;
    return result;
  }

  RegisterPushDeviceRequest._();

  factory RegisterPushDeviceRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RegisterPushDeviceRequest()..mergeFromBuffer(data, registry);
  factory RegisterPushDeviceRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RegisterPushDeviceRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RegisterPushDeviceRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RegisterPushDeviceRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'token')
    ..aE<PushPlatform>(3, _omitFieldNames ? '' : 'platform',
        enumValues: PushPlatform.values)
    ..aOS(4, _omitFieldNames ? '' : 'endpoint')
    ..aOS(5, _omitFieldNames ? '' : 'p256dh')
    ..aOS(6, _omitFieldNames ? '' : 'auth')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterPushDeviceRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterPushDeviceRequest copyWith(
          void Function(RegisterPushDeviceRequest) updates) =>
      super.copyWith((message) => updates(message as RegisterPushDeviceRequest))
          as RegisterPushDeviceRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RegisterPushDeviceRequest() / RegisterPushDeviceRequest.new instead')
  static RegisterPushDeviceRequest create() => RegisterPushDeviceRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      RegisterPushDeviceRequest._();
  @$core.override
  RegisterPushDeviceRequest createEmptyInstance() =>
      RegisterPushDeviceRequest._();
  @$core.pragma('dart2js:noInline')
  static RegisterPushDeviceRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RegisterPushDeviceRequest>(
          RegisterPushDeviceRequest.$_createMessage);
  static RegisterPushDeviceRequest? _defaultInstance;

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
  PushPlatform get platform => $_getN(2);
  @$pb.TagNumber(3)
  set platform(PushPlatform value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasPlatform() => $_has(2);
  @$pb.TagNumber(3)
  void clearPlatform() => $_clearField(3);

  /// Web Push subscription fields. `endpoint` is also the token identity for
  /// web registrations, so unregistering by token unregisters by endpoint.
  @$pb.TagNumber(4)
  $core.String get endpoint => $_getSZ(3);
  @$pb.TagNumber(4)
  set endpoint($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEndpoint() => $_has(3);
  @$pb.TagNumber(4)
  void clearEndpoint() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get p256dh => $_getSZ(4);
  @$pb.TagNumber(5)
  set p256dh($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasP256dh() => $_has(4);
  @$pb.TagNumber(5)
  void clearP256dh() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get auth => $_getSZ(5);
  @$pb.TagNumber(6)
  set auth($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasAuth() => $_has(5);
  @$pb.TagNumber(6)
  void clearAuth() => $_clearField(6);
}

class RegisterPushDeviceResponse extends $pb.GeneratedMessage {
  factory RegisterPushDeviceResponse({
    $core.bool? registered,
  }) {
    final result = RegisterPushDeviceResponse._();
    if (registered != null) result.registered = registered;
    return result;
  }

  RegisterPushDeviceResponse._();

  factory RegisterPushDeviceResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RegisterPushDeviceResponse()..mergeFromBuffer(data, registry);
  factory RegisterPushDeviceResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      RegisterPushDeviceResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'RegisterPushDeviceResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: RegisterPushDeviceResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'registered')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterPushDeviceResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  RegisterPushDeviceResponse copyWith(
          void Function(RegisterPushDeviceResponse) updates) =>
      super.copyWith(
              (message) => updates(message as RegisterPushDeviceResponse))
          as RegisterPushDeviceResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use RegisterPushDeviceResponse() / RegisterPushDeviceResponse.new instead')
  static RegisterPushDeviceResponse create() => RegisterPushDeviceResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      RegisterPushDeviceResponse._();
  @$core.override
  RegisterPushDeviceResponse createEmptyInstance() =>
      RegisterPushDeviceResponse._();
  @$core.pragma('dart2js:noInline')
  static RegisterPushDeviceResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<RegisterPushDeviceResponse>(
          RegisterPushDeviceResponse.$_createMessage);
  static RegisterPushDeviceResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get registered => $_getBF(0);
  @$pb.TagNumber(1)
  set registered($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasRegistered() => $_has(0);
  @$pb.TagNumber(1)
  void clearRegistered() => $_clearField(1);
}

/// Signing out, and turning the account switch off, take the device back off
/// the delivery list of every notification the reader would have been sent.
class UnregisterPushDeviceRequest extends $pb.GeneratedMessage {
  factory UnregisterPushDeviceRequest({
    $0.TenantContext? tenant,
    $core.String? token,
    $core.String? endpoint,
  }) {
    final result = UnregisterPushDeviceRequest._();
    if (tenant != null) result.tenant = tenant;
    if (token != null) result.token = token;
    if (endpoint != null) result.endpoint = endpoint;
    return result;
  }

  UnregisterPushDeviceRequest._();

  factory UnregisterPushDeviceRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnregisterPushDeviceRequest()..mergeFromBuffer(data, registry);
  factory UnregisterPushDeviceRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnregisterPushDeviceRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnregisterPushDeviceRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnregisterPushDeviceRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'token')
    ..aOS(3, _omitFieldNames ? '' : 'endpoint')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnregisterPushDeviceRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnregisterPushDeviceRequest copyWith(
          void Function(UnregisterPushDeviceRequest) updates) =>
      super.copyWith(
              (message) => updates(message as UnregisterPushDeviceRequest))
          as UnregisterPushDeviceRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UnregisterPushDeviceRequest() / UnregisterPushDeviceRequest.new instead')
  static UnregisterPushDeviceRequest create() =>
      UnregisterPushDeviceRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      UnregisterPushDeviceRequest._();
  @$core.override
  UnregisterPushDeviceRequest createEmptyInstance() =>
      UnregisterPushDeviceRequest._();
  @$core.pragma('dart2js:noInline')
  static UnregisterPushDeviceRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnregisterPushDeviceRequest>(
          UnregisterPushDeviceRequest.$_createMessage);
  static UnregisterPushDeviceRequest? _defaultInstance;

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

  /// Web Push registrations are identified by their subscription endpoint.
  @$pb.TagNumber(3)
  $core.String get endpoint => $_getSZ(2);
  @$pb.TagNumber(3)
  set endpoint($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEndpoint() => $_has(2);
  @$pb.TagNumber(3)
  void clearEndpoint() => $_clearField(3);
}

class UnregisterPushDeviceResponse extends $pb.GeneratedMessage {
  factory UnregisterPushDeviceResponse({
    $core.bool? unregistered,
  }) {
    final result = UnregisterPushDeviceResponse._();
    if (unregistered != null) result.unregistered = unregistered;
    return result;
  }

  UnregisterPushDeviceResponse._();

  factory UnregisterPushDeviceResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnregisterPushDeviceResponse()..mergeFromBuffer(data, registry);
  factory UnregisterPushDeviceResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UnregisterPushDeviceResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UnregisterPushDeviceResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: UnregisterPushDeviceResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'unregistered')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnregisterPushDeviceResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UnregisterPushDeviceResponse copyWith(
          void Function(UnregisterPushDeviceResponse) updates) =>
      super.copyWith(
              (message) => updates(message as UnregisterPushDeviceResponse))
          as UnregisterPushDeviceResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use UnregisterPushDeviceResponse() / UnregisterPushDeviceResponse.new instead')
  static UnregisterPushDeviceResponse create() =>
      UnregisterPushDeviceResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      UnregisterPushDeviceResponse._();
  @$core.override
  UnregisterPushDeviceResponse createEmptyInstance() =>
      UnregisterPushDeviceResponse._();
  @$core.pragma('dart2js:noInline')
  static UnregisterPushDeviceResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<UnregisterPushDeviceResponse>(
          UnregisterPushDeviceResponse.$_createMessage);
  static UnregisterPushDeviceResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get unregistered => $_getBF(0);
  @$pb.TagNumber(1)
  set unregistered($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUnregistered() => $_has(0);
  @$pb.TagNumber(1)
  void clearUnregistered() => $_clearField(1);
}

class CountUnreadNotificationsRequest extends $pb.GeneratedMessage {
  factory CountUnreadNotificationsRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
  }) {
    final result = CountUnreadNotificationsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    return result;
  }

  CountUnreadNotificationsRequest._();

  factory CountUnreadNotificationsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CountUnreadNotificationsRequest()..mergeFromBuffer(data, registry);
  factory CountUnreadNotificationsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CountUnreadNotificationsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CountUnreadNotificationsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CountUnreadNotificationsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CountUnreadNotificationsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CountUnreadNotificationsRequest copyWith(
          void Function(CountUnreadNotificationsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as CountUnreadNotificationsRequest))
          as CountUnreadNotificationsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use CountUnreadNotificationsRequest() / CountUnreadNotificationsRequest.new instead')
  static CountUnreadNotificationsRequest create() =>
      CountUnreadNotificationsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      CountUnreadNotificationsRequest._();
  @$core.override
  CountUnreadNotificationsRequest createEmptyInstance() =>
      CountUnreadNotificationsRequest._();
  @$core.pragma('dart2js:noInline')
  static CountUnreadNotificationsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CountUnreadNotificationsRequest>(
          CountUnreadNotificationsRequest.$_createMessage);
  static CountUnreadNotificationsRequest? _defaultInstance;

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

  /// The client making the read. Unspecified is answered as the web storefront,
  /// and the count is of what ListNotifications lists on the same surface.
  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);
}

class CountUnreadNotificationsResponse extends $pb.GeneratedMessage {
  factory CountUnreadNotificationsResponse({
    $core.int? unreadCount,
  }) {
    final result = CountUnreadNotificationsResponse._();
    if (unreadCount != null) result.unreadCount = unreadCount;
    return result;
  }

  CountUnreadNotificationsResponse._();

  factory CountUnreadNotificationsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CountUnreadNotificationsResponse()..mergeFromBuffer(data, registry);
  factory CountUnreadNotificationsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CountUnreadNotificationsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CountUnreadNotificationsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CountUnreadNotificationsResponse.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'unreadCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CountUnreadNotificationsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CountUnreadNotificationsResponse copyWith(
          void Function(CountUnreadNotificationsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as CountUnreadNotificationsResponse))
          as CountUnreadNotificationsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use CountUnreadNotificationsResponse() / CountUnreadNotificationsResponse.new instead')
  static CountUnreadNotificationsResponse create() =>
      CountUnreadNotificationsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      CountUnreadNotificationsResponse._();
  @$core.override
  CountUnreadNotificationsResponse createEmptyInstance() =>
      CountUnreadNotificationsResponse._();
  @$core.pragma('dart2js:noInline')
  static CountUnreadNotificationsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CountUnreadNotificationsResponse>(
          CountUnreadNotificationsResponse.$_createMessage);
  static CountUnreadNotificationsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get unreadCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set unreadCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasUnreadCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearUnreadCount() => $_clearField(1);
}

class MarkNotificationAsReadRequest extends $pb.GeneratedMessage {
  factory MarkNotificationAsReadRequest({
    $0.TenantContext? tenant,
    $core.String? notificationId,
  }) {
    final result = MarkNotificationAsReadRequest._();
    if (tenant != null) result.tenant = tenant;
    if (notificationId != null) result.notificationId = notificationId;
    return result;
  }

  MarkNotificationAsReadRequest._();

  factory MarkNotificationAsReadRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkNotificationAsReadRequest()..mergeFromBuffer(data, registry);
  factory MarkNotificationAsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkNotificationAsReadRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkNotificationAsReadRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkNotificationAsReadRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'notificationId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationAsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationAsReadRequest copyWith(
          void Function(MarkNotificationAsReadRequest) updates) =>
      super.copyWith(
              (message) => updates(message as MarkNotificationAsReadRequest))
          as MarkNotificationAsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkNotificationAsReadRequest() / MarkNotificationAsReadRequest.new instead')
  static MarkNotificationAsReadRequest create() =>
      MarkNotificationAsReadRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkNotificationAsReadRequest._();
  @$core.override
  MarkNotificationAsReadRequest createEmptyInstance() =>
      MarkNotificationAsReadRequest._();
  @$core.pragma('dart2js:noInline')
  static MarkNotificationAsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkNotificationAsReadRequest>(
          MarkNotificationAsReadRequest.$_createMessage);
  static MarkNotificationAsReadRequest? _defaultInstance;

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
  $core.String get notificationId => $_getSZ(1);
  @$pb.TagNumber(2)
  set notificationId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasNotificationId() => $_has(1);
  @$pb.TagNumber(2)
  void clearNotificationId() => $_clearField(2);
}

class MarkNotificationAsReadResponse extends $pb.GeneratedMessage {
  factory MarkNotificationAsReadResponse({
    $core.bool? marked,
  }) {
    final result = MarkNotificationAsReadResponse._();
    if (marked != null) result.marked = marked;
    return result;
  }

  MarkNotificationAsReadResponse._();

  factory MarkNotificationAsReadResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkNotificationAsReadResponse()..mergeFromBuffer(data, registry);
  factory MarkNotificationAsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkNotificationAsReadResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkNotificationAsReadResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkNotificationAsReadResponse.$_createMessage)
    ..aOB(1, _omitFieldNames ? '' : 'marked')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationAsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkNotificationAsReadResponse copyWith(
          void Function(MarkNotificationAsReadResponse) updates) =>
      super.copyWith(
              (message) => updates(message as MarkNotificationAsReadResponse))
          as MarkNotificationAsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkNotificationAsReadResponse() / MarkNotificationAsReadResponse.new instead')
  static MarkNotificationAsReadResponse create() =>
      MarkNotificationAsReadResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkNotificationAsReadResponse._();
  @$core.override
  MarkNotificationAsReadResponse createEmptyInstance() =>
      MarkNotificationAsReadResponse._();
  @$core.pragma('dart2js:noInline')
  static MarkNotificationAsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkNotificationAsReadResponse>(
          MarkNotificationAsReadResponse.$_createMessage);
  static MarkNotificationAsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.bool get marked => $_getBF(0);
  @$pb.TagNumber(1)
  set marked($core.bool value) => $_setBool(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMarked() => $_has(0);
  @$pb.TagNumber(1)
  void clearMarked() => $_clearField(1);
}

class MarkAllNotificationsAsReadRequest extends $pb.GeneratedMessage {
  factory MarkAllNotificationsAsReadRequest({
    $0.TenantContext? tenant,
    $0.ClientSurface? surface,
  }) {
    final result = MarkAllNotificationsAsReadRequest._();
    if (tenant != null) result.tenant = tenant;
    if (surface != null) result.surface = surface;
    return result;
  }

  MarkAllNotificationsAsReadRequest._();

  factory MarkAllNotificationsAsReadRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllNotificationsAsReadRequest()..mergeFromBuffer(data, registry);
  factory MarkAllNotificationsAsReadRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllNotificationsAsReadRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllNotificationsAsReadRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAllNotificationsAsReadRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<$0.ClientSurface>(2, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsAsReadRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsAsReadRequest copyWith(
          void Function(MarkAllNotificationsAsReadRequest) updates) =>
      super.copyWith((message) =>
              updates(message as MarkAllNotificationsAsReadRequest))
          as MarkAllNotificationsAsReadRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAllNotificationsAsReadRequest() / MarkAllNotificationsAsReadRequest.new instead')
  static MarkAllNotificationsAsReadRequest create() =>
      MarkAllNotificationsAsReadRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAllNotificationsAsReadRequest._();
  @$core.override
  MarkAllNotificationsAsReadRequest createEmptyInstance() =>
      MarkAllNotificationsAsReadRequest._();
  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsAsReadRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllNotificationsAsReadRequest>(
          MarkAllNotificationsAsReadRequest.$_createMessage);
  static MarkAllNotificationsAsReadRequest? _defaultInstance;

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

  /// The client making the call. Unspecified is answered as the web storefront,
  /// and what is marked is what ListNotifications lists on the same surface.
  @$pb.TagNumber(2)
  $0.ClientSurface get surface => $_getN(1);
  @$pb.TagNumber(2)
  set surface($0.ClientSurface value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasSurface() => $_has(1);
  @$pb.TagNumber(2)
  void clearSurface() => $_clearField(2);
}

class MarkAllNotificationsAsReadResponse extends $pb.GeneratedMessage {
  factory MarkAllNotificationsAsReadResponse({
    $core.int? markedCount,
  }) {
    final result = MarkAllNotificationsAsReadResponse._();
    if (markedCount != null) result.markedCount = markedCount;
    return result;
  }

  MarkAllNotificationsAsReadResponse._();

  factory MarkAllNotificationsAsReadResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllNotificationsAsReadResponse()..mergeFromBuffer(data, registry);
  factory MarkAllNotificationsAsReadResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MarkAllNotificationsAsReadResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MarkAllNotificationsAsReadResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MarkAllNotificationsAsReadResponse.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'markedCount')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsAsReadResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MarkAllNotificationsAsReadResponse copyWith(
          void Function(MarkAllNotificationsAsReadResponse) updates) =>
      super.copyWith((message) =>
              updates(message as MarkAllNotificationsAsReadResponse))
          as MarkAllNotificationsAsReadResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use MarkAllNotificationsAsReadResponse() / MarkAllNotificationsAsReadResponse.new instead')
  static MarkAllNotificationsAsReadResponse create() =>
      MarkAllNotificationsAsReadResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      MarkAllNotificationsAsReadResponse._();
  @$core.override
  MarkAllNotificationsAsReadResponse createEmptyInstance() =>
      MarkAllNotificationsAsReadResponse._();
  @$core.pragma('dart2js:noInline')
  static MarkAllNotificationsAsReadResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<MarkAllNotificationsAsReadResponse>(
          MarkAllNotificationsAsReadResponse.$_createMessage);
  static MarkAllNotificationsAsReadResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get markedCount => $_getIZ(0);
  @$pb.TagNumber(1)
  set markedCount($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasMarkedCount() => $_has(0);
  @$pb.TagNumber(1)
  void clearMarkedCount() => $_clearField(1);
}

class NotificationServiceApi {
  final $pb.RpcClient _client;

  NotificationServiceApi(this._client);

  $async.Future<ListNotificationsResponse> listNotifications(
          $pb.ClientContext? ctx, ListNotificationsRequest request) =>
      _client.invoke<ListNotificationsResponse>(ctx, 'NotificationService',
          'ListNotifications', request, ListNotificationsResponse());
  $async.Future<CountUnreadNotificationsResponse> countUnreadNotifications(
          $pb.ClientContext? ctx, CountUnreadNotificationsRequest request) =>
      _client.invoke<CountUnreadNotificationsResponse>(
          ctx,
          'NotificationService',
          'CountUnreadNotifications',
          request,
          CountUnreadNotificationsResponse());
  $async.Future<MarkNotificationAsReadResponse> markNotificationAsRead(
          $pb.ClientContext? ctx, MarkNotificationAsReadRequest request) =>
      _client.invoke<MarkNotificationAsReadResponse>(ctx, 'NotificationService',
          'MarkNotificationAsRead', request, MarkNotificationAsReadResponse());
  $async.Future<MarkAllNotificationsAsReadResponse> markAllNotificationsAsRead(
          $pb.ClientContext? ctx, MarkAllNotificationsAsReadRequest request) =>
      _client.invoke<MarkAllNotificationsAsReadResponse>(
          ctx,
          'NotificationService',
          'MarkAllNotificationsAsRead',
          request,
          MarkAllNotificationsAsReadResponse());
  $async.Future<RegisterPushDeviceResponse> registerPushDevice(
          $pb.ClientContext? ctx, RegisterPushDeviceRequest request) =>
      _client.invoke<RegisterPushDeviceResponse>(ctx, 'NotificationService',
          'RegisterPushDevice', request, RegisterPushDeviceResponse());
  $async.Future<UnregisterPushDeviceResponse> unregisterPushDevice(
          $pb.ClientContext? ctx, UnregisterPushDeviceRequest request) =>
      _client.invoke<UnregisterPushDeviceResponse>(ctx, 'NotificationService',
          'UnregisterPushDevice', request, UnregisterPushDeviceResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
