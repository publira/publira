// This is a generated file - do not edit.
//
// Generated from publira/v1/notification.proto.

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

@$core.Deprecated('Use pushPlatformDescriptor instead')
const PushPlatform$json = {
  '1': 'PushPlatform',
  '2': [
    {'1': 'PUSH_PLATFORM_UNSPECIFIED', '2': 0},
    {'1': 'PUSH_PLATFORM_ANDROID', '2': 1},
    {'1': 'PUSH_PLATFORM_IOS', '2': 2},
    {'1': 'PUSH_PLATFORM_WEB', '2': 3},
  ],
};

/// Descriptor for `PushPlatform`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List pushPlatformDescriptor = $convert.base64Decode(
    'CgxQdXNoUGxhdGZvcm0SHQoZUFVTSF9QTEFURk9STV9VTlNQRUNJRklFRBAAEhkKFVBVU0hfUE'
    'xBVEZPUk1fQU5EUk9JRBABEhUKEVBVU0hfUExBVEZPUk1fSU9TEAISFQoRUFVTSF9QTEFURk9S'
    'TV9XRUIQAw==');

@$core.Deprecated('Use notificationItemDescriptor instead')
const NotificationItem$json = {
  '1': 'NotificationItem',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'notification_type',
      '3': 2,
      '4': 1,
      '5': 9,
      '10': 'notificationType'
    },
    {'1': 'payload', '3': 3, '4': 1, '5': 9, '10': 'payload'},
    {'1': 'is_read', '3': 4, '4': 1, '5': 8, '10': 'isRead'},
    {'1': 'read_at', '3': 5, '4': 1, '5': 9, '10': 'readAt'},
    {'1': 'created_at', '3': 6, '4': 1, '5': 9, '10': 'createdAt'},
  ],
};

/// Descriptor for `NotificationItem`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List notificationItemDescriptor = $convert.base64Decode(
    'ChBOb3RpZmljYXRpb25JdGVtEg4KAmlkGAEgASgJUgJpZBIrChFub3RpZmljYXRpb25fdHlwZR'
    'gCIAEoCVIQbm90aWZpY2F0aW9uVHlwZRIYCgdwYXlsb2FkGAMgASgJUgdwYXlsb2FkEhcKB2lz'
    'X3JlYWQYBCABKAhSBmlzUmVhZBIXCgdyZWFkX2F0GAUgASgJUgZyZWFkQXQSHQoKY3JlYXRlZF'
    '9hdBgGIAEoCVIJY3JlYXRlZEF0');

@$core.Deprecated('Use listNotificationsRequestDescriptor instead')
const ListNotificationsRequest$json = {
  '1': 'ListNotificationsRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'limit', '3': 2, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 3, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `ListNotificationsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNotificationsRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0Tm90aWZpY2F0aW9uc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAiABKAVSBWxpbWl0EhQKBXRv'
    'a2VuGAMgASgJUgV0b2tlbhI5CgdzdXJmYWNlGAQgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbG'
    'llbnRTdXJmYWNlUgdzdXJmYWNl');

@$core.Deprecated('Use listNotificationsResponseDescriptor instead')
const ListNotificationsResponse$json = {
  '1': 'ListNotificationsResponse',
  '2': [
    {
      '1': 'notifications',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.NotificationItem',
      '10': 'notifications'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListNotificationsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listNotificationsResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0Tm90aWZpY2F0aW9uc1Jlc3BvbnNlEkIKDW5vdGlmaWNhdGlvbnMYASADKAsyHC5wdW'
    'JsaXJhLnYxLk5vdGlmaWNhdGlvbkl0ZW1SDW5vdGlmaWNhdGlvbnMSJQoOcHJldmlvdXNfdG9r'
    'ZW4YAiABKAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use registerPushDeviceRequestDescriptor instead')
const RegisterPushDeviceRequest$json = {
  '1': 'RegisterPushDeviceRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'token', '3': 2, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'platform',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.PushPlatform',
      '10': 'platform'
    },
    {'1': 'endpoint', '3': 4, '4': 1, '5': 9, '10': 'endpoint'},
    {'1': 'p256dh', '3': 5, '4': 1, '5': 9, '10': 'p256dh'},
    {'1': 'auth', '3': 6, '4': 1, '5': 9, '10': 'auth'},
  ],
};

/// Descriptor for `RegisterPushDeviceRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List registerPushDeviceRequestDescriptor = $convert.base64Decode(
    'ChlSZWdpc3RlclB1c2hEZXZpY2VSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBXRva2VuGAIgASgJUgV0b2tlbhI0Cghw'
    'bGF0Zm9ybRgDIAEoDjIYLnB1YmxpcmEudjEuUHVzaFBsYXRmb3JtUghwbGF0Zm9ybRIaCghlbm'
    'Rwb2ludBgEIAEoCVIIZW5kcG9pbnQSFgoGcDI1NmRoGAUgASgJUgZwMjU2ZGgSEgoEYXV0aBgG'
    'IAEoCVIEYXV0aA==');

@$core.Deprecated('Use registerPushDeviceResponseDescriptor instead')
const RegisterPushDeviceResponse$json = {
  '1': 'RegisterPushDeviceResponse',
  '2': [
    {'1': 'registered', '3': 1, '4': 1, '5': 8, '10': 'registered'},
  ],
};

/// Descriptor for `RegisterPushDeviceResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List registerPushDeviceResponseDescriptor =
    $convert.base64Decode(
        'ChpSZWdpc3RlclB1c2hEZXZpY2VSZXNwb25zZRIeCgpyZWdpc3RlcmVkGAEgASgIUgpyZWdpc3'
        'RlcmVk');

@$core.Deprecated('Use unregisterPushDeviceRequestDescriptor instead')
const UnregisterPushDeviceRequest$json = {
  '1': 'UnregisterPushDeviceRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'token', '3': 2, '4': 1, '5': 9, '10': 'token'},
    {'1': 'endpoint', '3': 3, '4': 1, '5': 9, '10': 'endpoint'},
  ],
};

/// Descriptor for `UnregisterPushDeviceRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unregisterPushDeviceRequestDescriptor =
    $convert.base64Decode(
        'ChtVbnJlZ2lzdGVyUHVzaERldmljZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
        '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFdG9rZW4YAiABKAlSBXRva2VuEhoK'
        'CGVuZHBvaW50GAMgASgJUghlbmRwb2ludA==');

@$core.Deprecated('Use unregisterPushDeviceResponseDescriptor instead')
const UnregisterPushDeviceResponse$json = {
  '1': 'UnregisterPushDeviceResponse',
  '2': [
    {'1': 'unregistered', '3': 1, '4': 1, '5': 8, '10': 'unregistered'},
  ],
};

/// Descriptor for `UnregisterPushDeviceResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unregisterPushDeviceResponseDescriptor =
    $convert.base64Decode(
        'ChxVbnJlZ2lzdGVyUHVzaERldmljZVJlc3BvbnNlEiIKDHVucmVnaXN0ZXJlZBgBIAEoCFIMdW'
        '5yZWdpc3RlcmVk');

@$core.Deprecated('Use countUnreadNotificationsRequestDescriptor instead')
const CountUnreadNotificationsRequest$json = {
  '1': 'CountUnreadNotificationsRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {
      '1': 'surface',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `CountUnreadNotificationsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List countUnreadNotificationsRequestDescriptor =
    $convert.base64Decode(
        'Ch9Db3VudFVucmVhZE5vdGlmaWNhdGlvbnNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjkKB3N1cmZhY2UYAiABKA4yHy5w'
        'dWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2U=');

@$core.Deprecated('Use countUnreadNotificationsResponseDescriptor instead')
const CountUnreadNotificationsResponse$json = {
  '1': 'CountUnreadNotificationsResponse',
  '2': [
    {'1': 'unread_count', '3': 1, '4': 1, '5': 5, '10': 'unreadCount'},
  ],
};

/// Descriptor for `CountUnreadNotificationsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List countUnreadNotificationsResponseDescriptor =
    $convert.base64Decode(
        'CiBDb3VudFVucmVhZE5vdGlmaWNhdGlvbnNSZXNwb25zZRIhCgx1bnJlYWRfY291bnQYASABKA'
        'VSC3VucmVhZENvdW50');

@$core.Deprecated('Use markNotificationAsReadRequestDescriptor instead')
const MarkNotificationAsReadRequest$json = {
  '1': 'MarkNotificationAsReadRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'notification_id', '3': 2, '4': 1, '5': 9, '10': 'notificationId'},
  ],
};

/// Descriptor for `MarkNotificationAsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markNotificationAsReadRequestDescriptor =
    $convert.base64Decode(
        'Ch1NYXJrTm90aWZpY2F0aW9uQXNSZWFkUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
        'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBInCg9ub3RpZmljYXRpb25faWQYAiAB'
        'KAlSDm5vdGlmaWNhdGlvbklk');

@$core.Deprecated('Use markNotificationAsReadResponseDescriptor instead')
const MarkNotificationAsReadResponse$json = {
  '1': 'MarkNotificationAsReadResponse',
  '2': [
    {'1': 'marked', '3': 1, '4': 1, '5': 8, '10': 'marked'},
  ],
};

/// Descriptor for `MarkNotificationAsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markNotificationAsReadResponseDescriptor =
    $convert.base64Decode(
        'Ch5NYXJrTm90aWZpY2F0aW9uQXNSZWFkUmVzcG9uc2USFgoGbWFya2VkGAEgASgIUgZtYXJrZW'
        'Q=');

@$core.Deprecated('Use markAllNotificationsAsReadRequestDescriptor instead')
const MarkAllNotificationsAsReadRequest$json = {
  '1': 'MarkAllNotificationsAsReadRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {
      '1': 'surface',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `MarkAllNotificationsAsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllNotificationsAsReadRequestDescriptor =
    $convert.base64Decode(
        'CiFNYXJrQWxsTm90aWZpY2F0aW9uc0FzUmVhZFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucH'
        'VibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgCIAEoDjIf'
        'LnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZQ==');

@$core.Deprecated('Use markAllNotificationsAsReadResponseDescriptor instead')
const MarkAllNotificationsAsReadResponse$json = {
  '1': 'MarkAllNotificationsAsReadResponse',
  '2': [
    {'1': 'marked_count', '3': 1, '4': 1, '5': 5, '10': 'markedCount'},
  ],
};

/// Descriptor for `MarkAllNotificationsAsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllNotificationsAsReadResponseDescriptor =
    $convert.base64Decode(
        'CiJNYXJrQWxsTm90aWZpY2F0aW9uc0FzUmVhZFJlc3BvbnNlEiEKDG1hcmtlZF9jb3VudBgBIA'
        'EoBVILbWFya2VkQ291bnQ=');

const $core.Map<$core.String, $core.dynamic> NotificationServiceBase$json = {
  '1': 'NotificationService',
  '2': [
    {
      '1': 'ListNotifications',
      '2': '.publira.v1.ListNotificationsRequest',
      '3': '.publira.v1.ListNotificationsResponse'
    },
    {
      '1': 'CountUnreadNotifications',
      '2': '.publira.v1.CountUnreadNotificationsRequest',
      '3': '.publira.v1.CountUnreadNotificationsResponse'
    },
    {
      '1': 'MarkNotificationAsRead',
      '2': '.publira.v1.MarkNotificationAsReadRequest',
      '3': '.publira.v1.MarkNotificationAsReadResponse'
    },
    {
      '1': 'MarkAllNotificationsAsRead',
      '2': '.publira.v1.MarkAllNotificationsAsReadRequest',
      '3': '.publira.v1.MarkAllNotificationsAsReadResponse'
    },
    {
      '1': 'RegisterPushDevice',
      '2': '.publira.v1.RegisterPushDeviceRequest',
      '3': '.publira.v1.RegisterPushDeviceResponse'
    },
    {
      '1': 'UnregisterPushDevice',
      '2': '.publira.v1.UnregisterPushDeviceRequest',
      '3': '.publira.v1.UnregisterPushDeviceResponse'
    },
  ],
};

@$core.Deprecated('Use notificationServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    NotificationServiceBase$messageJson = {
  '.publira.v1.ListNotificationsRequest': ListNotificationsRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ListNotificationsResponse': ListNotificationsResponse$json,
  '.publira.v1.NotificationItem': NotificationItem$json,
  '.publira.v1.CountUnreadNotificationsRequest':
      CountUnreadNotificationsRequest$json,
  '.publira.v1.CountUnreadNotificationsResponse':
      CountUnreadNotificationsResponse$json,
  '.publira.v1.MarkNotificationAsReadRequest':
      MarkNotificationAsReadRequest$json,
  '.publira.v1.MarkNotificationAsReadResponse':
      MarkNotificationAsReadResponse$json,
  '.publira.v1.MarkAllNotificationsAsReadRequest':
      MarkAllNotificationsAsReadRequest$json,
  '.publira.v1.MarkAllNotificationsAsReadResponse':
      MarkAllNotificationsAsReadResponse$json,
  '.publira.v1.RegisterPushDeviceRequest': RegisterPushDeviceRequest$json,
  '.publira.v1.RegisterPushDeviceResponse': RegisterPushDeviceResponse$json,
  '.publira.v1.UnregisterPushDeviceRequest': UnregisterPushDeviceRequest$json,
  '.publira.v1.UnregisterPushDeviceResponse': UnregisterPushDeviceResponse$json,
};

/// Descriptor for `NotificationService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List notificationServiceDescriptor = $convert.base64Decode(
    'ChNOb3RpZmljYXRpb25TZXJ2aWNlEmAKEUxpc3ROb3RpZmljYXRpb25zEiQucHVibGlyYS52MS'
    '5MaXN0Tm90aWZpY2F0aW9uc1JlcXVlc3QaJS5wdWJsaXJhLnYxLkxpc3ROb3RpZmljYXRpb25z'
    'UmVzcG9uc2USdQoYQ291bnRVbnJlYWROb3RpZmljYXRpb25zEisucHVibGlyYS52MS5Db3VudF'
    'VucmVhZE5vdGlmaWNhdGlvbnNSZXF1ZXN0GiwucHVibGlyYS52MS5Db3VudFVucmVhZE5vdGlm'
    'aWNhdGlvbnNSZXNwb25zZRJvChZNYXJrTm90aWZpY2F0aW9uQXNSZWFkEikucHVibGlyYS52MS'
    '5NYXJrTm90aWZpY2F0aW9uQXNSZWFkUmVxdWVzdBoqLnB1YmxpcmEudjEuTWFya05vdGlmaWNh'
    'dGlvbkFzUmVhZFJlc3BvbnNlEnsKGk1hcmtBbGxOb3RpZmljYXRpb25zQXNSZWFkEi0ucHVibG'
    'lyYS52MS5NYXJrQWxsTm90aWZpY2F0aW9uc0FzUmVhZFJlcXVlc3QaLi5wdWJsaXJhLnYxLk1h'
    'cmtBbGxOb3RpZmljYXRpb25zQXNSZWFkUmVzcG9uc2USYwoSUmVnaXN0ZXJQdXNoRGV2aWNlEi'
    'UucHVibGlyYS52MS5SZWdpc3RlclB1c2hEZXZpY2VSZXF1ZXN0GiYucHVibGlyYS52MS5SZWdp'
    'c3RlclB1c2hEZXZpY2VSZXNwb25zZRJpChRVbnJlZ2lzdGVyUHVzaERldmljZRInLnB1Ymxpcm'
    'EudjEuVW5yZWdpc3RlclB1c2hEZXZpY2VSZXF1ZXN0GigucHVibGlyYS52MS5VbnJlZ2lzdGVy'
    'UHVzaERldmljZVJlc3BvbnNl');
