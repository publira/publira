// This is a generated file - do not edit.
//
// Generated from publira/types/v1/types.proto.

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

@$core.Deprecated('Use creatorCreditSourceDescriptor instead')
const CreatorCreditSource$json = {
  '1': 'CreatorCreditSource',
  '2': [
    {'1': 'CREATOR_CREDIT_SOURCE_UNSPECIFIED', '2': 0},
    {'1': 'CREATOR_CREDIT_SOURCE_SERIES', '2': 1},
    {'1': 'CREATOR_CREDIT_SOURCE_EPISODE', '2': 2},
  ],
};

/// Descriptor for `CreatorCreditSource`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List creatorCreditSourceDescriptor = $convert.base64Decode(
    'ChNDcmVhdG9yQ3JlZGl0U291cmNlEiUKIUNSRUFUT1JfQ1JFRElUX1NPVVJDRV9VTlNQRUNJRk'
    'lFRBAAEiAKHENSRUFUT1JfQ1JFRElUX1NPVVJDRV9TRVJJRVMQARIhCh1DUkVBVE9SX0NSRURJ'
    'VF9TT1VSQ0VfRVBJU09ERRAC');

@$core.Deprecated('Use seriesStatusDescriptor instead')
const SeriesStatus$json = {
  '1': 'SeriesStatus',
  '2': [
    {'1': 'SERIES_STATUS_UNSPECIFIED', '2': 0},
    {'1': 'SERIES_STATUS_ONGOING', '2': 1},
    {'1': 'SERIES_STATUS_COMPLETED', '2': 2},
    {'1': 'SERIES_STATUS_HIATUS', '2': 3},
  ],
};

/// Descriptor for `SeriesStatus`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List seriesStatusDescriptor = $convert.base64Decode(
    'CgxTZXJpZXNTdGF0dXMSHQoZU0VSSUVTX1NUQVRVU19VTlNQRUNJRklFRBAAEhkKFVNFUklFU1'
    '9TVEFUVVNfT05HT0lORxABEhsKF1NFUklFU19TVEFUVVNfQ09NUExFVEVEEAISGAoUU0VSSUVT'
    'X1NUQVRVU19ISUFUVVMQAw==');

@$core.Deprecated('Use seriesAgeRatingDescriptor instead')
const SeriesAgeRating$json = {
  '1': 'SeriesAgeRating',
  '2': [
    {'1': 'SERIES_AGE_RATING_UNSPECIFIED', '2': 0},
    {'1': 'SERIES_AGE_RATING_ALL', '2': 1},
    {'1': 'SERIES_AGE_RATING_R15', '2': 2},
    {'1': 'SERIES_AGE_RATING_R18', '2': 3},
  ],
};

/// Descriptor for `SeriesAgeRating`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List seriesAgeRatingDescriptor = $convert.base64Decode(
    'Cg9TZXJpZXNBZ2VSYXRpbmcSIQodU0VSSUVTX0FHRV9SQVRJTkdfVU5TUEVDSUZJRUQQABIZCh'
    'VTRVJJRVNfQUdFX1JBVElOR19BTEwQARIZChVTRVJJRVNfQUdFX1JBVElOR19SMTUQAhIZChVT'
    'RVJJRVNfQUdFX1JBVElOR19SMTgQAw==');

@$core.Deprecated('Use readingDirectionDescriptor instead')
const ReadingDirection$json = {
  '1': 'ReadingDirection',
  '2': [
    {'1': 'READING_DIRECTION_UNSPECIFIED', '2': 0},
    {'1': 'READING_DIRECTION_RIGHT_TO_LEFT', '2': 1},
    {'1': 'READING_DIRECTION_LEFT_TO_RIGHT', '2': 2},
  ],
};

/// Descriptor for `ReadingDirection`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List readingDirectionDescriptor = $convert.base64Decode(
    'ChBSZWFkaW5nRGlyZWN0aW9uEiEKHVJFQURJTkdfRElSRUNUSU9OX1VOU1BFQ0lGSUVEEAASIw'
    'ofUkVBRElOR19ESVJFQ1RJT05fUklHSFRfVE9fTEVGVBABEiMKH1JFQURJTkdfRElSRUNUSU9O'
    'X0xFRlRfVE9fUklHSFQQAg==');

@$core.Deprecated('Use commentModeDescriptor instead')
const CommentMode$json = {
  '1': 'CommentMode',
  '2': [
    {'1': 'COMMENT_MODE_UNSPECIFIED', '2': 0},
    {'1': 'COMMENT_MODE_DISABLED', '2': 1},
    {'1': 'COMMENT_MODE_IMMEDIATE', '2': 2},
    {'1': 'COMMENT_MODE_APPROVAL_REQUIRED', '2': 3},
  ],
};

/// Descriptor for `CommentMode`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List commentModeDescriptor = $convert.base64Decode(
    'CgtDb21tZW50TW9kZRIcChhDT01NRU5UX01PREVfVU5TUEVDSUZJRUQQABIZChVDT01NRU5UX0'
    '1PREVfRElTQUJMRUQQARIaChZDT01NRU5UX01PREVfSU1NRURJQVRFEAISIgoeQ09NTUVOVF9N'
    'T0RFX0FQUFJPVkFMX1JFUVVJUkVEEAM=');

@$core.Deprecated('Use clientSurfaceDescriptor instead')
const ClientSurface$json = {
  '1': 'ClientSurface',
  '2': [
    {'1': 'CLIENT_SURFACE_UNSPECIFIED', '2': 0},
    {'1': 'CLIENT_SURFACE_WEB', '2': 1},
    {'1': 'CLIENT_SURFACE_APP', '2': 2},
  ],
};

/// Descriptor for `ClientSurface`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List clientSurfaceDescriptor = $convert.base64Decode(
    'Cg1DbGllbnRTdXJmYWNlEh4KGkNMSUVOVF9TVVJGQUNFX1VOU1BFQ0lGSUVEEAASFgoSQ0xJRU'
    '5UX1NVUkZBQ0VfV0VCEAESFgoSQ0xJRU5UX1NVUkZBQ0VfQVBQEAI=');

@$core.Deprecated('Use appPurchaseRouteDescriptor instead')
const AppPurchaseRoute$json = {
  '1': 'AppPurchaseRoute',
  '2': [
    {'1': 'APP_PURCHASE_ROUTE_UNSPECIFIED', '2': 0},
    {'1': 'APP_PURCHASE_ROUTE_EXTERNAL_CHECKOUT', '2': 1},
    {'1': 'APP_PURCHASE_ROUTE_STORE', '2': 2},
  ],
};

/// Descriptor for `AppPurchaseRoute`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List appPurchaseRouteDescriptor = $convert.base64Decode(
    'ChBBcHBQdXJjaGFzZVJvdXRlEiIKHkFQUF9QVVJDSEFTRV9ST1VURV9VTlNQRUNJRklFRBAAEi'
    'gKJEFQUF9QVVJDSEFTRV9ST1VURV9FWFRFUk5BTF9DSEVDS09VVBABEhwKGEFQUF9QVVJDSEFT'
    'RV9ST1VURV9TVE9SRRAC');

@$core.Deprecated('Use surfaceAvailabilityDescriptor instead')
const SurfaceAvailability$json = {
  '1': 'SurfaceAvailability',
  '2': [
    {'1': 'SURFACE_AVAILABILITY_UNSPECIFIED', '2': 0},
    {'1': 'SURFACE_AVAILABILITY_ALL', '2': 1},
    {'1': 'SURFACE_AVAILABILITY_WEB', '2': 2},
    {'1': 'SURFACE_AVAILABILITY_APP', '2': 3},
  ],
};

/// Descriptor for `SurfaceAvailability`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List surfaceAvailabilityDescriptor = $convert.base64Decode(
    'ChNTdXJmYWNlQXZhaWxhYmlsaXR5EiQKIFNVUkZBQ0VfQVZBSUxBQklMSVRZX1VOU1BFQ0lGSU'
    'VEEAASHAoYU1VSRkFDRV9BVkFJTEFCSUxJVFlfQUxMEAESHAoYU1VSRkFDRV9BVkFJTEFCSUxJ'
    'VFlfV0VCEAISHAoYU1VSRkFDRV9BVkFJTEFCSUxJVFlfQVBQEAM=');

@$core.Deprecated('Use purchaseKindDescriptor instead')
const PurchaseKind$json = {
  '1': 'PurchaseKind',
  '2': [
    {'1': 'PURCHASE_KIND_UNSPECIFIED', '2': 0},
    {'1': 'PURCHASE_KIND_PURCHASE', '2': 1},
    {'1': 'PURCHASE_KIND_RENTAL', '2': 2},
  ],
};

/// Descriptor for `PurchaseKind`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List purchaseKindDescriptor = $convert.base64Decode(
    'CgxQdXJjaGFzZUtpbmQSHQoZUFVSQ0hBU0VfS0lORF9VTlNQRUNJRklFRBAAEhoKFlBVUkNIQV'
    'NFX0tJTkRfUFVSQ0hBU0UQARIYChRQVVJDSEFTRV9LSU5EX1JFTlRBTBAC');

@$core.Deprecated('Use readerIconPolicyDescriptor instead')
const ReaderIconPolicy$json = {
  '1': 'ReaderIconPolicy',
  '2': [
    {'1': 'READER_ICON_POLICY_UNSPECIFIED', '2': 0},
    {'1': 'READER_ICON_POLICY_UPLOAD', '2': 1},
    {'1': 'READER_ICON_POLICY_PRESET', '2': 2},
    {'1': 'READER_ICON_POLICY_DISABLED', '2': 3},
  ],
};

/// Descriptor for `ReaderIconPolicy`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List readerIconPolicyDescriptor = $convert.base64Decode(
    'ChBSZWFkZXJJY29uUG9saWN5EiIKHlJFQURFUl9JQ09OX1BPTElDWV9VTlNQRUNJRklFRBAAEh'
    '0KGVJFQURFUl9JQ09OX1BPTElDWV9VUExPQUQQARIdChlSRUFERVJfSUNPTl9QT0xJQ1lfUFJF'
    'U0VUEAISHwobUkVBREVSX0lDT05fUE9MSUNZX0RJU0FCTEVEEAM=');

@$core.Deprecated('Use ageVerificationDescriptor instead')
const AgeVerification$json = {
  '1': 'AgeVerification',
  '2': [
    {'1': 'AGE_VERIFICATION_UNSPECIFIED', '2': 0},
    {'1': 'AGE_VERIFICATION_NONE', '2': 1},
    {'1': 'AGE_VERIFICATION_R18', '2': 2},
    {'1': 'AGE_VERIFICATION_R15_AND_R18', '2': 3},
  ],
};

/// Descriptor for `AgeVerification`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List ageVerificationDescriptor = $convert.base64Decode(
    'Cg9BZ2VWZXJpZmljYXRpb24SIAocQUdFX1ZFUklGSUNBVElPTl9VTlNQRUNJRklFRBAAEhkKFU'
    'FHRV9WRVJJRklDQVRJT05fTk9ORRABEhgKFEFHRV9WRVJJRklDQVRJT05fUjE4EAISIAocQUdF'
    'X1ZFUklGSUNBVElPTl9SMTVfQU5EX1IxOBAD');

@$core.Deprecated('Use tenantContextDescriptor instead')
const TenantContext$json = {
  '1': 'TenantContext',
  '2': [
    {'1': 'tenant_id', '3': 1, '4': 1, '5': 9, '10': 'tenantId'},
  ],
};

/// Descriptor for `TenantContext`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantContextDescriptor = $convert.base64Decode(
    'Cg1UZW5hbnRDb250ZXh0EhsKCXRlbmFudF9pZBgBIAEoCVIIdGVuYW50SWQ=');

@$core.Deprecated('Use userDescriptor instead')
const User$json = {
  '1': 'User',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'role', '3': 3, '4': 1, '5': 9, '10': 'role'},
    {'1': 'birth_date', '3': 4, '4': 1, '5': 9, '10': 'birthDate'},
    {'1': 'email', '3': 5, '4': 1, '5': 9, '10': 'email'},
    {
      '1': 'icon_image_updated_at',
      '3': 6,
      '4': 1,
      '5': 9,
      '10': 'iconImageUpdatedAt'
    },
    {
      '1': 'icon_image_variants',
      '3': 7,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.UserIconVariant',
      '10': 'iconImageVariants'
    },
    {'1': 'icon_preset_id', '3': 8, '4': 1, '5': 9, '10': 'iconPresetId'},
  ],
};

/// Descriptor for `User`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userDescriptor = $convert.base64Decode(
    'CgRVc2VyEhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibGljSWQSEgoEbmFtZRgCIAEoCVIEbmFtZR'
    'ISCgRyb2xlGAMgASgJUgRyb2xlEh0KCmJpcnRoX2RhdGUYBCABKAlSCWJpcnRoRGF0ZRIUCgVl'
    'bWFpbBgFIAEoCVIFZW1haWwSMQoVaWNvbl9pbWFnZV91cGRhdGVkX2F0GAYgASgJUhJpY29uSW'
    '1hZ2VVcGRhdGVkQXQSUQoTaWNvbl9pbWFnZV92YXJpYW50cxgHIAMoCzIhLnB1YmxpcmEudHlw'
    'ZXMudjEuVXNlckljb25WYXJpYW50UhFpY29uSW1hZ2VWYXJpYW50cxIkCg5pY29uX3ByZXNldF'
    '9pZBgIIAEoCVIMaWNvblByZXNldElk');

@$core.Deprecated('Use userIconVariantDescriptor instead')
const UserIconVariant$json = {
  '1': 'UserIconVariant',
  '2': [
    {'1': 'label', '3': 1, '4': 1, '5': 9, '10': 'label'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'content_type', '3': 3, '4': 1, '5': 9, '10': 'contentType'},
    {'1': 'width', '3': 4, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 5, '4': 1, '5': 5, '10': 'height'},
    {'1': 'file_size_bytes', '3': 6, '4': 1, '5': 3, '10': 'fileSizeBytes'},
  ],
};

/// Descriptor for `UserIconVariant`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List userIconVariantDescriptor = $convert.base64Decode(
    'Cg9Vc2VySWNvblZhcmlhbnQSFAoFbGFiZWwYASABKAlSBWxhYmVsEhAKA3VybBgCIAEoCVIDdX'
    'JsEiEKDGNvbnRlbnRfdHlwZRgDIAEoCVILY29udGVudFR5cGUSFAoFd2lkdGgYBCABKAVSBXdp'
    'ZHRoEhYKBmhlaWdodBgFIAEoBVIGaGVpZ2h0EiYKD2ZpbGVfc2l6ZV9ieXRlcxgGIAEoA1INZm'
    'lsZVNpemVCeXRlcw==');

@$core.Deprecated('Use accessTokenDescriptor instead')
const AccessToken$json = {
  '1': 'AccessToken',
  '2': [
    {'1': 'token', '3': 1, '4': 1, '5': 9, '10': 'token'},
    {'1': 'expires_at', '3': 2, '4': 1, '5': 9, '10': 'expiresAt'},
  ],
};

/// Descriptor for `AccessToken`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List accessTokenDescriptor = $convert.base64Decode(
    'CgtBY2Nlc3NUb2tlbhIUCgV0b2tlbhgBIAEoCVIFdG9rZW4SHQoKZXhwaXJlc19hdBgCIAEoCV'
    'IJZXhwaXJlc0F0');

@$core.Deprecated('Use creatorRoleDescriptor instead')
const CreatorRole$json = {
  '1': 'CreatorRole',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'id', '3': 3, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `CreatorRole`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List creatorRoleDescriptor = $convert.base64Decode(
    'CgtDcmVhdG9yUm9sZRIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBG5hbWUYAiABKA'
    'lSBG5hbWUSDgoCaWQYAyABKAlSAmlk');

@$core.Deprecated('Use creatorDescriptor instead')
const Creator$json = {
  '1': 'Creator',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'profile_text', '3': 4, '4': 1, '5': 9, '10': 'profileText'},
    {'1': 'icon_image_url', '3': 5, '4': 1, '5': 9, '10': 'iconImageUrl'},
    {
      '1': 'icon_image_file_size_bytes',
      '3': 6,
      '4': 1,
      '5': 3,
      '10': 'iconImageFileSizeBytes'
    },
    {
      '1': 'icon_image_updated_at',
      '3': 7,
      '4': 1,
      '5': 9,
      '10': 'iconImageUpdatedAt'
    },
    {
      '1': 'role',
      '3': 8,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.CreatorRole',
      '10': 'role'
    },
    {
      '1': 'source',
      '3': 9,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.CreatorCreditSource',
      '10': 'source'
    },
    {'1': 'id', '3': 10, '4': 1, '5': 9, '10': 'id'},
  ],
  '9': [
    {'1': 3, '2': 4},
  ],
};

/// Descriptor for `Creator`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List creatorDescriptor = $convert.base64Decode(
    'CgdDcmVhdG9yEhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibGljSWQSEgoEbmFtZRgCIAEoCVIEbm'
    'FtZRIhCgxwcm9maWxlX3RleHQYBCABKAlSC3Byb2ZpbGVUZXh0EiQKDmljb25faW1hZ2VfdXJs'
    'GAUgASgJUgxpY29uSW1hZ2VVcmwSOgoaaWNvbl9pbWFnZV9maWxlX3NpemVfYnl0ZXMYBiABKA'
    'NSFmljb25JbWFnZUZpbGVTaXplQnl0ZXMSMQoVaWNvbl9pbWFnZV91cGRhdGVkX2F0GAcgASgJ'
    'UhJpY29uSW1hZ2VVcGRhdGVkQXQSMQoEcm9sZRgIIAEoCzIdLnB1YmxpcmEudHlwZXMudjEuQ3'
    'JlYXRvclJvbGVSBHJvbGUSPQoGc291cmNlGAkgASgOMiUucHVibGlyYS50eXBlcy52MS5DcmVh'
    'dG9yQ3JlZGl0U291cmNlUgZzb3VyY2USDgoCaWQYCiABKAlSAmlkSgQIAxAE');

@$core.Deprecated('Use labelDescriptor instead')
const Label$json = {
  '1': 'Label',
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
    {'1': 'id', '3': 5, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `Label`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List labelDescriptor = $convert.base64Decode(
    'CgVMYWJlbBIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBG5hbWUYAiABKAlSBG5hbW'
    'USOgoaZXllX2NhdGNoX2ltYWdlX3VwZGF0ZWRfYXQYAyABKAlSFmV5ZUNhdGNoSW1hZ2VVcGRh'
    'dGVkQXQSYAoYZXllX2NhdGNoX2ltYWdlX3ZhcmlhbnRzGAQgAygLMicucHVibGlyYS50eXBlcy'
    '52MS5TZXJpZXNFeWVDYXRjaFZhcmlhbnRSFWV5ZUNhdGNoSW1hZ2VWYXJpYW50cxIOCgJpZBgF'
    'IAEoCVICaWQ=');

@$core.Deprecated('Use seriesEyeCatchVariantDescriptor instead')
const SeriesEyeCatchVariant$json = {
  '1': 'SeriesEyeCatchVariant',
  '2': [
    {'1': 'label', '3': 1, '4': 1, '5': 9, '10': 'label'},
    {'1': 'variant_type', '3': 7, '4': 1, '5': 9, '10': 'variantType'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'content_type', '3': 3, '4': 1, '5': 9, '10': 'contentType'},
    {'1': 'width', '3': 4, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 5, '4': 1, '5': 5, '10': 'height'},
    {'1': 'file_size_bytes', '3': 6, '4': 1, '5': 3, '10': 'fileSizeBytes'},
  ],
};

/// Descriptor for `SeriesEyeCatchVariant`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List seriesEyeCatchVariantDescriptor = $convert.base64Decode(
    'ChVTZXJpZXNFeWVDYXRjaFZhcmlhbnQSFAoFbGFiZWwYASABKAlSBWxhYmVsEiEKDHZhcmlhbn'
    'RfdHlwZRgHIAEoCVILdmFyaWFudFR5cGUSEAoDdXJsGAIgASgJUgN1cmwSIQoMY29udGVudF90'
    'eXBlGAMgASgJUgtjb250ZW50VHlwZRIUCgV3aWR0aBgEIAEoBVIFd2lkdGgSFgoGaGVpZ2h0GA'
    'UgASgFUgZoZWlnaHQSJgoPZmlsZV9zaXplX2J5dGVzGAYgASgDUg1maWxlU2l6ZUJ5dGVz');

@$core.Deprecated('Use imageCropRectDescriptor instead')
const ImageCropRect$json = {
  '1': 'ImageCropRect',
  '2': [
    {'1': 'x', '3': 1, '4': 1, '5': 5, '10': 'x'},
    {'1': 'y', '3': 2, '4': 1, '5': 5, '10': 'y'},
    {'1': 'width', '3': 3, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 4, '4': 1, '5': 5, '10': 'height'},
  ],
};

/// Descriptor for `ImageCropRect`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List imageCropRectDescriptor = $convert.base64Decode(
    'Cg1JbWFnZUNyb3BSZWN0EgwKAXgYASABKAVSAXgSDAoBeRgCIAEoBVIBeRIUCgV3aWR0aBgDIA'
    'EoBVIFd2lkdGgSFgoGaGVpZ2h0GAQgASgFUgZoZWlnaHQ=');

@$core.Deprecated('Use genreDescriptor instead')
const Genre$json = {
  '1': 'Genre',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'slug', '3': 3, '4': 1, '5': 9, '10': 'slug'},
    {
      '1': 'eye_catch_image_updated_at',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'eyeCatchImageUpdatedAt'
    },
    {
      '1': 'eye_catch_image_variants',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {'1': 'id', '3': 6, '4': 1, '5': 9, '10': 'id'},
    {'1': 'locale', '3': 7, '4': 1, '5': 9, '10': 'locale'},
    {
      '1': 'translations',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.GenreTranslation',
      '10': 'translations'
    },
  ],
};

/// Descriptor for `Genre`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List genreDescriptor = $convert.base64Decode(
    'CgVHZW5yZRIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBG5hbWUYAiABKAlSBG5hbW'
    'USEgoEc2x1ZxgDIAEoCVIEc2x1ZxI6ChpleWVfY2F0Y2hfaW1hZ2VfdXBkYXRlZF9hdBgEIAEo'
    'CVIWZXllQ2F0Y2hJbWFnZVVwZGF0ZWRBdBJgChhleWVfY2F0Y2hfaW1hZ2VfdmFyaWFudHMYBS'
    'ADKAsyJy5wdWJsaXJhLnR5cGVzLnYxLlNlcmllc0V5ZUNhdGNoVmFyaWFudFIVZXllQ2F0Y2hJ'
    'bWFnZVZhcmlhbnRzEg4KAmlkGAYgASgJUgJpZBIWCgZsb2NhbGUYByABKAlSBmxvY2FsZRJGCg'
    'x0cmFuc2xhdGlvbnMYCCADKAsyIi5wdWJsaXJhLnR5cGVzLnYxLkdlbnJlVHJhbnNsYXRpb25S'
    'DHRyYW5zbGF0aW9ucw==');

@$core.Deprecated('Use genreTranslationDescriptor instead')
const GenreTranslation$json = {
  '1': 'GenreTranslation',
  '2': [
    {'1': 'locale', '3': 1, '4': 1, '5': 9, '10': 'locale'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'created_at', '3': 3, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'updated_at', '3': 4, '4': 1, '5': 9, '10': 'updatedAt'},
  ],
};

/// Descriptor for `GenreTranslation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List genreTranslationDescriptor = $convert.base64Decode(
    'ChBHZW5yZVRyYW5zbGF0aW9uEhYKBmxvY2FsZRgBIAEoCVIGbG9jYWxlEhIKBG5hbWUYAiABKA'
    'lSBG5hbWUSHQoKY3JlYXRlZF9hdBgDIAEoCVIJY3JlYXRlZEF0Eh0KCnVwZGF0ZWRfYXQYBCAB'
    'KAlSCXVwZGF0ZWRBdA==');

@$core.Deprecated('Use tagDescriptor instead')
const Tag$json = {
  '1': 'Tag',
  '2': [
    {'1': 'name', '3': 1, '4': 1, '5': 9, '10': 'name'},
    {'1': 'slug', '3': 2, '4': 1, '5': 9, '10': 'slug'},
  ],
};

/// Descriptor for `Tag`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tagDescriptor = $convert.base64Decode(
    'CgNUYWcSEgoEbmFtZRgBIAEoCVIEbmFtZRISCgRzbHVnGAIgASgJUgRzbHVn');

@$core.Deprecated('Use seriesDescriptor instead')
const Series$json = {
  '1': 'Series',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'synopsis', '3': 3, '4': 1, '5': 9, '10': 'synopsis'},
    {
      '1': 'label',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Label',
      '10': 'label'
    },
    {
      '1': 'creators',
      '3': 5,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Creator',
      '10': 'creators'
    },
    {
      '1': 'reading_period_hours',
      '3': 6,
      '4': 1,
      '5': 5,
      '10': 'readingPeriodHours'
    },
    {'1': 'is_published', '3': 11, '4': 1, '5': 8, '10': 'isPublished'},
    {'1': 'published_at', '3': 12, '4': 1, '5': 9, '10': 'publishedAt'},
    {
      '1': 'eye_catch_image_updated_at',
      '3': 9,
      '4': 1,
      '5': 9,
      '10': 'eyeCatchImageUpdatedAt'
    },
    {
      '1': 'eye_catch_image_variants',
      '3': 10,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {
      '1': 'status',
      '3': 13,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SeriesStatus',
      '10': 'status'
    },
    {
      '1': 'schedule_weekdays',
      '3': 14,
      '4': 3,
      '5': 5,
      '10': 'scheduleWeekdays'
    },
    {
      '1': 'age_rating',
      '3': 15,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SeriesAgeRating',
      '10': 'ageRating'
    },
    {
      '1': 'genres',
      '3': 16,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Genre',
      '10': 'genres'
    },
    {
      '1': 'tags',
      '3': 17,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Tag',
      '10': 'tags'
    },
    {
      '1': 'free_episode_count',
      '3': 18,
      '4': 1,
      '5': 5,
      '10': 'freeEpisodeCount'
    },
    {'1': 'rating_average', '3': 19, '4': 1, '5': 1, '10': 'ratingAverage'},
    {'1': 'rating_count', '3': 20, '4': 1, '5': 3, '10': 'ratingCount'},
    {
      '1': 'availability',
      '3': 21,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SurfaceAvailability',
      '10': 'availability'
    },
    {'1': 'id', '3': 22, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'rental_period_hours',
      '3': 23,
      '4': 1,
      '5': 5,
      '10': 'rentalPeriodHours'
    },
    {'1': 'locale', '3': 24, '4': 1, '5': 9, '10': 'locale'},
  ],
  '9': [
    {'1': 7, '2': 8},
    {'1': 8, '2': 9},
  ],
};

/// Descriptor for `Series`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List seriesDescriptor = $convert.base64Decode(
    'CgZTZXJpZXMSGwoJcHVibGljX2lkGAEgASgJUghwdWJsaWNJZBIUCgV0aXRsZRgCIAEoCVIFdG'
    'l0bGUSGgoIc3lub3BzaXMYAyABKAlSCHN5bm9wc2lzEi0KBWxhYmVsGAQgASgLMhcucHVibGly'
    'YS50eXBlcy52MS5MYWJlbFIFbGFiZWwSNQoIY3JlYXRvcnMYBSADKAsyGS5wdWJsaXJhLnR5cG'
    'VzLnYxLkNyZWF0b3JSCGNyZWF0b3JzEjAKFHJlYWRpbmdfcGVyaW9kX2hvdXJzGAYgASgFUhJy'
    'ZWFkaW5nUGVyaW9kSG91cnMSIQoMaXNfcHVibGlzaGVkGAsgASgIUgtpc1B1Ymxpc2hlZBIhCg'
    'xwdWJsaXNoZWRfYXQYDCABKAlSC3B1Ymxpc2hlZEF0EjoKGmV5ZV9jYXRjaF9pbWFnZV91cGRh'
    'dGVkX2F0GAkgASgJUhZleWVDYXRjaEltYWdlVXBkYXRlZEF0EmAKGGV5ZV9jYXRjaF9pbWFnZV'
    '92YXJpYW50cxgKIAMoCzInLnB1YmxpcmEudHlwZXMudjEuU2VyaWVzRXllQ2F0Y2hWYXJpYW50'
    'UhVleWVDYXRjaEltYWdlVmFyaWFudHMSNgoGc3RhdHVzGA0gASgOMh4ucHVibGlyYS50eXBlcy'
    '52MS5TZXJpZXNTdGF0dXNSBnN0YXR1cxIrChFzY2hlZHVsZV93ZWVrZGF5cxgOIAMoBVIQc2No'
    'ZWR1bGVXZWVrZGF5cxJACgphZ2VfcmF0aW5nGA8gASgOMiEucHVibGlyYS50eXBlcy52MS5TZX'
    'JpZXNBZ2VSYXRpbmdSCWFnZVJhdGluZxIvCgZnZW5yZXMYECADKAsyFy5wdWJsaXJhLnR5cGVz'
    'LnYxLkdlbnJlUgZnZW5yZXMSKQoEdGFncxgRIAMoCzIVLnB1YmxpcmEudHlwZXMudjEuVGFnUg'
    'R0YWdzEiwKEmZyZWVfZXBpc29kZV9jb3VudBgSIAEoBVIQZnJlZUVwaXNvZGVDb3VudBIlCg5y'
    'YXRpbmdfYXZlcmFnZRgTIAEoAVINcmF0aW5nQXZlcmFnZRIhCgxyYXRpbmdfY291bnQYFCABKA'
    'NSC3JhdGluZ0NvdW50EkkKDGF2YWlsYWJpbGl0eRgVIAEoDjIlLnB1YmxpcmEudHlwZXMudjEu'
    'U3VyZmFjZUF2YWlsYWJpbGl0eVIMYXZhaWxhYmlsaXR5Eg4KAmlkGBYgASgJUgJpZBIuChNyZW'
    '50YWxfcGVyaW9kX2hvdXJzGBcgASgFUhFyZW50YWxQZXJpb2RIb3VycxIWCgZsb2NhbGUYGCAB'
    'KAlSBmxvY2FsZUoECAcQCEoECAgQCQ==');

@$core.Deprecated('Use episodeDescriptor instead')
const Episode$json = {
  '1': 'Episode',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'order_index', '3': 3, '4': 1, '5': 5, '10': 'orderIndex'},
    {'1': 'price', '3': 4, '4': 1, '5': 5, '10': 'price'},
    {
      '1': 'reading_period_hours',
      '3': 5,
      '4': 1,
      '5': 5,
      '10': 'readingPeriodHours'
    },
    {'1': 'status', '3': 6, '4': 1, '5': 9, '10': 'status'},
    {'1': 'scheduled_at', '3': 7, '4': 1, '5': 9, '10': 'scheduledAt'},
    {'1': 'published_at', '3': 8, '4': 1, '5': 9, '10': 'publishedAt'},
    {
      '1': 'creators',
      '3': 9,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Creator',
      '10': 'creators'
    },
    {'1': 'rating_count', '3': 10, '4': 1, '5': 3, '10': 'ratingCount'},
    {
      '1': 'reading_direction',
      '3': 11,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ReadingDirection',
      '10': 'readingDirection'
    },
    {
      '1': 'spread_start_index',
      '3': 12,
      '4': 1,
      '5': 5,
      '10': 'spreadStartIndex'
    },
    {
      '1': 'availability',
      '3': 13,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SurfaceAvailability',
      '10': 'availability'
    },
    {
      '1': 'purchase_availability',
      '3': 14,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SurfaceAvailability',
      '10': 'purchaseAvailability'
    },
    {'1': 'id', '3': 15, '4': 1, '5': 9, '10': 'id'},
    {'1': 'free_until', '3': 16, '4': 1, '5': 9, '10': 'freeUntil'},
    {
      '1': 'eye_catch_image_updated_at',
      '3': 17,
      '4': 1,
      '5': 9,
      '10': 'eyeCatchImageUpdatedAt'
    },
    {
      '1': 'eye_catch_image_variants',
      '3': 18,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'eyeCatchImageVariants'
    },
    {'1': 'rental_price', '3': 19, '4': 1, '5': 5, '10': 'rentalPrice'},
    {
      '1': 'rental_period_hours',
      '3': 20,
      '4': 1,
      '5': 5,
      '10': 'rentalPeriodHours'
    },
    {'1': 'locale', '3': 21, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `Episode`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List episodeDescriptor = $convert.base64Decode(
    'CgdFcGlzb2RlEhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibGljSWQSFAoFdGl0bGUYAiABKAlSBX'
    'RpdGxlEh8KC29yZGVyX2luZGV4GAMgASgFUgpvcmRlckluZGV4EhQKBXByaWNlGAQgASgFUgVw'
    'cmljZRIwChRyZWFkaW5nX3BlcmlvZF9ob3VycxgFIAEoBVIScmVhZGluZ1BlcmlvZEhvdXJzEh'
    'YKBnN0YXR1cxgGIAEoCVIGc3RhdHVzEiEKDHNjaGVkdWxlZF9hdBgHIAEoCVILc2NoZWR1bGVk'
    'QXQSIQoMcHVibGlzaGVkX2F0GAggASgJUgtwdWJsaXNoZWRBdBI1CghjcmVhdG9ycxgJIAMoCz'
    'IZLnB1YmxpcmEudHlwZXMudjEuQ3JlYXRvclIIY3JlYXRvcnMSIQoMcmF0aW5nX2NvdW50GAog'
    'ASgDUgtyYXRpbmdDb3VudBJPChFyZWFkaW5nX2RpcmVjdGlvbhgLIAEoDjIiLnB1YmxpcmEudH'
    'lwZXMudjEuUmVhZGluZ0RpcmVjdGlvblIQcmVhZGluZ0RpcmVjdGlvbhIsChJzcHJlYWRfc3Rh'
    'cnRfaW5kZXgYDCABKAVSEHNwcmVhZFN0YXJ0SW5kZXgSSQoMYXZhaWxhYmlsaXR5GA0gASgOMi'
    'UucHVibGlyYS50eXBlcy52MS5TdXJmYWNlQXZhaWxhYmlsaXR5UgxhdmFpbGFiaWxpdHkSWgoV'
    'cHVyY2hhc2VfYXZhaWxhYmlsaXR5GA4gASgOMiUucHVibGlyYS50eXBlcy52MS5TdXJmYWNlQX'
    'ZhaWxhYmlsaXR5UhRwdXJjaGFzZUF2YWlsYWJpbGl0eRIOCgJpZBgPIAEoCVICaWQSHQoKZnJl'
    'ZV91bnRpbBgQIAEoCVIJZnJlZVVudGlsEjoKGmV5ZV9jYXRjaF9pbWFnZV91cGRhdGVkX2F0GB'
    'EgASgJUhZleWVDYXRjaEltYWdlVXBkYXRlZEF0EmAKGGV5ZV9jYXRjaF9pbWFnZV92YXJpYW50'
    'cxgSIAMoCzInLnB1YmxpcmEudHlwZXMudjEuU2VyaWVzRXllQ2F0Y2hWYXJpYW50UhVleWVDYX'
    'RjaEltYWdlVmFyaWFudHMSIQoMcmVudGFsX3ByaWNlGBMgASgFUgtyZW50YWxQcmljZRIuChNy'
    'ZW50YWxfcGVyaW9kX2hvdXJzGBQgASgFUhFyZW50YWxQZXJpb2RIb3VycxIWCgZsb2NhbGUYFS'
    'ABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use episodeImageDescriptor instead')
const EpisodeImage$json = {
  '1': 'EpisodeImage',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'image_url', '3': 2, '4': 1, '5': 9, '10': 'imageUrl'},
    {'1': 'content_type', '3': 3, '4': 1, '5': 9, '10': 'contentType'},
    {'1': 'file_size_bytes', '3': 4, '4': 1, '5': 3, '10': 'fileSizeBytes'},
    {'1': 'display_order', '3': 5, '4': 1, '5': 5, '10': 'displayOrder'},
    {'1': 'width', '3': 6, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 7, '4': 1, '5': 5, '10': 'height'},
  ],
};

/// Descriptor for `EpisodeImage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List episodeImageDescriptor = $convert.base64Decode(
    'CgxFcGlzb2RlSW1hZ2USDgoCaWQYASABKAlSAmlkEhsKCWltYWdlX3VybBgCIAEoCVIIaW1hZ2'
    'VVcmwSIQoMY29udGVudF90eXBlGAMgASgJUgtjb250ZW50VHlwZRImCg9maWxlX3NpemVfYnl0'
    'ZXMYBCABKANSDWZpbGVTaXplQnl0ZXMSIwoNZGlzcGxheV9vcmRlchgFIAEoBVIMZGlzcGxheU'
    '9yZGVyEhQKBXdpZHRoGAYgASgFUgV3aWR0aBIWCgZoZWlnaHQYByABKAVSBmhlaWdodA==');

@$core.Deprecated('Use tenantImageVariantDescriptor instead')
const TenantImageVariant$json = {
  '1': 'TenantImageVariant',
  '2': [
    {'1': 'label', '3': 1, '4': 1, '5': 9, '10': 'label'},
    {'1': 'url', '3': 2, '4': 1, '5': 9, '10': 'url'},
    {'1': 'content_type', '3': 3, '4': 1, '5': 9, '10': 'contentType'},
    {'1': 'width', '3': 4, '4': 1, '5': 5, '10': 'width'},
    {'1': 'height', '3': 5, '4': 1, '5': 5, '10': 'height'},
    {'1': 'file_size_bytes', '3': 6, '4': 1, '5': 3, '10': 'fileSizeBytes'},
    {'1': 'variant_type', '3': 7, '4': 1, '5': 9, '10': 'variantType'},
  ],
};

/// Descriptor for `TenantImageVariant`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantImageVariantDescriptor = $convert.base64Decode(
    'ChJUZW5hbnRJbWFnZVZhcmlhbnQSFAoFbGFiZWwYASABKAlSBWxhYmVsEhAKA3VybBgCIAEoCV'
    'IDdXJsEiEKDGNvbnRlbnRfdHlwZRgDIAEoCVILY29udGVudFR5cGUSFAoFd2lkdGgYBCABKAVS'
    'BXdpZHRoEhYKBmhlaWdodBgFIAEoBVIGaGVpZ2h0EiYKD2ZpbGVfc2l6ZV9ieXRlcxgGIAEoA1'
    'INZmlsZVNpemVCeXRlcxIhCgx2YXJpYW50X3R5cGUYByABKAlSC3ZhcmlhbnRUeXBl');

@$core.Deprecated('Use tenantThemeDescriptor instead')
const TenantTheme$json = {
  '1': 'TenantTheme',
  '2': [
    {'1': 'primary_color', '3': 1, '4': 1, '5': 9, '10': 'primaryColor'},
    {'1': 'secondary_color', '3': 2, '4': 1, '5': 9, '10': 'secondaryColor'},
    {'1': 'accent_color', '3': 3, '4': 1, '5': 9, '10': 'accentColor'},
    {'1': 'background_color', '3': 5, '4': 1, '5': 9, '10': 'backgroundColor'},
    {'1': 'foreground_color', '3': 6, '4': 1, '5': 9, '10': 'foregroundColor'},
    {'1': 'surface_color', '3': 7, '4': 1, '5': 9, '10': 'surfaceColor'},
    {
      '1': 'surface_foreground_color',
      '3': 8,
      '4': 1,
      '5': 9,
      '10': 'surfaceForegroundColor'
    },
    {'1': 'card_color', '3': 9, '4': 1, '5': 9, '10': 'cardColor'},
    {
      '1': 'card_foreground_color',
      '3': 10,
      '4': 1,
      '5': 9,
      '10': 'cardForegroundColor'
    },
    {'1': 'popover_color', '3': 11, '4': 1, '5': 9, '10': 'popoverColor'},
    {
      '1': 'popover_foreground_color',
      '3': 12,
      '4': 1,
      '5': 9,
      '10': 'popoverForegroundColor'
    },
    {
      '1': 'primary_foreground_color',
      '3': 13,
      '4': 1,
      '5': 9,
      '10': 'primaryForegroundColor'
    },
    {
      '1': 'secondary_foreground_color',
      '3': 14,
      '4': 1,
      '5': 9,
      '10': 'secondaryForegroundColor'
    },
    {
      '1': 'accent_foreground_color',
      '3': 15,
      '4': 1,
      '5': 9,
      '10': 'accentForegroundColor'
    },
    {'1': 'muted_color', '3': 16, '4': 1, '5': 9, '10': 'mutedColor'},
    {
      '1': 'muted_foreground_color',
      '3': 17,
      '4': 1,
      '5': 9,
      '10': 'mutedForegroundColor'
    },
    {'1': 'border_color', '3': 18, '4': 1, '5': 9, '10': 'borderColor'},
    {'1': 'input_color', '3': 19, '4': 1, '5': 9, '10': 'inputColor'},
    {'1': 'ring_color', '3': 20, '4': 1, '5': 9, '10': 'ringColor'},
    {'1': 'success_color', '3': 21, '4': 1, '5': 9, '10': 'successColor'},
    {
      '1': 'success_foreground_color',
      '3': 22,
      '4': 1,
      '5': 9,
      '10': 'successForegroundColor'
    },
    {'1': 'warning_color', '3': 23, '4': 1, '5': 9, '10': 'warningColor'},
    {
      '1': 'warning_foreground_color',
      '3': 24,
      '4': 1,
      '5': 9,
      '10': 'warningForegroundColor'
    },
    {
      '1': 'destructive_color',
      '3': 25,
      '4': 1,
      '5': 9,
      '10': 'destructiveColor'
    },
    {
      '1': 'destructive_foreground_color',
      '3': 26,
      '4': 1,
      '5': 9,
      '10': 'destructiveForegroundColor'
    },
    {'1': 'info_color', '3': 27, '4': 1, '5': 9, '10': 'infoColor'},
    {
      '1': 'info_foreground_color',
      '3': 28,
      '4': 1,
      '5': 9,
      '10': 'infoForegroundColor'
    },
    {
      '1': 'icon_image_updated_at',
      '3': 30,
      '4': 1,
      '5': 9,
      '10': 'iconImageUpdatedAt'
    },
    {
      '1': 'icon_image_variants',
      '3': 31,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.TenantImageVariant',
      '10': 'iconImageVariants'
    },
    {
      '1': 'logo_image_updated_at',
      '3': 32,
      '4': 1,
      '5': 9,
      '10': 'logoImageUpdatedAt'
    },
    {
      '1': 'logo_image_variants',
      '3': 33,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.TenantImageVariant',
      '10': 'logoImageVariants'
    },
    {
      '1': 'serif_font_family',
      '3': 34,
      '4': 1,
      '5': 9,
      '10': 'serifFontFamily'
    },
    {'1': 'sans_font_family', '3': 35, '4': 1, '5': 9, '10': 'sansFontFamily'},
  ],
  '9': [
    {'1': 4, '2': 5},
    {'1': 29, '2': 30},
  ],
  '10': ['logo_url', 'icon_url'],
};

/// Descriptor for `TenantTheme`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantThemeDescriptor = $convert.base64Decode(
    'CgtUZW5hbnRUaGVtZRIjCg1wcmltYXJ5X2NvbG9yGAEgASgJUgxwcmltYXJ5Q29sb3ISJwoPc2'
    'Vjb25kYXJ5X2NvbG9yGAIgASgJUg5zZWNvbmRhcnlDb2xvchIhCgxhY2NlbnRfY29sb3IYAyAB'
    'KAlSC2FjY2VudENvbG9yEikKEGJhY2tncm91bmRfY29sb3IYBSABKAlSD2JhY2tncm91bmRDb2'
    'xvchIpChBmb3JlZ3JvdW5kX2NvbG9yGAYgASgJUg9mb3JlZ3JvdW5kQ29sb3ISIwoNc3VyZmFj'
    'ZV9jb2xvchgHIAEoCVIMc3VyZmFjZUNvbG9yEjgKGHN1cmZhY2VfZm9yZWdyb3VuZF9jb2xvch'
    'gIIAEoCVIWc3VyZmFjZUZvcmVncm91bmRDb2xvchIdCgpjYXJkX2NvbG9yGAkgASgJUgljYXJk'
    'Q29sb3ISMgoVY2FyZF9mb3JlZ3JvdW5kX2NvbG9yGAogASgJUhNjYXJkRm9yZWdyb3VuZENvbG'
    '9yEiMKDXBvcG92ZXJfY29sb3IYCyABKAlSDHBvcG92ZXJDb2xvchI4Chhwb3BvdmVyX2ZvcmVn'
    'cm91bmRfY29sb3IYDCABKAlSFnBvcG92ZXJGb3JlZ3JvdW5kQ29sb3ISOAoYcHJpbWFyeV9mb3'
    'JlZ3JvdW5kX2NvbG9yGA0gASgJUhZwcmltYXJ5Rm9yZWdyb3VuZENvbG9yEjwKGnNlY29uZGFy'
    'eV9mb3JlZ3JvdW5kX2NvbG9yGA4gASgJUhhzZWNvbmRhcnlGb3JlZ3JvdW5kQ29sb3ISNgoXYW'
    'NjZW50X2ZvcmVncm91bmRfY29sb3IYDyABKAlSFWFjY2VudEZvcmVncm91bmRDb2xvchIfCgtt'
    'dXRlZF9jb2xvchgQIAEoCVIKbXV0ZWRDb2xvchI0ChZtdXRlZF9mb3JlZ3JvdW5kX2NvbG9yGB'
    'EgASgJUhRtdXRlZEZvcmVncm91bmRDb2xvchIhCgxib3JkZXJfY29sb3IYEiABKAlSC2JvcmRl'
    'ckNvbG9yEh8KC2lucHV0X2NvbG9yGBMgASgJUgppbnB1dENvbG9yEh0KCnJpbmdfY29sb3IYFC'
    'ABKAlSCXJpbmdDb2xvchIjCg1zdWNjZXNzX2NvbG9yGBUgASgJUgxzdWNjZXNzQ29sb3ISOAoY'
    'c3VjY2Vzc19mb3JlZ3JvdW5kX2NvbG9yGBYgASgJUhZzdWNjZXNzRm9yZWdyb3VuZENvbG9yEi'
    'MKDXdhcm5pbmdfY29sb3IYFyABKAlSDHdhcm5pbmdDb2xvchI4Chh3YXJuaW5nX2ZvcmVncm91'
    'bmRfY29sb3IYGCABKAlSFndhcm5pbmdGb3JlZ3JvdW5kQ29sb3ISKwoRZGVzdHJ1Y3RpdmVfY2'
    '9sb3IYGSABKAlSEGRlc3RydWN0aXZlQ29sb3ISQAocZGVzdHJ1Y3RpdmVfZm9yZWdyb3VuZF9j'
    'b2xvchgaIAEoCVIaZGVzdHJ1Y3RpdmVGb3JlZ3JvdW5kQ29sb3ISHQoKaW5mb19jb2xvchgbIA'
    'EoCVIJaW5mb0NvbG9yEjIKFWluZm9fZm9yZWdyb3VuZF9jb2xvchgcIAEoCVITaW5mb0ZvcmVn'
    'cm91bmRDb2xvchIxChVpY29uX2ltYWdlX3VwZGF0ZWRfYXQYHiABKAlSEmljb25JbWFnZVVwZG'
    'F0ZWRBdBJUChNpY29uX2ltYWdlX3ZhcmlhbnRzGB8gAygLMiQucHVibGlyYS50eXBlcy52MS5U'
    'ZW5hbnRJbWFnZVZhcmlhbnRSEWljb25JbWFnZVZhcmlhbnRzEjEKFWxvZ29faW1hZ2VfdXBkYX'
    'RlZF9hdBggIAEoCVISbG9nb0ltYWdlVXBkYXRlZEF0ElQKE2xvZ29faW1hZ2VfdmFyaWFudHMY'
    'ISADKAsyJC5wdWJsaXJhLnR5cGVzLnYxLlRlbmFudEltYWdlVmFyaWFudFIRbG9nb0ltYWdlVm'
    'FyaWFudHMSKgoRc2VyaWZfZm9udF9mYW1pbHkYIiABKAlSD3NlcmlmRm9udEZhbWlseRIoChBz'
    'YW5zX2ZvbnRfZmFtaWx5GCMgASgJUg5zYW5zRm9udEZhbWlseUoECAQQBUoECB0QHlIIbG9nb1'
    '91cmxSCGljb25fdXJs');

@$core.Deprecated('Use pageDescriptor instead')
const Page$json = {
  '1': 'Page',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'slug', '3': 2, '4': 1, '5': 9, '10': 'slug'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {
      '1': 'published_version_id',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'publishedVersionId'
    },
    {'1': 'created_at', '3': 5, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'updated_at', '3': 6, '4': 1, '5': 9, '10': 'updatedAt'},
    {'1': 'display_in_footer', '3': 7, '4': 1, '5': 8, '10': 'displayInFooter'},
    {'1': 'locale', '3': 8, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `Page`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pageDescriptor = $convert.base64Decode(
    'CgRQYWdlEg4KAmlkGAEgASgJUgJpZBISCgRzbHVnGAIgASgJUgRzbHVnEhQKBXRpdGxlGAMgAS'
    'gJUgV0aXRsZRIwChRwdWJsaXNoZWRfdmVyc2lvbl9pZBgEIAEoCVIScHVibGlzaGVkVmVyc2lv'
    'bklkEh0KCmNyZWF0ZWRfYXQYBSABKAlSCWNyZWF0ZWRBdBIdCgp1cGRhdGVkX2F0GAYgASgJUg'
    'l1cGRhdGVkQXQSKgoRZGlzcGxheV9pbl9mb290ZXIYByABKAhSD2Rpc3BsYXlJbkZvb3RlchIW'
    'CgZsb2NhbGUYCCABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use pageVersionDescriptor instead')
const PageVersion$json = {
  '1': 'PageVersion',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'page_id', '3': 2, '4': 1, '5': 9, '10': 'pageId'},
    {'1': 'version_number', '3': 3, '4': 1, '5': 5, '10': 'versionNumber'},
    {'1': 'content_markdown', '3': 4, '4': 1, '5': 9, '10': 'contentMarkdown'},
    {'1': 'author_user_id', '3': 5, '4': 1, '5': 9, '10': 'authorUserId'},
    {'1': 'status', '3': 6, '4': 1, '5': 9, '10': 'status'},
    {'1': 'publish_at', '3': 7, '4': 1, '5': 9, '10': 'publishAt'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'published_at', '3': 9, '4': 1, '5': 9, '10': 'publishedAt'},
    {
      '1': 'agreement_required_at',
      '3': 10,
      '4': 1,
      '5': 9,
      '10': 'agreementRequiredAt'
    },
  ],
};

/// Descriptor for `PageVersion`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List pageVersionDescriptor = $convert.base64Decode(
    'CgtQYWdlVmVyc2lvbhIOCgJpZBgBIAEoCVICaWQSFwoHcGFnZV9pZBgCIAEoCVIGcGFnZUlkEi'
    'UKDnZlcnNpb25fbnVtYmVyGAMgASgFUg12ZXJzaW9uTnVtYmVyEikKEGNvbnRlbnRfbWFya2Rv'
    'd24YBCABKAlSD2NvbnRlbnRNYXJrZG93bhIkCg5hdXRob3JfdXNlcl9pZBgFIAEoCVIMYXV0aG'
    '9yVXNlcklkEhYKBnN0YXR1cxgGIAEoCVIGc3RhdHVzEh0KCnB1Ymxpc2hfYXQYByABKAlSCXB1'
    'Ymxpc2hBdBIdCgpjcmVhdGVkX2F0GAggASgJUgljcmVhdGVkQXQSIQoMcHVibGlzaGVkX2F0GA'
    'kgASgJUgtwdWJsaXNoZWRBdBIyChVhZ3JlZW1lbnRfcmVxdWlyZWRfYXQYCiABKAlSE2FncmVl'
    'bWVudFJlcXVpcmVkQXQ=');

@$core.Deprecated('Use volumeDescriptor instead')
const Volume$json = {
  '1': 'Volume',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'order_index', '3': 4, '4': 1, '5': 5, '10': 'orderIndex'},
    {'1': 'price', '3': 5, '4': 1, '5': 5, '10': 'price'},
    {'1': 'episode_ids', '3': 6, '4': 3, '5': 9, '10': 'episodeIds'},
    {
      '1': 'cover_image_updated_at',
      '3': 7,
      '4': 1,
      '5': 9,
      '10': 'coverImageUpdatedAt'
    },
    {
      '1': 'cover_image_variants',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.SeriesEyeCatchVariant',
      '10': 'coverImageVariants'
    },
  ],
};

/// Descriptor for `Volume`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List volumeDescriptor = $convert.base64Decode(
    'CgZWb2x1bWUSDgoCaWQYASABKAlSAmlkEhsKCXB1YmxpY19pZBgCIAEoCVIIcHVibGljSWQSFA'
    'oFdGl0bGUYAyABKAlSBXRpdGxlEh8KC29yZGVyX2luZGV4GAQgASgFUgpvcmRlckluZGV4EhQK'
    'BXByaWNlGAUgASgFUgVwcmljZRIfCgtlcGlzb2RlX2lkcxgGIAMoCVIKZXBpc29kZUlkcxIzCh'
    'Zjb3Zlcl9pbWFnZV91cGRhdGVkX2F0GAcgASgJUhNjb3ZlckltYWdlVXBkYXRlZEF0ElkKFGNv'
    'dmVyX2ltYWdlX3ZhcmlhbnRzGAggAygLMicucHVibGlyYS50eXBlcy52MS5TZXJpZXNFeWVDYX'
    'RjaFZhcmlhbnRSEmNvdmVySW1hZ2VWYXJpYW50cw==');

@$core.Deprecated('Use readerIconPresetDescriptor instead')
const ReaderIconPreset$json = {
  '1': 'ReaderIconPreset',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'created_at', '3': 2, '4': 1, '5': 9, '10': 'createdAt'},
    {
      '1': 'variants',
      '3': 3,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.UserIconVariant',
      '10': 'variants'
    },
  ],
};

/// Descriptor for `ReaderIconPreset`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List readerIconPresetDescriptor = $convert.base64Decode(
    'ChBSZWFkZXJJY29uUHJlc2V0Eg4KAmlkGAEgASgJUgJpZBIdCgpjcmVhdGVkX2F0GAIgASgJUg'
    'ljcmVhdGVkQXQSPQoIdmFyaWFudHMYAyADKAsyIS5wdWJsaXJhLnR5cGVzLnYxLlVzZXJJY29u'
    'VmFyaWFudFIIdmFyaWFudHM=');
