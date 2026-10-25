// This is a generated file - do not edit.
//
// Generated from publira/v1/catalog.proto.

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

@$core.Deprecated('Use seriesOrderDescriptor instead')
const SeriesOrder$json = {
  '1': 'SeriesOrder',
  '2': [
    {'1': 'SERIES_ORDER_UNSPECIFIED', '2': 0},
    {'1': 'SERIES_ORDER_PUBLISHED_AT_DESC', '2': 1},
    {'1': 'SERIES_ORDER_PUBLISHED_AT_ASC', '2': 2},
    {'1': 'SERIES_ORDER_TITLE_ASC', '2': 3},
    {'1': 'SERIES_ORDER_TITLE_DESC', '2': 4},
    {'1': 'SERIES_ORDER_LATEST_EPISODE_AT_DESC', '2': 5},
  ],
};

/// Descriptor for `SeriesOrder`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List seriesOrderDescriptor = $convert.base64Decode(
    'CgtTZXJpZXNPcmRlchIcChhTRVJJRVNfT1JERVJfVU5TUEVDSUZJRUQQABIiCh5TRVJJRVNfT1'
    'JERVJfUFVCTElTSEVEX0FUX0RFU0MQARIhCh1TRVJJRVNfT1JERVJfUFVCTElTSEVEX0FUX0FT'
    'QxACEhoKFlNFUklFU19PUkRFUl9USVRMRV9BU0MQAxIbChdTRVJJRVNfT1JERVJfVElUTEVfRE'
    'VTQxAEEicKI1NFUklFU19PUkRFUl9MQVRFU1RfRVBJU09ERV9BVF9ERVNDEAU=');

@$core.Deprecated('Use episodeAccessDescriptor instead')
const EpisodeAccess$json = {
  '1': 'EpisodeAccess',
  '2': [
    {'1': 'EPISODE_ACCESS_UNSPECIFIED', '2': 0},
    {'1': 'EPISODE_ACCESS_FREE', '2': 1},
    {'1': 'EPISODE_ACCESS_LOCKED', '2': 2},
    {'1': 'EPISODE_ACCESS_ENTITLED', '2': 3},
    {'1': 'EPISODE_ACCESS_AGE_RESTRICTED', '2': 4},
  ],
};

/// Descriptor for `EpisodeAccess`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List episodeAccessDescriptor = $convert.base64Decode(
    'Cg1FcGlzb2RlQWNjZXNzEh4KGkVQSVNPREVfQUNDRVNTX1VOU1BFQ0lGSUVEEAASFwoTRVBJU0'
    '9ERV9BQ0NFU1NfRlJFRRABEhkKFUVQSVNPREVfQUNDRVNTX0xPQ0tFRBACEhsKF0VQSVNPREVf'
    'QUNDRVNTX0VOVElUTEVEEAMSIQodRVBJU09ERV9BQ0NFU1NfQUdFX1JFU1RSSUNURUQQBA==');

@$core.Deprecated('Use episodeEntitlementSourceDescriptor instead')
const EpisodeEntitlementSource$json = {
  '1': 'EpisodeEntitlementSource',
  '2': [
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_UNSPECIFIED', '2': 0},
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_PURCHASE', '2': 1},
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_ACCESS_TICKET', '2': 2},
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_CREATOR', '2': 3},
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_STAFF', '2': 4},
    {'1': 'EPISODE_ENTITLEMENT_SOURCE_SUBSCRIPTION', '2': 5},
  ],
};

/// Descriptor for `EpisodeEntitlementSource`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List episodeEntitlementSourceDescriptor = $convert.base64Decode(
    'ChhFcGlzb2RlRW50aXRsZW1lbnRTb3VyY2USKgomRVBJU09ERV9FTlRJVExFTUVOVF9TT1VSQ0'
    'VfVU5TUEVDSUZJRUQQABInCiNFUElTT0RFX0VOVElUTEVNRU5UX1NPVVJDRV9QVVJDSEFTRRAB'
    'EiwKKEVQSVNPREVfRU5USVRMRU1FTlRfU09VUkNFX0FDQ0VTU19USUNLRVQQAhImCiJFUElTT0'
    'RFX0VOVElUTEVNRU5UX1NPVVJDRV9DUkVBVE9SEAMSJAogRVBJU09ERV9FTlRJVExFTUVOVF9T'
    'T1VSQ0VfU1RBRkYQBBIrCidFUElTT0RFX0VOVElUTEVNRU5UX1NPVVJDRV9TVUJTQ1JJUFRJT0'
    '4QBQ==');

@$core.Deprecated('Use recommendationSourceDescriptor instead')
const RecommendationSource$json = {
  '1': 'RecommendationSource',
  '2': [
    {'1': 'RECOMMENDATION_SOURCE_UNSPECIFIED', '2': 0},
    {'1': 'RECOMMENDATION_SOURCE_RANKING', '2': 1},
    {'1': 'RECOMMENDATION_SOURCE_NEW_ARRIVALS', '2': 2},
    {'1': 'RECOMMENDATION_SOURCE_READER_FEATURES', '2': 3},
  ],
};

/// Descriptor for `RecommendationSource`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List recommendationSourceDescriptor = $convert.base64Decode(
    'ChRSZWNvbW1lbmRhdGlvblNvdXJjZRIlCiFSRUNPTU1FTkRBVElPTl9TT1VSQ0VfVU5TUEVDSU'
    'ZJRUQQABIhCh1SRUNPTU1FTkRBVElPTl9TT1VSQ0VfUkFOS0lORxABEiYKIlJFQ09NTUVOREFU'
    'SU9OX1NPVVJDRV9ORVdfQVJSSVZBTFMQAhIpCiVSRUNPTU1FTkRBVElPTl9TT1VSQ0VfUkVBRE'
    'VSX0ZFQVRVUkVTEAM=');

@$core.Deprecated('Use rankingPeriodDescriptor instead')
const RankingPeriod$json = {
  '1': 'RankingPeriod',
  '2': [
    {'1': 'RANKING_PERIOD_UNSPECIFIED', '2': 0},
    {'1': 'RANKING_PERIOD_DAILY', '2': 1},
    {'1': 'RANKING_PERIOD_WEEKLY', '2': 2},
  ],
};

/// Descriptor for `RankingPeriod`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List rankingPeriodDescriptor = $convert.base64Decode(
    'Cg1SYW5raW5nUGVyaW9kEh4KGlJBTktJTkdfUEVSSU9EX1VOU1BFQ0lGSUVEEAASGAoUUkFOS0'
    'lOR19QRVJJT0RfREFJTFkQARIZChVSQU5LSU5HX1BFUklPRF9XRUVLTFkQAg==');

@$core.Deprecated('Use sitemapEntryKindDescriptor instead')
const SitemapEntryKind$json = {
  '1': 'SitemapEntryKind',
  '2': [
    {'1': 'SITEMAP_ENTRY_KIND_UNSPECIFIED', '2': 0},
    {'1': 'SITEMAP_ENTRY_KIND_SERIES', '2': 1},
    {'1': 'SITEMAP_ENTRY_KIND_EPISODE', '2': 2},
    {'1': 'SITEMAP_ENTRY_KIND_LABEL', '2': 3},
    {'1': 'SITEMAP_ENTRY_KIND_CREATOR', '2': 4},
    {'1': 'SITEMAP_ENTRY_KIND_GENRE', '2': 5},
    {'1': 'SITEMAP_ENTRY_KIND_PAGE', '2': 6},
  ],
};

/// Descriptor for `SitemapEntryKind`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List sitemapEntryKindDescriptor = $convert.base64Decode(
    'ChBTaXRlbWFwRW50cnlLaW5kEiIKHlNJVEVNQVBfRU5UUllfS0lORF9VTlNQRUNJRklFRBAAEh'
    '0KGVNJVEVNQVBfRU5UUllfS0lORF9TRVJJRVMQARIeChpTSVRFTUFQX0VOVFJZX0tJTkRfRVBJ'
    'U09ERRACEhwKGFNJVEVNQVBfRU5UUllfS0lORF9MQUJFTBADEh4KGlNJVEVNQVBfRU5UUllfS0'
    'lORF9DUkVBVE9SEAQSHAoYU0lURU1BUF9FTlRSWV9LSU5EX0dFTlJFEAUSGwoXU0lURU1BUF9F'
    'TlRSWV9LSU5EX1BBR0UQBg==');

@$core.Deprecated('Use followTargetTypeDescriptor instead')
const FollowTargetType$json = {
  '1': 'FollowTargetType',
  '2': [
    {'1': 'FOLLOW_TARGET_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'FOLLOW_TARGET_TYPE_EPISODE', '2': 1},
    {'1': 'FOLLOW_TARGET_TYPE_CREATOR', '2': 2},
    {'1': 'FOLLOW_TARGET_TYPE_SERIES', '2': 3},
  ],
};

/// Descriptor for `FollowTargetType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List followTargetTypeDescriptor = $convert.base64Decode(
    'ChBGb2xsb3dUYXJnZXRUeXBlEiIKHkZPTExPV19UQVJHRVRfVFlQRV9VTlNQRUNJRklFRBAAEh'
    '4KGkZPTExPV19UQVJHRVRfVFlQRV9FUElTT0RFEAESHgoaRk9MTE9XX1RBUkdFVF9UWVBFX0NS'
    'RUFUT1IQAhIdChlGT0xMT1dfVEFSR0VUX1RZUEVfU0VSSUVTEAM=');

@$core.Deprecated('Use episodeRatingModeDescriptor instead')
const EpisodeRatingMode$json = {
  '1': 'EpisodeRatingMode',
  '2': [
    {'1': 'EPISODE_RATING_MODE_UNSPECIFIED', '2': 0},
    {'1': 'EPISODE_RATING_MODE_SINGLE', '2': 1},
    {'1': 'EPISODE_RATING_MODE_MULTIPLE', '2': 2},
  ],
};

/// Descriptor for `EpisodeRatingMode`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List episodeRatingModeDescriptor = $convert.base64Decode(
    'ChFFcGlzb2RlUmF0aW5nTW9kZRIjCh9FUElTT0RFX1JBVElOR19NT0RFX1VOU1BFQ0lGSUVEEA'
    'ASHgoaRVBJU09ERV9SQVRJTkdfTU9ERV9TSU5HTEUQARIgChxFUElTT0RFX1JBVElOR19NT0RF'
    'X01VTFRJUExFEAI=');

@$core.Deprecated('Use contentViewTargetTypeDescriptor instead')
const ContentViewTargetType$json = {
  '1': 'ContentViewTargetType',
  '2': [
    {'1': 'CONTENT_VIEW_TARGET_TYPE_UNSPECIFIED', '2': 0},
    {'1': 'CONTENT_VIEW_TARGET_TYPE_SERIES', '2': 1},
    {'1': 'CONTENT_VIEW_TARGET_TYPE_EPISODE', '2': 2},
  ],
};

/// Descriptor for `ContentViewTargetType`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List contentViewTargetTypeDescriptor = $convert.base64Decode(
    'ChVDb250ZW50Vmlld1RhcmdldFR5cGUSKAokQ09OVEVOVF9WSUVXX1RBUkdFVF9UWVBFX1VOU1'
    'BFQ0lGSUVEEAASIwofQ09OVEVOVF9WSUVXX1RBUkdFVF9UWVBFX1NFUklFUxABEiQKIENPTlRF'
    'TlRfVklFV19UQVJHRVRfVFlQRV9FUElTT0RFEAI=');

@$core.Deprecated('Use inAppPurchaseStoreDescriptor instead')
const InAppPurchaseStore$json = {
  '1': 'InAppPurchaseStore',
  '2': [
    {'1': 'IN_APP_PURCHASE_STORE_UNSPECIFIED', '2': 0},
    {'1': 'IN_APP_PURCHASE_STORE_APP_STORE', '2': 1},
    {'1': 'IN_APP_PURCHASE_STORE_GOOGLE_PLAY', '2': 2},
  ],
};

/// Descriptor for `InAppPurchaseStore`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List inAppPurchaseStoreDescriptor = $convert.base64Decode(
    'ChJJbkFwcFB1cmNoYXNlU3RvcmUSJQohSU5fQVBQX1BVUkNIQVNFX1NUT1JFX1VOU1BFQ0lGSU'
    'VEEAASIwofSU5fQVBQX1BVUkNIQVNFX1NUT1JFX0FQUF9TVE9SRRABEiUKIUlOX0FQUF9QVVJD'
    'SEFTRV9TVE9SRV9HT09HTEVfUExBWRAC');

@$core.Deprecated('Use listPublishedLabelsRequestDescriptor instead')
const ListPublishedLabelsRequest$json = {
  '1': 'ListPublishedLabelsRequest',
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
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {
      '1': 'has_published_series',
      '3': 6,
      '4': 1,
      '5': 8,
      '10': 'hasPublishedSeries'
    },
  ],
  '9': [
    {'1': 3, '2': 4},
  ],
  '10': ['offset'],
};

/// Descriptor for `ListPublishedLabelsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedLabelsRequestDescriptor = $convert.base64Decode(
    'ChpMaXN0UHVibGlzaGVkTGFiZWxzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFAoF'
    'dG9rZW4YBCABKAlSBXRva2VuEjkKB3N1cmZhY2UYBSABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLk'
    'NsaWVudFN1cmZhY2VSB3N1cmZhY2USMAoUaGFzX3B1Ymxpc2hlZF9zZXJpZXMYBiABKAhSEmhh'
    'c1B1Ymxpc2hlZFNlcmllc0oECAMQBFIGb2Zmc2V0');

@$core.Deprecated('Use listPublishedLabelsResponseDescriptor instead')
const ListPublishedLabelsResponse$json = {
  '1': 'ListPublishedLabelsResponse',
  '2': [
    {
      '1': 'labels',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedLabel',
      '10': 'labels'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListPublishedLabelsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedLabelsResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0UHVibGlzaGVkTGFiZWxzUmVzcG9uc2USMgoGbGFiZWxzGAEgAygLMhoucHVibGlyYS'
        '52MS5QdWJsaXNoZWRMYWJlbFIGbGFiZWxzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2'
        'aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use listPublishedSeriesRequestDescriptor instead')
const ListPublishedSeriesRequest$json = {
  '1': 'ListPublishedSeriesRequest',
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
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'order',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.SeriesOrder',
      '10': 'order'
    },
    {'1': 'has_free_episodes', '3': 6, '4': 1, '5': 8, '10': 'hasFreeEpisodes'},
    {'1': 'genre_public_id', '3': 7, '4': 1, '5': 9, '10': 'genrePublicId'},
    {'1': 'tag_slug', '3': 8, '4': 1, '5': 9, '10': 'tagSlug'},
    {
      '1': 'status',
      '3': 9,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SeriesStatus',
      '10': 'status'
    },
    {
      '1': 'weekday',
      '3': 10,
      '4': 1,
      '5': 5,
      '9': 0,
      '10': 'weekday',
      '17': true
    },
    {
      '1': 'surface',
      '3': 11,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 12, '4': 1, '5': 9, '10': 'locale'},
  ],
  '8': [
    {'1': '_weekday'},
  ],
  '9': [
    {'1': 3, '2': 4},
  ],
  '10': ['offset'],
};

/// Descriptor for `ListPublishedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedSeriesRequestDescriptor = $convert.base64Decode(
    'ChpMaXN0UHVibGlzaGVkU2VyaWVzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFAoF'
    'dG9rZW4YBCABKAlSBXRva2VuEi0KBW9yZGVyGAUgASgOMhcucHVibGlyYS52MS5TZXJpZXNPcm'
    'RlclIFb3JkZXISKgoRaGFzX2ZyZWVfZXBpc29kZXMYBiABKAhSD2hhc0ZyZWVFcGlzb2RlcxIm'
    'Cg9nZW5yZV9wdWJsaWNfaWQYByABKAlSDWdlbnJlUHVibGljSWQSGQoIdGFnX3NsdWcYCCABKA'
    'lSB3RhZ1NsdWcSNgoGc3RhdHVzGAkgASgOMh4ucHVibGlyYS50eXBlcy52MS5TZXJpZXNTdGF0'
    'dXNSBnN0YXR1cxIdCgd3ZWVrZGF5GAogASgFSABSB3dlZWtkYXmIAQESOQoHc3VyZmFjZRgLIA'
    'EoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIWCgZsb2NhbGUY'
    'DCABKAlSBmxvY2FsZUIKCghfd2Vla2RheUoECAMQBFIGb2Zmc2V0');

@$core.Deprecated('Use listPublishedSeriesResponseDescriptor instead')
const ListPublishedSeriesResponse$json = {
  '1': 'ListPublishedSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListPublishedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedSeriesResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0UHVibGlzaGVkU2VyaWVzUmVzcG9uc2USMAoGc2VyaWVzGAEgAygLMhgucHVibGlyYS'
        '50eXBlcy52MS5TZXJpZXNSBnNlcmllcxIlCg5wcmV2aW91c190b2tlbhgCIAEoCVINcHJldmlv'
        'dXNUb2tlbhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use getSeriesDetailRequestDescriptor instead')
const GetSeriesDetailRequest$json = {
  '1': 'GetSeriesDetailRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetSeriesDetailRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSeriesDetailRequestDescriptor = $convert.base64Decode(
    'ChZHZXRTZXJpZXNEZXRhaWxSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZX'
    'MudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhsKCXB1YmxpY19pZBgCIAEoCVIIcHVibGljSWQS'
    'OQoHc3VyZmFjZRgDIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZm'
    'FjZRIWCgZsb2NhbGUYBCABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use waitFreeRuleDescriptor instead')
const WaitFreeRule$json = {
  '1': 'WaitFreeRule',
  '2': [
    {'1': 'recharge_hours', '3': 1, '4': 1, '5': 5, '10': 'rechargeHours'},
    {'1': 'access_hours', '3': 2, '4': 1, '5': 5, '10': 'accessHours'},
    {
      '1': 'excluded_latest_count',
      '3': 3,
      '4': 1,
      '5': 5,
      '10': 'excludedLatestCount'
    },
    {
      '1': 'excluded_episode_ids',
      '3': 4,
      '4': 3,
      '5': 9,
      '10': 'excludedEpisodeIds'
    },
  ],
};

/// Descriptor for `WaitFreeRule`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List waitFreeRuleDescriptor = $convert.base64Decode(
    'CgxXYWl0RnJlZVJ1bGUSJQoOcmVjaGFyZ2VfaG91cnMYASABKAVSDXJlY2hhcmdlSG91cnMSIQ'
    'oMYWNjZXNzX2hvdXJzGAIgASgFUgthY2Nlc3NIb3VycxIyChVleGNsdWRlZF9sYXRlc3RfY291'
    'bnQYAyABKAVSE2V4Y2x1ZGVkTGF0ZXN0Q291bnQSMAoUZXhjbHVkZWRfZXBpc29kZV9pZHMYBC'
    'ADKAlSEmV4Y2x1ZGVkRXBpc29kZUlkcw==');

@$core.Deprecated('Use getSeriesDetailResponseDescriptor instead')
const GetSeriesDetailResponse$json = {
  '1': 'GetSeriesDetailResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'episodes',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episodes'
    },
    {
      '1': 'required_minimum_age',
      '3': 3,
      '4': 1,
      '5': 5,
      '10': 'requiredMinimumAge'
    },
    {
      '1': 'comment_mode',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.CommentMode',
      '10': 'commentMode'
    },
    {
      '1': 'wait_free',
      '3': 5,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.WaitFreeRule',
      '10': 'waitFree'
    },
    {
      '1': 'published_locales',
      '3': 6,
      '4': 3,
      '5': 9,
      '10': 'publishedLocales'
    },
    {
      '1': 'volumes',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Volume',
      '10': 'volumes'
    },
  ],
};

/// Descriptor for `GetSeriesDetailResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSeriesDetailResponseDescriptor = $convert.base64Decode(
    'ChdHZXRTZXJpZXNEZXRhaWxSZXNwb25zZRIwCgZzZXJpZXMYASABKAsyGC5wdWJsaXJhLnR5cG'
    'VzLnYxLlNlcmllc1IGc2VyaWVzEjUKCGVwaXNvZGVzGAIgAygLMhkucHVibGlyYS50eXBlcy52'
    'MS5FcGlzb2RlUghlcGlzb2RlcxIwChRyZXF1aXJlZF9taW5pbXVtX2FnZRgDIAEoBVIScmVxdW'
    'lyZWRNaW5pbXVtQWdlEkAKDGNvbW1lbnRfbW9kZRgEIAEoDjIdLnB1YmxpcmEudHlwZXMudjEu'
    'Q29tbWVudE1vZGVSC2NvbW1lbnRNb2RlEjUKCXdhaXRfZnJlZRgFIAEoCzIYLnB1YmxpcmEudj'
    'EuV2FpdEZyZWVSdWxlUgh3YWl0RnJlZRIrChFwdWJsaXNoZWRfbG9jYWxlcxgGIAMoCVIQcHVi'
    'bGlzaGVkTG9jYWxlcxIyCgd2b2x1bWVzGAcgAygLMhgucHVibGlyYS50eXBlcy52MS5Wb2x1bW'
    'VSB3ZvbHVtZXM=');

@$core.Deprecated('Use getSeriesEpisodeAccessRequestDescriptor instead')
const GetSeriesEpisodeAccessRequest$json = {
  '1': 'GetSeriesEpisodeAccessRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'series_id', '3': 4, '4': 1, '5': 9, '10': 'seriesId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['series_public_id'],
};

/// Descriptor for `GetSeriesEpisodeAccessRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSeriesEpisodeAccessRequestDescriptor = $convert.base64Decode(
    'Ch1HZXRTZXJpZXNFcGlzb2RlQWNjZXNzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
    'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBI5CgdzdXJmYWNlGAMgASgOMh8ucHVi'
    'bGlyYS50eXBlcy52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNlEhsKCXNlcmllc19pZBgEIAEoCV'
    'IIc2VyaWVzSWRKBAgCEANSEHNlcmllc19wdWJsaWNfaWQ=');

@$core.Deprecated('Use seriesEpisodeAccessDescriptor instead')
const SeriesEpisodeAccess$json = {
  '1': 'SeriesEpisodeAccess',
  '2': [
    {'1': 'episode_public_id', '3': 1, '4': 1, '5': 9, '10': 'episodePublicId'},
    {
      '1': 'access',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeAccess',
      '10': 'access'
    },
    {'1': 'episode_id', '3': 3, '4': 1, '5': 9, '10': 'episodeId'},
    {'1': 'owned', '3': 4, '4': 1, '5': 8, '10': 'owned'},
    {
      '1': 'entitlement_source',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeEntitlementSource',
      '10': 'entitlementSource'
    },
  ],
};

/// Descriptor for `SeriesEpisodeAccess`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List seriesEpisodeAccessDescriptor = $convert.base64Decode(
    'ChNTZXJpZXNFcGlzb2RlQWNjZXNzEioKEWVwaXNvZGVfcHVibGljX2lkGAEgASgJUg9lcGlzb2'
    'RlUHVibGljSWQSMQoGYWNjZXNzGAIgASgOMhkucHVibGlyYS52MS5FcGlzb2RlQWNjZXNzUgZh'
    'Y2Nlc3MSHQoKZXBpc29kZV9pZBgDIAEoCVIJZXBpc29kZUlkEhQKBW93bmVkGAQgASgIUgVvd2'
    '5lZBJTChJlbnRpdGxlbWVudF9zb3VyY2UYBSABKA4yJC5wdWJsaXJhLnYxLkVwaXNvZGVFbnRp'
    'dGxlbWVudFNvdXJjZVIRZW50aXRsZW1lbnRTb3VyY2U=');

@$core.Deprecated('Use getSeriesEpisodeAccessResponseDescriptor instead')
const GetSeriesEpisodeAccessResponse$json = {
  '1': 'GetSeriesEpisodeAccessResponse',
  '2': [
    {
      '1': 'episodes',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.SeriesEpisodeAccess',
      '10': 'episodes'
    },
    {
      '1': 'remainder',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.SeriesRemainderOffer',
      '10': 'remainder'
    },
  ],
};

/// Descriptor for `GetSeriesEpisodeAccessResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getSeriesEpisodeAccessResponseDescriptor =
    $convert.base64Decode(
        'Ch5HZXRTZXJpZXNFcGlzb2RlQWNjZXNzUmVzcG9uc2USOwoIZXBpc29kZXMYASADKAsyHy5wdW'
        'JsaXJhLnYxLlNlcmllc0VwaXNvZGVBY2Nlc3NSCGVwaXNvZGVzEj4KCXJlbWFpbmRlchgCIAEo'
        'CzIgLnB1YmxpcmEudjEuU2VyaWVzUmVtYWluZGVyT2ZmZXJSCXJlbWFpbmRlcg==');

@$core.Deprecated('Use seriesRemainderOfferDescriptor instead')
const SeriesRemainderOffer$json = {
  '1': 'SeriesRemainderOffer',
  '2': [
    {'1': 'episode_count', '3': 1, '4': 1, '5': 5, '10': 'episodeCount'},
    {'1': 'list_price', '3': 2, '4': 1, '5': 5, '10': 'listPrice'},
    {'1': 'discount_percent', '3': 3, '4': 1, '5': 5, '10': 'discountPercent'},
    {'1': 'price', '3': 4, '4': 1, '5': 5, '10': 'price'},
  ],
};

/// Descriptor for `SeriesRemainderOffer`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List seriesRemainderOfferDescriptor = $convert.base64Decode(
    'ChRTZXJpZXNSZW1haW5kZXJPZmZlchIjCg1lcGlzb2RlX2NvdW50GAEgASgFUgxlcGlzb2RlQ2'
    '91bnQSHQoKbGlzdF9wcmljZRgCIAEoBVIJbGlzdFByaWNlEikKEGRpc2NvdW50X3BlcmNlbnQY'
    'AyABKAVSD2Rpc2NvdW50UGVyY2VudBIUCgVwcmljZRgEIAEoBVIFcHJpY2U=');

@$core.Deprecated('Use getEpisodeDetailRequestDescriptor instead')
const GetEpisodeDetailRequest$json = {
  '1': 'GetEpisodeDetailRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetEpisodeDetailRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getEpisodeDetailRequestDescriptor = $convert.base64Decode(
    'ChdHZXRFcGlzb2RlRGV0YWlsUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIbCglwdWJsaWNfaWQYAiABKAlSCHB1YmxpY0lk'
    'EjkKB3N1cmZhY2UYAyABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cm'
    'ZhY2USFgoGbG9jYWxlGAQgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use episodeNeighborDescriptor instead')
const EpisodeNeighbor$json = {
  '1': 'EpisodeNeighbor',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'order_index', '3': 3, '4': 1, '5': 5, '10': 'orderIndex'},
    {'1': 'price', '3': 4, '4': 1, '5': 5, '10': 'price'},
    {'1': 'is_free', '3': 5, '4': 1, '5': 8, '10': 'isFree'},
    {
      '1': 'creators',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Creator',
      '10': 'creators'
    },
    {
      '1': 'purchase_availability',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SurfaceAvailability',
      '10': 'purchaseAvailability'
    },
    {'1': 'locale', '3': 8, '4': 1, '5': 9, '10': 'locale'},
    {'1': 'campaign_price', '3': 9, '4': 1, '5': 5, '10': 'campaignPrice'},
    {'1': 'campaign_ends_at', '3': 10, '4': 1, '5': 9, '10': 'campaignEndsAt'},
  ],
};

/// Descriptor for `EpisodeNeighbor`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List episodeNeighborDescriptor = $convert.base64Decode(
    'Cg9FcGlzb2RlTmVpZ2hib3ISGwoJcHVibGljX2lkGAEgASgJUghwdWJsaWNJZBIUCgV0aXRsZR'
    'gCIAEoCVIFdGl0bGUSHwoLb3JkZXJfaW5kZXgYAyABKAVSCm9yZGVySW5kZXgSFAoFcHJpY2UY'
    'BCABKAVSBXByaWNlEhcKB2lzX2ZyZWUYBSABKAhSBmlzRnJlZRI1CghjcmVhdG9ycxgGIAMoCz'
    'IZLnB1YmxpcmEudHlwZXMudjEuQ3JlYXRvclIIY3JlYXRvcnMSWgoVcHVyY2hhc2VfYXZhaWxh'
    'YmlsaXR5GAcgASgOMiUucHVibGlyYS50eXBlcy52MS5TdXJmYWNlQXZhaWxhYmlsaXR5UhRwdX'
    'JjaGFzZUF2YWlsYWJpbGl0eRIWCgZsb2NhbGUYCCABKAlSBmxvY2FsZRIlCg5jYW1wYWlnbl9w'
    'cmljZRgJIAEoBVINY2FtcGFpZ25QcmljZRIoChBjYW1wYWlnbl9lbmRzX2F0GAogASgJUg5jYW'
    '1wYWlnbkVuZHNBdA==');

@$core.Deprecated('Use getEpisodeDetailResponseDescriptor instead')
const GetEpisodeDetailResponse$json = {
  '1': 'GetEpisodeDetailResponse',
  '2': [
    {
      '1': 'episode',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {
      '1': 'series',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'images',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.EpisodeImage',
      '10': 'images'
    },
    {
      '1': 'access',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeAccess',
      '10': 'access'
    },
    {'1': 'free_until', '3': 5, '4': 1, '5': 9, '10': 'freeUntil'},
    {
      '1': 'previous_episode',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.EpisodeNeighbor',
      '10': 'previousEpisode'
    },
    {
      '1': 'next_episode',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.EpisodeNeighbor',
      '10': 'nextEpisode'
    },
    {
      '1': 'entitlement_source',
      '3': 8,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeEntitlementSource',
      '10': 'entitlementSource'
    },
    {
      '1': 'preview_images',
      '3': 9,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.EpisodeImage',
      '10': 'previewImages'
    },
    {
      '1': 'next_free_episode',
      '3': 10,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.EpisodeNeighbor',
      '10': 'nextFreeEpisode'
    },
    {
      '1': 'published_locales',
      '3': 11,
      '4': 3,
      '5': 9,
      '10': 'publishedLocales'
    },
  ],
};

/// Descriptor for `GetEpisodeDetailResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getEpisodeDetailResponseDescriptor = $convert.base64Decode(
    'ChhHZXRFcGlzb2RlRGV0YWlsUmVzcG9uc2USMwoHZXBpc29kZRgBIAEoCzIZLnB1YmxpcmEudH'
    'lwZXMudjEuRXBpc29kZVIHZXBpc29kZRIwCgZzZXJpZXMYAiABKAsyGC5wdWJsaXJhLnR5cGVz'
    'LnYxLlNlcmllc1IGc2VyaWVzEjYKBmltYWdlcxgDIAMoCzIeLnB1YmxpcmEudHlwZXMudjEuRX'
    'Bpc29kZUltYWdlUgZpbWFnZXMSMQoGYWNjZXNzGAQgASgOMhkucHVibGlyYS52MS5FcGlzb2Rl'
    'QWNjZXNzUgZhY2Nlc3MSHQoKZnJlZV91bnRpbBgFIAEoCVIJZnJlZVVudGlsEkYKEHByZXZpb3'
    'VzX2VwaXNvZGUYBiABKAsyGy5wdWJsaXJhLnYxLkVwaXNvZGVOZWlnaGJvclIPcHJldmlvdXNF'
    'cGlzb2RlEj4KDG5leHRfZXBpc29kZRgHIAEoCzIbLnB1YmxpcmEudjEuRXBpc29kZU5laWdoYm'
    '9yUgtuZXh0RXBpc29kZRJTChJlbnRpdGxlbWVudF9zb3VyY2UYCCABKA4yJC5wdWJsaXJhLnYx'
    'LkVwaXNvZGVFbnRpdGxlbWVudFNvdXJjZVIRZW50aXRsZW1lbnRTb3VyY2USRQoOcHJldmlld1'
    '9pbWFnZXMYCSADKAsyHi5wdWJsaXJhLnR5cGVzLnYxLkVwaXNvZGVJbWFnZVINcHJldmlld0lt'
    'YWdlcxJHChFuZXh0X2ZyZWVfZXBpc29kZRgKIAEoCzIbLnB1YmxpcmEudjEuRXBpc29kZU5laW'
    'doYm9yUg9uZXh0RnJlZUVwaXNvZGUSKwoRcHVibGlzaGVkX2xvY2FsZXMYCyADKAlSEHB1Ymxp'
    'c2hlZExvY2FsZXM=');

@$core.Deprecated('Use publishedCreatorDescriptor instead')
const PublishedCreator$json = {
  '1': 'PublishedCreator',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'profile_text', '3': 3, '4': 1, '5': 9, '10': 'profileText'},
    {'1': 'icon_image_url', '3': 4, '4': 1, '5': 9, '10': 'iconImageUrl'},
    {
      '1': 'icon_image_file_size_bytes',
      '3': 5,
      '4': 1,
      '5': 3,
      '10': 'iconImageFileSizeBytes'
    },
    {
      '1': 'icon_image_updated_at',
      '3': 6,
      '4': 1,
      '5': 9,
      '10': 'iconImageUpdatedAt'
    },
    {
      '1': 'published_series_count',
      '3': 7,
      '4': 1,
      '5': 5,
      '10': 'publishedSeriesCount'
    },
    {'1': 'id', '3': 8, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `PublishedCreator`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishedCreatorDescriptor = $convert.base64Decode(
    'ChBQdWJsaXNoZWRDcmVhdG9yEhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibGljSWQSEgoEbmFtZR'
    'gCIAEoCVIEbmFtZRIhCgxwcm9maWxlX3RleHQYAyABKAlSC3Byb2ZpbGVUZXh0EiQKDmljb25f'
    'aW1hZ2VfdXJsGAQgASgJUgxpY29uSW1hZ2VVcmwSOgoaaWNvbl9pbWFnZV9maWxlX3NpemVfYn'
    'l0ZXMYBSABKANSFmljb25JbWFnZUZpbGVTaXplQnl0ZXMSMQoVaWNvbl9pbWFnZV91cGRhdGVk'
    'X2F0GAYgASgJUhJpY29uSW1hZ2VVcGRhdGVkQXQSNAoWcHVibGlzaGVkX3Nlcmllc19jb3VudB'
    'gHIAEoBVIUcHVibGlzaGVkU2VyaWVzQ291bnQSDgoCaWQYCCABKAlSAmlk');

@$core.Deprecated('Use listPublishedCreatorsRequestDescriptor instead')
const ListPublishedCreatorsRequest$json = {
  '1': 'ListPublishedCreatorsRequest',
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

/// Descriptor for `ListPublishedCreatorsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedCreatorsRequestDescriptor = $convert.base64Decode(
    'ChxMaXN0UHVibGlzaGVkQ3JlYXRvcnNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIU'
    'CgV0b2tlbhgDIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudj'
    'EuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZQ==');

@$core.Deprecated('Use listPublishedCreatorsResponseDescriptor instead')
const ListPublishedCreatorsResponse$json = {
  '1': 'ListPublishedCreatorsResponse',
  '2': [
    {
      '1': 'creators',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedCreator',
      '10': 'creators'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListPublishedCreatorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedCreatorsResponseDescriptor =
    $convert.base64Decode(
        'Ch1MaXN0UHVibGlzaGVkQ3JlYXRvcnNSZXNwb25zZRI4CghjcmVhdG9ycxgBIAMoCzIcLnB1Ym'
        'xpcmEudjEuUHVibGlzaGVkQ3JlYXRvclIIY3JlYXRvcnMSJQoOcHJldmlvdXNfdG9rZW4YAiAB'
        'KAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use getPublishedCreatorDetailRequestDescriptor instead')
const GetPublishedCreatorDetailRequest$json = {
  '1': 'GetPublishedCreatorDetailRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 6, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetPublishedCreatorDetailRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedCreatorDetailRequestDescriptor = $convert.base64Decode(
    'CiBHZXRQdWJsaXNoZWRDcmVhdG9yRGV0YWlsUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdW'
    'JsaXJhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIbCglwdWJsaWNfaWQYAiABKAlS'
    'CHB1YmxpY0lkEhQKBWxpbWl0GAMgASgFUgVsaW1pdBIUCgV0b2tlbhgEIAEoCVIFdG9rZW4SOQ'
    'oHc3VyZmFjZRgFIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFj'
    'ZRIWCgZsb2NhbGUYBiABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use getPublishedCreatorDetailResponseDescriptor instead')
const GetPublishedCreatorDetailResponse$json = {
  '1': 'GetPublishedCreatorDetailResponse',
  '2': [
    {
      '1': 'creator',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.PublishedCreator',
      '10': 'creator'
    },
    {
      '1': 'series',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 3, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 4, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `GetPublishedCreatorDetailResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedCreatorDetailResponseDescriptor =
    $convert.base64Decode(
        'CiFHZXRQdWJsaXNoZWRDcmVhdG9yRGV0YWlsUmVzcG9uc2USNgoHY3JlYXRvchgBIAEoCzIcLn'
        'B1YmxpcmEudjEuUHVibGlzaGVkQ3JlYXRvclIHY3JlYXRvchIwCgZzZXJpZXMYAiADKAsyGC5w'
        'dWJsaXJhLnR5cGVzLnYxLlNlcmllc1IGc2VyaWVzEiUKDnByZXZpb3VzX3Rva2VuGAMgASgJUg'
        '1wcmV2aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YBCABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use publishedLabelDescriptor instead')
const PublishedLabel$json = {
  '1': 'PublishedLabel',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {
      '1': 'eye_catch_image_updated_at',
      '3': 3,
      '4': 1,
      '5': 9,
      '10': 'eyeCatchImageUpdatedAt'
    },
    {
      '1': 'eye_catch_image_variants',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {
      '1': 'published_series_count',
      '3': 5,
      '4': 1,
      '5': 5,
      '10': 'publishedSeriesCount'
    },
  ],
};

/// Descriptor for `PublishedLabel`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishedLabelDescriptor = $convert.base64Decode(
    'Cg5QdWJsaXNoZWRMYWJlbBIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBG5hbWUYAi'
    'ABKAlSBG5hbWUSOgoaZXllX2NhdGNoX2ltYWdlX3VwZGF0ZWRfYXQYAyABKAlSFmV5ZUNhdGNo'
    'SW1hZ2VVcGRhdGVkQXQSYAoYZXllX2NhdGNoX2ltYWdlX3ZhcmlhbnRzGAQgAygLMicucHVibG'
    'lyYS50eXBlcy52MS5TZXJpZXNFeWVDYXRjaFZhcmlhbnRSFWV5ZUNhdGNoSW1hZ2VWYXJpYW50'
    'cxI0ChZwdWJsaXNoZWRfc2VyaWVzX2NvdW50GAUgASgFUhRwdWJsaXNoZWRTZXJpZXNDb3VudA'
    '==');

@$core.Deprecated('Use getPublishedLabelDetailRequestDescriptor instead')
const GetPublishedLabelDetailRequest$json = {
  '1': 'GetPublishedLabelDetailRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 6, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetPublishedLabelDetailRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedLabelDetailRequestDescriptor = $convert.base64Decode(
    'Ch5HZXRQdWJsaXNoZWRMYWJlbERldGFpbFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
    'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSGwoJcHVibGljX2lkGAIgASgJUghw'
    'dWJsaWNJZBIUCgVsaW1pdBgDIAEoBVIFbGltaXQSFAoFdG9rZW4YBCABKAlSBXRva2VuEjkKB3'
    'N1cmZhY2UYBSABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2US'
    'FgoGbG9jYWxlGAYgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use getPublishedLabelDetailResponseDescriptor instead')
const GetPublishedLabelDetailResponse$json = {
  '1': 'GetPublishedLabelDetailResponse',
  '2': [
    {
      '1': 'label',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.PublishedLabel',
      '10': 'label'
    },
    {
      '1': 'series',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 3, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 4, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `GetPublishedLabelDetailResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedLabelDetailResponseDescriptor =
    $convert.base64Decode(
        'Ch9HZXRQdWJsaXNoZWRMYWJlbERldGFpbFJlc3BvbnNlEjAKBWxhYmVsGAEgASgLMhoucHVibG'
        'lyYS52MS5QdWJsaXNoZWRMYWJlbFIFbGFiZWwSMAoGc2VyaWVzGAIgAygLMhgucHVibGlyYS50'
        'eXBlcy52MS5TZXJpZXNSBnNlcmllcxIlCg5wcmV2aW91c190b2tlbhgDIAEoCVINcHJldmlvdX'
        'NUb2tlbhIdCgpuZXh0X3Rva2VuGAQgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use publishedGenreDescriptor instead')
const PublishedGenre$json = {
  '1': 'PublishedGenre',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'slug', '3': 3, '4': 1, '5': 9, '10': 'slug'},
    {
      '1': 'published_series_count',
      '3': 4,
      '4': 1,
      '5': 5,
      '10': 'publishedSeriesCount'
    },
    {
      '1': 'featured_series',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedGenreFeaturedSeries',
      '10': 'featuredSeries'
    },
    {
      '1': 'eye_catch_image_variants',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {'1': 'locale', '3': 7, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `PublishedGenre`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishedGenreDescriptor = $convert.base64Decode(
    'Cg5QdWJsaXNoZWRHZW5yZRIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBG5hbWUYAi'
    'ABKAlSBG5hbWUSEgoEc2x1ZxgDIAEoCVIEc2x1ZxI0ChZwdWJsaXNoZWRfc2VyaWVzX2NvdW50'
    'GAQgASgFUhRwdWJsaXNoZWRTZXJpZXNDb3VudBJRCg9mZWF0dXJlZF9zZXJpZXMYBSADKAsyKC'
    '5wdWJsaXJhLnYxLlB1Ymxpc2hlZEdlbnJlRmVhdHVyZWRTZXJpZXNSDmZlYXR1cmVkU2VyaWVz'
    'EmAKGGV5ZV9jYXRjaF9pbWFnZV92YXJpYW50cxgGIAMoCzInLnB1YmxpcmEudHlwZXMudjEuU2'
    'VyaWVzRXllQ2F0Y2hWYXJpYW50UhVleWVDYXRjaEltYWdlVmFyaWFudHMSFgoGbG9jYWxlGAcg'
    'ASgJUgZsb2NhbGU=');

@$core.Deprecated('Use publishedGenreFeaturedSeriesDescriptor instead')
const PublishedGenreFeaturedSeries$json = {
  '1': 'PublishedGenreFeaturedSeries',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {
      '1': 'eye_catch_image_variants',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `PublishedGenreFeaturedSeries`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishedGenreFeaturedSeriesDescriptor = $convert.base64Decode(
    'ChxQdWJsaXNoZWRHZW5yZUZlYXR1cmVkU2VyaWVzEhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibG'
    'ljSWQSFAoFdGl0bGUYAiABKAlSBXRpdGxlEmAKGGV5ZV9jYXRjaF9pbWFnZV92YXJpYW50cxgD'
    'IAMoCzInLnB1YmxpcmEudHlwZXMudjEuU2VyaWVzRXllQ2F0Y2hWYXJpYW50UhVleWVDYXRjaE'
    'ltYWdlVmFyaWFudHMSFgoGbG9jYWxlGAQgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use listPublishedGenresRequestDescriptor instead')
const ListPublishedGenresRequest$json = {
  '1': 'ListPublishedGenresRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListPublishedGenresRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedGenresRequestDescriptor = $convert.base64Decode(
    'ChpMaXN0UHVibGlzaGVkR2VucmVzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFAoF'
    'dG9rZW4YAyABKAlSBXRva2VuEjkKB3N1cmZhY2UYBCABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLk'
    'NsaWVudFN1cmZhY2VSB3N1cmZhY2USFgoGbG9jYWxlGAUgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use listPublishedGenresResponseDescriptor instead')
const ListPublishedGenresResponse$json = {
  '1': 'ListPublishedGenresResponse',
  '2': [
    {
      '1': 'genres',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedGenre',
      '10': 'genres'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListPublishedGenresResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedGenresResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0UHVibGlzaGVkR2VucmVzUmVzcG9uc2USMgoGZ2VucmVzGAEgAygLMhoucHVibGlyYS'
        '52MS5QdWJsaXNoZWRHZW5yZVIGZ2VucmVzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2'
        'aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use publishedTagDescriptor instead')
const PublishedTag$json = {
  '1': 'PublishedTag',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'slug', '3': 2, '4': 1, '5': 9, '10': 'slug'},
    {
      '1': 'published_series_count',
      '3': 3,
      '4': 1,
      '5': 5,
      '10': 'publishedSeriesCount'
    },
  ],
};

/// Descriptor for `PublishedTag`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List publishedTagDescriptor = $convert.base64Decode(
    'CgxQdWJsaXNoZWRUYWcSEgoEbmFtZRgBIAEoCVIEbmFtZRISCgRzbHVnGAIgASgJUgRzbHVnEj'
    'QKFnB1Ymxpc2hlZF9zZXJpZXNfY291bnQYAyABKAVSFHB1Ymxpc2hlZFNlcmllc0NvdW50');

@$core.Deprecated('Use listPublishedTagsRequestDescriptor instead')
const ListPublishedTagsRequest$json = {
  '1': 'ListPublishedTagsRequest',
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

/// Descriptor for `ListPublishedTagsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedTagsRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0UHVibGlzaGVkVGFnc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAiABKAVSBWxpbWl0EhQKBXRv'
    'a2VuGAMgASgJUgV0b2tlbhI5CgdzdXJmYWNlGAQgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbG'
    'llbnRTdXJmYWNlUgdzdXJmYWNl');

@$core.Deprecated('Use listPublishedTagsResponseDescriptor instead')
const ListPublishedTagsResponse$json = {
  '1': 'ListPublishedTagsResponse',
  '2': [
    {
      '1': 'tags',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedTag',
      '10': 'tags'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListPublishedTagsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedTagsResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0UHVibGlzaGVkVGFnc1Jlc3BvbnNlEiwKBHRhZ3MYASADKAsyGC5wdWJsaXJhLnYxLl'
    'B1Ymxpc2hlZFRhZ1IEdGFncxIlCg5wcmV2aW91c190b2tlbhgCIAEoCVINcHJldmlvdXNUb2tl'
    'bhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use searchPublishedSeriesRequestDescriptor instead')
const SearchPublishedSeriesRequest$json = {
  '1': 'SearchPublishedSeriesRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'query', '3': 2, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {
      '1': 'order',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.SeriesOrder',
      '10': 'order'
    },
    {'1': 'has_free_episodes', '3': 7, '4': 1, '5': 8, '10': 'hasFreeEpisodes'},
    {'1': 'genre_public_id', '3': 8, '4': 1, '5': 9, '10': 'genrePublicId'},
    {'1': 'tag_slug', '3': 9, '4': 1, '5': 9, '10': 'tagSlug'},
    {
      '1': 'status',
      '3': 10,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SeriesStatus',
      '10': 'status'
    },
    {
      '1': 'weekday',
      '3': 11,
      '4': 1,
      '5': 5,
      '9': 0,
      '10': 'weekday',
      '17': true
    },
    {'1': 'locale', '3': 12, '4': 1, '5': 9, '10': 'locale'},
  ],
  '8': [
    {'1': '_weekday'},
  ],
};

/// Descriptor for `SearchPublishedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedSeriesRequestDescriptor = $convert.base64Decode(
    'ChxTZWFyY2hQdWJsaXNoZWRTZXJpZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBXF1ZXJ5GAIgASgJUgVxdWVyeRIU'
    'CgVsaW1pdBgDIAEoBVIFbGltaXQSFAoFdG9rZW4YBCABKAlSBXRva2VuEjkKB3N1cmZhY2UYBS'
    'ABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2USLQoFb3JkZXIY'
    'BiABKA4yFy5wdWJsaXJhLnYxLlNlcmllc09yZGVyUgVvcmRlchIqChFoYXNfZnJlZV9lcGlzb2'
    'RlcxgHIAEoCFIPaGFzRnJlZUVwaXNvZGVzEiYKD2dlbnJlX3B1YmxpY19pZBgIIAEoCVINZ2Vu'
    'cmVQdWJsaWNJZBIZCgh0YWdfc2x1ZxgJIAEoCVIHdGFnU2x1ZxI2CgZzdGF0dXMYCiABKA4yHi'
    '5wdWJsaXJhLnR5cGVzLnYxLlNlcmllc1N0YXR1c1IGc3RhdHVzEh0KB3dlZWtkYXkYCyABKAVI'
    'AFIHd2Vla2RheYgBARIWCgZsb2NhbGUYDCABKAlSBmxvY2FsZUIKCghfd2Vla2RheQ==');

@$core.Deprecated('Use searchPublishedSeriesResponseDescriptor instead')
const SearchPublishedSeriesResponse$json = {
  '1': 'SearchPublishedSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `SearchPublishedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedSeriesResponseDescriptor =
    $convert.base64Decode(
        'Ch1TZWFyY2hQdWJsaXNoZWRTZXJpZXNSZXNwb25zZRIwCgZzZXJpZXMYASADKAsyGC5wdWJsaX'
        'JhLnR5cGVzLnYxLlNlcmllc1IGc2VyaWVzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2'
        'aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use searchPublishedCreatorsRequestDescriptor instead')
const SearchPublishedCreatorsRequest$json = {
  '1': 'SearchPublishedCreatorsRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'query', '3': 2, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `SearchPublishedCreatorsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedCreatorsRequestDescriptor =
    $convert.base64Decode(
        'Ch5TZWFyY2hQdWJsaXNoZWRDcmVhdG9yc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
        'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFcXVlcnkYAiABKAlSBXF1ZXJ5'
        'EhQKBWxpbWl0GAMgASgFUgVsaW1pdBIUCgV0b2tlbhgEIAEoCVIFdG9rZW4SOQoHc3VyZmFjZR'
        'gFIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZQ==');

@$core.Deprecated('Use searchPublishedCreatorsResponseDescriptor instead')
const SearchPublishedCreatorsResponse$json = {
  '1': 'SearchPublishedCreatorsResponse',
  '2': [
    {
      '1': 'creators',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedCreator',
      '10': 'creators'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `SearchPublishedCreatorsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedCreatorsResponseDescriptor =
    $convert.base64Decode(
        'Ch9TZWFyY2hQdWJsaXNoZWRDcmVhdG9yc1Jlc3BvbnNlEjgKCGNyZWF0b3JzGAEgAygLMhwucH'
        'VibGlyYS52MS5QdWJsaXNoZWRDcmVhdG9yUghjcmVhdG9ycxIlCg5wcmV2aW91c190b2tlbhgC'
        'IAEoCVINcHJldmlvdXNUb2tlbhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use searchPublishedLabelsRequestDescriptor instead')
const SearchPublishedLabelsRequest$json = {
  '1': 'SearchPublishedLabelsRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'query', '3': 2, '4': 1, '5': 9, '10': 'query'},
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `SearchPublishedLabelsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedLabelsRequestDescriptor = $convert.base64Decode(
    'ChxTZWFyY2hQdWJsaXNoZWRMYWJlbHNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBXF1ZXJ5GAIgASgJUgVxdWVyeRIU'
    'CgVsaW1pdBgDIAEoBVIFbGltaXQSFAoFdG9rZW4YBCABKAlSBXRva2VuEjkKB3N1cmZhY2UYBS'
    'ABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2U=');

@$core.Deprecated('Use searchPublishedLabelsResponseDescriptor instead')
const SearchPublishedLabelsResponse$json = {
  '1': 'SearchPublishedLabelsResponse',
  '2': [
    {
      '1': 'labels',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedLabel',
      '10': 'labels'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `SearchPublishedLabelsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List searchPublishedLabelsResponseDescriptor =
    $convert.base64Decode(
        'Ch1TZWFyY2hQdWJsaXNoZWRMYWJlbHNSZXNwb25zZRIyCgZsYWJlbHMYASADKAsyGi5wdWJsaX'
        'JhLnYxLlB1Ymxpc2hlZExhYmVsUgZsYWJlbHMSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXBy'
        'ZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use listRecommendedSeriesRequestDescriptor instead')
const ListRecommendedSeriesRequest$json = {
  '1': 'ListRecommendedSeriesRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListRecommendedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRecommendedSeriesRequestDescriptor = $convert.base64Decode(
    'ChxMaXN0UmVjb21tZW5kZWRTZXJpZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIU'
    'CgV0b2tlbhgDIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudj'
    'EuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIWCgZsb2NhbGUYBSABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use listRecommendedSeriesResponseDescriptor instead')
const ListRecommendedSeriesResponse$json = {
  '1': 'ListRecommendedSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
    {
      '1': 'source',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.RecommendationSource',
      '10': 'source'
    },
  ],
};

/// Descriptor for `ListRecommendedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRecommendedSeriesResponseDescriptor = $convert.base64Decode(
    'Ch1MaXN0UmVjb21tZW5kZWRTZXJpZXNSZXNwb25zZRIwCgZzZXJpZXMYASADKAsyGC5wdWJsaX'
    'JhLnR5cGVzLnYxLlNlcmllc1IGc2VyaWVzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2'
    'aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbhI4CgZzb3VyY2UYBCABKA'
    '4yIC5wdWJsaXJhLnYxLlJlY29tbWVuZGF0aW9uU291cmNlUgZzb3VyY2U=');

@$core.Deprecated('Use listMyRecommendedSeriesRequestDescriptor instead')
const ListMyRecommendedSeriesRequest$json = {
  '1': 'ListMyRecommendedSeriesRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListMyRecommendedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyRecommendedSeriesRequestDescriptor =
    $convert.base64Decode(
        'Ch5MaXN0TXlSZWNvbW1lbmRlZFNlcmllc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
        'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAiABKAVSBWxpbWl0'
        'EhQKBXRva2VuGAMgASgJUgV0b2tlbhI5CgdzdXJmYWNlGAQgASgOMh8ucHVibGlyYS50eXBlcy'
        '52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNlEhYKBmxvY2FsZRgFIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use listMyRecommendedSeriesResponseDescriptor instead')
const ListMyRecommendedSeriesResponse$json = {
  '1': 'ListMyRecommendedSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
    {
      '1': 'source',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.RecommendationSource',
      '10': 'source'
    },
  ],
};

/// Descriptor for `ListMyRecommendedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyRecommendedSeriesResponseDescriptor =
    $convert.base64Decode(
        'Ch9MaXN0TXlSZWNvbW1lbmRlZFNlcmllc1Jlc3BvbnNlEjAKBnNlcmllcxgBIAMoCzIYLnB1Ym'
        'xpcmEudHlwZXMudjEuU2VyaWVzUgZzZXJpZXMSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXBy'
        'ZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2VuEjgKBnNvdXJjZRgEIA'
        'EoDjIgLnB1YmxpcmEudjEuUmVjb21tZW5kYXRpb25Tb3VyY2VSBnNvdXJjZQ==');

@$core.Deprecated('Use rankedSeriesDescriptor instead')
const RankedSeries$json = {
  '1': 'RankedSeries',
  '2': [
    {'1': 'rank', '3': 1, '4': 1, '5': 5, '10': 'rank'},
    {
      '1': 'series',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'previous_rank',
      '3': 3,
      '4': 1,
      '5': 5,
      '9': 0,
      '10': 'previousRank',
      '17': true
    },
  ],
  '8': [
    {'1': '_previous_rank'},
  ],
};

/// Descriptor for `RankedSeries`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List rankedSeriesDescriptor = $convert.base64Decode(
    'CgxSYW5rZWRTZXJpZXMSEgoEcmFuaxgBIAEoBVIEcmFuaxIwCgZzZXJpZXMYAiABKAsyGC5wdW'
    'JsaXJhLnR5cGVzLnYxLlNlcmllc1IGc2VyaWVzEigKDXByZXZpb3VzX3JhbmsYAyABKAVIAFIM'
    'cHJldmlvdXNSYW5riAEBQhAKDl9wcmV2aW91c19yYW5r');

@$core.Deprecated('Use listRankedSeriesRequestDescriptor instead')
const ListRankedSeriesRequest$json = {
  '1': 'ListRankedSeriesRequest',
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
      '1': 'period',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.RankingPeriod',
      '10': 'period'
    },
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {
      '1': 'age_rating',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SeriesAgeRating',
      '10': 'ageRating'
    },
    {'1': 'genre_public_id', '3': 7, '4': 1, '5': 9, '10': 'genrePublicId'},
    {'1': 'locale', '3': 8, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListRankedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRankedSeriesRequestDescriptor = $convert.base64Decode(
    'ChdMaXN0UmFua2VkU2VyaWVzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIxCgZwZXJpb2QYAiABKA4yGS5wdWJsaXJhLnYx'
    'LlJhbmtpbmdQZXJpb2RSBnBlcmlvZBIUCgVsaW1pdBgDIAEoBVIFbGltaXQSFAoFdG9rZW4YBC'
    'ABKAlSBXRva2VuEjkKB3N1cmZhY2UYBSABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1'
    'cmZhY2VSB3N1cmZhY2USQAoKYWdlX3JhdGluZxgGIAEoDjIhLnB1YmxpcmEudHlwZXMudjEuU2'
    'VyaWVzQWdlUmF0aW5nUglhZ2VSYXRpbmcSJgoPZ2VucmVfcHVibGljX2lkGAcgASgJUg1nZW5y'
    'ZVB1YmxpY0lkEhYKBmxvY2FsZRgIIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use listRankedSeriesResponseDescriptor instead')
const ListRankedSeriesResponse$json = {
  '1': 'ListRankedSeriesResponse',
  '2': [
    {
      '1': 'ranked_series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.RankedSeries',
      '10': 'rankedSeries'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
    {'1': 'computed_at', '3': 4, '4': 1, '5': 9, '10': 'computedAt'},
    {'1': 'period_start', '3': 5, '4': 1, '5': 9, '10': 'periodStart'},
    {'1': 'period_end', '3': 6, '4': 1, '5': 9, '10': 'periodEnd'},
  ],
};

/// Descriptor for `ListRankedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRankedSeriesResponseDescriptor = $convert.base64Decode(
    'ChhMaXN0UmFua2VkU2VyaWVzUmVzcG9uc2USPQoNcmFua2VkX3NlcmllcxgBIAMoCzIYLnB1Ym'
    'xpcmEudjEuUmFua2VkU2VyaWVzUgxyYW5rZWRTZXJpZXMSJQoOcHJldmlvdXNfdG9rZW4YAiAB'
    'KAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2VuEh8KC2NvbX'
    'B1dGVkX2F0GAQgASgJUgpjb21wdXRlZEF0EiEKDHBlcmlvZF9zdGFydBgFIAEoCVILcGVyaW9k'
    'U3RhcnQSHQoKcGVyaW9kX2VuZBgGIAEoCVIJcGVyaW9kRW5k');

@$core.Deprecated('Use listRelatedSeriesRequestDescriptor instead')
const ListRelatedSeriesRequest$json = {
  '1': 'ListRelatedSeriesRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'limit', '3': 3, '4': 1, '5': 5, '10': 'limit'},
    {'1': 'token', '3': 4, '4': 1, '5': 9, '10': 'token'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'series_id', '3': 6, '4': 1, '5': 9, '10': 'seriesId'},
    {'1': 'locale', '3': 7, '4': 1, '5': 9, '10': 'locale'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['series_public_id'],
};

/// Descriptor for `ListRelatedSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRelatedSeriesRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0UmVsYXRlZFNlcmllc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAyABKAVSBWxpbWl0EhQKBXRv'
    'a2VuGAQgASgJUgV0b2tlbhI5CgdzdXJmYWNlGAUgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbG'
    'llbnRTdXJmYWNlUgdzdXJmYWNlEhsKCXNlcmllc19pZBgGIAEoCVIIc2VyaWVzSWQSFgoGbG9j'
    'YWxlGAcgASgJUgZsb2NhbGVKBAgCEANSEHNlcmllc19wdWJsaWNfaWQ=');

@$core.Deprecated('Use listRelatedSeriesResponseDescriptor instead')
const ListRelatedSeriesResponse$json = {
  '1': 'ListRelatedSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListRelatedSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listRelatedSeriesResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0UmVsYXRlZFNlcmllc1Jlc3BvbnNlEjAKBnNlcmllcxgBIAMoCzIYLnB1YmxpcmEudH'
    'lwZXMudjEuU2VyaWVzUgZzZXJpZXMSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXByZXZpb3Vz'
    'VG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use sitemapEntryDescriptor instead')
const SitemapEntry$json = {
  '1': 'SitemapEntry',
  '2': [
    {
      '1': 'kind',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.SitemapEntryKind',
      '10': 'kind'
    },
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'series_public_id', '3': 3, '4': 1, '5': 9, '10': 'seriesPublicId'},
    {'1': 'slug', '3': 4, '4': 1, '5': 9, '10': 'slug'},
    {'1': 'last_modified_at', '3': 5, '4': 1, '5': 9, '10': 'lastModifiedAt'},
    {
      '1': 'published_locales',
      '3': 6,
      '4': 3,
      '5': 9,
      '10': 'publishedLocales'
    },
  ],
};

/// Descriptor for `SitemapEntry`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List sitemapEntryDescriptor = $convert.base64Decode(
    'CgxTaXRlbWFwRW50cnkSMAoEa2luZBgBIAEoDjIcLnB1YmxpcmEudjEuU2l0ZW1hcEVudHJ5S2'
    'luZFIEa2luZBIbCglwdWJsaWNfaWQYAiABKAlSCHB1YmxpY0lkEigKEHNlcmllc19wdWJsaWNf'
    'aWQYAyABKAlSDnNlcmllc1B1YmxpY0lkEhIKBHNsdWcYBCABKAlSBHNsdWcSKAoQbGFzdF9tb2'
    'RpZmllZF9hdBgFIAEoCVIObGFzdE1vZGlmaWVkQXQSKwoRcHVibGlzaGVkX2xvY2FsZXMYBiAD'
    'KAlSEHB1Ymxpc2hlZExvY2FsZXM=');

@$core.Deprecated('Use listSitemapEntriesRequestDescriptor instead')
const ListSitemapEntriesRequest$json = {
  '1': 'ListSitemapEntriesRequest',
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
  ],
};

/// Descriptor for `ListSitemapEntriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSitemapEntriesRequestDescriptor = $convert.base64Decode(
    'ChlMaXN0U2l0ZW1hcEVudHJpZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIUCgV0'
    'b2tlbhgDIAEoCVIFdG9rZW4=');

@$core.Deprecated('Use listSitemapEntriesResponseDescriptor instead')
const ListSitemapEntriesResponse$json = {
  '1': 'ListSitemapEntriesResponse',
  '2': [
    {
      '1': 'entries',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.SitemapEntry',
      '10': 'entries'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListSitemapEntriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSitemapEntriesResponseDescriptor =
    $convert.base64Decode(
        'ChpMaXN0U2l0ZW1hcEVudHJpZXNSZXNwb25zZRIyCgdlbnRyaWVzGAEgAygLMhgucHVibGlyYS'
        '52MS5TaXRlbWFwRW50cnlSB2VudHJpZXMSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXByZXZp'
        'b3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use campaignBannerDescriptor instead')
const CampaignBanner$json = {
  '1': 'CampaignBanner',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'link_url', '3': 2, '4': 1, '5': 9, '10': 'linkUrl'},
    {'1': 'image_updated_at', '3': 3, '4': 1, '5': 9, '10': 'imageUpdatedAt'},
    {
      '1': 'image_variants',
      '3': 4,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'imageVariants'
    },
    {'1': 'alt_text', '3': 5, '4': 1, '5': 9, '10': 'altText'},
  ],
};

/// Descriptor for `CampaignBanner`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List campaignBannerDescriptor = $convert.base64Decode(
    'Cg5DYW1wYWlnbkJhbm5lchIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhkKCGxpbmtfdX'
    'JsGAIgASgJUgdsaW5rVXJsEigKEGltYWdlX3VwZGF0ZWRfYXQYAyABKAlSDmltYWdlVXBkYXRl'
    'ZEF0Ek4KDmltYWdlX3ZhcmlhbnRzGAQgAygLMicucHVibGlyYS50eXBlcy52MS5TZXJpZXNFeW'
    'VDYXRjaFZhcmlhbnRSDWltYWdlVmFyaWFudHMSGQoIYWx0X3RleHQYBSABKAlSB2FsdFRleHQ=');

@$core.Deprecated('Use listCampaignBannersRequestDescriptor instead')
const ListCampaignBannersRequest$json = {
  '1': 'ListCampaignBannersRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
  ],
};

/// Descriptor for `ListCampaignBannersRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listCampaignBannersRequestDescriptor =
    $convert.base64Decode(
        'ChpMaXN0Q2FtcGFpZ25CYW5uZXJzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
        'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudA==');

@$core.Deprecated('Use listCampaignBannersResponseDescriptor instead')
const ListCampaignBannersResponse$json = {
  '1': 'ListCampaignBannersResponse',
  '2': [
    {
      '1': 'banners',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.CampaignBanner',
      '10': 'banners'
    },
  ],
};

/// Descriptor for `ListCampaignBannersResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listCampaignBannersResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0Q2FtcGFpZ25CYW5uZXJzUmVzcG9uc2USNAoHYmFubmVycxgBIAMoCzIaLnB1Ymxpcm'
        'EudjEuQ2FtcGFpZ25CYW5uZXJSB2Jhbm5lcnM=');

@$core.Deprecated('Use markEpisodeAsReadRequestDescriptor instead')
const MarkEpisodeAsReadRequest$json = {
  '1': 'MarkEpisodeAsReadRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'episode_id', '3': 4, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `MarkEpisodeAsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markEpisodeAsReadRequestDescriptor = $convert.base64Decode(
    'ChhNYXJrRXBpc29kZUFzUmVhZFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgDIAEoDjIfLnB1YmxpcmEu'
    'dHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCgplcGlzb2RlX2lkGAQgASgJUgllcG'
    'lzb2RlSWRKBAgCEANSEWVwaXNvZGVfcHVibGljX2lk');

@$core.Deprecated('Use markEpisodeAsReadResponseDescriptor instead')
const MarkEpisodeAsReadResponse$json = {
  '1': 'MarkEpisodeAsReadResponse',
  '2': [
    {'1': 'read_at', '3': 1, '4': 1, '5': 9, '10': 'readAt'},
  ],
};

/// Descriptor for `MarkEpisodeAsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markEpisodeAsReadResponseDescriptor =
    $convert.base64Decode(
        'ChlNYXJrRXBpc29kZUFzUmVhZFJlc3BvbnNlEhcKB3JlYWRfYXQYASABKAlSBnJlYWRBdA==');

@$core.Deprecated('Use readingPositionDescriptor instead')
const ReadingPosition$json = {
  '1': 'ReadingPosition',
  '2': [
    {'1': 'episode_public_id', '3': 1, '4': 1, '5': 9, '10': 'episodePublicId'},
    {'1': 'page_index', '3': 2, '4': 1, '5': 5, '10': 'pageIndex'},
    {'1': 'page_count', '3': 3, '4': 1, '5': 5, '10': 'pageCount'},
    {'1': 'updated_at', '3': 4, '4': 1, '5': 9, '10': 'updatedAt'},
  ],
};

/// Descriptor for `ReadingPosition`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List readingPositionDescriptor = $convert.base64Decode(
    'Cg9SZWFkaW5nUG9zaXRpb24SKgoRZXBpc29kZV9wdWJsaWNfaWQYASABKAlSD2VwaXNvZGVQdW'
    'JsaWNJZBIdCgpwYWdlX2luZGV4GAIgASgFUglwYWdlSW5kZXgSHQoKcGFnZV9jb3VudBgDIAEo'
    'BVIJcGFnZUNvdW50Eh0KCnVwZGF0ZWRfYXQYBCABKAlSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use saveReadingPositionRequestDescriptor instead')
const SaveReadingPositionRequest$json = {
  '1': 'SaveReadingPositionRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'page_index', '3': 3, '4': 1, '5': 5, '10': 'pageIndex'},
    {
      '1': 'surface',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'episode_id', '3': 5, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `SaveReadingPositionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List saveReadingPositionRequestDescriptor = $convert.base64Decode(
    'ChpTYXZlUmVhZGluZ1Bvc2l0aW9uUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIdCgpwYWdlX2luZGV4GAMgASgFUglwYWdl'
    'SW5kZXgSOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZV'
    'IHc3VyZmFjZRIdCgplcGlzb2RlX2lkGAUgASgJUgllcGlzb2RlSWRKBAgCEANSEWVwaXNvZGVf'
    'cHVibGljX2lk');

@$core.Deprecated('Use saveReadingPositionResponseDescriptor instead')
const SaveReadingPositionResponse$json = {
  '1': 'SaveReadingPositionResponse',
  '2': [
    {
      '1': 'position',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ReadingPosition',
      '10': 'position'
    },
  ],
};

/// Descriptor for `SaveReadingPositionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List saveReadingPositionResponseDescriptor =
    $convert.base64Decode(
        'ChtTYXZlUmVhZGluZ1Bvc2l0aW9uUmVzcG9uc2USNwoIcG9zaXRpb24YASABKAsyGy5wdWJsaX'
        'JhLnYxLlJlYWRpbmdQb3NpdGlvblIIcG9zaXRpb24=');

@$core.Deprecated('Use getMyReadingPositionRequestDescriptor instead')
const GetMyReadingPositionRequest$json = {
  '1': 'GetMyReadingPositionRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'episode_id', '3': 4, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `GetMyReadingPositionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyReadingPositionRequestDescriptor = $convert.base64Decode(
    'ChtHZXRNeVJlYWRpbmdQb3NpdGlvblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgDIAEoDjIfLnB1Ymxp'
    'cmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCgplcGlzb2RlX2lkGAQgASgJUg'
    'llcGlzb2RlSWRKBAgCEANSEWVwaXNvZGVfcHVibGljX2lk');

@$core.Deprecated('Use getMyReadingPositionResponseDescriptor instead')
const GetMyReadingPositionResponse$json = {
  '1': 'GetMyReadingPositionResponse',
  '2': [
    {
      '1': 'position',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ReadingPosition',
      '10': 'position'
    },
  ],
};

/// Descriptor for `GetMyReadingPositionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyReadingPositionResponseDescriptor =
    $convert.base64Decode(
        'ChxHZXRNeVJlYWRpbmdQb3NpdGlvblJlc3BvbnNlEjcKCHBvc2l0aW9uGAEgASgLMhsucHVibG'
        'lyYS52MS5SZWFkaW5nUG9zaXRpb25SCHBvc2l0aW9u');

@$core.Deprecated('Use getMySeriesProgressRequestDescriptor instead')
const GetMySeriesProgressRequest$json = {
  '1': 'GetMySeriesProgressRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'series_id', '3': 4, '4': 1, '5': 9, '10': 'seriesId'},
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['series_public_id'],
};

/// Descriptor for `GetMySeriesProgressRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySeriesProgressRequestDescriptor = $convert.base64Decode(
    'ChpHZXRNeVNlcmllc1Byb2dyZXNzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBI5CgdzdXJmYWNlGAMgASgOMh8ucHVibGly'
    'YS50eXBlcy52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNlEhsKCXNlcmllc19pZBgEIAEoCVIIc2'
    'VyaWVzSWQSFgoGbG9jYWxlGAUgASgJUgZsb2NhbGVKBAgCEANSEHNlcmllc19wdWJsaWNfaWQ=');

@$core.Deprecated('Use seriesProgressDescriptor instead')
const SeriesProgress$json = {
  '1': 'SeriesProgress',
  '2': [
    {
      '1': 'episode',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {
      '1': 'position',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ReadingPosition',
      '10': 'position'
    },
    {'1': 'is_finished', '3': 3, '4': 1, '5': 8, '10': 'isFinished'},
  ],
};

/// Descriptor for `SeriesProgress`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List seriesProgressDescriptor = $convert.base64Decode(
    'Cg5TZXJpZXNQcm9ncmVzcxIzCgdlcGlzb2RlGAEgASgLMhkucHVibGlyYS50eXBlcy52MS5FcG'
    'lzb2RlUgdlcGlzb2RlEjcKCHBvc2l0aW9uGAIgASgLMhsucHVibGlyYS52MS5SZWFkaW5nUG9z'
    'aXRpb25SCHBvc2l0aW9uEh8KC2lzX2ZpbmlzaGVkGAMgASgIUgppc0ZpbmlzaGVk');

@$core.Deprecated('Use getMySeriesProgressResponseDescriptor instead')
const GetMySeriesProgressResponse$json = {
  '1': 'GetMySeriesProgressResponse',
  '2': [
    {
      '1': 'progress',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.SeriesProgress',
      '10': 'progress'
    },
    {
      '1': 'finished_episode_public_ids',
      '3': 2,
      '4': 3,
      '5': 9,
      '10': 'finishedEpisodePublicIds'
    },
  ],
};

/// Descriptor for `GetMySeriesProgressResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySeriesProgressResponseDescriptor =
    $convert.base64Decode(
        'ChtHZXRNeVNlcmllc1Byb2dyZXNzUmVzcG9uc2USNgoIcHJvZ3Jlc3MYASABKAsyGi5wdWJsaX'
        'JhLnYxLlNlcmllc1Byb2dyZXNzUghwcm9ncmVzcxI9ChtmaW5pc2hlZF9lcGlzb2RlX3B1Ymxp'
        'Y19pZHMYAiADKAlSGGZpbmlzaGVkRXBpc29kZVB1YmxpY0lkcw==');

@$core.Deprecated('Use recentSeriesDescriptor instead')
const RecentSeries$json = {
  '1': 'RecentSeries',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'episode',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {
      '1': 'position',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ReadingPosition',
      '10': 'position'
    },
    {'1': 'last_activity_at', '3': 4, '4': 1, '5': 9, '10': 'lastActivityAt'},
  ],
};

/// Descriptor for `RecentSeries`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recentSeriesDescriptor = $convert.base64Decode(
    'CgxSZWNlbnRTZXJpZXMSMAoGc2VyaWVzGAEgASgLMhgucHVibGlyYS50eXBlcy52MS5TZXJpZX'
    'NSBnNlcmllcxIzCgdlcGlzb2RlGAIgASgLMhkucHVibGlyYS50eXBlcy52MS5FcGlzb2RlUgdl'
    'cGlzb2RlEjcKCHBvc2l0aW9uGAMgASgLMhsucHVibGlyYS52MS5SZWFkaW5nUG9zaXRpb25SCH'
    'Bvc2l0aW9uEigKEGxhc3RfYWN0aXZpdHlfYXQYBCABKAlSDmxhc3RBY3Rpdml0eUF0');

@$core.Deprecated('Use listMyRecentSeriesRequestDescriptor instead')
const ListMyRecentSeriesRequest$json = {
  '1': 'ListMyRecentSeriesRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListMyRecentSeriesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyRecentSeriesRequestDescriptor = $convert.base64Decode(
    'ChlMaXN0TXlSZWNlbnRTZXJpZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIUCgV0'
    'b2tlbhgDIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2'
    'xpZW50U3VyZmFjZVIHc3VyZmFjZRIWCgZsb2NhbGUYBSABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use listMyRecentSeriesResponseDescriptor instead')
const ListMyRecentSeriesResponse$json = {
  '1': 'ListMyRecentSeriesResponse',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.RecentSeries',
      '10': 'series'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyRecentSeriesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyRecentSeriesResponseDescriptor =
    $convert.base64Decode(
        'ChpMaXN0TXlSZWNlbnRTZXJpZXNSZXNwb25zZRIwCgZzZXJpZXMYASADKAsyGC5wdWJsaXJhLn'
        'YxLlJlY2VudFNlcmllc1IGc2VyaWVzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2aW91'
        'c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use myEpisodeReadDescriptor instead')
const MyEpisodeRead$json = {
  '1': 'MyEpisodeRead',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'episode',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {'1': 'read_at', '3': 3, '4': 1, '5': 9, '10': 'readAt'},
  ],
};

/// Descriptor for `MyEpisodeRead`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myEpisodeReadDescriptor = $convert.base64Decode(
    'Cg1NeUVwaXNvZGVSZWFkEjAKBnNlcmllcxgBIAEoCzIYLnB1YmxpcmEudHlwZXMudjEuU2VyaW'
    'VzUgZzZXJpZXMSMwoHZXBpc29kZRgCIAEoCzIZLnB1YmxpcmEudHlwZXMudjEuRXBpc29kZVIH'
    'ZXBpc29kZRIXCgdyZWFkX2F0GAMgASgJUgZyZWFkQXQ=');

@$core.Deprecated('Use listMyEpisodeReadsRequestDescriptor instead')
const ListMyEpisodeReadsRequest$json = {
  '1': 'ListMyEpisodeReadsRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListMyEpisodeReadsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyEpisodeReadsRequestDescriptor = $convert.base64Decode(
    'ChlMaXN0TXlFcGlzb2RlUmVhZHNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIUCgV0'
    'b2tlbhgDIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2'
    'xpZW50U3VyZmFjZVIHc3VyZmFjZRIWCgZsb2NhbGUYBSABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use listMyEpisodeReadsResponseDescriptor instead')
const ListMyEpisodeReadsResponse$json = {
  '1': 'ListMyEpisodeReadsResponse',
  '2': [
    {
      '1': 'reads',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyEpisodeRead',
      '10': 'reads'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyEpisodeReadsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyEpisodeReadsResponseDescriptor =
    $convert.base64Decode(
        'ChpMaXN0TXlFcGlzb2RlUmVhZHNSZXNwb25zZRIvCgVyZWFkcxgBIAMoCzIZLnB1YmxpcmEudj'
        'EuTXlFcGlzb2RlUmVhZFIFcmVhZHMSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXByZXZpb3Vz'
        'VG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use followTargetDescriptor instead')
const FollowTarget$json = {
  '1': 'FollowTarget',
  '2': [
    {
      '1': 'type',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.FollowTargetType',
      '10': 'type'
    },
    {'1': 'id', '3': 3, '4': 1, '5': 9, '10': 'id'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['public_id'],
};

/// Descriptor for `FollowTarget`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followTargetDescriptor = $convert.base64Decode(
    'CgxGb2xsb3dUYXJnZXQSMAoEdHlwZRgBIAEoDjIcLnB1YmxpcmEudjEuRm9sbG93VGFyZ2V0VH'
    'lwZVIEdHlwZRIOCgJpZBgDIAEoCVICaWRKBAgCEANSCXB1YmxpY19pZA==');

@$core.Deprecated('Use getMyFollowStatusRequestDescriptor instead')
const GetMyFollowStatusRequest$json = {
  '1': 'GetMyFollowStatusRequest',
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
      '1': 'target',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.FollowTarget',
      '10': 'target'
    },
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `GetMyFollowStatusRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyFollowStatusRequestDescriptor = $convert.base64Decode(
    'ChhHZXRNeUZvbGxvd1N0YXR1c1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSMAoGdGFyZ2V0GAIgASgLMhgucHVibGlyYS52'
    'MS5Gb2xsb3dUYXJnZXRSBnRhcmdldBI5CgdzdXJmYWNlGAMgASgOMh8ucHVibGlyYS50eXBlcy'
    '52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNl');

@$core.Deprecated('Use getMyFollowStatusResponseDescriptor instead')
const GetMyFollowStatusResponse$json = {
  '1': 'GetMyFollowStatusResponse',
  '2': [
    {'1': 'is_following', '3': 1, '4': 1, '5': 8, '10': 'isFollowing'},
  ],
};

/// Descriptor for `GetMyFollowStatusResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyFollowStatusResponseDescriptor =
    $convert.base64Decode(
        'ChlHZXRNeUZvbGxvd1N0YXR1c1Jlc3BvbnNlEiEKDGlzX2ZvbGxvd2luZxgBIAEoCFILaXNGb2'
        'xsb3dpbmc=');

@$core.Deprecated('Use followRequestDescriptor instead')
const FollowRequest$json = {
  '1': 'FollowRequest',
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
      '1': 'target',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.FollowTarget',
      '10': 'target'
    },
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `FollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followRequestDescriptor = $convert.base64Decode(
    'Cg1Gb2xsb3dSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudjEuVGVuYW'
    '50Q29udGV4dFIGdGVuYW50EjAKBnRhcmdldBgCIAEoCzIYLnB1YmxpcmEudjEuRm9sbG93VGFy'
    'Z2V0UgZ0YXJnZXQSOQoHc3VyZmFjZRgDIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3'
    'VyZmFjZVIHc3VyZmFjZQ==');

@$core.Deprecated('Use followResponseDescriptor instead')
const FollowResponse$json = {
  '1': 'FollowResponse',
  '2': [
    {'1': 'is_following', '3': 1, '4': 1, '5': 8, '10': 'isFollowing'},
  ],
};

/// Descriptor for `FollowResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followResponseDescriptor = $convert.base64Decode(
    'Cg5Gb2xsb3dSZXNwb25zZRIhCgxpc19mb2xsb3dpbmcYASABKAhSC2lzRm9sbG93aW5n');

@$core.Deprecated('Use unfollowRequestDescriptor instead')
const UnfollowRequest$json = {
  '1': 'UnfollowRequest',
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
      '1': 'target',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.FollowTarget',
      '10': 'target'
    },
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `UnfollowRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unfollowRequestDescriptor = $convert.base64Decode(
    'Cg9VbmZvbGxvd1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS5UZW'
    '5hbnRDb250ZXh0UgZ0ZW5hbnQSMAoGdGFyZ2V0GAIgASgLMhgucHVibGlyYS52MS5Gb2xsb3dU'
    'YXJnZXRSBnRhcmdldBI5CgdzdXJmYWNlGAMgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbGllbn'
    'RTdXJmYWNlUgdzdXJmYWNl');

@$core.Deprecated('Use unfollowResponseDescriptor instead')
const UnfollowResponse$json = {
  '1': 'UnfollowResponse',
  '2': [
    {'1': 'is_following', '3': 1, '4': 1, '5': 8, '10': 'isFollowing'},
  ],
};

/// Descriptor for `UnfollowResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unfollowResponseDescriptor = $convert.base64Decode(
    'ChBVbmZvbGxvd1Jlc3BvbnNlEiEKDGlzX2ZvbGxvd2luZxgBIAEoCFILaXNGb2xsb3dpbmc=');

@$core.Deprecated('Use myFollowDescriptor instead')
const MyFollow$json = {
  '1': 'MyFollow',
  '2': [
    {
      '1': 'target_type',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.FollowTargetType',
      '10': 'targetType'
    },
    {'1': 'target_public_id', '3': 2, '4': 1, '5': 9, '10': 'targetPublicId'},
    {'1': 'followed_at', '3': 3, '4': 1, '5': 9, '10': 'followedAt'},
    {'1': 'target_id', '3': 4, '4': 1, '5': 9, '10': 'targetId'},
  ],
};

/// Descriptor for `MyFollow`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myFollowDescriptor = $convert.base64Decode(
    'CghNeUZvbGxvdxI9Cgt0YXJnZXRfdHlwZRgBIAEoDjIcLnB1YmxpcmEudjEuRm9sbG93VGFyZ2'
    'V0VHlwZVIKdGFyZ2V0VHlwZRIoChB0YXJnZXRfcHVibGljX2lkGAIgASgJUg50YXJnZXRQdWJs'
    'aWNJZBIfCgtmb2xsb3dlZF9hdBgDIAEoCVIKZm9sbG93ZWRBdBIbCgl0YXJnZXRfaWQYBCABKA'
    'lSCHRhcmdldElk');

@$core.Deprecated('Use listMyFollowsRequestDescriptor instead')
const ListMyFollowsRequest$json = {
  '1': 'ListMyFollowsRequest',
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

/// Descriptor for `ListMyFollowsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyFollowsRequestDescriptor = $convert.base64Decode(
    'ChRMaXN0TXlGb2xsb3dzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cGVzLn'
    'YxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFAoFdG9rZW4Y'
    'AyABKAlSBXRva2VuEjkKB3N1cmZhY2UYBCABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudF'
    'N1cmZhY2VSB3N1cmZhY2U=');

@$core.Deprecated('Use listMyFollowsResponseDescriptor instead')
const ListMyFollowsResponse$json = {
  '1': 'ListMyFollowsResponse',
  '2': [
    {
      '1': 'follows',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyFollow',
      '10': 'follows'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyFollowsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyFollowsResponseDescriptor = $convert.base64Decode(
    'ChVMaXN0TXlGb2xsb3dzUmVzcG9uc2USLgoHZm9sbG93cxgBIAMoCzIULnB1YmxpcmEudjEuTX'
    'lGb2xsb3dSB2ZvbGxvd3MSJQoOcHJldmlvdXNfdG9rZW4YAiABKAlSDXByZXZpb3VzVG9rZW4S'
    'HQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use followUpdateDescriptor instead')
const FollowUpdate$json = {
  '1': 'FollowUpdate',
  '2': [
    {
      '1': 'series',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'episode',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
  ],
};

/// Descriptor for `FollowUpdate`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List followUpdateDescriptor = $convert.base64Decode(
    'CgxGb2xsb3dVcGRhdGUSMAoGc2VyaWVzGAEgASgLMhgucHVibGlyYS50eXBlcy52MS5TZXJpZX'
    'NSBnNlcmllcxIzCgdlcGlzb2RlGAIgASgLMhkucHVibGlyYS50eXBlcy52MS5FcGlzb2RlUgdl'
    'cGlzb2Rl');

@$core.Deprecated('Use listMyFollowUpdatesRequestDescriptor instead')
const ListMyFollowUpdatesRequest$json = {
  '1': 'ListMyFollowUpdatesRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListMyFollowUpdatesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyFollowUpdatesRequestDescriptor = $convert.base64Decode(
    'ChpMaXN0TXlGb2xsb3dVcGRhdGVzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgCIAEoBVIFbGltaXQSFAoF'
    'dG9rZW4YAyABKAlSBXRva2VuEjkKB3N1cmZhY2UYBCABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLk'
    'NsaWVudFN1cmZhY2VSB3N1cmZhY2USFgoGbG9jYWxlGAUgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use listMyFollowUpdatesResponseDescriptor instead')
const ListMyFollowUpdatesResponse$json = {
  '1': 'ListMyFollowUpdatesResponse',
  '2': [
    {
      '1': 'updates',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.FollowUpdate',
      '10': 'updates'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyFollowUpdatesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyFollowUpdatesResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0TXlGb2xsb3dVcGRhdGVzUmVzcG9uc2USMgoHdXBkYXRlcxgBIAMoCzIYLnB1Ymxpcm'
        'EudjEuRm9sbG93VXBkYXRlUgd1cGRhdGVzEiUKDnByZXZpb3VzX3Rva2VuGAIgASgJUg1wcmV2'
        'aW91c1Rva2VuEh0KCm5leHRfdG9rZW4YAyABKAlSCW5leHRUb2tlbg==');

@$core.Deprecated('Use rateEpisodeRequestDescriptor instead')
const RateEpisodeRequest$json = {
  '1': 'RateEpisodeRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'presses', '3': 3, '4': 1, '5': 5, '10': 'presses'},
    {
      '1': 'surface',
      '3': 4,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'episode_id', '3': 5, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `RateEpisodeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List rateEpisodeRequestDescriptor = $convert.base64Decode(
    'ChJSYXRlRXBpc29kZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS'
    '5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSGAoHcHJlc3NlcxgDIAEoBVIHcHJlc3NlcxI5CgdzdXJm'
    'YWNlGAQgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNlEh0KCm'
    'VwaXNvZGVfaWQYBSABKAlSCWVwaXNvZGVJZEoECAIQA1IRZXBpc29kZV9wdWJsaWNfaWQ=');

@$core.Deprecated('Use rateEpisodeResponseDescriptor instead')
const RateEpisodeResponse$json = {
  '1': 'RateEpisodeResponse',
  '2': [
    {'1': 'score', '3': 1, '4': 1, '5': 5, '10': 'score'},
    {'1': 'rating_count', '3': 2, '4': 1, '5': 3, '10': 'ratingCount'},
    {
      '1': 'mode',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeRatingMode',
      '10': 'mode'
    },
  ],
};

/// Descriptor for `RateEpisodeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List rateEpisodeResponseDescriptor = $convert.base64Decode(
    'ChNSYXRlRXBpc29kZVJlc3BvbnNlEhQKBXNjb3JlGAEgASgFUgVzY29yZRIhCgxyYXRpbmdfY2'
    '91bnQYAiABKANSC3JhdGluZ0NvdW50EjEKBG1vZGUYAyABKA4yHS5wdWJsaXJhLnYxLkVwaXNv'
    'ZGVSYXRpbmdNb2RlUgRtb2Rl');

@$core.Deprecated('Use getMyEpisodeRatingRequestDescriptor instead')
const GetMyEpisodeRatingRequest$json = {
  '1': 'GetMyEpisodeRatingRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'episode_id', '3': 4, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `GetMyEpisodeRatingRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyEpisodeRatingRequestDescriptor = $convert.base64Decode(
    'ChlHZXRNeUVwaXNvZGVSYXRpbmdSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjkKB3N1cmZhY2UYAyABKA4yHy5wdWJsaXJh'
    'LnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2USHQoKZXBpc29kZV9pZBgEIAEoCVIJZX'
    'Bpc29kZUlkSgQIAhADUhFlcGlzb2RlX3B1YmxpY19pZA==');

@$core.Deprecated('Use getMyEpisodeRatingResponseDescriptor instead')
const GetMyEpisodeRatingResponse$json = {
  '1': 'GetMyEpisodeRatingResponse',
  '2': [
    {'1': 'score', '3': 1, '4': 1, '5': 5, '10': 'score'},
    {'1': 'rating_count', '3': 2, '4': 1, '5': 3, '10': 'ratingCount'},
    {
      '1': 'mode',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.EpisodeRatingMode',
      '10': 'mode'
    },
    {'1': 'reader_credited', '3': 4, '4': 1, '5': 8, '10': 'readerCredited'},
    {'1': 'reader_is_staff', '3': 5, '4': 1, '5': 8, '10': 'readerIsStaff'},
  ],
};

/// Descriptor for `GetMyEpisodeRatingResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyEpisodeRatingResponseDescriptor = $convert.base64Decode(
    'ChpHZXRNeUVwaXNvZGVSYXRpbmdSZXNwb25zZRIUCgVzY29yZRgBIAEoBVIFc2NvcmUSIQoMcm'
    'F0aW5nX2NvdW50GAIgASgDUgtyYXRpbmdDb3VudBIxCgRtb2RlGAMgASgOMh0ucHVibGlyYS52'
    'MS5FcGlzb2RlUmF0aW5nTW9kZVIEbW9kZRInCg9yZWFkZXJfY3JlZGl0ZWQYBCABKAhSDnJlYW'
    'RlckNyZWRpdGVkEiYKD3JlYWRlcl9pc19zdGFmZhgFIAEoCFINcmVhZGVySXNTdGFmZg==');

@$core.Deprecated('Use getMySeriesRatingRequestDescriptor instead')
const GetMySeriesRatingRequest$json = {
  '1': 'GetMySeriesRatingRequest',
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
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'series_id', '3': 4, '4': 1, '5': 9, '10': 'seriesId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['series_public_id'],
};

/// Descriptor for `GetMySeriesRatingRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySeriesRatingRequestDescriptor = $convert.base64Decode(
    'ChhHZXRNeVNlcmllc1JhdGluZ1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOQoHc3VyZmFjZRgDIAEoDjIfLnB1YmxpcmEu'
    'dHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIbCglzZXJpZXNfaWQYBCABKAlSCHNlcm'
    'llc0lkSgQIAhADUhBzZXJpZXNfcHVibGljX2lk');

@$core.Deprecated('Use getMySeriesRatingResponseDescriptor instead')
const GetMySeriesRatingResponse$json = {
  '1': 'GetMySeriesRatingResponse',
  '2': [
    {'1': 'rating_average', '3': 1, '4': 1, '5': 1, '10': 'ratingAverage'},
    {
      '1': 'rated_episode_count',
      '3': 2,
      '4': 1,
      '5': 5,
      '10': 'ratedEpisodeCount'
    },
  ],
};

/// Descriptor for `GetMySeriesRatingResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySeriesRatingResponseDescriptor = $convert.base64Decode(
    'ChlHZXRNeVNlcmllc1JhdGluZ1Jlc3BvbnNlEiUKDnJhdGluZ19hdmVyYWdlGAEgASgBUg1yYX'
    'RpbmdBdmVyYWdlEi4KE3JhdGVkX2VwaXNvZGVfY291bnQYAiABKAVSEXJhdGVkRXBpc29kZUNv'
    'dW50');

@$core.Deprecated('Use contentViewTargetDescriptor instead')
const ContentViewTarget$json = {
  '1': 'ContentViewTarget',
  '2': [
    {
      '1': 'type',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.ContentViewTargetType',
      '10': 'type'
    },
    {'1': 'id', '3': 3, '4': 1, '5': 9, '10': 'id'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['public_id'],
};

/// Descriptor for `ContentViewTarget`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List contentViewTargetDescriptor = $convert.base64Decode(
    'ChFDb250ZW50Vmlld1RhcmdldBI1CgR0eXBlGAEgASgOMiEucHVibGlyYS52MS5Db250ZW50Vm'
    'lld1RhcmdldFR5cGVSBHR5cGUSDgoCaWQYAyABKAlSAmlkSgQIAhADUglwdWJsaWNfaWQ=');

@$core.Deprecated('Use recordContentViewRequestDescriptor instead')
const RecordContentViewRequest$json = {
  '1': 'RecordContentViewRequest',
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
      '1': 'target',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ContentViewTarget',
      '10': 'target'
    },
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `RecordContentViewRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recordContentViewRequestDescriptor = $convert.base64Decode(
    'ChhSZWNvcmRDb250ZW50Vmlld1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSNQoGdGFyZ2V0GAIgASgLMh0ucHVibGlyYS52'
    'MS5Db250ZW50Vmlld1RhcmdldFIGdGFyZ2V0EjkKB3N1cmZhY2UYAyABKA4yHy5wdWJsaXJhLn'
    'R5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2U=');

@$core.Deprecated('Use recordContentViewResponseDescriptor instead')
const RecordContentViewResponse$json = {
  '1': 'RecordContentViewResponse',
};

/// Descriptor for `RecordContentViewResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List recordContentViewResponseDescriptor =
    $convert.base64Decode('ChlSZWNvcmRDb250ZW50Vmlld1Jlc3BvbnNl');

@$core.Deprecated('Use startEpisodeCheckoutRequestDescriptor instead')
const StartEpisodeCheckoutRequest$json = {
  '1': 'StartEpisodeCheckoutRequest',
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
      '1': 'client',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.StartEpisodeCheckoutRequest.Client',
      '10': 'client'
    },
    {'1': 'episode_id', '3': 4, '4': 1, '5': 9, '10': 'episodeId'},
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
    {
      '1': 'kind',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.PurchaseKind',
      '10': 'kind'
    },
  ],
  '4': [StartEpisodeCheckoutRequest_Client$json],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

@$core.Deprecated('Use startEpisodeCheckoutRequestDescriptor instead')
const StartEpisodeCheckoutRequest_Client$json = {
  '1': 'Client',
  '2': [
    {'1': 'CLIENT_UNSPECIFIED', '2': 0},
    {'1': 'CLIENT_WEB', '2': 1},
    {'1': 'CLIENT_MOBILE', '2': 2},
  ],
};

/// Descriptor for `StartEpisodeCheckoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startEpisodeCheckoutRequestDescriptor = $convert.base64Decode(
    'ChtTdGFydEVwaXNvZGVDaGVja291dFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSRgoGY2xpZW50GAMgASgOMi4ucHVibGly'
    'YS52MS5TdGFydEVwaXNvZGVDaGVja291dFJlcXVlc3QuQ2xpZW50UgZjbGllbnQSHQoKZXBpc2'
    '9kZV9pZBgEIAEoCVIJZXBpc29kZUlkEhYKBmxvY2FsZRgFIAEoCVIGbG9jYWxlEjIKBGtpbmQY'
    'BiABKA4yHi5wdWJsaXJhLnR5cGVzLnYxLlB1cmNoYXNlS2luZFIEa2luZCJDCgZDbGllbnQSFg'
    'oSQ0xJRU5UX1VOU1BFQ0lGSUVEEAASDgoKQ0xJRU5UX1dFQhABEhEKDUNMSUVOVF9NT0JJTEUQ'
    'AkoECAIQA1IRZXBpc29kZV9wdWJsaWNfaWQ=');

@$core.Deprecated('Use startEpisodeCheckoutResponseDescriptor instead')
const StartEpisodeCheckoutResponse$json = {
  '1': 'StartEpisodeCheckoutResponse',
  '2': [
    {'1': 'checkout_url', '3': 1, '4': 1, '5': 9, '10': 'checkoutUrl'},
  ],
};

/// Descriptor for `StartEpisodeCheckoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startEpisodeCheckoutResponseDescriptor =
    $convert.base64Decode(
        'ChxTdGFydEVwaXNvZGVDaGVja291dFJlc3BvbnNlEiEKDGNoZWNrb3V0X3VybBgBIAEoCVILY2'
        'hlY2tvdXRVcmw=');

@$core.Deprecated('Use startVolumeCheckoutRequestDescriptor instead')
const StartVolumeCheckoutRequest$json = {
  '1': 'StartVolumeCheckoutRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'volume_id', '3': 2, '4': 1, '5': 9, '10': 'volumeId'},
    {
      '1': 'client',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.StartEpisodeCheckoutRequest.Client',
      '10': 'client'
    },
  ],
};

/// Descriptor for `StartVolumeCheckoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startVolumeCheckoutRequestDescriptor = $convert.base64Decode(
    'ChpTdGFydFZvbHVtZUNoZWNrb3V0UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIbCgl2b2x1bWVfaWQYAiABKAlSCHZvbHVt'
    'ZUlkEkYKBmNsaWVudBgDIAEoDjIuLnB1YmxpcmEudjEuU3RhcnRFcGlzb2RlQ2hlY2tvdXRSZX'
    'F1ZXN0LkNsaWVudFIGY2xpZW50');

@$core.Deprecated('Use startVolumeCheckoutResponseDescriptor instead')
const StartVolumeCheckoutResponse$json = {
  '1': 'StartVolumeCheckoutResponse',
  '2': [
    {'1': 'checkout_url', '3': 1, '4': 1, '5': 9, '10': 'checkoutUrl'},
  ],
};

/// Descriptor for `StartVolumeCheckoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startVolumeCheckoutResponseDescriptor =
    $convert.base64Decode(
        'ChtTdGFydFZvbHVtZUNoZWNrb3V0UmVzcG9uc2USIQoMY2hlY2tvdXRfdXJsGAEgASgJUgtjaG'
        'Vja291dFVybA==');

@$core.Deprecated('Use startSeriesRemainderCheckoutRequestDescriptor instead')
const StartSeriesRemainderCheckoutRequest$json = {
  '1': 'StartSeriesRemainderCheckoutRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'series_id', '3': 2, '4': 1, '5': 9, '10': 'seriesId'},
    {
      '1': 'client',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.StartEpisodeCheckoutRequest.Client',
      '10': 'client'
    },
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `StartSeriesRemainderCheckoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startSeriesRemainderCheckoutRequestDescriptor =
    $convert.base64Decode(
        'CiNTdGFydFNlcmllc1JlbWFpbmRlckNoZWNrb3V0UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy'
        '5wdWJsaXJhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIbCglzZXJpZXNfaWQYAiAB'
        'KAlSCHNlcmllc0lkEkYKBmNsaWVudBgDIAEoDjIuLnB1YmxpcmEudjEuU3RhcnRFcGlzb2RlQ2'
        'hlY2tvdXRSZXF1ZXN0LkNsaWVudFIGY2xpZW50EhYKBmxvY2FsZRgEIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use startSeriesRemainderCheckoutResponseDescriptor instead')
const StartSeriesRemainderCheckoutResponse$json = {
  '1': 'StartSeriesRemainderCheckoutResponse',
  '2': [
    {'1': 'checkout_url', '3': 1, '4': 1, '5': 9, '10': 'checkoutUrl'},
  ],
};

/// Descriptor for `StartSeriesRemainderCheckoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startSeriesRemainderCheckoutResponseDescriptor =
    $convert.base64Decode(
        'CiRTdGFydFNlcmllc1JlbWFpbmRlckNoZWNrb3V0UmVzcG9uc2USIQoMY2hlY2tvdXRfdXJsGA'
        'EgASgJUgtjaGVja291dFVybA==');

@$core.Deprecated('Use myPurchaseDescriptor instead')
const MyPurchase$json = {
  '1': 'MyPurchase',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'episode',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {
      '1': 'series',
      '3': 3,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {'1': 'price_at_purchase', '3': 4, '4': 1, '5': 5, '10': 'priceAtPurchase'},
    {'1': 'purchased_at', '3': 5, '4': 1, '5': 9, '10': 'purchasedAt'},
    {'1': 'expires_at', '3': 6, '4': 1, '5': 9, '10': 'expiresAt'},
    {'1': 'is_active', '3': 7, '4': 1, '5': 8, '10': 'isActive'},
    {'1': 'currency', '3': 8, '4': 1, '5': 9, '10': 'currency'},
    {'1': 'refunded_amount', '3': 9, '4': 1, '5': 5, '10': 'refundedAmount'},
    {'1': 'refunded_at', '3': 10, '4': 1, '5': 9, '10': 'refundedAt'},
    {'1': 'revoked_at', '3': 11, '4': 1, '5': 9, '10': 'revokedAt'},
    {
      '1': 'kind',
      '3': 12,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.PurchaseKind',
      '10': 'kind'
    },
    {
      '1': 'volume',
      '3': 13,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Volume',
      '10': 'volume'
    },
    {
      '1': 'series_bundle',
      '3': 14,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.SeriesBundle',
      '10': 'seriesBundle'
    },
    {'1': 'coins_spent', '3': 15, '4': 1, '5': 5, '10': 'coinsSpent'},
    {'1': 'coin_name', '3': 16, '4': 1, '5': 9, '10': 'coinName'},
  ],
};

/// Descriptor for `MyPurchase`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myPurchaseDescriptor = $convert.base64Decode(
    'CgpNeVB1cmNoYXNlEg4KAmlkGAEgASgJUgJpZBIzCgdlcGlzb2RlGAIgASgLMhkucHVibGlyYS'
    '50eXBlcy52MS5FcGlzb2RlUgdlcGlzb2RlEjAKBnNlcmllcxgDIAEoCzIYLnB1YmxpcmEudHlw'
    'ZXMudjEuU2VyaWVzUgZzZXJpZXMSKgoRcHJpY2VfYXRfcHVyY2hhc2UYBCABKAVSD3ByaWNlQX'
    'RQdXJjaGFzZRIhCgxwdXJjaGFzZWRfYXQYBSABKAlSC3B1cmNoYXNlZEF0Eh0KCmV4cGlyZXNf'
    'YXQYBiABKAlSCWV4cGlyZXNBdBIbCglpc19hY3RpdmUYByABKAhSCGlzQWN0aXZlEhoKCGN1cn'
    'JlbmN5GAggASgJUghjdXJyZW5jeRInCg9yZWZ1bmRlZF9hbW91bnQYCSABKAVSDnJlZnVuZGVk'
    'QW1vdW50Eh8KC3JlZnVuZGVkX2F0GAogASgJUgpyZWZ1bmRlZEF0Eh0KCnJldm9rZWRfYXQYCy'
    'ABKAlSCXJldm9rZWRBdBIyCgRraW5kGAwgASgOMh4ucHVibGlyYS50eXBlcy52MS5QdXJjaGFz'
    'ZUtpbmRSBGtpbmQSMAoGdm9sdW1lGA0gASgLMhgucHVibGlyYS50eXBlcy52MS5Wb2x1bWVSBn'
    'ZvbHVtZRJDCg1zZXJpZXNfYnVuZGxlGA4gASgLMh4ucHVibGlyYS50eXBlcy52MS5TZXJpZXNC'
    'dW5kbGVSDHNlcmllc0J1bmRsZRIfCgtjb2luc19zcGVudBgPIAEoBVIKY29pbnNTcGVudBIbCg'
    'ljb2luX25hbWUYECABKAlSCGNvaW5OYW1l');

@$core.Deprecated('Use listMyPurchasesRequestDescriptor instead')
const ListMyPurchasesRequest$json = {
  '1': 'ListMyPurchasesRequest',
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
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListMyPurchasesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyPurchasesRequestDescriptor = $convert.base64Decode(
    'ChZMaXN0TXlQdXJjaGFzZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZX'
    'MudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAIgASgFUgVsaW1pdBIUCgV0b2tl'
    'bhgDIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW'
    '50U3VyZmFjZVIHc3VyZmFjZRIWCgZsb2NhbGUYBSABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use listMyPurchasesResponseDescriptor instead')
const ListMyPurchasesResponse$json = {
  '1': 'ListMyPurchasesResponse',
  '2': [
    {
      '1': 'purchases',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyPurchase',
      '10': 'purchases'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyPurchasesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyPurchasesResponseDescriptor = $convert.base64Decode(
    'ChdMaXN0TXlQdXJjaGFzZXNSZXNwb25zZRI0CglwdXJjaGFzZXMYASADKAsyFi5wdWJsaXJhLn'
    'YxLk15UHVyY2hhc2VSCXB1cmNoYXNlcxIlCg5wcmV2aW91c190b2tlbhgCIAEoCVINcHJldmlv'
    'dXNUb2tlbhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use processPaymentWebhookRequestDescriptor instead')
const ProcessPaymentWebhookRequest$json = {
  '1': 'ProcessPaymentWebhookRequest',
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
      '6': '.publira.v1.ProcessPaymentWebhookRequest.HeadersEntry',
      '10': 'headers'
    },
  ],
  '3': [ProcessPaymentWebhookRequest_HeadersEntry$json],
};

@$core.Deprecated('Use processPaymentWebhookRequestDescriptor instead')
const ProcessPaymentWebhookRequest_HeadersEntry$json = {
  '1': 'HeadersEntry',
  '2': [
    {'1': 'key', '3': 1, '4': 1, '5': 9, '10': 'key'},
    {'1': 'value', '3': 2, '4': 1, '5': 9, '10': 'value'},
  ],
  '7': {'7': true},
};

/// Descriptor for `ProcessPaymentWebhookRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processPaymentWebhookRequestDescriptor = $convert.base64Decode(
    'ChxQcm9jZXNzUGF5bWVudFdlYmhvb2tSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhoKCHByb3ZpZGVyGAIgASgJUghwcm92'
    'aWRlchIYCgdwYXlsb2FkGAMgASgMUgdwYXlsb2FkEk8KB2hlYWRlcnMYBCADKAsyNS5wdWJsaX'
    'JhLnYxLlByb2Nlc3NQYXltZW50V2ViaG9va1JlcXVlc3QuSGVhZGVyc0VudHJ5UgdoZWFkZXJz'
    'GjoKDEhlYWRlcnNFbnRyeRIQCgNrZXkYASABKAlSA2tleRIUCgV2YWx1ZRgCIAEoCVIFdmFsdW'
    'U6AjgB');

@$core.Deprecated('Use processPaymentWebhookResponseDescriptor instead')
const ProcessPaymentWebhookResponse$json = {
  '1': 'ProcessPaymentWebhookResponse',
};

/// Descriptor for `ProcessPaymentWebhookResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processPaymentWebhookResponseDescriptor =
    $convert.base64Decode('Ch1Qcm9jZXNzUGF5bWVudFdlYmhvb2tSZXNwb25zZQ==');

@$core.Deprecated('Use startStorePurchaseRequestDescriptor instead')
const StartStorePurchaseRequest$json = {
  '1': 'StartStorePurchaseRequest',
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
      '1': 'store',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.InAppPurchaseStore',
      '10': 'store'
    },
    {'1': 'episode_id', '3': 4, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `StartStorePurchaseRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startStorePurchaseRequestDescriptor = $convert.base64Decode(
    'ChlTdGFydFN0b3JlUHVyY2hhc2VSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjQKBXN0b3JlGAMgASgOMh4ucHVibGlyYS52'
    'MS5JbkFwcFB1cmNoYXNlU3RvcmVSBXN0b3JlEh0KCmVwaXNvZGVfaWQYBCABKAlSCWVwaXNvZG'
    'VJZEoECAIQA1IRZXBpc29kZV9wdWJsaWNfaWQ=');

@$core.Deprecated('Use startStorePurchaseResponseDescriptor instead')
const StartStorePurchaseResponse$json = {
  '1': 'StartStorePurchaseResponse',
  '2': [
    {'1': 'intent_id', '3': 1, '4': 1, '5': 9, '10': 'intentId'},
    {'1': 'product_id', '3': 2, '4': 1, '5': 9, '10': 'productId'},
  ],
};

/// Descriptor for `StartStorePurchaseResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startStorePurchaseResponseDescriptor =
    $convert.base64Decode(
        'ChpTdGFydFN0b3JlUHVyY2hhc2VSZXNwb25zZRIbCglpbnRlbnRfaWQYASABKAlSCGludGVudE'
        'lkEh0KCnByb2R1Y3RfaWQYAiABKAlSCXByb2R1Y3RJZA==');

@$core.Deprecated('Use confirmStorePurchaseRequestDescriptor instead')
const ConfirmStorePurchaseRequest$json = {
  '1': 'ConfirmStorePurchaseRequest',
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
      '1': 'store',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.InAppPurchaseStore',
      '10': 'store'
    },
    {'1': 'transaction', '3': 3, '4': 1, '5': 9, '10': 'transaction'},
    {'1': 'product_id', '3': 4, '4': 1, '5': 9, '10': 'productId'},
    {'1': 'locale', '3': 5, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ConfirmStorePurchaseRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmStorePurchaseRequestDescriptor = $convert.base64Decode(
    'ChtDb25maXJtU3RvcmVQdXJjaGFzZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSNAoFc3RvcmUYAiABKA4yHi5wdWJsaXJh'
    'LnYxLkluQXBwUHVyY2hhc2VTdG9yZVIFc3RvcmUSIAoLdHJhbnNhY3Rpb24YAyABKAlSC3RyYW'
    '5zYWN0aW9uEh0KCnByb2R1Y3RfaWQYBCABKAlSCXByb2R1Y3RJZBIWCgZsb2NhbGUYBSABKAlS'
    'BmxvY2FsZQ==');

@$core.Deprecated('Use confirmStorePurchaseResponseDescriptor instead')
const ConfirmStorePurchaseResponse$json = {
  '1': 'ConfirmStorePurchaseResponse',
  '2': [
    {
      '1': 'purchase',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.MyPurchase',
      '10': 'purchase'
    },
  ],
};

/// Descriptor for `ConfirmStorePurchaseResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmStorePurchaseResponseDescriptor =
    $convert.base64Decode(
        'ChxDb25maXJtU3RvcmVQdXJjaGFzZVJlc3BvbnNlEjIKCHB1cmNoYXNlGAEgASgLMhYucHVibG'
        'lyYS52MS5NeVB1cmNoYXNlUghwdXJjaGFzZQ==');

@$core.Deprecated('Use processAppStoreNotificationRequestDescriptor instead')
const ProcessAppStoreNotificationRequest$json = {
  '1': 'ProcessAppStoreNotificationRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'payload', '3': 2, '4': 1, '5': 12, '10': 'payload'},
  ],
};

/// Descriptor for `ProcessAppStoreNotificationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processAppStoreNotificationRequestDescriptor =
    $convert.base64Decode(
        'CiJQcm9jZXNzQXBwU3RvcmVOb3RpZmljYXRpb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLn'
        'B1YmxpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhgKB3BheWxvYWQYAiABKAxS'
        'B3BheWxvYWQ=');

@$core.Deprecated('Use processAppStoreNotificationResponseDescriptor instead')
const ProcessAppStoreNotificationResponse$json = {
  '1': 'ProcessAppStoreNotificationResponse',
};

/// Descriptor for `ProcessAppStoreNotificationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List processAppStoreNotificationResponseDescriptor =
    $convert
        .base64Decode('CiNQcm9jZXNzQXBwU3RvcmVOb3RpZmljYXRpb25SZXNwb25zZQ==');

@$core.Deprecated('Use getMyTicketStateRequestDescriptor instead')
const GetMyTicketStateRequest$json = {
  '1': 'GetMyTicketStateRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'series_id', '3': 2, '4': 1, '5': 9, '10': 'seriesId'},
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `GetMyTicketStateRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyTicketStateRequestDescriptor = $convert.base64Decode(
    'ChdHZXRNeVRpY2tldFN0YXRlUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIbCglzZXJpZXNfaWQYAiABKAlSCHNlcmllc0lk'
    'EjkKB3N1cmZhY2UYAyABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cm'
    'ZhY2U=');

@$core.Deprecated('Use waitFreeTicketDescriptor instead')
const WaitFreeTicket$json = {
  '1': 'WaitFreeTicket',
  '2': [
    {'1': 'episode_id', '3': 1, '4': 1, '5': 9, '10': 'episodeId'},
    {'1': 'expires_at', '3': 2, '4': 1, '5': 9, '10': 'expiresAt'},
  ],
};

/// Descriptor for `WaitFreeTicket`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List waitFreeTicketDescriptor = $convert.base64Decode(
    'Cg5XYWl0RnJlZVRpY2tldBIdCgplcGlzb2RlX2lkGAEgASgJUgllcGlzb2RlSWQSHQoKZXhwaX'
    'Jlc19hdBgCIAEoCVIJZXhwaXJlc0F0');

@$core.Deprecated('Use getMyTicketStateResponseDescriptor instead')
const GetMyTicketStateResponse$json = {
  '1': 'GetMyTicketStateResponse',
  '2': [
    {'1': 'next_available_at', '3': 1, '4': 1, '5': 9, '10': 'nextAvailableAt'},
    {
      '1': 'open_tickets',
      '3': 2,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.WaitFreeTicket',
      '10': 'openTickets'
    },
  ],
};

/// Descriptor for `GetMyTicketStateResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyTicketStateResponseDescriptor = $convert.base64Decode(
    'ChhHZXRNeVRpY2tldFN0YXRlUmVzcG9uc2USKgoRbmV4dF9hdmFpbGFibGVfYXQYASABKAlSD2'
    '5leHRBdmFpbGFibGVBdBI9CgxvcGVuX3RpY2tldHMYAiADKAsyGi5wdWJsaXJhLnYxLldhaXRG'
    'cmVlVGlja2V0UgtvcGVuVGlja2V0cw==');

@$core.Deprecated('Use useTicketRequestDescriptor instead')
const UseTicketRequest$json = {
  '1': 'UseTicketRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'episode_id', '3': 2, '4': 1, '5': 9, '10': 'episodeId'},
    {
      '1': 'surface',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
  ],
};

/// Descriptor for `UseTicketRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List useTicketRequestDescriptor = $convert.base64Decode(
    'ChBVc2VUaWNrZXRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudjEuVG'
    'VuYW50Q29udGV4dFIGdGVuYW50Eh0KCmVwaXNvZGVfaWQYAiABKAlSCWVwaXNvZGVJZBI5Cgdz'
    'dXJmYWNlGAMgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNl');

@$core.Deprecated('Use useTicketResponseDescriptor instead')
const UseTicketResponse$json = {
  '1': 'UseTicketResponse',
  '2': [
    {
      '1': 'ticket',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.WaitFreeTicket',
      '10': 'ticket'
    },
    {'1': 'next_available_at', '3': 2, '4': 1, '5': 9, '10': 'nextAvailableAt'},
  ],
};

/// Descriptor for `UseTicketResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List useTicketResponseDescriptor = $convert.base64Decode(
    'ChFVc2VUaWNrZXRSZXNwb25zZRIyCgZ0aWNrZXQYASABKAsyGi5wdWJsaXJhLnYxLldhaXRGcm'
    'VlVGlja2V0UgZ0aWNrZXQSKgoRbmV4dF9hdmFpbGFibGVfYXQYAiABKAlSD25leHRBdmFpbGFi'
    'bGVBdA==');

const $core.Map<$core.String, $core.dynamic> CatalogServiceBase$json = {
  '1': 'CatalogService',
  '2': [
    {
      '1': 'ListPublishedLabels',
      '2': '.publira.v1.ListPublishedLabelsRequest',
      '3': '.publira.v1.ListPublishedLabelsResponse'
    },
    {
      '1': 'ListPublishedSeries',
      '2': '.publira.v1.ListPublishedSeriesRequest',
      '3': '.publira.v1.ListPublishedSeriesResponse'
    },
    {
      '1': 'GetSeriesDetail',
      '2': '.publira.v1.GetSeriesDetailRequest',
      '3': '.publira.v1.GetSeriesDetailResponse'
    },
    {
      '1': 'GetSeriesEpisodeAccess',
      '2': '.publira.v1.GetSeriesEpisodeAccessRequest',
      '3': '.publira.v1.GetSeriesEpisodeAccessResponse'
    },
    {
      '1': 'GetEpisodeDetail',
      '2': '.publira.v1.GetEpisodeDetailRequest',
      '3': '.publira.v1.GetEpisodeDetailResponse'
    },
    {
      '1': 'ListPublishedCreators',
      '2': '.publira.v1.ListPublishedCreatorsRequest',
      '3': '.publira.v1.ListPublishedCreatorsResponse'
    },
    {
      '1': 'GetPublishedCreatorDetail',
      '2': '.publira.v1.GetPublishedCreatorDetailRequest',
      '3': '.publira.v1.GetPublishedCreatorDetailResponse'
    },
    {
      '1': 'GetPublishedLabelDetail',
      '2': '.publira.v1.GetPublishedLabelDetailRequest',
      '3': '.publira.v1.GetPublishedLabelDetailResponse'
    },
    {
      '1': 'ListPublishedGenres',
      '2': '.publira.v1.ListPublishedGenresRequest',
      '3': '.publira.v1.ListPublishedGenresResponse'
    },
    {
      '1': 'ListPublishedTags',
      '2': '.publira.v1.ListPublishedTagsRequest',
      '3': '.publira.v1.ListPublishedTagsResponse'
    },
    {
      '1': 'SearchPublishedSeries',
      '2': '.publira.v1.SearchPublishedSeriesRequest',
      '3': '.publira.v1.SearchPublishedSeriesResponse'
    },
    {
      '1': 'SearchPublishedCreators',
      '2': '.publira.v1.SearchPublishedCreatorsRequest',
      '3': '.publira.v1.SearchPublishedCreatorsResponse'
    },
    {
      '1': 'SearchPublishedLabels',
      '2': '.publira.v1.SearchPublishedLabelsRequest',
      '3': '.publira.v1.SearchPublishedLabelsResponse'
    },
    {
      '1': 'ListRecommendedSeries',
      '2': '.publira.v1.ListRecommendedSeriesRequest',
      '3': '.publira.v1.ListRecommendedSeriesResponse'
    },
    {
      '1': 'ListMyRecommendedSeries',
      '2': '.publira.v1.ListMyRecommendedSeriesRequest',
      '3': '.publira.v1.ListMyRecommendedSeriesResponse'
    },
    {
      '1': 'ListRankedSeries',
      '2': '.publira.v1.ListRankedSeriesRequest',
      '3': '.publira.v1.ListRankedSeriesResponse'
    },
    {
      '1': 'ListRelatedSeries',
      '2': '.publira.v1.ListRelatedSeriesRequest',
      '3': '.publira.v1.ListRelatedSeriesResponse'
    },
    {
      '1': 'ListSitemapEntries',
      '2': '.publira.v1.ListSitemapEntriesRequest',
      '3': '.publira.v1.ListSitemapEntriesResponse'
    },
    {
      '1': 'ListCampaignBanners',
      '2': '.publira.v1.ListCampaignBannersRequest',
      '3': '.publira.v1.ListCampaignBannersResponse'
    },
  ],
};

@$core.Deprecated('Use catalogServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    CatalogServiceBase$messageJson = {
  '.publira.v1.ListPublishedLabelsRequest': ListPublishedLabelsRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ListPublishedLabelsResponse': ListPublishedLabelsResponse$json,
  '.publira.v1.PublishedLabel': PublishedLabel$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $0.SeriesEyeCatchVariant$json,
  '.publira.v1.ListPublishedSeriesRequest': ListPublishedSeriesRequest$json,
  '.publira.v1.ListPublishedSeriesResponse': ListPublishedSeriesResponse$json,
  '.publira.types.v1.Series': $0.Series$json,
  '.publira.types.v1.Label': $0.Label$json,
  '.publira.types.v1.Creator': $0.Creator$json,
  '.publira.types.v1.CreatorRole': $0.CreatorRole$json,
  '.publira.types.v1.Genre': $0.Genre$json,
  '.publira.types.v1.GenreTranslation': $0.GenreTranslation$json,
  '.publira.types.v1.Tag': $0.Tag$json,
  '.publira.v1.GetSeriesDetailRequest': GetSeriesDetailRequest$json,
  '.publira.v1.GetSeriesDetailResponse': GetSeriesDetailResponse$json,
  '.publira.types.v1.Episode': $0.Episode$json,
  '.publira.v1.WaitFreeRule': WaitFreeRule$json,
  '.publira.types.v1.Volume': $0.Volume$json,
  '.publira.v1.GetSeriesEpisodeAccessRequest':
      GetSeriesEpisodeAccessRequest$json,
  '.publira.v1.GetSeriesEpisodeAccessResponse':
      GetSeriesEpisodeAccessResponse$json,
  '.publira.v1.SeriesEpisodeAccess': SeriesEpisodeAccess$json,
  '.publira.v1.SeriesRemainderOffer': SeriesRemainderOffer$json,
  '.publira.v1.GetEpisodeDetailRequest': GetEpisodeDetailRequest$json,
  '.publira.v1.GetEpisodeDetailResponse': GetEpisodeDetailResponse$json,
  '.publira.types.v1.EpisodeImage': $0.EpisodeImage$json,
  '.publira.v1.EpisodeNeighbor': EpisodeNeighbor$json,
  '.publira.v1.ListPublishedCreatorsRequest': ListPublishedCreatorsRequest$json,
  '.publira.v1.ListPublishedCreatorsResponse':
      ListPublishedCreatorsResponse$json,
  '.publira.v1.PublishedCreator': PublishedCreator$json,
  '.publira.v1.GetPublishedCreatorDetailRequest':
      GetPublishedCreatorDetailRequest$json,
  '.publira.v1.GetPublishedCreatorDetailResponse':
      GetPublishedCreatorDetailResponse$json,
  '.publira.v1.GetPublishedLabelDetailRequest':
      GetPublishedLabelDetailRequest$json,
  '.publira.v1.GetPublishedLabelDetailResponse':
      GetPublishedLabelDetailResponse$json,
  '.publira.v1.ListPublishedGenresRequest': ListPublishedGenresRequest$json,
  '.publira.v1.ListPublishedGenresResponse': ListPublishedGenresResponse$json,
  '.publira.v1.PublishedGenre': PublishedGenre$json,
  '.publira.v1.PublishedGenreFeaturedSeries': PublishedGenreFeaturedSeries$json,
  '.publira.v1.ListPublishedTagsRequest': ListPublishedTagsRequest$json,
  '.publira.v1.ListPublishedTagsResponse': ListPublishedTagsResponse$json,
  '.publira.v1.PublishedTag': PublishedTag$json,
  '.publira.v1.SearchPublishedSeriesRequest': SearchPublishedSeriesRequest$json,
  '.publira.v1.SearchPublishedSeriesResponse':
      SearchPublishedSeriesResponse$json,
  '.publira.v1.SearchPublishedCreatorsRequest':
      SearchPublishedCreatorsRequest$json,
  '.publira.v1.SearchPublishedCreatorsResponse':
      SearchPublishedCreatorsResponse$json,
  '.publira.v1.SearchPublishedLabelsRequest': SearchPublishedLabelsRequest$json,
  '.publira.v1.SearchPublishedLabelsResponse':
      SearchPublishedLabelsResponse$json,
  '.publira.v1.ListRecommendedSeriesRequest': ListRecommendedSeriesRequest$json,
  '.publira.v1.ListRecommendedSeriesResponse':
      ListRecommendedSeriesResponse$json,
  '.publira.v1.ListMyRecommendedSeriesRequest':
      ListMyRecommendedSeriesRequest$json,
  '.publira.v1.ListMyRecommendedSeriesResponse':
      ListMyRecommendedSeriesResponse$json,
  '.publira.v1.ListRankedSeriesRequest': ListRankedSeriesRequest$json,
  '.publira.v1.ListRankedSeriesResponse': ListRankedSeriesResponse$json,
  '.publira.v1.RankedSeries': RankedSeries$json,
  '.publira.v1.ListRelatedSeriesRequest': ListRelatedSeriesRequest$json,
  '.publira.v1.ListRelatedSeriesResponse': ListRelatedSeriesResponse$json,
  '.publira.v1.ListSitemapEntriesRequest': ListSitemapEntriesRequest$json,
  '.publira.v1.ListSitemapEntriesResponse': ListSitemapEntriesResponse$json,
  '.publira.v1.SitemapEntry': SitemapEntry$json,
  '.publira.v1.ListCampaignBannersRequest': ListCampaignBannersRequest$json,
  '.publira.v1.ListCampaignBannersResponse': ListCampaignBannersResponse$json,
  '.publira.v1.CampaignBanner': CampaignBanner$json,
};

/// Descriptor for `CatalogService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List catalogServiceDescriptor = $convert.base64Decode(
    'Cg5DYXRhbG9nU2VydmljZRJmChNMaXN0UHVibGlzaGVkTGFiZWxzEiYucHVibGlyYS52MS5MaX'
    'N0UHVibGlzaGVkTGFiZWxzUmVxdWVzdBonLnB1YmxpcmEudjEuTGlzdFB1Ymxpc2hlZExhYmVs'
    'c1Jlc3BvbnNlEmYKE0xpc3RQdWJsaXNoZWRTZXJpZXMSJi5wdWJsaXJhLnYxLkxpc3RQdWJsaX'
    'NoZWRTZXJpZXNSZXF1ZXN0GicucHVibGlyYS52MS5MaXN0UHVibGlzaGVkU2VyaWVzUmVzcG9u'
    'c2USWgoPR2V0U2VyaWVzRGV0YWlsEiIucHVibGlyYS52MS5HZXRTZXJpZXNEZXRhaWxSZXF1ZX'
    'N0GiMucHVibGlyYS52MS5HZXRTZXJpZXNEZXRhaWxSZXNwb25zZRJvChZHZXRTZXJpZXNFcGlz'
    'b2RlQWNjZXNzEikucHVibGlyYS52MS5HZXRTZXJpZXNFcGlzb2RlQWNjZXNzUmVxdWVzdBoqLn'
    'B1YmxpcmEudjEuR2V0U2VyaWVzRXBpc29kZUFjY2Vzc1Jlc3BvbnNlEl0KEEdldEVwaXNvZGVE'
    'ZXRhaWwSIy5wdWJsaXJhLnYxLkdldEVwaXNvZGVEZXRhaWxSZXF1ZXN0GiQucHVibGlyYS52MS'
    '5HZXRFcGlzb2RlRGV0YWlsUmVzcG9uc2USbAoVTGlzdFB1Ymxpc2hlZENyZWF0b3JzEigucHVi'
    'bGlyYS52MS5MaXN0UHVibGlzaGVkQ3JlYXRvcnNSZXF1ZXN0GikucHVibGlyYS52MS5MaXN0UH'
    'VibGlzaGVkQ3JlYXRvcnNSZXNwb25zZRJ4ChlHZXRQdWJsaXNoZWRDcmVhdG9yRGV0YWlsEiwu'
    'cHVibGlyYS52MS5HZXRQdWJsaXNoZWRDcmVhdG9yRGV0YWlsUmVxdWVzdBotLnB1YmxpcmEudj'
    'EuR2V0UHVibGlzaGVkQ3JlYXRvckRldGFpbFJlc3BvbnNlEnIKF0dldFB1Ymxpc2hlZExhYmVs'
    'RGV0YWlsEioucHVibGlyYS52MS5HZXRQdWJsaXNoZWRMYWJlbERldGFpbFJlcXVlc3QaKy5wdW'
    'JsaXJhLnYxLkdldFB1Ymxpc2hlZExhYmVsRGV0YWlsUmVzcG9uc2USZgoTTGlzdFB1Ymxpc2hl'
    'ZEdlbnJlcxImLnB1YmxpcmEudjEuTGlzdFB1Ymxpc2hlZEdlbnJlc1JlcXVlc3QaJy5wdWJsaX'
    'JhLnYxLkxpc3RQdWJsaXNoZWRHZW5yZXNSZXNwb25zZRJgChFMaXN0UHVibGlzaGVkVGFncxIk'
    'LnB1YmxpcmEudjEuTGlzdFB1Ymxpc2hlZFRhZ3NSZXF1ZXN0GiUucHVibGlyYS52MS5MaXN0UH'
    'VibGlzaGVkVGFnc1Jlc3BvbnNlEmwKFVNlYXJjaFB1Ymxpc2hlZFNlcmllcxIoLnB1YmxpcmEu'
    'djEuU2VhcmNoUHVibGlzaGVkU2VyaWVzUmVxdWVzdBopLnB1YmxpcmEudjEuU2VhcmNoUHVibG'
    'lzaGVkU2VyaWVzUmVzcG9uc2UScgoXU2VhcmNoUHVibGlzaGVkQ3JlYXRvcnMSKi5wdWJsaXJh'
    'LnYxLlNlYXJjaFB1Ymxpc2hlZENyZWF0b3JzUmVxdWVzdBorLnB1YmxpcmEudjEuU2VhcmNoUH'
    'VibGlzaGVkQ3JlYXRvcnNSZXNwb25zZRJsChVTZWFyY2hQdWJsaXNoZWRMYWJlbHMSKC5wdWJs'
    'aXJhLnYxLlNlYXJjaFB1Ymxpc2hlZExhYmVsc1JlcXVlc3QaKS5wdWJsaXJhLnYxLlNlYXJjaF'
    'B1Ymxpc2hlZExhYmVsc1Jlc3BvbnNlEmwKFUxpc3RSZWNvbW1lbmRlZFNlcmllcxIoLnB1Ymxp'
    'cmEudjEuTGlzdFJlY29tbWVuZGVkU2VyaWVzUmVxdWVzdBopLnB1YmxpcmEudjEuTGlzdFJlY2'
    '9tbWVuZGVkU2VyaWVzUmVzcG9uc2UScgoXTGlzdE15UmVjb21tZW5kZWRTZXJpZXMSKi5wdWJs'
    'aXJhLnYxLkxpc3RNeVJlY29tbWVuZGVkU2VyaWVzUmVxdWVzdBorLnB1YmxpcmEudjEuTGlzdE'
    '15UmVjb21tZW5kZWRTZXJpZXNSZXNwb25zZRJdChBMaXN0UmFua2VkU2VyaWVzEiMucHVibGly'
    'YS52MS5MaXN0UmFua2VkU2VyaWVzUmVxdWVzdBokLnB1YmxpcmEudjEuTGlzdFJhbmtlZFNlcm'
    'llc1Jlc3BvbnNlEmAKEUxpc3RSZWxhdGVkU2VyaWVzEiQucHVibGlyYS52MS5MaXN0UmVsYXRl'
    'ZFNlcmllc1JlcXVlc3QaJS5wdWJsaXJhLnYxLkxpc3RSZWxhdGVkU2VyaWVzUmVzcG9uc2USYw'
    'oSTGlzdFNpdGVtYXBFbnRyaWVzEiUucHVibGlyYS52MS5MaXN0U2l0ZW1hcEVudHJpZXNSZXF1'
    'ZXN0GiYucHVibGlyYS52MS5MaXN0U2l0ZW1hcEVudHJpZXNSZXNwb25zZRJmChNMaXN0Q2FtcG'
    'FpZ25CYW5uZXJzEiYucHVibGlyYS52MS5MaXN0Q2FtcGFpZ25CYW5uZXJzUmVxdWVzdBonLnB1'
    'YmxpcmEudjEuTGlzdENhbXBhaWduQmFubmVyc1Jlc3BvbnNl');

const $core.Map<$core.String, $core.dynamic> EpisodeReadServiceBase$json = {
  '1': 'EpisodeReadService',
  '2': [
    {
      '1': 'MarkEpisodeAsRead',
      '2': '.publira.v1.MarkEpisodeAsReadRequest',
      '3': '.publira.v1.MarkEpisodeAsReadResponse'
    },
    {
      '1': 'SaveReadingPosition',
      '2': '.publira.v1.SaveReadingPositionRequest',
      '3': '.publira.v1.SaveReadingPositionResponse'
    },
    {
      '1': 'GetMyReadingPosition',
      '2': '.publira.v1.GetMyReadingPositionRequest',
      '3': '.publira.v1.GetMyReadingPositionResponse'
    },
    {
      '1': 'GetMySeriesProgress',
      '2': '.publira.v1.GetMySeriesProgressRequest',
      '3': '.publira.v1.GetMySeriesProgressResponse'
    },
    {
      '1': 'ListMyRecentSeries',
      '2': '.publira.v1.ListMyRecentSeriesRequest',
      '3': '.publira.v1.ListMyRecentSeriesResponse'
    },
    {
      '1': 'ListMyEpisodeReads',
      '2': '.publira.v1.ListMyEpisodeReadsRequest',
      '3': '.publira.v1.ListMyEpisodeReadsResponse'
    },
  ],
};

@$core.Deprecated('Use episodeReadServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    EpisodeReadServiceBase$messageJson = {
  '.publira.v1.MarkEpisodeAsReadRequest': MarkEpisodeAsReadRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.MarkEpisodeAsReadResponse': MarkEpisodeAsReadResponse$json,
  '.publira.v1.SaveReadingPositionRequest': SaveReadingPositionRequest$json,
  '.publira.v1.SaveReadingPositionResponse': SaveReadingPositionResponse$json,
  '.publira.v1.ReadingPosition': ReadingPosition$json,
  '.publira.v1.GetMyReadingPositionRequest': GetMyReadingPositionRequest$json,
  '.publira.v1.GetMyReadingPositionResponse': GetMyReadingPositionResponse$json,
  '.publira.v1.GetMySeriesProgressRequest': GetMySeriesProgressRequest$json,
  '.publira.v1.GetMySeriesProgressResponse': GetMySeriesProgressResponse$json,
  '.publira.v1.SeriesProgress': SeriesProgress$json,
  '.publira.types.v1.Episode': $0.Episode$json,
  '.publira.types.v1.Creator': $0.Creator$json,
  '.publira.types.v1.CreatorRole': $0.CreatorRole$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $0.SeriesEyeCatchVariant$json,
  '.publira.v1.ListMyRecentSeriesRequest': ListMyRecentSeriesRequest$json,
  '.publira.v1.ListMyRecentSeriesResponse': ListMyRecentSeriesResponse$json,
  '.publira.v1.RecentSeries': RecentSeries$json,
  '.publira.types.v1.Series': $0.Series$json,
  '.publira.types.v1.Label': $0.Label$json,
  '.publira.types.v1.Genre': $0.Genre$json,
  '.publira.types.v1.GenreTranslation': $0.GenreTranslation$json,
  '.publira.types.v1.Tag': $0.Tag$json,
  '.publira.v1.ListMyEpisodeReadsRequest': ListMyEpisodeReadsRequest$json,
  '.publira.v1.ListMyEpisodeReadsResponse': ListMyEpisodeReadsResponse$json,
  '.publira.v1.MyEpisodeRead': MyEpisodeRead$json,
};

/// Descriptor for `EpisodeReadService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List episodeReadServiceDescriptor = $convert.base64Decode(
    'ChJFcGlzb2RlUmVhZFNlcnZpY2USYAoRTWFya0VwaXNvZGVBc1JlYWQSJC5wdWJsaXJhLnYxLk'
    '1hcmtFcGlzb2RlQXNSZWFkUmVxdWVzdBolLnB1YmxpcmEudjEuTWFya0VwaXNvZGVBc1JlYWRS'
    'ZXNwb25zZRJmChNTYXZlUmVhZGluZ1Bvc2l0aW9uEiYucHVibGlyYS52MS5TYXZlUmVhZGluZ1'
    'Bvc2l0aW9uUmVxdWVzdBonLnB1YmxpcmEudjEuU2F2ZVJlYWRpbmdQb3NpdGlvblJlc3BvbnNl'
    'EmkKFEdldE15UmVhZGluZ1Bvc2l0aW9uEicucHVibGlyYS52MS5HZXRNeVJlYWRpbmdQb3NpdG'
    'lvblJlcXVlc3QaKC5wdWJsaXJhLnYxLkdldE15UmVhZGluZ1Bvc2l0aW9uUmVzcG9uc2USZgoT'
    'R2V0TXlTZXJpZXNQcm9ncmVzcxImLnB1YmxpcmEudjEuR2V0TXlTZXJpZXNQcm9ncmVzc1JlcX'
    'Vlc3QaJy5wdWJsaXJhLnYxLkdldE15U2VyaWVzUHJvZ3Jlc3NSZXNwb25zZRJjChJMaXN0TXlS'
    'ZWNlbnRTZXJpZXMSJS5wdWJsaXJhLnYxLkxpc3RNeVJlY2VudFNlcmllc1JlcXVlc3QaJi5wdW'
    'JsaXJhLnYxLkxpc3RNeVJlY2VudFNlcmllc1Jlc3BvbnNlEmMKEkxpc3RNeUVwaXNvZGVSZWFk'
    'cxIlLnB1YmxpcmEudjEuTGlzdE15RXBpc29kZVJlYWRzUmVxdWVzdBomLnB1YmxpcmEudjEuTG'
    'lzdE15RXBpc29kZVJlYWRzUmVzcG9uc2U=');

const $core.Map<$core.String, $core.dynamic> FollowServiceBase$json = {
  '1': 'FollowService',
  '2': [
    {
      '1': 'GetMyFollowStatus',
      '2': '.publira.v1.GetMyFollowStatusRequest',
      '3': '.publira.v1.GetMyFollowStatusResponse'
    },
    {
      '1': 'Follow',
      '2': '.publira.v1.FollowRequest',
      '3': '.publira.v1.FollowResponse'
    },
    {
      '1': 'Unfollow',
      '2': '.publira.v1.UnfollowRequest',
      '3': '.publira.v1.UnfollowResponse'
    },
    {
      '1': 'ListMyFollows',
      '2': '.publira.v1.ListMyFollowsRequest',
      '3': '.publira.v1.ListMyFollowsResponse'
    },
    {
      '1': 'ListMyFollowUpdates',
      '2': '.publira.v1.ListMyFollowUpdatesRequest',
      '3': '.publira.v1.ListMyFollowUpdatesResponse'
    },
  ],
};

@$core.Deprecated('Use followServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    FollowServiceBase$messageJson = {
  '.publira.v1.GetMyFollowStatusRequest': GetMyFollowStatusRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.FollowTarget': FollowTarget$json,
  '.publira.v1.GetMyFollowStatusResponse': GetMyFollowStatusResponse$json,
  '.publira.v1.FollowRequest': FollowRequest$json,
  '.publira.v1.FollowResponse': FollowResponse$json,
  '.publira.v1.UnfollowRequest': UnfollowRequest$json,
  '.publira.v1.UnfollowResponse': UnfollowResponse$json,
  '.publira.v1.ListMyFollowsRequest': ListMyFollowsRequest$json,
  '.publira.v1.ListMyFollowsResponse': ListMyFollowsResponse$json,
  '.publira.v1.MyFollow': MyFollow$json,
  '.publira.v1.ListMyFollowUpdatesRequest': ListMyFollowUpdatesRequest$json,
  '.publira.v1.ListMyFollowUpdatesResponse': ListMyFollowUpdatesResponse$json,
  '.publira.v1.FollowUpdate': FollowUpdate$json,
  '.publira.types.v1.Series': $0.Series$json,
  '.publira.types.v1.Label': $0.Label$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $0.SeriesEyeCatchVariant$json,
  '.publira.types.v1.Creator': $0.Creator$json,
  '.publira.types.v1.CreatorRole': $0.CreatorRole$json,
  '.publira.types.v1.Genre': $0.Genre$json,
  '.publira.types.v1.GenreTranslation': $0.GenreTranslation$json,
  '.publira.types.v1.Tag': $0.Tag$json,
  '.publira.types.v1.Episode': $0.Episode$json,
};

/// Descriptor for `FollowService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List followServiceDescriptor = $convert.base64Decode(
    'Cg1Gb2xsb3dTZXJ2aWNlEmAKEUdldE15Rm9sbG93U3RhdHVzEiQucHVibGlyYS52MS5HZXRNeU'
    'ZvbGxvd1N0YXR1c1JlcXVlc3QaJS5wdWJsaXJhLnYxLkdldE15Rm9sbG93U3RhdHVzUmVzcG9u'
    'c2USPwoGRm9sbG93EhkucHVibGlyYS52MS5Gb2xsb3dSZXF1ZXN0GhoucHVibGlyYS52MS5Gb2'
    'xsb3dSZXNwb25zZRJFCghVbmZvbGxvdxIbLnB1YmxpcmEudjEuVW5mb2xsb3dSZXF1ZXN0Ghwu'
    'cHVibGlyYS52MS5VbmZvbGxvd1Jlc3BvbnNlElQKDUxpc3RNeUZvbGxvd3MSIC5wdWJsaXJhLn'
    'YxLkxpc3RNeUZvbGxvd3NSZXF1ZXN0GiEucHVibGlyYS52MS5MaXN0TXlGb2xsb3dzUmVzcG9u'
    'c2USZgoTTGlzdE15Rm9sbG93VXBkYXRlcxImLnB1YmxpcmEudjEuTGlzdE15Rm9sbG93VXBkYX'
    'Rlc1JlcXVlc3QaJy5wdWJsaXJhLnYxLkxpc3RNeUZvbGxvd1VwZGF0ZXNSZXNwb25zZQ==');

const $core.Map<$core.String, $core.dynamic> RatingServiceBase$json = {
  '1': 'RatingService',
  '2': [
    {
      '1': 'RateEpisode',
      '2': '.publira.v1.RateEpisodeRequest',
      '3': '.publira.v1.RateEpisodeResponse'
    },
    {
      '1': 'GetMyEpisodeRating',
      '2': '.publira.v1.GetMyEpisodeRatingRequest',
      '3': '.publira.v1.GetMyEpisodeRatingResponse'
    },
    {
      '1': 'GetMySeriesRating',
      '2': '.publira.v1.GetMySeriesRatingRequest',
      '3': '.publira.v1.GetMySeriesRatingResponse'
    },
  ],
};

@$core.Deprecated('Use ratingServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    RatingServiceBase$messageJson = {
  '.publira.v1.RateEpisodeRequest': RateEpisodeRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.RateEpisodeResponse': RateEpisodeResponse$json,
  '.publira.v1.GetMyEpisodeRatingRequest': GetMyEpisodeRatingRequest$json,
  '.publira.v1.GetMyEpisodeRatingResponse': GetMyEpisodeRatingResponse$json,
  '.publira.v1.GetMySeriesRatingRequest': GetMySeriesRatingRequest$json,
  '.publira.v1.GetMySeriesRatingResponse': GetMySeriesRatingResponse$json,
};

/// Descriptor for `RatingService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List ratingServiceDescriptor = $convert.base64Decode(
    'Cg1SYXRpbmdTZXJ2aWNlEk4KC1JhdGVFcGlzb2RlEh4ucHVibGlyYS52MS5SYXRlRXBpc29kZV'
    'JlcXVlc3QaHy5wdWJsaXJhLnYxLlJhdGVFcGlzb2RlUmVzcG9uc2USYwoSR2V0TXlFcGlzb2Rl'
    'UmF0aW5nEiUucHVibGlyYS52MS5HZXRNeUVwaXNvZGVSYXRpbmdSZXF1ZXN0GiYucHVibGlyYS'
    '52MS5HZXRNeUVwaXNvZGVSYXRpbmdSZXNwb25zZRJgChFHZXRNeVNlcmllc1JhdGluZxIkLnB1'
    'YmxpcmEudjEuR2V0TXlTZXJpZXNSYXRpbmdSZXF1ZXN0GiUucHVibGlyYS52MS5HZXRNeVNlcm'
    'llc1JhdGluZ1Jlc3BvbnNl');

const $core.Map<$core.String, $core.dynamic> ContentViewServiceBase$json = {
  '1': 'ContentViewService',
  '2': [
    {
      '1': 'RecordContentView',
      '2': '.publira.v1.RecordContentViewRequest',
      '3': '.publira.v1.RecordContentViewResponse'
    },
  ],
};

@$core.Deprecated('Use contentViewServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    ContentViewServiceBase$messageJson = {
  '.publira.v1.RecordContentViewRequest': RecordContentViewRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ContentViewTarget': ContentViewTarget$json,
  '.publira.v1.RecordContentViewResponse': RecordContentViewResponse$json,
};

/// Descriptor for `ContentViewService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List contentViewServiceDescriptor = $convert.base64Decode(
    'ChJDb250ZW50Vmlld1NlcnZpY2USYAoRUmVjb3JkQ29udGVudFZpZXcSJC5wdWJsaXJhLnYxLl'
    'JlY29yZENvbnRlbnRWaWV3UmVxdWVzdBolLnB1YmxpcmEudjEuUmVjb3JkQ29udGVudFZpZXdS'
    'ZXNwb25zZQ==');

const $core.Map<$core.String, $core.dynamic> PurchaseServiceBase$json = {
  '1': 'PurchaseService',
  '2': [
    {
      '1': 'StartEpisodeCheckout',
      '2': '.publira.v1.StartEpisodeCheckoutRequest',
      '3': '.publira.v1.StartEpisodeCheckoutResponse'
    },
    {
      '1': 'StartVolumeCheckout',
      '2': '.publira.v1.StartVolumeCheckoutRequest',
      '3': '.publira.v1.StartVolumeCheckoutResponse'
    },
    {
      '1': 'StartSeriesRemainderCheckout',
      '2': '.publira.v1.StartSeriesRemainderCheckoutRequest',
      '3': '.publira.v1.StartSeriesRemainderCheckoutResponse'
    },
    {
      '1': 'ListMyPurchases',
      '2': '.publira.v1.ListMyPurchasesRequest',
      '3': '.publira.v1.ListMyPurchasesResponse'
    },
    {
      '1': 'ProcessPaymentWebhook',
      '2': '.publira.v1.ProcessPaymentWebhookRequest',
      '3': '.publira.v1.ProcessPaymentWebhookResponse'
    },
    {
      '1': 'StartStorePurchase',
      '2': '.publira.v1.StartStorePurchaseRequest',
      '3': '.publira.v1.StartStorePurchaseResponse'
    },
    {
      '1': 'ConfirmStorePurchase',
      '2': '.publira.v1.ConfirmStorePurchaseRequest',
      '3': '.publira.v1.ConfirmStorePurchaseResponse'
    },
    {
      '1': 'ProcessAppStoreNotification',
      '2': '.publira.v1.ProcessAppStoreNotificationRequest',
      '3': '.publira.v1.ProcessAppStoreNotificationResponse'
    },
  ],
};

@$core.Deprecated('Use purchaseServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    PurchaseServiceBase$messageJson = {
  '.publira.v1.StartEpisodeCheckoutRequest': StartEpisodeCheckoutRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.StartEpisodeCheckoutResponse': StartEpisodeCheckoutResponse$json,
  '.publira.v1.StartVolumeCheckoutRequest': StartVolumeCheckoutRequest$json,
  '.publira.v1.StartVolumeCheckoutResponse': StartVolumeCheckoutResponse$json,
  '.publira.v1.StartSeriesRemainderCheckoutRequest':
      StartSeriesRemainderCheckoutRequest$json,
  '.publira.v1.StartSeriesRemainderCheckoutResponse':
      StartSeriesRemainderCheckoutResponse$json,
  '.publira.v1.ListMyPurchasesRequest': ListMyPurchasesRequest$json,
  '.publira.v1.ListMyPurchasesResponse': ListMyPurchasesResponse$json,
  '.publira.v1.MyPurchase': MyPurchase$json,
  '.publira.types.v1.Episode': $0.Episode$json,
  '.publira.types.v1.Creator': $0.Creator$json,
  '.publira.types.v1.CreatorRole': $0.CreatorRole$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $0.SeriesEyeCatchVariant$json,
  '.publira.types.v1.Series': $0.Series$json,
  '.publira.types.v1.Label': $0.Label$json,
  '.publira.types.v1.Genre': $0.Genre$json,
  '.publira.types.v1.GenreTranslation': $0.GenreTranslation$json,
  '.publira.types.v1.Tag': $0.Tag$json,
  '.publira.types.v1.Volume': $0.Volume$json,
  '.publira.types.v1.SeriesBundle': $0.SeriesBundle$json,
  '.publira.v1.ProcessPaymentWebhookRequest': ProcessPaymentWebhookRequest$json,
  '.publira.v1.ProcessPaymentWebhookRequest.HeadersEntry':
      ProcessPaymentWebhookRequest_HeadersEntry$json,
  '.publira.v1.ProcessPaymentWebhookResponse':
      ProcessPaymentWebhookResponse$json,
  '.publira.v1.StartStorePurchaseRequest': StartStorePurchaseRequest$json,
  '.publira.v1.StartStorePurchaseResponse': StartStorePurchaseResponse$json,
  '.publira.v1.ConfirmStorePurchaseRequest': ConfirmStorePurchaseRequest$json,
  '.publira.v1.ConfirmStorePurchaseResponse': ConfirmStorePurchaseResponse$json,
  '.publira.v1.ProcessAppStoreNotificationRequest':
      ProcessAppStoreNotificationRequest$json,
  '.publira.v1.ProcessAppStoreNotificationResponse':
      ProcessAppStoreNotificationResponse$json,
};

/// Descriptor for `PurchaseService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List purchaseServiceDescriptor = $convert.base64Decode(
    'Cg9QdXJjaGFzZVNlcnZpY2USaQoUU3RhcnRFcGlzb2RlQ2hlY2tvdXQSJy5wdWJsaXJhLnYxLl'
    'N0YXJ0RXBpc29kZUNoZWNrb3V0UmVxdWVzdBooLnB1YmxpcmEudjEuU3RhcnRFcGlzb2RlQ2hl'
    'Y2tvdXRSZXNwb25zZRJmChNTdGFydFZvbHVtZUNoZWNrb3V0EiYucHVibGlyYS52MS5TdGFydF'
    'ZvbHVtZUNoZWNrb3V0UmVxdWVzdBonLnB1YmxpcmEudjEuU3RhcnRWb2x1bWVDaGVja291dFJl'
    'c3BvbnNlEoEBChxTdGFydFNlcmllc1JlbWFpbmRlckNoZWNrb3V0Ei8ucHVibGlyYS52MS5TdG'
    'FydFNlcmllc1JlbWFpbmRlckNoZWNrb3V0UmVxdWVzdBowLnB1YmxpcmEudjEuU3RhcnRTZXJp'
    'ZXNSZW1haW5kZXJDaGVja291dFJlc3BvbnNlEloKD0xpc3RNeVB1cmNoYXNlcxIiLnB1Ymxpcm'
    'EudjEuTGlzdE15UHVyY2hhc2VzUmVxdWVzdBojLnB1YmxpcmEudjEuTGlzdE15UHVyY2hhc2Vz'
    'UmVzcG9uc2USbAoVUHJvY2Vzc1BheW1lbnRXZWJob29rEigucHVibGlyYS52MS5Qcm9jZXNzUG'
    'F5bWVudFdlYmhvb2tSZXF1ZXN0GikucHVibGlyYS52MS5Qcm9jZXNzUGF5bWVudFdlYmhvb2tS'
    'ZXNwb25zZRJjChJTdGFydFN0b3JlUHVyY2hhc2USJS5wdWJsaXJhLnYxLlN0YXJ0U3RvcmVQdX'
    'JjaGFzZVJlcXVlc3QaJi5wdWJsaXJhLnYxLlN0YXJ0U3RvcmVQdXJjaGFzZVJlc3BvbnNlEmkK'
    'FENvbmZpcm1TdG9yZVB1cmNoYXNlEicucHVibGlyYS52MS5Db25maXJtU3RvcmVQdXJjaGFzZV'
    'JlcXVlc3QaKC5wdWJsaXJhLnYxLkNvbmZpcm1TdG9yZVB1cmNoYXNlUmVzcG9uc2USfgobUHJv'
    'Y2Vzc0FwcFN0b3JlTm90aWZpY2F0aW9uEi4ucHVibGlyYS52MS5Qcm9jZXNzQXBwU3RvcmVOb3'
    'RpZmljYXRpb25SZXF1ZXN0Gi8ucHVibGlyYS52MS5Qcm9jZXNzQXBwU3RvcmVOb3RpZmljYXRp'
    'b25SZXNwb25zZQ==');

const $core.Map<$core.String, $core.dynamic> WaitFreeServiceBase$json = {
  '1': 'WaitFreeService',
  '2': [
    {
      '1': 'GetMyTicketState',
      '2': '.publira.v1.GetMyTicketStateRequest',
      '3': '.publira.v1.GetMyTicketStateResponse'
    },
    {
      '1': 'UseTicket',
      '2': '.publira.v1.UseTicketRequest',
      '3': '.publira.v1.UseTicketResponse'
    },
  ],
};

@$core.Deprecated('Use waitFreeServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    WaitFreeServiceBase$messageJson = {
  '.publira.v1.GetMyTicketStateRequest': GetMyTicketStateRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.GetMyTicketStateResponse': GetMyTicketStateResponse$json,
  '.publira.v1.WaitFreeTicket': WaitFreeTicket$json,
  '.publira.v1.UseTicketRequest': UseTicketRequest$json,
  '.publira.v1.UseTicketResponse': UseTicketResponse$json,
};

/// Descriptor for `WaitFreeService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List waitFreeServiceDescriptor = $convert.base64Decode(
    'Cg9XYWl0RnJlZVNlcnZpY2USXQoQR2V0TXlUaWNrZXRTdGF0ZRIjLnB1YmxpcmEudjEuR2V0TX'
    'lUaWNrZXRTdGF0ZVJlcXVlc3QaJC5wdWJsaXJhLnYxLkdldE15VGlja2V0U3RhdGVSZXNwb25z'
    'ZRJICglVc2VUaWNrZXQSHC5wdWJsaXJhLnYxLlVzZVRpY2tldFJlcXVlc3QaHS5wdWJsaXJhLn'
    'YxLlVzZVRpY2tldFJlc3BvbnNl');
