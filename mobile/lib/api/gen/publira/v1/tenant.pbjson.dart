// This is a generated file - do not edit.
//
// Generated from publira/v1/tenant.proto.

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

@$core.Deprecated('Use getTenantRequestDescriptor instead')
const GetTenantRequest$json = {
  '1': 'GetTenantRequest',
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

/// Descriptor for `GetTenantRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantRequestDescriptor = $convert.base64Decode(
    'ChBHZXRUZW5hbnRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudjEuVG'
    'VuYW50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use getTenantLegalPagesRequestDescriptor instead')
const GetTenantLegalPagesRequest$json = {
  '1': 'GetTenantLegalPagesRequest',
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

/// Descriptor for `GetTenantLegalPagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantLegalPagesRequestDescriptor =
    $convert.base64Decode(
        'ChpHZXRUZW5hbnRMZWdhbFBhZ2VzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
        'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIWCgZsb2NhbGUYAiABKAlSBmxvY2FsZQ==');

@$core.Deprecated('Use tenantLegalPageDescriptor instead')
const TenantLegalPage$json = {
  '1': 'TenantLegalPage',
  '2': [
    {'1': 'slug', '3': 1, '4': 1, '5': 9, '10': 'slug'},
    {'1': 'title', '3': 2, '4': 1, '5': 9, '10': 'title'},
    {'1': 'version_id', '3': 3, '4': 1, '5': 9, '10': 'versionId'},
    {'1': 'locale', '3': 4, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `TenantLegalPage`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantLegalPageDescriptor = $convert.base64Decode(
    'Cg9UZW5hbnRMZWdhbFBhZ2USEgoEc2x1ZxgBIAEoCVIEc2x1ZxIUCgV0aXRsZRgCIAEoCVIFdG'
    'l0bGUSHQoKdmVyc2lvbl9pZBgDIAEoCVIJdmVyc2lvbklkEhYKBmxvY2FsZRgEIAEoCVIGbG9j'
    'YWxl');

@$core.Deprecated('Use getTenantLegalPagesResponseDescriptor instead')
const GetTenantLegalPagesResponse$json = {
  '1': 'GetTenantLegalPagesResponse',
  '2': [
    {
      '1': 'terms_page',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantLegalPage',
      '10': 'termsPage'
    },
    {
      '1': 'privacy_page',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantLegalPage',
      '10': 'privacyPage'
    },
  ],
};

/// Descriptor for `GetTenantLegalPagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantLegalPagesResponseDescriptor =
    $convert.base64Decode(
        'ChtHZXRUZW5hbnRMZWdhbFBhZ2VzUmVzcG9uc2USOgoKdGVybXNfcGFnZRgBIAEoCzIbLnB1Ym'
        'xpcmEudjEuVGVuYW50TGVnYWxQYWdlUgl0ZXJtc1BhZ2USPgoMcHJpdmFjeV9wYWdlGAIgASgL'
        'MhsucHVibGlyYS52MS5UZW5hbnRMZWdhbFBhZ2VSC3ByaXZhY3lQYWdl');

@$core.Deprecated('Use getTenantResponseDescriptor instead')
const GetTenantResponse$json = {
  '1': 'GetTenantResponse',
  '2': [
    {'1': 'tenant_public_id', '3': 1, '4': 1, '5': 9, '10': 'tenantPublicId'},
    {'1': 'tenant_name', '3': 2, '4': 1, '5': 9, '10': 'tenantName'},
    {'1': 'tenant_domain', '3': 3, '4': 1, '5': 9, '10': 'tenantDomain'},
    {'1': 'copyright_text', '3': 4, '4': 1, '5': 9, '10': 'copyrightText'},
    {'1': 'site_description', '3': 5, '4': 1, '5': 9, '10': 'siteDescription'},
    {'1': 'site_tagline', '3': 6, '4': 1, '5': 9, '10': 'siteTagline'},
    {
      '1': 'theme',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantTheme',
      '10': 'theme'
    },
    {'1': 'timezone', '3': 8, '4': 1, '5': 9, '10': 'timezone'},
    {'1': 'default_locale', '3': 9, '4': 1, '5': 9, '10': 'defaultLocale'},
    {'1': 'accepts_payments', '3': 10, '4': 1, '5': 8, '10': 'acceptsPayments'},
    {
      '1': 'comment_mode',
      '3': 11,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.CommentMode',
      '10': 'commentMode'
    },
    {
      '1': 'age_verification',
      '3': 12,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.AgeVerification',
      '10': 'ageVerification'
    },
    {
      '1': 'web_push_vapid_public_key',
      '3': 13,
      '4': 1,
      '5': 9,
      '10': 'webPushVapidPublicKey'
    },
    {'1': 'app_store_url', '3': 14, '4': 1, '5': 9, '10': 'appStoreUrl'},
    {'1': 'google_play_url', '3': 15, '4': 1, '5': 9, '10': 'googlePlayUrl'},
    {
      '1': 'app_purchase_route',
      '3': 18,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.AppPurchaseRoute',
      '10': 'appPurchaseRoute'
    },
    {
      '1': 'accepts_app_store_payments',
      '3': 19,
      '4': 1,
      '5': 8,
      '10': 'acceptsAppStorePayments'
    },
    {
      '1': 'accepts_google_play_payments',
      '3': 20,
      '4': 1,
      '5': 8,
      '10': 'acceptsGooglePlayPayments'
    },
    {
      '1': 'apple_sign_in',
      '3': 21,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantAppleSignIn',
      '10': 'appleSignIn'
    },
    {
      '1': 'google_sign_in',
      '3': 22,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantGoogleSignIn',
      '10': 'googleSignIn'
    },
    {'1': 'currency', '3': 23, '4': 1, '5': 9, '10': 'currency'},
    {
      '1': 'supported_locales',
      '3': 24,
      '4': 3,
      '5': 9,
      '10': 'supportedLocales'
    },
  ],
  '9': [
    {'1': 16, '2': 17},
    {'1': 17, '2': 18},
  ],
  '10': ['terms_page', 'privacy_page'],
};

/// Descriptor for `GetTenantResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantResponseDescriptor = $convert.base64Decode(
    'ChFHZXRUZW5hbnRSZXNwb25zZRIoChB0ZW5hbnRfcHVibGljX2lkGAEgASgJUg50ZW5hbnRQdW'
    'JsaWNJZBIfCgt0ZW5hbnRfbmFtZRgCIAEoCVIKdGVuYW50TmFtZRIjCg10ZW5hbnRfZG9tYWlu'
    'GAMgASgJUgx0ZW5hbnREb21haW4SJQoOY29weXJpZ2h0X3RleHQYBCABKAlSDWNvcHlyaWdodF'
    'RleHQSKQoQc2l0ZV9kZXNjcmlwdGlvbhgFIAEoCVIPc2l0ZURlc2NyaXB0aW9uEiEKDHNpdGVf'
    'dGFnbGluZRgGIAEoCVILc2l0ZVRhZ2xpbmUSMwoFdGhlbWUYByABKAsyHS5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudFRoZW1lUgV0aGVtZRIaCgh0aW1lem9uZRgIIAEoCVIIdGltZXpvbmUSJQoO'
    'ZGVmYXVsdF9sb2NhbGUYCSABKAlSDWRlZmF1bHRMb2NhbGUSKQoQYWNjZXB0c19wYXltZW50cx'
    'gKIAEoCFIPYWNjZXB0c1BheW1lbnRzEkAKDGNvbW1lbnRfbW9kZRgLIAEoDjIdLnB1YmxpcmEu'
    'dHlwZXMudjEuQ29tbWVudE1vZGVSC2NvbW1lbnRNb2RlEkwKEGFnZV92ZXJpZmljYXRpb24YDC'
    'ABKA4yIS5wdWJsaXJhLnR5cGVzLnYxLkFnZVZlcmlmaWNhdGlvblIPYWdlVmVyaWZpY2F0aW9u'
    'EjgKGXdlYl9wdXNoX3ZhcGlkX3B1YmxpY19rZXkYDSABKAlSFXdlYlB1c2hWYXBpZFB1YmxpY0'
    'tleRIiCg1hcHBfc3RvcmVfdXJsGA4gASgJUgthcHBTdG9yZVVybBImCg9nb29nbGVfcGxheV91'
    'cmwYDyABKAlSDWdvb2dsZVBsYXlVcmwSUAoSYXBwX3B1cmNoYXNlX3JvdXRlGBIgASgOMiIucH'
    'VibGlyYS50eXBlcy52MS5BcHBQdXJjaGFzZVJvdXRlUhBhcHBQdXJjaGFzZVJvdXRlEjsKGmFj'
    'Y2VwdHNfYXBwX3N0b3JlX3BheW1lbnRzGBMgASgIUhdhY2NlcHRzQXBwU3RvcmVQYXltZW50cx'
    'I/ChxhY2NlcHRzX2dvb2dsZV9wbGF5X3BheW1lbnRzGBQgASgIUhlhY2NlcHRzR29vZ2xlUGxh'
    'eVBheW1lbnRzEkEKDWFwcGxlX3NpZ25faW4YFSABKAsyHS5wdWJsaXJhLnYxLlRlbmFudEFwcG'
    'xlU2lnbkluUgthcHBsZVNpZ25JbhJECg5nb29nbGVfc2lnbl9pbhgWIAEoCzIeLnB1YmxpcmEu'
    'djEuVGVuYW50R29vZ2xlU2lnbkluUgxnb29nbGVTaWduSW4SGgoIY3VycmVuY3kYFyABKAlSCG'
    'N1cnJlbmN5EisKEXN1cHBvcnRlZF9sb2NhbGVzGBggAygJUhBzdXBwb3J0ZWRMb2NhbGVzSgQI'
    'EBARSgQIERASUgp0ZXJtc19wYWdlUgxwcml2YWN5X3BhZ2U=');

@$core.Deprecated('Use tenantAppleSignInDescriptor instead')
const TenantAppleSignIn$json = {
  '1': 'TenantAppleSignIn',
  '2': [
    {'1': 'services_id', '3': 1, '4': 1, '5': 9, '10': 'servicesId'},
  ],
};

/// Descriptor for `TenantAppleSignIn`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantAppleSignInDescriptor = $convert.base64Decode(
    'ChFUZW5hbnRBcHBsZVNpZ25JbhIfCgtzZXJ2aWNlc19pZBgBIAEoCVIKc2VydmljZXNJZA==');

@$core.Deprecated('Use tenantGoogleSignInDescriptor instead')
const TenantGoogleSignIn$json = {
  '1': 'TenantGoogleSignIn',
  '2': [
    {'1': 'web_client_id', '3': 1, '4': 1, '5': 9, '10': 'webClientId'},
    {'1': 'ios_client_id', '3': 2, '4': 1, '5': 9, '10': 'iosClientId'},
  ],
};

/// Descriptor for `TenantGoogleSignIn`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantGoogleSignInDescriptor = $convert.base64Decode(
    'ChJUZW5hbnRHb29nbGVTaWduSW4SIgoNd2ViX2NsaWVudF9pZBgBIAEoCVILd2ViQ2xpZW50SW'
    'QSIgoNaW9zX2NsaWVudF9pZBgCIAEoCVILaW9zQ2xpZW50SWQ=');

@$core.Deprecated('Use getTenantMobileAppAssociationRequestDescriptor instead')
const GetTenantMobileAppAssociationRequest$json = {
  '1': 'GetTenantMobileAppAssociationRequest',
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

/// Descriptor for `GetTenantMobileAppAssociationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantMobileAppAssociationRequestDescriptor =
    $convert.base64Decode(
        'CiRHZXRUZW5hbnRNb2JpbGVBcHBBc3NvY2lhdGlvblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh'
        '8ucHVibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use tenantAndroidAppAssociationDescriptor instead')
const TenantAndroidAppAssociation$json = {
  '1': 'TenantAndroidAppAssociation',
  '2': [
    {'1': 'application_id', '3': 1, '4': 1, '5': 9, '10': 'applicationId'},
    {
      '1': 'sha256_cert_fingerprints',
      '3': 2,
      '4': 3,
      '5': 9,
      '10': 'sha256CertFingerprints'
    },
  ],
};

/// Descriptor for `TenantAndroidAppAssociation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantAndroidAppAssociationDescriptor =
    $convert.base64Decode(
        'ChtUZW5hbnRBbmRyb2lkQXBwQXNzb2NpYXRpb24SJQoOYXBwbGljYXRpb25faWQYASABKAlSDW'
        'FwcGxpY2F0aW9uSWQSOAoYc2hhMjU2X2NlcnRfZmluZ2VycHJpbnRzGAIgAygJUhZzaGEyNTZD'
        'ZXJ0RmluZ2VycHJpbnRz');

@$core.Deprecated('Use tenantIosAppAssociationDescriptor instead')
const TenantIosAppAssociation$json = {
  '1': 'TenantIosAppAssociation',
  '2': [
    {'1': 'team_id', '3': 1, '4': 1, '5': 9, '10': 'teamId'},
    {
      '1': 'bundle_identifier',
      '3': 2,
      '4': 1,
      '5': 9,
      '10': 'bundleIdentifier'
    },
  ],
};

/// Descriptor for `TenantIosAppAssociation`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List tenantIosAppAssociationDescriptor =
    $convert.base64Decode(
        'ChdUZW5hbnRJb3NBcHBBc3NvY2lhdGlvbhIXCgd0ZWFtX2lkGAEgASgJUgZ0ZWFtSWQSKwoRYn'
        'VuZGxlX2lkZW50aWZpZXIYAiABKAlSEGJ1bmRsZUlkZW50aWZpZXI=');

@$core.Deprecated('Use getTenantMobileAppAssociationResponseDescriptor instead')
const GetTenantMobileAppAssociationResponse$json = {
  '1': 'GetTenantMobileAppAssociationResponse',
  '2': [
    {
      '1': 'android',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantAndroidAppAssociation',
      '10': 'android'
    },
    {
      '1': 'ios',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.TenantIosAppAssociation',
      '10': 'ios'
    },
  ],
};

/// Descriptor for `GetTenantMobileAppAssociationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantMobileAppAssociationResponseDescriptor =
    $convert.base64Decode(
        'CiVHZXRUZW5hbnRNb2JpbGVBcHBBc3NvY2lhdGlvblJlc3BvbnNlEkEKB2FuZHJvaWQYASABKA'
        'syJy5wdWJsaXJhLnYxLlRlbmFudEFuZHJvaWRBcHBBc3NvY2lhdGlvblIHYW5kcm9pZBI1CgNp'
        'b3MYAiABKAsyIy5wdWJsaXJhLnYxLlRlbmFudElvc0FwcEFzc29jaWF0aW9uUgNpb3M=');

const $core.Map<$core.String, $core.dynamic> TenantServiceBase$json = {
  '1': 'TenantService',
  '2': [
    {
      '1': 'GetTenant',
      '2': '.publira.v1.GetTenantRequest',
      '3': '.publira.v1.GetTenantResponse'
    },
    {
      '1': 'GetTenantLegalPages',
      '2': '.publira.v1.GetTenantLegalPagesRequest',
      '3': '.publira.v1.GetTenantLegalPagesResponse'
    },
    {
      '1': 'GetTenantMobileAppAssociation',
      '2': '.publira.v1.GetTenantMobileAppAssociationRequest',
      '3': '.publira.v1.GetTenantMobileAppAssociationResponse'
    },
  ],
};

@$core.Deprecated('Use tenantServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    TenantServiceBase$messageJson = {
  '.publira.v1.GetTenantRequest': GetTenantRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.GetTenantResponse': GetTenantResponse$json,
  '.publira.types.v1.TenantTheme': $0.TenantTheme$json,
  '.publira.types.v1.TenantImageVariant': $0.TenantImageVariant$json,
  '.publira.v1.TenantAppleSignIn': TenantAppleSignIn$json,
  '.publira.v1.TenantGoogleSignIn': TenantGoogleSignIn$json,
  '.publira.v1.GetTenantLegalPagesRequest': GetTenantLegalPagesRequest$json,
  '.publira.v1.GetTenantLegalPagesResponse': GetTenantLegalPagesResponse$json,
  '.publira.v1.TenantLegalPage': TenantLegalPage$json,
  '.publira.v1.GetTenantMobileAppAssociationRequest':
      GetTenantMobileAppAssociationRequest$json,
  '.publira.v1.GetTenantMobileAppAssociationResponse':
      GetTenantMobileAppAssociationResponse$json,
  '.publira.v1.TenantAndroidAppAssociation': TenantAndroidAppAssociation$json,
  '.publira.v1.TenantIosAppAssociation': TenantIosAppAssociation$json,
};

/// Descriptor for `TenantService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List tenantServiceDescriptor = $convert.base64Decode(
    'Cg1UZW5hbnRTZXJ2aWNlEkgKCUdldFRlbmFudBIcLnB1YmxpcmEudjEuR2V0VGVuYW50UmVxdW'
    'VzdBodLnB1YmxpcmEudjEuR2V0VGVuYW50UmVzcG9uc2USZgoTR2V0VGVuYW50TGVnYWxQYWdl'
    'cxImLnB1YmxpcmEudjEuR2V0VGVuYW50TGVnYWxQYWdlc1JlcXVlc3QaJy5wdWJsaXJhLnYxLk'
    'dldFRlbmFudExlZ2FsUGFnZXNSZXNwb25zZRKEAQodR2V0VGVuYW50TW9iaWxlQXBwQXNzb2Np'
    'YXRpb24SMC5wdWJsaXJhLnYxLkdldFRlbmFudE1vYmlsZUFwcEFzc29jaWF0aW9uUmVxdWVzdB'
    'oxLnB1YmxpcmEudjEuR2V0VGVuYW50TW9iaWxlQXBwQXNzb2NpYXRpb25SZXNwb25zZQ==');
