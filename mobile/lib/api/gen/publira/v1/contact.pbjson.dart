// This is a generated file - do not edit.
//
// Generated from publira/v1/contact.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports
// ignore_for_file: unused_import

import 'dart:convert' as $convert;
import 'dart:core' as $core;
import 'dart:typed_data' as $typed_data;

import '../types/v1/types.pbjson.dart' as $0;

@$core.Deprecated('Use submitContactMessageRequestDescriptor instead')
const SubmitContactMessageRequest$json = {
  '1': 'SubmitContactMessageRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'reply_to_email', '3': 2, '4': 1, '5': 9, '10': 'replyToEmail'},
    {'1': 'subject', '3': 3, '4': 1, '5': 9, '10': 'subject'},
    {'1': 'body', '3': 4, '4': 1, '5': 9, '10': 'body'},
  ],
};

/// Descriptor for `SubmitContactMessageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List submitContactMessageRequestDescriptor = $convert.base64Decode(
    'ChtTdWJtaXRDb250YWN0TWVzc2FnZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSJAoOcmVwbHlfdG9fZW1haWwYAiABKAlS'
    'DHJlcGx5VG9FbWFpbBIYCgdzdWJqZWN0GAMgASgJUgdzdWJqZWN0EhIKBGJvZHkYBCABKAlSBG'
    'JvZHk=');

@$core.Deprecated('Use submitContactMessageResponseDescriptor instead')
const SubmitContactMessageResponse$json = {
  '1': 'SubmitContactMessageResponse',
};

/// Descriptor for `SubmitContactMessageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List submitContactMessageResponseDescriptor =
    $convert.base64Decode('ChxTdWJtaXRDb250YWN0TWVzc2FnZVJlc3BvbnNl');

@$core.Deprecated('Use processInboundEmailWebhookRequestDescriptor instead')
const ProcessInboundEmailWebhookRequest$json = {
  '1': 'ProcessInboundEmailWebhookRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'provider', '3': 2, '4': 1, '5': 9, '10': 'provider'},
    {'1': 'payload', '3': 3, '4': 1, '5': 12, '10': 'payload'},
    {
      '1': 'headers',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.ProcessInboundEmailWebhookRequest.HeadersEntry',
      '10': 'headers'
    },
  ],
  '3': [ProcessInboundEmailWebhookRequest_HeadersEntry$json],
};

@$core.Deprecated('Use processInboundEmailWebhookRequestDescriptor instead')
const ProcessInboundEmailWebhookRequest_HeadersEntry$json = {
  '1': 'HeadersEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ProcessInboundEmailWebhookRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processInboundEmailWebhookRequestDescriptor = $convert.base64Decode(
    'CiFQcm9jZXNzSW5ib3VuZEVtYWlsV2ViaG9va1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucH'
    'VibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSGgoIcHJvdmlkZXIYAiABKAlS'
    'CHByb3ZpZGVyEhgKB3BheWxvYWQYAyABKAxSB3BheWxvYWQSVAoHaGVhZGVycxgEIAMoCzI6Ln'
    'B1YmxpcmEudjEuUHJvY2Vzc0luYm91bmRFbWFpbFdlYmhvb2tSZXF1ZXN0LkhlYWRlcnNFbnRy'
    'eVIHaGVhZGVycxo6CgxIZWFkZXJzRW50cnkSEAoDa2V5GAEgASgJUgNrZXkSFAoFdmFsdWUYAi'
    'ABKAlSBXZhbHVlOgI4AQ==');

@$core.Deprecated('Use processInboundEmailWebhookResponseDescriptor instead')
const ProcessInboundEmailWebhookResponse$json = {
  '1': 'ProcessInboundEmailWebhookResponse',
};

/// Descriptor for `ProcessInboundEmailWebhookResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processInboundEmailWebhookResponseDescriptor =
    $convert.base64Decode('CiJQcm9jZXNzSW5ib3VuZEVtYWlsV2ViaG9va1Jlc3BvbnNl');

const $core.Map<$core.String, $core.dynamic> ContactServiceBase$json = {
  '1': 'ContactService',
  '2': [
    {
      '1': 'SubmitContactMessage',
      '2': '.publira.v1.SubmitContactMessageRequest',
      '3': '.publira.v1.SubmitContactMessageResponse'
    },
    {
      '1': 'ProcessInboundEmailWebhook',
      '2': '.publira.v1.ProcessInboundEmailWebhookRequest',
      '3': '.publira.v1.ProcessInboundEmailWebhookResponse'
    },
  ],
};

@$core.Deprecated('Use contactServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    ContactServiceBase$messageJson = {
  '.publira.v1.SubmitContactMessageRequest': SubmitContactMessageRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.SubmitContactMessageResponse': SubmitContactMessageResponse$json,
  '.publira.v1.ProcessInboundEmailWebhookRequest':
      ProcessInboundEmailWebhookRequest$json,
  '.publira.v1.ProcessInboundEmailWebhookRequest.HeadersEntry':
      ProcessInboundEmailWebhookRequest_HeadersEntry$json,
  '.publira.v1.ProcessInboundEmailWebhookResponse':
      ProcessInboundEmailWebhookResponse$json,
};

/// Descriptor for `ContactService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List contactServiceDescriptor = $convert.base64Decode(
    'Cg5Db250YWN0U2VydmljZRJpChRTdWJtaXRDb250YWN0TWVzc2FnZRInLnB1YmxpcmEudjEuU3'
    'VibWl0Q29udGFjdE1lc3NhZ2VSZXF1ZXN0GigucHVibGlyYS52MS5TdWJtaXRDb250YWN0TWVz'
    'c2FnZVJlc3BvbnNlEnsKGlByb2Nlc3NJbmJvdW5kRW1haWxXZWJob29rEi0ucHVibGlyYS52MS'
    '5Qcm9jZXNzSW5ib3VuZEVtYWlsV2ViaG9va1JlcXVlc3QaLi5wdWJsaXJhLnYxLlByb2Nlc3NJ'
    'bmJvdW5kRW1haWxXZWJob29rUmVzcG9uc2U=');
