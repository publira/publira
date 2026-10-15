// This is a generated file - do not edit.
//
// Generated from publira/v1/contact.proto.

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

class SubmitContactMessageRequest extends $pb.GeneratedMessage {
  factory SubmitContactMessageRequest({
    $0.TenantContext? tenant,
    $core.String? replyToEmail,
    $core.String? subject,
    $core.String? body,
  }) {
    final result = SubmitContactMessageRequest._();
    if (tenant != null) result.tenant = tenant;
    if (replyToEmail != null) result.replyToEmail = replyToEmail;
    if (subject != null) result.subject = subject;
    if (body != null) result.body = body;
    return result;
  }

  SubmitContactMessageRequest._();

  factory SubmitContactMessageRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubmitContactMessageRequest()..mergeFromBuffer(data, registry);
  factory SubmitContactMessageRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubmitContactMessageRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SubmitContactMessageRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SubmitContactMessageRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'replyToEmail')
    ..aOS(3, _omitFieldNames ? '' : 'subject')
    ..aOS(4, _omitFieldNames ? '' : 'body')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubmitContactMessageRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubmitContactMessageRequest copyWith(
          void Function(SubmitContactMessageRequest) updates) =>
      super.copyWith(
              (message) => updates(message as SubmitContactMessageRequest))
          as SubmitContactMessageRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SubmitContactMessageRequest() / SubmitContactMessageRequest.new instead')
  static SubmitContactMessageRequest create() =>
      SubmitContactMessageRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      SubmitContactMessageRequest._();
  @$core.override
  SubmitContactMessageRequest createEmptyInstance() =>
      SubmitContactMessageRequest._();
  @$core.pragma('dart2js:noInline')
  static SubmitContactMessageRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SubmitContactMessageRequest>(
          SubmitContactMessageRequest.$_createMessage);
  static SubmitContactMessageRequest? _defaultInstance;

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

  /// Where the tenant's staff answer. Required, and a syntactically valid
  /// address of at most 254 bytes, which is the length a mailbox may have;
  /// anything else is invalid_argument.
  ///
  /// A signed-in reader gives it too rather than having their account address
  /// taken: the address they can be reached at is not always the one they signed
  /// up with, and staff reply to whichever they named.
  @$pb.TagNumber(2)
  $core.String get replyToEmail => $_getSZ(1);
  @$pb.TagNumber(2)
  set replyToEmail($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasReplyToEmail() => $_has(1);
  @$pb.TagNumber(2)
  void clearReplyToEmail() => $_clearField(2);

  /// Optional. At most 200 Unicode code points once trimmed; a blank subject is
  /// stored as no subject at all.
  @$pb.TagNumber(3)
  $core.String get subject => $_getSZ(2);
  @$pb.TagNumber(3)
  set subject($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSubject() => $_has(2);
  @$pb.TagNumber(3)
  void clearSubject() => $_clearField(3);

  /// Non-blank after trimming and at most 4000 Unicode code points. Anything
  /// else is invalid_argument.
  @$pb.TagNumber(4)
  $core.String get body => $_getSZ(3);
  @$pb.TagNumber(4)
  set body($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBody() => $_has(3);
  @$pb.TagNumber(4)
  void clearBody() => $_clearField(4);
}

/// Deliberately empty. The reader is told their message was accepted and nothing
/// else: the identifier it was stored under is what staff work from, and a
/// reader who is never answered through Publira has nothing to name it in.
class SubmitContactMessageResponse extends $pb.GeneratedMessage {
  factory SubmitContactMessageResponse() => SubmitContactMessageResponse._();

  SubmitContactMessageResponse._();

  factory SubmitContactMessageResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubmitContactMessageResponse()..mergeFromBuffer(data, registry);
  factory SubmitContactMessageResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SubmitContactMessageResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SubmitContactMessageResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: SubmitContactMessageResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubmitContactMessageResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SubmitContactMessageResponse copyWith(
          void Function(SubmitContactMessageResponse) updates) =>
      super.copyWith(
              (message) => updates(message as SubmitContactMessageResponse))
          as SubmitContactMessageResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SubmitContactMessageResponse() / SubmitContactMessageResponse.new instead')
  static SubmitContactMessageResponse create() =>
      SubmitContactMessageResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      SubmitContactMessageResponse._();
  @$core.override
  SubmitContactMessageResponse createEmptyInstance() =>
      SubmitContactMessageResponse._();
  @$core.pragma('dart2js:noInline')
  static SubmitContactMessageResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SubmitContactMessageResponse>(
          SubmitContactMessageResponse.$_createMessage);
  static SubmitContactMessageResponse? _defaultInstance;
}

/// `web-storefront` forwards an inbound email provider's raw request body and
/// headers to this RPC. Verifying the request and reading the mail out of it
/// stay on the API server, with the credentials the provider declares.
class ProcessInboundEmailWebhookRequest extends $pb.GeneratedMessage {
  factory ProcessInboundEmailWebhookRequest({
    $0.TenantContext? tenant,
    $core.String? provider,
    $core.List<$core.int>? payload,
    $core.Iterable<$core.MapEntry<$core.String, $core.String>>? headers,
  }) {
    final result = ProcessInboundEmailWebhookRequest._();
    if (tenant != null) result.tenant = tenant;
    if (provider != null) result.provider = provider;
    if (payload != null) result.payload = payload;
    if (headers != null) result.headers.addEntries(headers);
    return result;
  }

  ProcessInboundEmailWebhookRequest._();

  factory ProcessInboundEmailWebhookRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessInboundEmailWebhookRequest()..mergeFromBuffer(data, registry);
  factory ProcessInboundEmailWebhookRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessInboundEmailWebhookRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessInboundEmailWebhookRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessInboundEmailWebhookRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'provider')
    ..a<$core.List<$core.int>>(
        3, _omitFieldNames ? '' : 'payload', $pb.PbFieldType.OY)
    ..m<$core.String, $core.String>(4, _omitFieldNames ? '' : 'headers',
        entryClassName: 'ProcessInboundEmailWebhookRequest.HeadersEntry',
        keyFieldType: $pb.PbFieldType.OS,
        valueFieldType: $pb.PbFieldType.OS,
        packageName: const $pb.PackageName('publira.v1'))
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessInboundEmailWebhookRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessInboundEmailWebhookRequest copyWith(
          void Function(ProcessInboundEmailWebhookRequest) updates) =>
      super.copyWith((message) =>
              updates(message as ProcessInboundEmailWebhookRequest))
          as ProcessInboundEmailWebhookRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessInboundEmailWebhookRequest() / ProcessInboundEmailWebhookRequest.new instead')
  static ProcessInboundEmailWebhookRequest create() =>
      ProcessInboundEmailWebhookRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessInboundEmailWebhookRequest._();
  @$core.override
  ProcessInboundEmailWebhookRequest createEmptyInstance() =>
      ProcessInboundEmailWebhookRequest._();
  @$core.pragma('dart2js:noInline')
  static ProcessInboundEmailWebhookRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProcessInboundEmailWebhookRequest>(
          ProcessInboundEmailWebhookRequest.$_createMessage);
  static ProcessInboundEmailWebhookRequest? _defaultInstance;

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

  /// The id of the provider the request came from, such as `sendgrid`.
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

class ProcessInboundEmailWebhookResponse extends $pb.GeneratedMessage {
  factory ProcessInboundEmailWebhookResponse() =>
      ProcessInboundEmailWebhookResponse._();

  ProcessInboundEmailWebhookResponse._();

  factory ProcessInboundEmailWebhookResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessInboundEmailWebhookResponse()..mergeFromBuffer(data, registry);
  factory ProcessInboundEmailWebhookResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ProcessInboundEmailWebhookResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ProcessInboundEmailWebhookResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ProcessInboundEmailWebhookResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessInboundEmailWebhookResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ProcessInboundEmailWebhookResponse copyWith(
          void Function(ProcessInboundEmailWebhookResponse) updates) =>
      super.copyWith((message) =>
              updates(message as ProcessInboundEmailWebhookResponse))
          as ProcessInboundEmailWebhookResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ProcessInboundEmailWebhookResponse() / ProcessInboundEmailWebhookResponse.new instead')
  static ProcessInboundEmailWebhookResponse create() =>
      ProcessInboundEmailWebhookResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ProcessInboundEmailWebhookResponse._();
  @$core.override
  ProcessInboundEmailWebhookResponse createEmptyInstance() =>
      ProcessInboundEmailWebhookResponse._();
  @$core.pragma('dart2js:noInline')
  static ProcessInboundEmailWebhookResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ProcessInboundEmailWebhookResponse>(
          ProcessInboundEmailWebhookResponse.$_createMessage);
  static ProcessInboundEmailWebhookResponse? _defaultInstance;
}

class ContactServiceApi {
  final $pb.RpcClient _client;

  ContactServiceApi(this._client);

  /// Stores one message for the tenant's staff and queues the mail that tells
  /// them it arrived.
  ///
  /// A session is optional. A reader who is signed in has their account attached
  /// to the message, and a guest may send one as well, because a reader who
  /// cannot sign in is one of the people who needs to reach the tenant.
  ///
  /// resource_exhausted once the sender has spent the allowance held by their
  /// account or the one held by their client.
  $async.Future<SubmitContactMessageResponse> submitContactMessage(
          $pb.ClientContext? ctx, SubmitContactMessageRequest request) =>
      _client.invoke<SubmitContactMessageResponse>(ctx, 'ContactService',
          'SubmitContactMessage', request, SubmitContactMessageResponse());

  /// Stores a reader's emailed reply under the contact message it answers, puts
  /// the message back among the waiting ones, and queues the mail that tells
  /// staff a reply arrived.
  ///
  /// The message is the one whose per-message address
  /// (`contact+<message id>@<inbound domain>`) the mail was sent to, or else
  /// the one an entry named in its In-Reply-To or References belongs to. A mail
  /// that matches no message, a tenant whose inbound email is not ready or uses
  /// another provider, a request the provider sends about something that is not
  /// a received mail, and a mail whose Message-ID is already stored are all
  /// answered with success and store nothing, so the provider does not deliver
  /// them again.
  ///
  /// A request of more than 33 MiB is resource_exhausted, refused while it is
  /// read and before anything else is checked. A payload over 32 MiB inside
  /// that bound is acknowledged and dropped, as the provider would only deliver
  /// it again.
  ///
  /// An unregistered provider is not_found. A request whose signature or token
  /// does not verify is unauthenticated, and one that verifies but cannot be
  /// read is invalid_argument; neither stores anything. unavailable when the
  /// provider's API, which some providers have the mail's content read from,
  /// cannot be reached.
  $async.Future<ProcessInboundEmailWebhookResponse> processInboundEmailWebhook(
          $pb.ClientContext? ctx, ProcessInboundEmailWebhookRequest request) =>
      _client.invoke<ProcessInboundEmailWebhookResponse>(
          ctx,
          'ContactService',
          'ProcessInboundEmailWebhook',
          request,
          ProcessInboundEmailWebhookResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
