// This is a generated file - do not edit.
//
// Generated from publira/v1/creator.proto.

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

@$core.Deprecated('Use creatorStatementLineSourceDescriptor instead')
const CreatorStatementLineSource$json = {
  '1': 'CreatorStatementLineSource',
  '2': [
    {'1': 'CREATOR_STATEMENT_LINE_SOURCE_UNSPECIFIED', '2': 0},
    {'1': 'CREATOR_STATEMENT_LINE_SOURCE_SALE', '2': 1},
    {'1': 'CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION', '2': 2},
  ],
};

/// Descriptor for `CreatorStatementLineSource`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List creatorStatementLineSourceDescriptor = $convert.base64Decode(
    'ChpDcmVhdG9yU3RhdGVtZW50TGluZVNvdXJjZRItCilDUkVBVE9SX1NUQVRFTUVOVF9MSU5FX1'
    'NPVVJDRV9VTlNQRUNJRklFRBAAEiYKIkNSRUFUT1JfU1RBVEVNRU5UX0xJTkVfU09VUkNFX1NB'
    'TEUQARIuCipDUkVBVE9SX1NUQVRFTUVOVF9MSU5FX1NPVVJDRV9TVUJTQ1JJUFRJT04QAg==');

@$core.Deprecated('Use myCreatorDescriptor instead')
const MyCreator$json = {
  '1': 'MyCreator',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'icon_image_url', '3': 4, '4': 1, '5': 9, '10': 'iconImageUrl'},
    {
      '1': 'published_series_count',
      '3': 5,
      '4': 1,
      '5': 5,
      '10': 'publishedSeriesCount'
    },
  ],
};

/// Descriptor for `MyCreator`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myCreatorDescriptor = $convert.base64Decode(
    'CglNeUNyZWF0b3ISDgoCaWQYASABKAlSAmlkEhsKCXB1YmxpY19pZBgCIAEoCVIIcHVibGljSW'
    'QSEgoEbmFtZRgDIAEoCVIEbmFtZRIkCg5pY29uX2ltYWdlX3VybBgEIAEoCVIMaWNvbkltYWdl'
    'VXJsEjQKFnB1Ymxpc2hlZF9zZXJpZXNfY291bnQYBSABKAVSFHB1Ymxpc2hlZFNlcmllc0NvdW'
    '50');

@$core.Deprecated('Use listMyCreatorsRequestDescriptor instead')
const ListMyCreatorsRequest$json = {
  '1': 'ListMyCreatorsRequest',
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

/// Descriptor for `ListMyCreatorsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyCreatorsRequestDescriptor = $convert.base64Decode(
    'ChVMaXN0TXlDcmVhdG9yc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy'
    '52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgCIAEoDjIfLnB1YmxpcmEudHlw'
    'ZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZQ==');

@$core.Deprecated('Use listMyCreatorsResponseDescriptor instead')
const ListMyCreatorsResponse$json = {
  '1': 'ListMyCreatorsResponse',
  '2': [
    {
      '1': 'creators',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyCreator',
      '10': 'creators'
    },
    {'1': 'sales_visible', '3': 2, '4': 1, '5': 8, '10': 'salesVisible'},
  ],
};

/// Descriptor for `ListMyCreatorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyCreatorsResponseDescriptor = $convert.base64Decode(
    'ChZMaXN0TXlDcmVhdG9yc1Jlc3BvbnNlEjEKCGNyZWF0b3JzGAEgAygLMhUucHVibGlyYS52MS'
    '5NeUNyZWF0b3JSCGNyZWF0b3JzEiMKDXNhbGVzX3Zpc2libGUYAiABKAhSDHNhbGVzVmlzaWJs'
    'ZQ==');

@$core.Deprecated('Use myCreatorEpisodeStatsDescriptor instead')
const MyCreatorEpisodeStats$json = {
  '1': 'MyCreatorEpisodeStats',
  '2': [
    {'1': 'series_public_id', '3': 1, '4': 1, '5': 9, '10': 'seriesPublicId'},
    {'1': 'series_title', '3': 2, '4': 1, '5': 9, '10': 'seriesTitle'},
    {'1': 'episode_public_id', '3': 3, '4': 1, '5': 9, '10': 'episodePublicId'},
    {'1': 'episode_title', '3': 4, '4': 1, '5': 9, '10': 'episodeTitle'},
    {'1': 'member_view_count', '3': 5, '4': 1, '5': 3, '10': 'memberViewCount'},
    {'1': 'complete_count', '3': 6, '4': 1, '5': 3, '10': 'completeCount'},
    {
      '1': 'purchase_count',
      '3': 7,
      '4': 1,
      '5': 3,
      '9': 0,
      '10': 'purchaseCount',
      '17': true
    },
    {
      '1': 'net_amount',
      '3': 8,
      '4': 1,
      '5': 3,
      '9': 1,
      '10': 'netAmount',
      '17': true
    },
  ],
  '8': [
    {'1': '_purchase_count'},
    {'1': '_net_amount'},
  ],
};

/// Descriptor for `MyCreatorEpisodeStats`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myCreatorEpisodeStatsDescriptor = $convert.base64Decode(
    'ChVNeUNyZWF0b3JFcGlzb2RlU3RhdHMSKAoQc2VyaWVzX3B1YmxpY19pZBgBIAEoCVIOc2VyaW'
    'VzUHVibGljSWQSIQoMc2VyaWVzX3RpdGxlGAIgASgJUgtzZXJpZXNUaXRsZRIqChFlcGlzb2Rl'
    'X3B1YmxpY19pZBgDIAEoCVIPZXBpc29kZVB1YmxpY0lkEiMKDWVwaXNvZGVfdGl0bGUYBCABKA'
    'lSDGVwaXNvZGVUaXRsZRIqChFtZW1iZXJfdmlld19jb3VudBgFIAEoA1IPbWVtYmVyVmlld0Nv'
    'dW50EiUKDmNvbXBsZXRlX2NvdW50GAYgASgDUg1jb21wbGV0ZUNvdW50EioKDnB1cmNoYXNlX2'
    'NvdW50GAcgASgDSABSDXB1cmNoYXNlQ291bnSIAQESIgoKbmV0X2Ftb3VudBgIIAEoA0gBUglu'
    'ZXRBbW91bnSIAQFCEQoPX3B1cmNoYXNlX2NvdW50Qg0KC19uZXRfYW1vdW50');

@$core.Deprecated('Use getMyCreatorStatsRequestDescriptor instead')
const GetMyCreatorStatsRequest$json = {
  '1': 'GetMyCreatorStatsRequest',
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
    {'1': 'creator_id', '3': 3, '4': 1, '5': 9, '10': 'creatorId'},
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
    {'1': 'limit', '3': 5, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 6, '4': 1, '5': 9, '10': 'token'},
  ],
};

/// Descriptor for `GetMyCreatorStatsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyCreatorStatsRequestDescriptor = $convert.base64Decode(
    'ChhHZXRNeUNyZWF0b3JTdGF0c1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgCIAEoDjIfLnB1YmxpcmEu'
    'dHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCgpjcmVhdG9yX2lkGAMgASgJUgljcm'
    'VhdG9ySWQSFgoGbG9jYWxlGAQgASgJUgZsb2NhbGUSFAoFbGltaXQYBSABKAVSBWxpbWl0EhQK'
    'BXRva2VuGAYgASgJUgV0b2tlbg==');

@$core.Deprecated('Use getMyCreatorStatsResponseDescriptor instead')
const GetMyCreatorStatsResponse$json = {
  '1': 'GetMyCreatorStatsResponse',
  '2': [
    {'1': 'period_start', '3': 1, '4': 1, '5': 9, '10': 'periodStart'},
    {'1': 'period_end', '3': 2, '4': 1, '5': 9, '10': 'periodEnd'},
    {'1': 'time_zone', '3': 3, '4': 1, '5': 9, '10': 'timeZone'},
    {'1': 'follower_count', '3': 4, '4': 1, '5': 3, '10': 'followerCount'},
    {
      '1': 'total_member_view_count',
      '3': 5,
      '4': 1,
      '5': 3,
      '10': 'totalMemberViewCount'
    },
    {
      '1': 'total_complete_count',
      '3': 6,
      '4': 1,
      '5': 3,
      '10': 'totalCompleteCount'
    },
    {'1': 'currency', '3': 7, '4': 1, '5': 9, '10': 'currency'},
    {
      '1': 'episodes',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyCreatorEpisodeStats',
      '10': 'episodes'
    },
    {'1': 'previous_token', '3': 9, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 10, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `GetMyCreatorStatsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyCreatorStatsResponseDescriptor = $convert.base64Decode(
    'ChlHZXRNeUNyZWF0b3JTdGF0c1Jlc3BvbnNlEiEKDHBlcmlvZF9zdGFydBgBIAEoCVILcGVyaW'
    '9kU3RhcnQSHQoKcGVyaW9kX2VuZBgCIAEoCVIJcGVyaW9kRW5kEhsKCXRpbWVfem9uZRgDIAEo'
    'CVIIdGltZVpvbmUSJQoOZm9sbG93ZXJfY291bnQYBCABKANSDWZvbGxvd2VyQ291bnQSNQoXdG'
    '90YWxfbWVtYmVyX3ZpZXdfY291bnQYBSABKANSFHRvdGFsTWVtYmVyVmlld0NvdW50EjAKFHRv'
    'dGFsX2NvbXBsZXRlX2NvdW50GAYgASgDUhJ0b3RhbENvbXBsZXRlQ291bnQSGgoIY3VycmVuY3'
    'kYByABKAlSCGN1cnJlbmN5Ej0KCGVwaXNvZGVzGAggAygLMiEucHVibGlyYS52MS5NeUNyZWF0'
    'b3JFcGlzb2RlU3RhdHNSCGVwaXNvZGVzEiUKDnByZXZpb3VzX3Rva2VuGAkgASgJUg1wcmV2aW'
    '91c1Rva2VuEh0KCm5leHRfdG9rZW4YCiABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use myCreatorStatementDescriptor instead')
const MyCreatorStatement$json = {
  '1': 'MyCreatorStatement',
  '2': [
    {'1': 'period', '3': 1, '4': 1, '5': 9, '10': 'period'},
    {'1': 'time_zone', '3': 2, '4': 1, '5': 9, '10': 'timeZone'},
    {'1': 'closed_at', '3': 3, '4': 1, '5': 9, '10': 'closedAt'},
    {'1': 'currency', '3': 4, '4': 1, '5': 9, '10': 'currency'},
    {'1': 'sale_count', '3': 5, '4': 1, '5': 3, '10': 'saleCount'},
    {'1': 'gross_amount', '3': 6, '4': 1, '5': 3, '10': 'grossAmount'},
    {'1': 'refunded_amount', '3': 7, '4': 1, '5': 3, '10': 'refundedAmount'},
    {'1': 'payout_amount', '3': 8, '4': 1, '5': 3, '10': 'payoutAmount'},
  ],
};

/// Descriptor for `MyCreatorStatement`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myCreatorStatementDescriptor = $convert.base64Decode(
    'ChJNeUNyZWF0b3JTdGF0ZW1lbnQSFgoGcGVyaW9kGAEgASgJUgZwZXJpb2QSGwoJdGltZV96b2'
    '5lGAIgASgJUgh0aW1lWm9uZRIbCgljbG9zZWRfYXQYAyABKAlSCGNsb3NlZEF0EhoKCGN1cnJl'
    'bmN5GAQgASgJUghjdXJyZW5jeRIdCgpzYWxlX2NvdW50GAUgASgDUglzYWxlQ291bnQSIQoMZ3'
    'Jvc3NfYW1vdW50GAYgASgDUgtncm9zc0Ftb3VudBInCg9yZWZ1bmRlZF9hbW91bnQYByABKANS'
    'DnJlZnVuZGVkQW1vdW50EiMKDXBheW91dF9hbW91bnQYCCABKANSDHBheW91dEFtb3VudA==');

@$core.Deprecated('Use myCreatorStatementLineDescriptor instead')
const MyCreatorStatementLine$json = {
  '1': 'MyCreatorStatementLine',
  '2': [
    {'1': 'line_number', '3': 1, '4': 1, '5': 5, '10': 'lineNumber'},
    {'1': 'series_public_id', '3': 2, '4': 1, '5': 9, '10': 'seriesPublicId'},
    {'1': 'series_title', '3': 3, '4': 1, '5': 9, '10': 'seriesTitle'},
    {'1': 'episode_public_id', '3': 4, '4': 1, '5': 9, '10': 'episodePublicId'},
    {'1': 'episode_title', '3': 5, '4': 1, '5': 9, '10': 'episodeTitle'},
    {'1': 'role_name', '3': 6, '4': 1, '5': 9, '10': 'roleName'},
    {'1': 'sale_count', '3': 7, '4': 1, '5': 5, '10': 'saleCount'},
    {'1': 'gross_amount', '3': 8, '4': 1, '5': 3, '10': 'grossAmount'},
    {'1': 'refunded_amount', '3': 9, '4': 1, '5': 3, '10': 'refundedAmount'},
    {'1': 'share_bps', '3': 10, '4': 1, '5': 5, '10': 'shareBps'},
    {'1': 'payout_amount', '3': 11, '4': 1, '5': 3, '10': 'payoutAmount'},
    {'1': 'adjusted_period', '3': 12, '4': 1, '5': 9, '10': 'adjustedPeriod'},
    {
      '1': 'source',
      '3': 13,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.CreatorStatementLineSource',
      '10': 'source'
    },
  ],
};

/// Descriptor for `MyCreatorStatementLine`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myCreatorStatementLineDescriptor = $convert.base64Decode(
    'ChZNeUNyZWF0b3JTdGF0ZW1lbnRMaW5lEh8KC2xpbmVfbnVtYmVyGAEgASgFUgpsaW5lTnVtYm'
    'VyEigKEHNlcmllc19wdWJsaWNfaWQYAiABKAlSDnNlcmllc1B1YmxpY0lkEiEKDHNlcmllc190'
    'aXRsZRgDIAEoCVILc2VyaWVzVGl0bGUSKgoRZXBpc29kZV9wdWJsaWNfaWQYBCABKAlSD2VwaX'
    'NvZGVQdWJsaWNJZBIjCg1lcGlzb2RlX3RpdGxlGAUgASgJUgxlcGlzb2RlVGl0bGUSGwoJcm9s'
    'ZV9uYW1lGAYgASgJUghyb2xlTmFtZRIdCgpzYWxlX2NvdW50GAcgASgFUglzYWxlQ291bnQSIQ'
    'oMZ3Jvc3NfYW1vdW50GAggASgDUgtncm9zc0Ftb3VudBInCg9yZWZ1bmRlZF9hbW91bnQYCSAB'
    'KANSDnJlZnVuZGVkQW1vdW50EhsKCXNoYXJlX2JwcxgKIAEoBVIIc2hhcmVCcHMSIwoNcGF5b3'
    'V0X2Ftb3VudBgLIAEoA1IMcGF5b3V0QW1vdW50EicKD2FkanVzdGVkX3BlcmlvZBgMIAEoCVIO'
    'YWRqdXN0ZWRQZXJpb2QSPgoGc291cmNlGA0gASgOMiYucHVibGlyYS52MS5DcmVhdG9yU3RhdG'
    'VtZW50TGluZVNvdXJjZVIGc291cmNl');

@$core.Deprecated('Use listMyCreatorStatementsRequestDescriptor instead')
const ListMyCreatorStatementsRequest$json = {
  '1': 'ListMyCreatorStatementsRequest',
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
    {'1': 'creator_id', '3': 3, '4': 1, '5': 9, '10': 'creatorId'},
    {'1': 'limit', '3': 4, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 5, '4': 1, '5': 9, '10': 'token'},
  ],
};

/// Descriptor for `ListMyCreatorStatementsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyCreatorStatementsRequestDescriptor = $convert.base64Decode(
    'Ch5MaXN0TXlDcmVhdG9yU3RhdGVtZW50c1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
    'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgCIAEoDjIfLnB1'
    'YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCgpjcmVhdG9yX2lkGAMgAS'
    'gJUgljcmVhdG9ySWQSFAoFbGltaXQYBCABKAVSBWxpbWl0EhQKBXRva2VuGAUgASgJUgV0b2tl'
    'bg==');

@$core.Deprecated('Use listMyCreatorStatementsResponseDescriptor instead')
const ListMyCreatorStatementsResponse$json = {
  '1': 'ListMyCreatorStatementsResponse',
  '2': [
    {
      '1': 'statements',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyCreatorStatement',
      '10': 'statements'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyCreatorStatementsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyCreatorStatementsResponseDescriptor =
    $convert.base64Decode(
        'Ch9MaXN0TXlDcmVhdG9yU3RhdGVtZW50c1Jlc3BvbnNlEj4KCnN0YXRlbWVudHMYASADKAsyHi'
        '5wdWJsaXJhLnYxLk15Q3JlYXRvclN0YXRlbWVudFIKc3RhdGVtZW50cxIlCg5wcmV2aW91c190'
        'b2tlbhgCIAEoCVINcHJldmlvdXNUb2tlbhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW'
        '4=');

@$core.Deprecated('Use getMyCreatorStatementRequestDescriptor instead')
const GetMyCreatorStatementRequest$json = {
  '1': 'GetMyCreatorStatementRequest',
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
    {'1': 'creator_id', '3': 3, '4': 1, '5': 9, '10': 'creatorId'},
    {'1': 'period', '3': 4, '4': 1, '5': 9, '10': 'period'},
    {'1': 'limit', '3': 5, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 6, '4': 1, '5': 9, '10': 'token'},
  ],
};

/// Descriptor for `GetMyCreatorStatementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyCreatorStatementRequestDescriptor = $convert.base64Decode(
    'ChxHZXRNeUNyZWF0b3JTdGF0ZW1lbnRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjkKB3N1cmZhY2UYAiABKA4yHy5wdWJs'
    'aXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2USHQoKY3JlYXRvcl9pZBgDIAEoCV'
    'IJY3JlYXRvcklkEhYKBnBlcmlvZBgEIAEoCVIGcGVyaW9kEhQKBWxpbWl0GAUgASgFUgVsaW1p'
    'dBIUCgV0b2tlbhgGIAEoCVIFdG9rZW4=');

@$core.Deprecated('Use getMyCreatorStatementResponseDescriptor instead')
const GetMyCreatorStatementResponse$json = {
  '1': 'GetMyCreatorStatementResponse',
  '2': [
    {
      '1': 'statement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.MyCreatorStatement',
      '10': 'statement'
    },
    {
      '1': 'lines',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyCreatorStatementLine',
      '10': 'lines'
    },
    {'1': 'previous_token', '3': 3, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 4, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `GetMyCreatorStatementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyCreatorStatementResponseDescriptor = $convert.base64Decode(
    'Ch1HZXRNeUNyZWF0b3JTdGF0ZW1lbnRSZXNwb25zZRI8CglzdGF0ZW1lbnQYASABKAsyHi5wdW'
    'JsaXJhLnYxLk15Q3JlYXRvclN0YXRlbWVudFIJc3RhdGVtZW50EjgKBWxpbmVzGAIgAygLMiIu'
    'cHVibGlyYS52MS5NeUNyZWF0b3JTdGF0ZW1lbnRMaW5lUgVsaW5lcxIlCg5wcmV2aW91c190b2'
    'tlbhgDIAEoCVINcHJldmlvdXNUb2tlbhIdCgpuZXh0X3Rva2VuGAQgASgJUgluZXh0VG9rZW4=');

const $core.Map<$core.String, $core.dynamic> CreatorServiceBase$json = {
  '1': 'CreatorService',
  '2': [
    {
      '1': 'ListMyCreators',
      '2': '.publira.v1.ListMyCreatorsRequest',
      '3': '.publira.v1.ListMyCreatorsResponse'
    },
    {
      '1': 'GetMyCreatorStats',
      '2': '.publira.v1.GetMyCreatorStatsRequest',
      '3': '.publira.v1.GetMyCreatorStatsResponse'
    },
    {
      '1': 'ListMyCreatorStatements',
      '2': '.publira.v1.ListMyCreatorStatementsRequest',
      '3': '.publira.v1.ListMyCreatorStatementsResponse'
    },
    {
      '1': 'GetMyCreatorStatement',
      '2': '.publira.v1.GetMyCreatorStatementRequest',
      '3': '.publira.v1.GetMyCreatorStatementResponse'
    },
  ],
};

@$core.Deprecated('Use creatorServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    CreatorServiceBase$messageJson = {
  '.publira.v1.ListMyCreatorsRequest': ListMyCreatorsRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ListMyCreatorsResponse': ListMyCreatorsResponse$json,
  '.publira.v1.MyCreator': MyCreator$json,
  '.publira.v1.GetMyCreatorStatsRequest': GetMyCreatorStatsRequest$json,
  '.publira.v1.GetMyCreatorStatsResponse': GetMyCreatorStatsResponse$json,
  '.publira.v1.MyCreatorEpisodeStats': MyCreatorEpisodeStats$json,
  '.publira.v1.ListMyCreatorStatementsRequest':
      ListMyCreatorStatementsRequest$json,
  '.publira.v1.ListMyCreatorStatementsResponse':
      ListMyCreatorStatementsResponse$json,
  '.publira.v1.MyCreatorStatement': MyCreatorStatement$json,
  '.publira.v1.GetMyCreatorStatementRequest': GetMyCreatorStatementRequest$json,
  '.publira.v1.GetMyCreatorStatementResponse':
      GetMyCreatorStatementResponse$json,
  '.publira.v1.MyCreatorStatementLine': MyCreatorStatementLine$json,
};

/// Descriptor for `CreatorService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List creatorServiceDescriptor = $convert.base64Decode(
    'Cg5DcmVhdG9yU2VydmljZRJXCg5MaXN0TXlDcmVhdG9ycxIhLnB1YmxpcmEudjEuTGlzdE15Q3'
    'JlYXRvcnNSZXF1ZXN0GiIucHVibGlyYS52MS5MaXN0TXlDcmVhdG9yc1Jlc3BvbnNlEmAKEUdl'
    'dE15Q3JlYXRvclN0YXRzEiQucHVibGlyYS52MS5HZXRNeUNyZWF0b3JTdGF0c1JlcXVlc3QaJS'
    '5wdWJsaXJhLnYxLkdldE15Q3JlYXRvclN0YXRzUmVzcG9uc2UScgoXTGlzdE15Q3JlYXRvclN0'
    'YXRlbWVudHMSKi5wdWJsaXJhLnYxLkxpc3RNeUNyZWF0b3JTdGF0ZW1lbnRzUmVxdWVzdBorLn'
    'B1YmxpcmEudjEuTGlzdE15Q3JlYXRvclN0YXRlbWVudHNSZXNwb25zZRJsChVHZXRNeUNyZWF0'
    'b3JTdGF0ZW1lbnQSKC5wdWJsaXJhLnYxLkdldE15Q3JlYXRvclN0YXRlbWVudFJlcXVlc3QaKS'
    '5wdWJsaXJhLnYxLkdldE15Q3JlYXRvclN0YXRlbWVudFJlc3BvbnNl');
