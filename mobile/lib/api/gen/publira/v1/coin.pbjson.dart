// This is a generated file - do not edit.
//
// Generated from publira/v1/coin.proto.

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
import 'catalog.pbjson.dart' as $1;

@$core.Deprecated('Use coinTransactionKindDescriptor instead')
const CoinTransactionKind$json = {
  '1': 'CoinTransactionKind',
  '2': [
    {'1': 'COIN_TRANSACTION_KIND_UNSPECIFIED', '2': 0},
    {'1': 'COIN_TRANSACTION_KIND_GRANT', '2': 1},
    {'1': 'COIN_TRANSACTION_KIND_SPEND', '2': 2},
    {'1': 'COIN_TRANSACTION_KIND_REVOCATION', '2': 3},
    {'1': 'COIN_TRANSACTION_KIND_EXPIRY', '2': 4},
    {'1': 'COIN_TRANSACTION_KIND_SHORTFALL', '2': 5},
    {'1': 'COIN_TRANSACTION_KIND_SHORTFALL_SETTLEMENT', '2': 6},
  ],
};

/// Descriptor for `CoinTransactionKind`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List coinTransactionKindDescriptor = $convert.base64Decode(
    'ChNDb2luVHJhbnNhY3Rpb25LaW5kEiUKIUNPSU5fVFJBTlNBQ1RJT05fS0lORF9VTlNQRUNJRk'
    'lFRBAAEh8KG0NPSU5fVFJBTlNBQ1RJT05fS0lORF9HUkFOVBABEh8KG0NPSU5fVFJBTlNBQ1RJ'
    'T05fS0lORF9TUEVORBACEiQKIENPSU5fVFJBTlNBQ1RJT05fS0lORF9SRVZPQ0FUSU9OEAMSIA'
    'ocQ09JTl9UUkFOU0FDVElPTl9LSU5EX0VYUElSWRAEEiMKH0NPSU5fVFJBTlNBQ1RJT05fS0lO'
    'RF9TSE9SVEZBTEwQBRIuCipDT0lOX1RSQU5TQUNUSU9OX0tJTkRfU0hPUlRGQUxMX1NFVFRMRU'
    '1FTlQQBg==');

@$core.Deprecated('Use coinDisclosuresDescriptor instead')
const CoinDisclosures$json = {
  '1': 'CoinDisclosures',
  '2': [
    {'1': 'issuer_name', '3': 1, '4': 1, '5': 9, '10': 'issuerName'},
    {'1': 'terms_url', '3': 2, '4': 1, '5': 9, '10': 'termsUrl'},
    {'1': 'contact', '3': 3, '4': 1, '5': 9, '10': 'contact'},
    {'1': 'notice', '3': 4, '4': 1, '5': 9, '10': 'notice'},
  ],
};

/// Descriptor for `CoinDisclosures`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List coinDisclosuresDescriptor = $convert.base64Decode(
    'Cg9Db2luRGlzY2xvc3VyZXMSHwoLaXNzdWVyX25hbWUYASABKAlSCmlzc3Vlck5hbWUSGwoJdG'
    'VybXNfdXJsGAIgASgJUgh0ZXJtc1VybBIYCgdjb250YWN0GAMgASgJUgdjb250YWN0EhYKBm5v'
    'dGljZRgEIAEoCVIGbm90aWNl');

@$core.Deprecated('Use coinPackDescriptor instead')
const CoinPack$json = {
  '1': 'CoinPack',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'coins', '3': 3, '4': 1, '5': 5, '10': 'coins'},
    {'1': 'bonus_coins', '3': 4, '4': 1, '5': 5, '10': 'bonusCoins'},
    {'1': 'price', '3': 5, '4': 1, '5': 5, '10': 'price'},
    {'1': 'currency', '3': 6, '4': 1, '5': 9, '10': 'currency'},
  ],
};

/// Descriptor for `CoinPack`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List coinPackDescriptor = $convert.base64Decode(
    'CghDb2luUGFjaxIOCgJpZBgBIAEoCVICaWQSGwoJcHVibGljX2lkGAIgASgJUghwdWJsaWNJZB'
    'IUCgVjb2lucxgDIAEoBVIFY29pbnMSHwoLYm9udXNfY29pbnMYBCABKAVSCmJvbnVzQ29pbnMS'
    'FAoFcHJpY2UYBSABKAVSBXByaWNlEhoKCGN1cnJlbmN5GAYgASgJUghjdXJyZW5jeQ==');

@$core.Deprecated('Use coinSettingsDescriptor instead')
const CoinSettings$json = {
  '1': 'CoinSettings',
  '2': [
    {'1': 'coin_name', '3': 1, '4': 1, '5': 9, '10': 'coinName'},
    {'1': 'coin_unit_amount', '3': 2, '4': 1, '5': 5, '10': 'coinUnitAmount'},
    {'1': 'currency', '3': 3, '4': 1, '5': 9, '10': 'currency'},
    {'1': 'expiry_days', '3': 4, '4': 1, '5': 5, '10': 'expiryDays'},
    {'1': 'selling', '3': 5, '4': 1, '5': 8, '10': 'selling'},
    {
      '1': 'packs',
      '3': 6,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.CoinPack',
      '10': 'packs'
    },
    {
      '1': 'disclosures',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.CoinDisclosures',
      '10': 'disclosures'
    },
  ],
};

/// Descriptor for `CoinSettings`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List coinSettingsDescriptor = $convert.base64Decode(
    'CgxDb2luU2V0dGluZ3MSGwoJY29pbl9uYW1lGAEgASgJUghjb2luTmFtZRIoChBjb2luX3VuaX'
    'RfYW1vdW50GAIgASgFUg5jb2luVW5pdEFtb3VudBIaCghjdXJyZW5jeRgDIAEoCVIIY3VycmVu'
    'Y3kSHwoLZXhwaXJ5X2RheXMYBCABKAVSCmV4cGlyeURheXMSGAoHc2VsbGluZxgFIAEoCFIHc2'
    'VsbGluZxIqCgVwYWNrcxgGIAMoCzIULnB1YmxpcmEudjEuQ29pblBhY2tSBXBhY2tzEj0KC2Rp'
    'c2Nsb3N1cmVzGAcgASgLMhsucHVibGlyYS52MS5Db2luRGlzY2xvc3VyZXNSC2Rpc2Nsb3N1cm'
    'Vz');

@$core.Deprecated('Use getCoinSettingsRequestDescriptor instead')
const GetCoinSettingsRequest$json = {
  '1': 'GetCoinSettingsRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'locale', '3': 2, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetCoinSettingsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCoinSettingsRequestDescriptor =
    $convert.base64Decode(
        'ChZHZXRDb2luU2V0dGluZ3NSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZX'
        'MudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhYKBmxvY2FsZRgCIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use getCoinSettingsResponseDescriptor instead')
const GetCoinSettingsResponse$json = {
  '1': 'GetCoinSettingsResponse',
  '2': [
    {
      '1': 'settings',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.CoinSettings',
      '10': 'settings'
    },
  ],
};

/// Descriptor for `GetCoinSettingsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCoinSettingsResponseDescriptor =
    $convert.base64Decode(
        'ChdHZXRDb2luU2V0dGluZ3NSZXNwb25zZRI0CghzZXR0aW5ncxgBIAEoCzIYLnB1YmxpcmEudj'
        'EuQ29pblNldHRpbmdzUghzZXR0aW5ncw==');

@$core.Deprecated('Use coinBalanceDescriptor instead')
const CoinBalance$json = {
  '1': 'CoinBalance',
  '2': [
    {'1': 'coins', '3': 1, '4': 1, '5': 3, '10': 'coins'},
    {'1': 'coin_name', '3': 2, '4': 1, '5': 9, '10': 'coinName'},
    {'1': 'nearest_expiry_at', '3': 3, '4': 1, '5': 9, '10': 'nearestExpiryAt'},
    {
      '1': 'nearest_expiry_coins',
      '3': 4,
      '4': 1,
      '5': 3,
      '10': 'nearestExpiryCoins'
    },
    {'1': 'shortfall_coins', '3': 5, '4': 1, '5': 3, '10': 'shortfallCoins'},
  ],
};

/// Descriptor for `CoinBalance`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List coinBalanceDescriptor = $convert.base64Decode(
    'CgtDb2luQmFsYW5jZRIUCgVjb2lucxgBIAEoA1IFY29pbnMSGwoJY29pbl9uYW1lGAIgASgJUg'
    'hjb2luTmFtZRIqChFuZWFyZXN0X2V4cGlyeV9hdBgDIAEoCVIPbmVhcmVzdEV4cGlyeUF0EjAK'
    'FG5lYXJlc3RfZXhwaXJ5X2NvaW5zGAQgASgDUhJuZWFyZXN0RXhwaXJ5Q29pbnMSJwoPc2hvcn'
    'RmYWxsX2NvaW5zGAUgASgDUg5zaG9ydGZhbGxDb2lucw==');

@$core.Deprecated('Use getCoinBalanceRequestDescriptor instead')
const GetCoinBalanceRequest$json = {
  '1': 'GetCoinBalanceRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'locale', '3': 2, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetCoinBalanceRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCoinBalanceRequestDescriptor = $convert.base64Decode(
    'ChVHZXRDb2luQmFsYW5jZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy'
    '52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFgoGbG9jYWxlGAIgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use getCoinBalanceResponseDescriptor instead')
const GetCoinBalanceResponse$json = {
  '1': 'GetCoinBalanceResponse',
  '2': [
    {
      '1': 'balance',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.CoinBalance',
      '10': 'balance'
    },
  ],
};

/// Descriptor for `GetCoinBalanceResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getCoinBalanceResponseDescriptor =
    $convert.base64Decode(
        'ChZHZXRDb2luQmFsYW5jZVJlc3BvbnNlEjEKB2JhbGFuY2UYASABKAsyFy5wdWJsaXJhLnYxLk'
        'NvaW5CYWxhbmNlUgdiYWxhbmNl');

@$core.Deprecated('Use coinTransactionDescriptor instead')
const CoinTransaction$json = {
  '1': 'CoinTransaction',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'kind',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.CoinTransactionKind',
      '10': 'kind'
    },
    {'1': 'coins', '3': 3, '4': 1, '5': 5, '10': 'coins'},
    {'1': 'created_at', '3': 4, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'expires_at', '3': 5, '4': 1, '5': 9, '10': 'expiresAt'},
    {'1': 'purchase_id', '3': 6, '4': 1, '5': 9, '10': 'purchaseId'},
    {
      '1': 'episode',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Episode',
      '10': 'episode'
    },
    {
      '1': 'series',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
  ],
};

/// Descriptor for `CoinTransaction`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List coinTransactionDescriptor = $convert.base64Decode(
    'Cg9Db2luVHJhbnNhY3Rpb24SDgoCaWQYASABKAlSAmlkEjMKBGtpbmQYAiABKA4yHy5wdWJsaX'
    'JhLnYxLkNvaW5UcmFuc2FjdGlvbktpbmRSBGtpbmQSFAoFY29pbnMYAyABKAVSBWNvaW5zEh0K'
    'CmNyZWF0ZWRfYXQYBCABKAlSCWNyZWF0ZWRBdBIdCgpleHBpcmVzX2F0GAUgASgJUglleHBpcm'
    'VzQXQSHwoLcHVyY2hhc2VfaWQYBiABKAlSCnB1cmNoYXNlSWQSMwoHZXBpc29kZRgHIAEoCzIZ'
    'LnB1YmxpcmEudHlwZXMudjEuRXBpc29kZVIHZXBpc29kZRIwCgZzZXJpZXMYCCABKAsyGC5wdW'
    'JsaXJhLnR5cGVzLnYxLlNlcmllc1IGc2VyaWVz');

@$core.Deprecated('Use listCoinTransactionsRequestDescriptor instead')
const ListCoinTransactionsRequest$json = {
  '1': 'ListCoinTransactionsRequest',
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

/// Descriptor for `ListCoinTransactionsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listCoinTransactionsRequestDescriptor = $convert.base64Decode(
    'ChtMaXN0Q29pblRyYW5zYWN0aW9uc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAiABKAVSBWxpbWl0EhQK'
    'BXRva2VuGAMgASgJUgV0b2tlbhI5CgdzdXJmYWNlGAQgASgOMh8ucHVibGlyYS50eXBlcy52MS'
    '5DbGllbnRTdXJmYWNlUgdzdXJmYWNlEhYKBmxvY2FsZRgFIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use listCoinTransactionsResponseDescriptor instead')
const ListCoinTransactionsResponse$json = {
  '1': 'ListCoinTransactionsResponse',
  '2': [
    {
      '1': 'transactions',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.CoinTransaction',
      '10': 'transactions'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
    {'1': 'coin_name', '3': 4, '4': 1, '5': 9, '10': 'coinName'},
  ],
};

/// Descriptor for `ListCoinTransactionsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listCoinTransactionsResponseDescriptor = $convert.base64Decode(
    'ChxMaXN0Q29pblRyYW5zYWN0aW9uc1Jlc3BvbnNlEj8KDHRyYW5zYWN0aW9ucxgBIAMoCzIbLn'
    'B1YmxpcmEudjEuQ29pblRyYW5zYWN0aW9uUgx0cmFuc2FjdGlvbnMSJQoOcHJldmlvdXNfdG9r'
    'ZW4YAiABKAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2VuEh'
    'sKCWNvaW5fbmFtZRgEIAEoCVIIY29pbk5hbWU=');

@$core.Deprecated('Use payEpisodeWithCoinsRequestDescriptor instead')
const PayEpisodeWithCoinsRequest$json = {
  '1': 'PayEpisodeWithCoinsRequest',
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
      '1': 'kind',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.PurchaseKind',
      '10': 'kind'
    },
    {'1': 'coins', '3': 4, '4': 1, '5': 5, '10': 'coins'},
    {'1': 'idempotency_key', '3': 5, '4': 1, '5': 9, '10': 'idempotencyKey'},
    {
      '1': 'surface',
      '3': 6,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'locale', '3': 7, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `PayEpisodeWithCoinsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List payEpisodeWithCoinsRequestDescriptor = $convert.base64Decode(
    'ChpQYXlFcGlzb2RlV2l0aENvaW5zUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIdCgplcGlzb2RlX2lkGAIgASgJUgllcGlz'
    'b2RlSWQSMgoEa2luZBgDIAEoDjIeLnB1YmxpcmEudHlwZXMudjEuUHVyY2hhc2VLaW5kUgRraW'
    '5kEhQKBWNvaW5zGAQgASgFUgVjb2lucxInCg9pZGVtcG90ZW5jeV9rZXkYBSABKAlSDmlkZW1w'
    'b3RlbmN5S2V5EjkKB3N1cmZhY2UYBiABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLkNsaWVudFN1cm'
    'ZhY2VSB3N1cmZhY2USFgoGbG9jYWxlGAcgASgJUgZsb2NhbGU=');

@$core.Deprecated('Use payEpisodeWithCoinsResponseDescriptor instead')
const PayEpisodeWithCoinsResponse$json = {
  '1': 'PayEpisodeWithCoinsResponse',
  '2': [
    {
      '1': 'purchase',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.MyPurchase',
      '10': 'purchase'
    },
    {
      '1': 'balance',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.CoinBalance',
      '10': 'balance'
    },
  ],
};

/// Descriptor for `PayEpisodeWithCoinsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List payEpisodeWithCoinsResponseDescriptor =
    $convert.base64Decode(
        'ChtQYXlFcGlzb2RlV2l0aENvaW5zUmVzcG9uc2USMgoIcHVyY2hhc2UYASABKAsyFi5wdWJsaX'
        'JhLnYxLk15UHVyY2hhc2VSCHB1cmNoYXNlEjEKB2JhbGFuY2UYAiABKAsyFy5wdWJsaXJhLnYx'
        'LkNvaW5CYWxhbmNlUgdiYWxhbmNl');

@$core.Deprecated('Use startCoinPackCheckoutRequestDescriptor instead')
const StartCoinPackCheckoutRequest$json = {
  '1': 'StartCoinPackCheckoutRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'coin_pack_id', '3': 2, '4': 1, '5': 9, '10': 'coinPackId'},
    {'1': 'return_episode_id', '3': 3, '4': 1, '5': 9, '10': 'returnEpisodeId'},
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `StartCoinPackCheckoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startCoinPackCheckoutRequestDescriptor = $convert.base64Decode(
    'ChxTdGFydENvaW5QYWNrQ2hlY2tvdXRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EiAKDGNvaW5fcGFja19pZBgCIAEoCVIK'
    'Y29pblBhY2tJZBIqChFyZXR1cm5fZXBpc29kZV9pZBgDIAEoCVIPcmV0dXJuRXBpc29kZUlkEh'
    'YKBmxvY2FsZRgEIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use startCoinPackCheckoutResponseDescriptor instead')
const StartCoinPackCheckoutResponse$json = {
  '1': 'StartCoinPackCheckoutResponse',
  '2': [
    {'1': 'checkout_url', '3': 1, '4': 1, '5': 9, '10': 'checkoutUrl'},
  ],
};

/// Descriptor for `StartCoinPackCheckoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startCoinPackCheckoutResponseDescriptor =
    $convert.base64Decode(
        'Ch1TdGFydENvaW5QYWNrQ2hlY2tvdXRSZXNwb25zZRIhCgxjaGVja291dF91cmwYASABKAlSC2'
        'NoZWNrb3V0VXJs');

const $core.Map<$core.String, $core.dynamic> CoinServiceBase$json = {
  '1': 'CoinService',
  '2': [
    {
      '1': 'GetCoinSettings',
      '2': '.publira.v1.GetCoinSettingsRequest',
      '3': '.publira.v1.GetCoinSettingsResponse'
    },
    {
      '1': 'GetCoinBalance',
      '2': '.publira.v1.GetCoinBalanceRequest',
      '3': '.publira.v1.GetCoinBalanceResponse'
    },
    {
      '1': 'ListCoinTransactions',
      '2': '.publira.v1.ListCoinTransactionsRequest',
      '3': '.publira.v1.ListCoinTransactionsResponse'
    },
    {
      '1': 'PayEpisodeWithCoins',
      '2': '.publira.v1.PayEpisodeWithCoinsRequest',
      '3': '.publira.v1.PayEpisodeWithCoinsResponse'
    },
    {
      '1': 'StartCoinPackCheckout',
      '2': '.publira.v1.StartCoinPackCheckoutRequest',
      '3': '.publira.v1.StartCoinPackCheckoutResponse'
    },
  ],
};

@$core.Deprecated('Use coinServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    CoinServiceBase$messageJson = {
  '.publira.v1.GetCoinSettingsRequest': GetCoinSettingsRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.GetCoinSettingsResponse': GetCoinSettingsResponse$json,
  '.publira.v1.CoinSettings': CoinSettings$json,
  '.publira.v1.CoinPack': CoinPack$json,
  '.publira.v1.CoinDisclosures': CoinDisclosures$json,
  '.publira.v1.GetCoinBalanceRequest': GetCoinBalanceRequest$json,
  '.publira.v1.GetCoinBalanceResponse': GetCoinBalanceResponse$json,
  '.publira.v1.CoinBalance': CoinBalance$json,
  '.publira.v1.ListCoinTransactionsRequest': ListCoinTransactionsRequest$json,
  '.publira.v1.ListCoinTransactionsResponse': ListCoinTransactionsResponse$json,
  '.publira.v1.CoinTransaction': CoinTransaction$json,
  '.publira.types.v1.Episode': $0.Episode$json,
  '.publira.types.v1.Creator': $0.Creator$json,
  '.publira.types.v1.CreatorRole': $0.CreatorRole$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $0.SeriesEyeCatchVariant$json,
  '.publira.types.v1.Series': $0.Series$json,
  '.publira.types.v1.Label': $0.Label$json,
  '.publira.types.v1.Genre': $0.Genre$json,
  '.publira.types.v1.GenreTranslation': $0.GenreTranslation$json,
  '.publira.types.v1.Tag': $0.Tag$json,
  '.publira.v1.PayEpisodeWithCoinsRequest': PayEpisodeWithCoinsRequest$json,
  '.publira.v1.PayEpisodeWithCoinsResponse': PayEpisodeWithCoinsResponse$json,
  '.publira.v1.MyPurchase': $1.MyPurchase$json,
  '.publira.types.v1.Volume': $0.Volume$json,
  '.publira.types.v1.SeriesBundle': $0.SeriesBundle$json,
  '.publira.types.v1.PurchasedCoinPack': $0.PurchasedCoinPack$json,
  '.publira.v1.StartCoinPackCheckoutRequest': StartCoinPackCheckoutRequest$json,
  '.publira.v1.StartCoinPackCheckoutResponse':
      StartCoinPackCheckoutResponse$json,
};

/// Descriptor for `CoinService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List coinServiceDescriptor = $convert.base64Decode(
    'CgtDb2luU2VydmljZRJaCg9HZXRDb2luU2V0dGluZ3MSIi5wdWJsaXJhLnYxLkdldENvaW5TZX'
    'R0aW5nc1JlcXVlc3QaIy5wdWJsaXJhLnYxLkdldENvaW5TZXR0aW5nc1Jlc3BvbnNlElcKDkdl'
    'dENvaW5CYWxhbmNlEiEucHVibGlyYS52MS5HZXRDb2luQmFsYW5jZVJlcXVlc3QaIi5wdWJsaX'
    'JhLnYxLkdldENvaW5CYWxhbmNlUmVzcG9uc2USaQoUTGlzdENvaW5UcmFuc2FjdGlvbnMSJy5w'
    'dWJsaXJhLnYxLkxpc3RDb2luVHJhbnNhY3Rpb25zUmVxdWVzdBooLnB1YmxpcmEudjEuTGlzdE'
    'NvaW5UcmFuc2FjdGlvbnNSZXNwb25zZRJmChNQYXlFcGlzb2RlV2l0aENvaW5zEiYucHVibGly'
    'YS52MS5QYXlFcGlzb2RlV2l0aENvaW5zUmVxdWVzdBonLnB1YmxpcmEudjEuUGF5RXBpc29kZV'
    'dpdGhDb2luc1Jlc3BvbnNlEmwKFVN0YXJ0Q29pblBhY2tDaGVja291dBIoLnB1YmxpcmEudjEu'
    'U3RhcnRDb2luUGFja0NoZWNrb3V0UmVxdWVzdBopLnB1YmxpcmEudjEuU3RhcnRDb2luUGFja0'
    'NoZWNrb3V0UmVzcG9uc2U=');
