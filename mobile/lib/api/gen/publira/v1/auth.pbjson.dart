// This is a generated file - do not edit.
//
// Generated from publira/v1/auth.proto.

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
import 'tenant.pbjson.dart' as $1;

@$core.Deprecated('Use identityProviderDescriptor instead')
const IdentityProvider$json = {
  '1': 'IdentityProvider',
  '2': [
    {'1': 'IDENTITY_PROVIDER_UNSPECIFIED', '2': 0},
    {'1': 'IDENTITY_PROVIDER_APPLE', '2': 1},
    {'1': 'IDENTITY_PROVIDER_GOOGLE', '2': 2},
  ],
};

/// Descriptor for `IdentityProvider`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List identityProviderDescriptor = $convert.base64Decode(
    'ChBJZGVudGl0eVByb3ZpZGVyEiEKHUlERU5USVRZX1BST1ZJREVSX1VOU1BFQ0lGSUVEEAASGw'
    'oXSURFTlRJVFlfUFJPVklERVJfQVBQTEUQARIcChhJREVOVElUWV9QUk9WSURFUl9HT09HTEUQ'
    'Ag==');

@$core.Deprecated('Use loginRequestDescriptor instead')
const LoginRequest$json = {
  '1': 'LoginRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'email', '3': 2, '4': 1, '5': 9, '10': 'email'},
    {'1': 'password', '3': 3, '4': 1, '5': 9, '10': 'password'},
  ],
};

/// Descriptor for `LoginRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginRequestDescriptor = $convert.base64Decode(
    'CgxMb2dpblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS5UZW5hbn'
    'RDb250ZXh0UgZ0ZW5hbnQSFAoFZW1haWwYAiABKAlSBWVtYWlsEhoKCHBhc3N3b3JkGAMgASgJ'
    'UghwYXNzd29yZA==');

@$core.Deprecated('Use loginResponseDescriptor instead')
const LoginResponse$json = {
  '1': 'LoginResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
    {
      '1': 'access_token',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.AccessToken',
      '10': 'accessToken'
    },
  ],
};

/// Descriptor for `LoginResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginResponseDescriptor = $convert.base64Decode(
    'Cg1Mb2dpblJlc3BvbnNlEioKBHVzZXIYASABKAsyFi5wdWJsaXJhLnR5cGVzLnYxLlVzZXJSBH'
    'VzZXISQAoMYWNjZXNzX3Rva2VuGAIgASgLMh0ucHVibGlyYS50eXBlcy52MS5BY2Nlc3NUb2tl'
    'blILYWNjZXNzVG9rZW4=');

@$core.Deprecated('Use loginWithIdTokenRequestDescriptor instead')
const LoginWithIdTokenRequest$json = {
  '1': 'LoginWithIdTokenRequest',
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
      '1': 'provider',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
    {'1': 'id_token', '3': 3, '4': 1, '5': 9, '10': 'idToken'},
    {'1': 'nonce', '3': 4, '4': 1, '5': 9, '10': 'nonce'},
    {
      '1': 'authorization_code',
      '3': 5,
      '4': 1,
      '5': 9,
      '10': 'authorizationCode'
    },
    {'1': 'redirect_uri', '3': 6, '4': 1, '5': 9, '10': 'redirectUri'},
    {'1': 'name', '3': 7, '4': 1, '5': 9, '10': 'name'},
    {
      '1': 'agreed_page_version_ids',
      '3': 8,
      '4': 3,
      '5': 9,
      '10': 'agreedPageVersionIds'
    },
    {'1': 'birth_date', '3': 9, '4': 1, '5': 9, '10': 'birthDate'},
  ],
};

/// Descriptor for `LoginWithIdTokenRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginWithIdTokenRequestDescriptor = $convert.base64Decode(
    'ChdMb2dpbldpdGhJZFRva2VuUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBI4Cghwcm92aWRlchgCIAEoDjIcLnB1YmxpcmEu'
    'djEuSWRlbnRpdHlQcm92aWRlclIIcHJvdmlkZXISGQoIaWRfdG9rZW4YAyABKAlSB2lkVG9rZW'
    '4SFAoFbm9uY2UYBCABKAlSBW5vbmNlEi0KEmF1dGhvcml6YXRpb25fY29kZRgFIAEoCVIRYXV0'
    'aG9yaXphdGlvbkNvZGUSIQoMcmVkaXJlY3RfdXJpGAYgASgJUgtyZWRpcmVjdFVyaRISCgRuYW'
    '1lGAcgASgJUgRuYW1lEjUKF2FncmVlZF9wYWdlX3ZlcnNpb25faWRzGAggAygJUhRhZ3JlZWRQ'
    'YWdlVmVyc2lvbklkcxIdCgpiaXJ0aF9kYXRlGAkgASgJUgliaXJ0aERhdGU=');

@$core.Deprecated('Use loginWithIdTokenResponseDescriptor instead')
const LoginWithIdTokenResponse$json = {
  '1': 'LoginWithIdTokenResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
    {
      '1': 'access_token',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.AccessToken',
      '10': 'accessToken'
    },
    {'1': 'account_created', '3': 3, '4': 1, '5': 8, '10': 'accountCreated'},
  ],
};

/// Descriptor for `LoginWithIdTokenResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List loginWithIdTokenResponseDescriptor = $convert.base64Decode(
    'ChhMb2dpbldpdGhJZFRva2VuUmVzcG9uc2USKgoEdXNlchgBIAEoCzIWLnB1YmxpcmEudHlwZX'
    'MudjEuVXNlclIEdXNlchJACgxhY2Nlc3NfdG9rZW4YAiABKAsyHS5wdWJsaXJhLnR5cGVzLnYx'
    'LkFjY2Vzc1Rva2VuUgthY2Nlc3NUb2tlbhInCg9hY2NvdW50X2NyZWF0ZWQYAyABKAhSDmFjY2'
    '91bnRDcmVhdGVk');

@$core.Deprecated('Use linkedIdentityDescriptor instead')
const LinkedIdentity$json = {
  '1': 'LinkedIdentity',
  '2': [
    {
      '1': 'provider',
      '3': 1,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
    {'1': 'email', '3': 2, '4': 1, '5': 9, '10': 'email'},
    {'1': 'linked_at', '3': 3, '4': 1, '5': 9, '10': 'linkedAt'},
  ],
};

/// Descriptor for `LinkedIdentity`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List linkedIdentityDescriptor = $convert.base64Decode(
    'Cg5MaW5rZWRJZGVudGl0eRI4Cghwcm92aWRlchgBIAEoDjIcLnB1YmxpcmEudjEuSWRlbnRpdH'
    'lQcm92aWRlclIIcHJvdmlkZXISFAoFZW1haWwYAiABKAlSBWVtYWlsEhsKCWxpbmtlZF9hdBgD'
    'IAEoCVIIbGlua2VkQXQ=');

@$core.Deprecated('Use listMyIdentitiesRequestDescriptor instead')
const ListMyIdentitiesRequest$json = {
  '1': 'ListMyIdentitiesRequest',
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

/// Descriptor for `ListMyIdentitiesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyIdentitiesRequestDescriptor =
    $convert.base64Decode(
        'ChdMaXN0TXlJZGVudGl0aWVzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
        'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudA==');

@$core.Deprecated('Use listMyIdentitiesResponseDescriptor instead')
const ListMyIdentitiesResponse$json = {
  '1': 'ListMyIdentitiesResponse',
  '2': [
    {
      '1': 'identities',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.LinkedIdentity',
      '10': 'identities'
    },
    {'1': 'has_password', '3': 2, '4': 1, '5': 8, '10': 'hasPassword'},
    {'1': 'has_passkey', '3': 3, '4': 1, '5': 8, '10': 'hasPasskey'},
  ],
};

/// Descriptor for `ListMyIdentitiesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyIdentitiesResponseDescriptor = $convert.base64Decode(
    'ChhMaXN0TXlJZGVudGl0aWVzUmVzcG9uc2USOgoKaWRlbnRpdGllcxgBIAMoCzIaLnB1Ymxpcm'
    'EudjEuTGlua2VkSWRlbnRpdHlSCmlkZW50aXRpZXMSIQoMaGFzX3Bhc3N3b3JkGAIgASgIUgto'
    'YXNQYXNzd29yZBIfCgtoYXNfcGFzc2tleRgDIAEoCFIKaGFzUGFzc2tleQ==');

@$core.Deprecated('Use unlinkIdentityRequestDescriptor instead')
const UnlinkIdentityRequest$json = {
  '1': 'UnlinkIdentityRequest',
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
      '1': 'provider',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
  ],
};

/// Descriptor for `UnlinkIdentityRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlinkIdentityRequestDescriptor = $convert.base64Decode(
    'ChVVbmxpbmtJZGVudGl0eVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy'
    '52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSOAoIcHJvdmlkZXIYAiABKA4yHC5wdWJsaXJhLnYx'
    'LklkZW50aXR5UHJvdmlkZXJSCHByb3ZpZGVy');

@$core.Deprecated('Use unlinkIdentityResponseDescriptor instead')
const UnlinkIdentityResponse$json = {
  '1': 'UnlinkIdentityResponse',
};

/// Descriptor for `UnlinkIdentityResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List unlinkIdentityResponseDescriptor =
    $convert.base64Decode('ChZVbmxpbmtJZGVudGl0eVJlc3BvbnNl');

@$core.Deprecated('Use linkIdentityRequestDescriptor instead')
const LinkIdentityRequest$json = {
  '1': 'LinkIdentityRequest',
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
      '1': 'provider',
      '3': 2,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
    {'1': 'id_token', '3': 3, '4': 1, '5': 9, '10': 'idToken'},
    {'1': 'nonce', '3': 4, '4': 1, '5': 9, '10': 'nonce'},
    {
      '1': 'authorization_code',
      '3': 5,
      '4': 1,
      '5': 9,
      '10': 'authorizationCode'
    },
    {'1': 'redirect_uri', '3': 6, '4': 1, '5': 9, '10': 'redirectUri'},
  ],
};

/// Descriptor for `LinkIdentityRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List linkIdentityRequestDescriptor = $convert.base64Decode(
    'ChNMaW5rSWRlbnRpdHlSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudj'
    'EuVGVuYW50Q29udGV4dFIGdGVuYW50EjgKCHByb3ZpZGVyGAIgASgOMhwucHVibGlyYS52MS5J'
    'ZGVudGl0eVByb3ZpZGVyUghwcm92aWRlchIZCghpZF90b2tlbhgDIAEoCVIHaWRUb2tlbhIUCg'
    'Vub25jZRgEIAEoCVIFbm9uY2USLQoSYXV0aG9yaXphdGlvbl9jb2RlGAUgASgJUhFhdXRob3Jp'
    'emF0aW9uQ29kZRIhCgxyZWRpcmVjdF91cmkYBiABKAlSC3JlZGlyZWN0VXJp');

@$core.Deprecated('Use linkIdentityResponseDescriptor instead')
const LinkIdentityResponse$json = {
  '1': 'LinkIdentityResponse',
  '2': [
    {
      '1': 'identity',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.LinkedIdentity',
      '10': 'identity'
    },
  ],
};

/// Descriptor for `LinkIdentityResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List linkIdentityResponseDescriptor = $convert.base64Decode(
    'ChRMaW5rSWRlbnRpdHlSZXNwb25zZRI2CghpZGVudGl0eRgBIAEoCzIaLnB1YmxpcmEudjEuTG'
    'lua2VkSWRlbnRpdHlSCGlkZW50aXR5');

@$core.Deprecated('Use passkeyDescriptor instead')
const Passkey$json = {
  '1': 'Passkey',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'created_at', '3': 3, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'last_used_at', '3': 4, '4': 1, '5': 9, '10': 'lastUsedAt'},
    {'1': 'backed_up', '3': 5, '4': 1, '5': 8, '10': 'backedUp'},
  ],
};

/// Descriptor for `Passkey`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List passkeyDescriptor = $convert.base64Decode(
    'CgdQYXNza2V5Eg4KAmlkGAEgASgJUgJpZBISCgRuYW1lGAIgASgJUgRuYW1lEh0KCmNyZWF0ZW'
    'RfYXQYAyABKAlSCWNyZWF0ZWRBdBIgCgxsYXN0X3VzZWRfYXQYBCABKAlSCmxhc3RVc2VkQXQS'
    'GwoJYmFja2VkX3VwGAUgASgIUghiYWNrZWRVcA==');

@$core.Deprecated('Use beginPasskeyLoginRequestDescriptor instead')
const BeginPasskeyLoginRequest$json = {
  '1': 'BeginPasskeyLoginRequest',
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

/// Descriptor for `BeginPasskeyLoginRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyLoginRequestDescriptor =
    $convert.base64Decode(
        'ChhCZWdpblBhc3NrZXlMb2dpblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
        'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use beginPasskeyLoginResponseDescriptor instead')
const BeginPasskeyLoginResponse$json = {
  '1': 'BeginPasskeyLoginResponse',
  '2': [
    {
      '1': 'request_options_json',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'requestOptionsJson'
    },
  ],
};

/// Descriptor for `BeginPasskeyLoginResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyLoginResponseDescriptor =
    $convert.base64Decode(
        'ChlCZWdpblBhc3NrZXlMb2dpblJlc3BvbnNlEjAKFHJlcXVlc3Rfb3B0aW9uc19qc29uGAEgAS'
        'gJUhJyZXF1ZXN0T3B0aW9uc0pzb24=');

@$core.Deprecated('Use finishPasskeyLoginRequestDescriptor instead')
const FinishPasskeyLoginRequest$json = {
  '1': 'FinishPasskeyLoginRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'credential_json', '3': 2, '4': 1, '5': 9, '10': 'credentialJson'},
  ],
};

/// Descriptor for `FinishPasskeyLoginRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List finishPasskeyLoginRequestDescriptor = $convert.base64Decode(
    'ChlGaW5pc2hQYXNza2V5TG9naW5SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EicKD2NyZWRlbnRpYWxfanNvbhgCIAEoCVIO'
    'Y3JlZGVudGlhbEpzb24=');

@$core.Deprecated('Use finishPasskeyLoginResponseDescriptor instead')
const FinishPasskeyLoginResponse$json = {
  '1': 'FinishPasskeyLoginResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
    {
      '1': 'access_token',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.AccessToken',
      '10': 'accessToken'
    },
  ],
};

/// Descriptor for `FinishPasskeyLoginResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List finishPasskeyLoginResponseDescriptor =
    $convert.base64Decode(
        'ChpGaW5pc2hQYXNza2V5TG9naW5SZXNwb25zZRIqCgR1c2VyGAEgASgLMhYucHVibGlyYS50eX'
        'Blcy52MS5Vc2VyUgR1c2VyEkAKDGFjY2Vzc190b2tlbhgCIAEoCzIdLnB1YmxpcmEudHlwZXMu'
        'djEuQWNjZXNzVG9rZW5SC2FjY2Vzc1Rva2Vu');

@$core.Deprecated('Use beginPasskeyRegistrationRequestDescriptor instead')
const BeginPasskeyRegistrationRequest$json = {
  '1': 'BeginPasskeyRegistrationRequest',
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

/// Descriptor for `BeginPasskeyRegistrationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyRegistrationRequestDescriptor =
    $convert.base64Decode(
        'Ch9CZWdpblBhc3NrZXlSZWdpc3RyYXRpb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use beginPasskeyRegistrationResponseDescriptor instead')
const BeginPasskeyRegistrationResponse$json = {
  '1': 'BeginPasskeyRegistrationResponse',
  '2': [
    {
      '1': 'creation_options_json',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'creationOptionsJson'
    },
  ],
};

/// Descriptor for `BeginPasskeyRegistrationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyRegistrationResponseDescriptor =
    $convert.base64Decode(
        'CiBCZWdpblBhc3NrZXlSZWdpc3RyYXRpb25SZXNwb25zZRIyChVjcmVhdGlvbl9vcHRpb25zX2'
        'pzb24YASABKAlSE2NyZWF0aW9uT3B0aW9uc0pzb24=');

@$core.Deprecated('Use finishPasskeyRegistrationRequestDescriptor instead')
const FinishPasskeyRegistrationRequest$json = {
  '1': 'FinishPasskeyRegistrationRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'credential_json', '3': 2, '4': 1, '5': 9, '10': 'credentialJson'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
  ],
};

/// Descriptor for `FinishPasskeyRegistrationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List finishPasskeyRegistrationRequestDescriptor =
    $convert.base64Decode(
        'CiBGaW5pc2hQYXNza2V5UmVnaXN0cmF0aW9uUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdW'
        'JsaXJhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBInCg9jcmVkZW50aWFsX2pzb24Y'
        'AiABKAlSDmNyZWRlbnRpYWxKc29uEhIKBG5hbWUYAyABKAlSBG5hbWU=');

@$core.Deprecated('Use finishPasskeyRegistrationResponseDescriptor instead')
const FinishPasskeyRegistrationResponse$json = {
  '1': 'FinishPasskeyRegistrationResponse',
  '2': [
    {
      '1': 'passkey',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.Passkey',
      '10': 'passkey'
    },
  ],
};

/// Descriptor for `FinishPasskeyRegistrationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List finishPasskeyRegistrationResponseDescriptor =
    $convert.base64Decode(
        'CiFGaW5pc2hQYXNza2V5UmVnaXN0cmF0aW9uUmVzcG9uc2USLQoHcGFzc2tleRgBIAEoCzITLn'
        'B1YmxpcmEudjEuUGFzc2tleVIHcGFzc2tleQ==');

@$core.Deprecated('Use listMyPasskeysRequestDescriptor instead')
const ListMyPasskeysRequest$json = {
  '1': 'ListMyPasskeysRequest',
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

/// Descriptor for `ListMyPasskeysRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyPasskeysRequestDescriptor = $convert.base64Decode(
    'ChVMaXN0TXlQYXNza2V5c1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy'
    '52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use listMyPasskeysResponseDescriptor instead')
const ListMyPasskeysResponse$json = {
  '1': 'ListMyPasskeysResponse',
  '2': [
    {
      '1': 'passkeys',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.Passkey',
      '10': 'passkeys'
    },
  ],
};

/// Descriptor for `ListMyPasskeysResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyPasskeysResponseDescriptor =
    $convert.base64Decode(
        'ChZMaXN0TXlQYXNza2V5c1Jlc3BvbnNlEi8KCHBhc3NrZXlzGAEgAygLMhMucHVibGlyYS52MS'
        '5QYXNza2V5UghwYXNza2V5cw==');

@$core.Deprecated('Use renamePasskeyRequestDescriptor instead')
const RenamePasskeyRequest$json = {
  '1': 'RenamePasskeyRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'id', '3': 2, '4': 1, '5': 9, '10': 'id'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
  ],
};

/// Descriptor for `RenamePasskeyRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List renamePasskeyRequestDescriptor = $convert.base64Decode(
    'ChRSZW5hbWVQYXNza2V5UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cGVzLn'
    'YxLlRlbmFudENvbnRleHRSBnRlbmFudBIOCgJpZBgCIAEoCVICaWQSEgoEbmFtZRgDIAEoCVIE'
    'bmFtZQ==');

@$core.Deprecated('Use renamePasskeyResponseDescriptor instead')
const RenamePasskeyResponse$json = {
  '1': 'RenamePasskeyResponse',
  '2': [
    {
      '1': 'passkey',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.Passkey',
      '10': 'passkey'
    },
  ],
};

/// Descriptor for `RenamePasskeyResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List renamePasskeyResponseDescriptor = $convert.base64Decode(
    'ChVSZW5hbWVQYXNza2V5UmVzcG9uc2USLQoHcGFzc2tleRgBIAEoCzITLnB1YmxpcmEudjEuUG'
    'Fzc2tleVIHcGFzc2tleQ==');

@$core.Deprecated('Use deletePasskeyRequestDescriptor instead')
const DeletePasskeyRequest$json = {
  '1': 'DeletePasskeyRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'id', '3': 2, '4': 1, '5': 9, '10': 'id'},
  ],
};

/// Descriptor for `DeletePasskeyRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletePasskeyRequestDescriptor = $convert.base64Decode(
    'ChREZWxldGVQYXNza2V5UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cGVzLn'
    'YxLlRlbmFudENvbnRleHRSBnRlbmFudBIOCgJpZBgCIAEoCVICaWQ=');

@$core.Deprecated('Use deletePasskeyResponseDescriptor instead')
const DeletePasskeyResponse$json = {
  '1': 'DeletePasskeyResponse',
};

/// Descriptor for `DeletePasskeyResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deletePasskeyResponseDescriptor =
    $convert.base64Decode('ChVEZWxldGVQYXNza2V5UmVzcG9uc2U=');

@$core.Deprecated('Use beginPasskeyConfirmationRequestDescriptor instead')
const BeginPasskeyConfirmationRequest$json = {
  '1': 'BeginPasskeyConfirmationRequest',
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

/// Descriptor for `BeginPasskeyConfirmationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyConfirmationRequestDescriptor =
    $convert.base64Decode(
        'Ch9CZWdpblBhc3NrZXlDb25maXJtYXRpb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use beginPasskeyConfirmationResponseDescriptor instead')
const BeginPasskeyConfirmationResponse$json = {
  '1': 'BeginPasskeyConfirmationResponse',
  '2': [
    {
      '1': 'request_options_json',
      '3': 1,
      '4': 1,
      '5': 9,
      '10': 'requestOptionsJson'
    },
  ],
};

/// Descriptor for `BeginPasskeyConfirmationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List beginPasskeyConfirmationResponseDescriptor =
    $convert.base64Decode(
        'CiBCZWdpblBhc3NrZXlDb25maXJtYXRpb25SZXNwb25zZRIwChRyZXF1ZXN0X29wdGlvbnNfan'
        'NvbhgBIAEoCVIScmVxdWVzdE9wdGlvbnNKc29u');

@$core.Deprecated('Use createUserRequestDescriptor instead')
const CreateUserRequest$json = {
  '1': 'CreateUserRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'email', '3': 3, '4': 1, '5': 9, '10': 'email'},
    {'1': 'password', '3': 4, '4': 1, '5': 9, '10': 'password'},
    {'1': 'birth_date', '3': 5, '4': 1, '5': 9, '10': 'birthDate'},
    {
      '1': 'agreed_page_version_ids',
      '3': 6,
      '4': 3,
      '5': 9,
      '10': 'agreedPageVersionIds'
    },
  ],
};

/// Descriptor for `CreateUserRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createUserRequestDescriptor = $convert.base64Decode(
    'ChFDcmVhdGVVc2VyUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cGVzLnYxLl'
    'RlbmFudENvbnRleHRSBnRlbmFudBISCgRuYW1lGAIgASgJUgRuYW1lEhQKBWVtYWlsGAMgASgJ'
    'UgVlbWFpbBIaCghwYXNzd29yZBgEIAEoCVIIcGFzc3dvcmQSHQoKYmlydGhfZGF0ZRgFIAEoCV'
    'IJYmlydGhEYXRlEjUKF2FncmVlZF9wYWdlX3ZlcnNpb25faWRzGAYgAygJUhRhZ3JlZWRQYWdl'
    'VmVyc2lvbklkcw==');

@$core.Deprecated('Use createUserResponseDescriptor instead')
const CreateUserResponse$json = {
  '1': 'CreateUserResponse',
  '2': [
    {'1': 'accepted', '3': 3, '4': 1, '5': 8, '10': 'accepted'},
  ],
  '9': [
    {'1': 1, '2': 2},
    {'1': 2, '2': 3},
  ],
  '10': ['user', 'access_token'],
};

/// Descriptor for `CreateUserResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createUserResponseDescriptor = $convert.base64Decode(
    'ChJDcmVhdGVVc2VyUmVzcG9uc2USGgoIYWNjZXB0ZWQYAyABKAhSCGFjY2VwdGVkSgQIARACSg'
    'QIAhADUgR1c2VyUgxhY2Nlc3NfdG9rZW4=');

@$core.Deprecated('Use verifyUserEmailRequestDescriptor instead')
const VerifyUserEmailRequest$json = {
  '1': 'VerifyUserEmailRequest',
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
  ],
};

/// Descriptor for `VerifyUserEmailRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifyUserEmailRequestDescriptor =
    $convert.base64Decode(
        'ChZWZXJpZnlVc2VyRW1haWxSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZX'
        'MudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBXRva2VuGAIgASgJUgV0b2tlbg==');

@$core.Deprecated('Use verifyUserEmailResponseDescriptor instead')
const VerifyUserEmailResponse$json = {
  '1': 'VerifyUserEmailResponse',
  '2': [
    {'1': 'verified', '3': 1, '4': 1, '5': 8, '10': 'verified'},
  ],
};

/// Descriptor for `VerifyUserEmailResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List verifyUserEmailResponseDescriptor =
    $convert.base64Decode(
        'ChdWZXJpZnlVc2VyRW1haWxSZXNwb25zZRIaCgh2ZXJpZmllZBgBIAEoCFIIdmVyaWZpZWQ=');

@$core.Deprecated('Use requestEmailVerificationRequestDescriptor instead')
const RequestEmailVerificationRequest$json = {
  '1': 'RequestEmailVerificationRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'email', '3': 2, '4': 1, '5': 9, '10': 'email'},
  ],
};

/// Descriptor for `RequestEmailVerificationRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestEmailVerificationRequestDescriptor =
    $convert.base64Decode(
        'Ch9SZXF1ZXN0RW1haWxWZXJpZmljYXRpb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWVtYWlsGAIgASgJUgVlbWFp'
        'bA==');

@$core.Deprecated('Use requestEmailVerificationResponseDescriptor instead')
const RequestEmailVerificationResponse$json = {
  '1': 'RequestEmailVerificationResponse',
  '2': [
    {'1': 'requested', '3': 1, '4': 1, '5': 8, '10': 'requested'},
  ],
};

/// Descriptor for `RequestEmailVerificationResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestEmailVerificationResponseDescriptor =
    $convert.base64Decode(
        'CiBSZXF1ZXN0RW1haWxWZXJpZmljYXRpb25SZXNwb25zZRIcCglyZXF1ZXN0ZWQYASABKAhSCX'
        'JlcXVlc3RlZA==');

@$core.Deprecated('Use requestEmailChangeRequestDescriptor instead')
const RequestEmailChangeRequest$json = {
  '1': 'RequestEmailChangeRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'current_email', '3': 2, '4': 1, '5': 9, '10': 'currentEmail'},
    {'1': 'new_email', '3': 3, '4': 1, '5': 9, '10': 'newEmail'},
    {'1': 'current_password', '3': 4, '4': 1, '5': 9, '10': 'currentPassword'},
    {
      '1': 'provider',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
    {'1': 'id_token', '3': 6, '4': 1, '5': 9, '10': 'idToken'},
    {'1': 'nonce', '3': 7, '4': 1, '5': 9, '10': 'nonce'},
    {
      '1': 'passkey_credential_json',
      '3': 8,
      '4': 1,
      '5': 9,
      '10': 'passkeyCredentialJson'
    },
  ],
};

/// Descriptor for `RequestEmailChangeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestEmailChangeRequestDescriptor = $convert.base64Decode(
    'ChlSZXF1ZXN0RW1haWxDaGFuZ2VSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EiMKDWN1cnJlbnRfZW1haWwYAiABKAlSDGN1'
    'cnJlbnRFbWFpbBIbCgluZXdfZW1haWwYAyABKAlSCG5ld0VtYWlsEikKEGN1cnJlbnRfcGFzc3'
    'dvcmQYBCABKAlSD2N1cnJlbnRQYXNzd29yZBI4Cghwcm92aWRlchgFIAEoDjIcLnB1YmxpcmEu'
    'djEuSWRlbnRpdHlQcm92aWRlclIIcHJvdmlkZXISGQoIaWRfdG9rZW4YBiABKAlSB2lkVG9rZW'
    '4SFAoFbm9uY2UYByABKAlSBW5vbmNlEjYKF3Bhc3NrZXlfY3JlZGVudGlhbF9qc29uGAggASgJ'
    'UhVwYXNza2V5Q3JlZGVudGlhbEpzb24=');

@$core.Deprecated('Use requestEmailChangeResponseDescriptor instead')
const RequestEmailChangeResponse$json = {
  '1': 'RequestEmailChangeResponse',
  '2': [
    {'1': 'requested', '3': 1, '4': 1, '5': 8, '10': 'requested'},
  ],
};

/// Descriptor for `RequestEmailChangeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestEmailChangeResponseDescriptor =
    $convert.base64Decode(
        'ChpSZXF1ZXN0RW1haWxDaGFuZ2VSZXNwb25zZRIcCglyZXF1ZXN0ZWQYASABKAhSCXJlcXVlc3'
        'RlZA==');

@$core.Deprecated('Use confirmEmailChangeRequestDescriptor instead')
const ConfirmEmailChangeRequest$json = {
  '1': 'ConfirmEmailChangeRequest',
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
  ],
};

/// Descriptor for `ConfirmEmailChangeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmEmailChangeRequestDescriptor =
    $convert.base64Decode(
        'ChlDb25maXJtRW1haWxDaGFuZ2VSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
        'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBXRva2VuGAIgASgJUgV0b2tlbg==');

@$core.Deprecated('Use confirmEmailChangeResponseDescriptor instead')
const ConfirmEmailChangeResponse$json = {
  '1': 'ConfirmEmailChangeResponse',
  '2': [
    {'1': 'confirmed', '3': 1, '4': 1, '5': 8, '10': 'confirmed'},
    {'1': 'changed', '3': 2, '4': 1, '5': 8, '10': 'changed'},
    {
      '1': 'pending_confirmation_for',
      '3': 3,
      '4': 1,
      '5': 9,
      '10': 'pendingConfirmationFor'
    },
  ],
};

/// Descriptor for `ConfirmEmailChangeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmEmailChangeResponseDescriptor =
    $convert.base64Decode(
        'ChpDb25maXJtRW1haWxDaGFuZ2VSZXNwb25zZRIcCgljb25maXJtZWQYASABKAhSCWNvbmZpcm'
        '1lZBIYCgdjaGFuZ2VkGAIgASgIUgdjaGFuZ2VkEjgKGHBlbmRpbmdfY29uZmlybWF0aW9uX2Zv'
        'chgDIAEoCVIWcGVuZGluZ0NvbmZpcm1hdGlvbkZvcg==');

@$core.Deprecated('Use requestPasswordResetRequestDescriptor instead')
const RequestPasswordResetRequest$json = {
  '1': 'RequestPasswordResetRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'email', '3': 2, '4': 1, '5': 9, '10': 'email'},
  ],
};

/// Descriptor for `RequestPasswordResetRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestPasswordResetRequestDescriptor =
    $convert.base64Decode(
        'ChtSZXF1ZXN0UGFzc3dvcmRSZXNldFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
        '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFZW1haWwYAiABKAlSBWVtYWls');

@$core.Deprecated('Use requestPasswordResetResponseDescriptor instead')
const RequestPasswordResetResponse$json = {
  '1': 'RequestPasswordResetResponse',
  '2': [
    {'1': 'requested', '3': 1, '4': 1, '5': 8, '10': 'requested'},
  ],
};

/// Descriptor for `RequestPasswordResetResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List requestPasswordResetResponseDescriptor =
    $convert.base64Decode(
        'ChxSZXF1ZXN0UGFzc3dvcmRSZXNldFJlc3BvbnNlEhwKCXJlcXVlc3RlZBgBIAEoCFIJcmVxdW'
        'VzdGVk');

@$core.Deprecated('Use confirmPasswordResetRequestDescriptor instead')
const ConfirmPasswordResetRequest$json = {
  '1': 'ConfirmPasswordResetRequest',
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
    {'1': 'new_password', '3': 3, '4': 1, '5': 9, '10': 'newPassword'},
  ],
};

/// Descriptor for `ConfirmPasswordResetRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmPasswordResetRequestDescriptor =
    $convert.base64Decode(
        'ChtDb25maXJtUGFzc3dvcmRSZXNldFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
        '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFdG9rZW4YAiABKAlSBXRva2VuEiEK'
        'DG5ld19wYXNzd29yZBgDIAEoCVILbmV3UGFzc3dvcmQ=');

@$core.Deprecated('Use confirmPasswordResetResponseDescriptor instead')
const ConfirmPasswordResetResponse$json = {
  '1': 'ConfirmPasswordResetResponse',
  '2': [
    {'1': 'confirmed', '3': 1, '4': 1, '5': 8, '10': 'confirmed'},
  ],
};

/// Descriptor for `ConfirmPasswordResetResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmPasswordResetResponseDescriptor =
    $convert.base64Decode(
        'ChxDb25maXJtUGFzc3dvcmRSZXNldFJlc3BvbnNlEhwKCWNvbmZpcm1lZBgBIAEoCFIJY29uZm'
        'lybWVk');

@$core.Deprecated('Use changePasswordRequestDescriptor instead')
const ChangePasswordRequest$json = {
  '1': 'ChangePasswordRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'current_password', '3': 2, '4': 1, '5': 9, '10': 'currentPassword'},
    {'1': 'new_password', '3': 3, '4': 1, '5': 9, '10': 'newPassword'},
  ],
};

/// Descriptor for `ChangePasswordRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List changePasswordRequestDescriptor = $convert.base64Decode(
    'ChVDaGFuZ2VQYXNzd29yZFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy'
    '52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSKQoQY3VycmVudF9wYXNzd29yZBgCIAEoCVIPY3Vy'
    'cmVudFBhc3N3b3JkEiEKDG5ld19wYXNzd29yZBgDIAEoCVILbmV3UGFzc3dvcmQ=');

@$core.Deprecated('Use changePasswordResponseDescriptor instead')
const ChangePasswordResponse$json = {
  '1': 'ChangePasswordResponse',
  '2': [
    {
      '1': 'access_token',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.AccessToken',
      '10': 'accessToken'
    },
  ],
};

/// Descriptor for `ChangePasswordResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List changePasswordResponseDescriptor =
    $convert.base64Decode(
        'ChZDaGFuZ2VQYXNzd29yZFJlc3BvbnNlEkAKDGFjY2Vzc190b2tlbhgBIAEoCzIdLnB1Ymxpcm'
        'EudHlwZXMudjEuQWNjZXNzVG9rZW5SC2FjY2Vzc1Rva2Vu');

@$core.Deprecated('Use logoutRequestDescriptor instead')
const LogoutRequest$json = {
  '1': 'LogoutRequest',
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

/// Descriptor for `LogoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List logoutRequestDescriptor = $convert.base64Decode(
    'Cg1Mb2dvdXRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudjEuVGVuYW'
    '50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use logoutResponseDescriptor instead')
const LogoutResponse$json = {
  '1': 'LogoutResponse',
};

/// Descriptor for `LogoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List logoutResponseDescriptor =
    $convert.base64Decode('Cg5Mb2dvdXRSZXNwb25zZQ==');

@$core.Deprecated('Use getMeRequestDescriptor instead')
const GetMeRequest$json = {
  '1': 'GetMeRequest',
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

/// Descriptor for `GetMeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMeRequestDescriptor = $convert.base64Decode(
    'CgxHZXRNZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS5UZW5hbn'
    'RDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use getMeResponseDescriptor instead')
const GetMeResponse$json = {
  '1': 'GetMeResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
  ],
};

/// Descriptor for `GetMeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMeResponseDescriptor = $convert.base64Decode(
    'Cg1HZXRNZVJlc3BvbnNlEioKBHVzZXIYASABKAsyFi5wdWJsaXJhLnR5cGVzLnYxLlVzZXJSBH'
    'VzZXI=');

@$core.Deprecated('Use updateMeRequestDescriptor instead')
const UpdateMeRequest$json = {
  '1': 'UpdateMeRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'name', '3': 2, '4': 1, '5': 9, '10': 'name'},
    {'1': 'birth_date', '3': 3, '4': 1, '5': 9, '10': 'birthDate'},
  ],
};

/// Descriptor for `UpdateMeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMeRequestDescriptor = $convert.base64Decode(
    'Cg9VcGRhdGVNZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS5UZW'
    '5hbnRDb250ZXh0UgZ0ZW5hbnQSEgoEbmFtZRgCIAEoCVIEbmFtZRIdCgpiaXJ0aF9kYXRlGAMg'
    'ASgJUgliaXJ0aERhdGU=');

@$core.Deprecated('Use updateMeResponseDescriptor instead')
const UpdateMeResponse$json = {
  '1': 'UpdateMeResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
  ],
};

/// Descriptor for `UpdateMeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateMeResponseDescriptor = $convert.base64Decode(
    'ChBVcGRhdGVNZVJlc3BvbnNlEioKBHVzZXIYASABKAsyFi5wdWJsaXJhLnR5cGVzLnYxLlVzZX'
    'JSBHVzZXI=');

@$core.Deprecated('Use uploadMyIconRequestDescriptor instead')
const UploadMyIconRequest$json = {
  '1': 'UploadMyIconRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'icon_data', '3': 2, '4': 1, '5': 12, '10': 'iconData'},
    {'1': 'icon_content_type', '3': 3, '4': 1, '5': 9, '10': 'iconContentType'},
    {
      '1': 'icon_crop',
      '3': 4,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.ImageCropRect',
      '10': 'iconCrop'
    },
  ],
};

/// Descriptor for `UploadMyIconRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadMyIconRequestDescriptor = $convert.base64Decode(
    'ChNVcGxvYWRNeUljb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudj'
    'EuVGVuYW50Q29udGV4dFIGdGVuYW50EhsKCWljb25fZGF0YRgCIAEoDFIIaWNvbkRhdGESKgoR'
    'aWNvbl9jb250ZW50X3R5cGUYAyABKAlSD2ljb25Db250ZW50VHlwZRI8CglpY29uX2Nyb3AYBC'
    'ABKAsyHy5wdWJsaXJhLnR5cGVzLnYxLkltYWdlQ3JvcFJlY3RSCGljb25Dcm9w');

@$core.Deprecated('Use uploadMyIconResponseDescriptor instead')
const UploadMyIconResponse$json = {
  '1': 'UploadMyIconResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
  ],
};

/// Descriptor for `UploadMyIconResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List uploadMyIconResponseDescriptor = $convert.base64Decode(
    'ChRVcGxvYWRNeUljb25SZXNwb25zZRIqCgR1c2VyGAEgASgLMhYucHVibGlyYS50eXBlcy52MS'
    '5Vc2VyUgR1c2Vy');

@$core.Deprecated('Use deleteMyIconRequestDescriptor instead')
const DeleteMyIconRequest$json = {
  '1': 'DeleteMyIconRequest',
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

/// Descriptor for `DeleteMyIconRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMyIconRequestDescriptor = $convert.base64Decode(
    'ChNEZWxldGVNeUljb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudj'
    'EuVGVuYW50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use deleteMyIconResponseDescriptor instead')
const DeleteMyIconResponse$json = {
  '1': 'DeleteMyIconResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
  ],
};

/// Descriptor for `DeleteMyIconResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMyIconResponseDescriptor = $convert.base64Decode(
    'ChREZWxldGVNeUljb25SZXNwb25zZRIqCgR1c2VyGAEgASgLMhYucHVibGlyYS50eXBlcy52MS'
    '5Vc2VyUgR1c2Vy');

@$core.Deprecated('Use selectMyIconRequestDescriptor instead')
const SelectMyIconRequest$json = {
  '1': 'SelectMyIconRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'preset_id', '3': 2, '4': 1, '5': 9, '10': 'presetId'},
  ],
};

/// Descriptor for `SelectMyIconRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List selectMyIconRequestDescriptor = $convert.base64Decode(
    'ChNTZWxlY3RNeUljb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZXMudj'
    'EuVGVuYW50Q29udGV4dFIGdGVuYW50EhsKCXByZXNldF9pZBgCIAEoCVIIcHJlc2V0SWQ=');

@$core.Deprecated('Use selectMyIconResponseDescriptor instead')
const SelectMyIconResponse$json = {
  '1': 'SelectMyIconResponse',
  '2': [
    {
      '1': 'user',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.User',
      '10': 'user'
    },
  ],
};

/// Descriptor for `SelectMyIconResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List selectMyIconResponseDescriptor = $convert.base64Decode(
    'ChRTZWxlY3RNeUljb25SZXNwb25zZRIqCgR1c2VyGAEgASgLMhYucHVibGlyYS50eXBlcy52MS'
    '5Vc2VyUgR1c2Vy');

@$core.Deprecated('Use deleteMeRequestDescriptor instead')
const DeleteMeRequest$json = {
  '1': 'DeleteMeRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'password', '3': 2, '4': 1, '5': 9, '10': 'password'},
    {
      '1': 'provider',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.IdentityProvider',
      '10': 'provider'
    },
    {'1': 'id_token', '3': 4, '4': 1, '5': 9, '10': 'idToken'},
    {'1': 'nonce', '3': 5, '4': 1, '5': 9, '10': 'nonce'},
    {
      '1': 'passkey_credential_json',
      '3': 6,
      '4': 1,
      '5': 9,
      '10': 'passkeyCredentialJson'
    },
  ],
};

/// Descriptor for `DeleteMeRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMeRequestDescriptor = $convert.base64Decode(
    'Cg9EZWxldGVNZVJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eXBlcy52MS5UZW'
    '5hbnRDb250ZXh0UgZ0ZW5hbnQSGgoIcGFzc3dvcmQYAiABKAlSCHBhc3N3b3JkEjgKCHByb3Zp'
    'ZGVyGAMgASgOMhwucHVibGlyYS52MS5JZGVudGl0eVByb3ZpZGVyUghwcm92aWRlchIZCghpZF'
    '90b2tlbhgEIAEoCVIHaWRUb2tlbhIUCgVub25jZRgFIAEoCVIFbm9uY2USNgoXcGFzc2tleV9j'
    'cmVkZW50aWFsX2pzb24YBiABKAlSFXBhc3NrZXlDcmVkZW50aWFsSnNvbg==');

@$core.Deprecated('Use deleteMeResponseDescriptor instead')
const DeleteMeResponse$json = {
  '1': 'DeleteMeResponse',
};

/// Descriptor for `DeleteMeResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List deleteMeResponseDescriptor =
    $convert.base64Decode('ChBEZWxldGVNZVJlc3BvbnNl');

@$core.Deprecated('Use getNotificationSettingsRequestDescriptor instead')
const GetNotificationSettingsRequest$json = {
  '1': 'GetNotificationSettingsRequest',
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

/// Descriptor for `GetNotificationSettingsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNotificationSettingsRequestDescriptor =
    $convert.base64Decode(
        'Ch5HZXROb3RpZmljYXRpb25TZXR0aW5nc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
        'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use getNotificationSettingsResponseDescriptor instead')
const GetNotificationSettingsResponse$json = {
  '1': 'GetNotificationSettingsResponse',
  '2': [
    {
      '1': 'email_notifications_enabled',
      '3': 1,
      '4': 1,
      '5': 8,
      '10': 'emailNotificationsEnabled'
    },
  ],
};

/// Descriptor for `GetNotificationSettingsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getNotificationSettingsResponseDescriptor =
    $convert.base64Decode(
        'Ch9HZXROb3RpZmljYXRpb25TZXR0aW5nc1Jlc3BvbnNlEj4KG2VtYWlsX25vdGlmaWNhdGlvbn'
        'NfZW5hYmxlZBgBIAEoCFIZZW1haWxOb3RpZmljYXRpb25zRW5hYmxlZA==');

@$core.Deprecated('Use updateNotificationSettingsRequestDescriptor instead')
const UpdateNotificationSettingsRequest$json = {
  '1': 'UpdateNotificationSettingsRequest',
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
      '1': 'email_notifications_enabled',
      '3': 2,
      '4': 1,
      '5': 8,
      '10': 'emailNotificationsEnabled'
    },
  ],
};

/// Descriptor for `UpdateNotificationSettingsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateNotificationSettingsRequestDescriptor =
    $convert.base64Decode(
        'CiFVcGRhdGVOb3RpZmljYXRpb25TZXR0aW5nc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucH'
        'VibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSPgobZW1haWxfbm90aWZpY2F0'
        'aW9uc19lbmFibGVkGAIgASgIUhllbWFpbE5vdGlmaWNhdGlvbnNFbmFibGVk');

@$core.Deprecated('Use updateNotificationSettingsResponseDescriptor instead')
const UpdateNotificationSettingsResponse$json = {
  '1': 'UpdateNotificationSettingsResponse',
  '2': [
    {
      '1': 'email_notifications_enabled',
      '3': 1,
      '4': 1,
      '5': 8,
      '10': 'emailNotificationsEnabled'
    },
  ],
};

/// Descriptor for `UpdateNotificationSettingsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateNotificationSettingsResponseDescriptor =
    $convert.base64Decode(
        'CiJVcGRhdGVOb3RpZmljYXRpb25TZXR0aW5nc1Jlc3BvbnNlEj4KG2VtYWlsX25vdGlmaWNhdG'
        'lvbnNfZW5hYmxlZBgBIAEoCFIZZW1haWxOb3RpZmljYXRpb25zRW5hYmxlZA==');

@$core.Deprecated('Use viewerPreferencesDescriptor instead')
const ViewerPreferences$json = {
  '1': 'ViewerPreferences',
  '2': [
    {
      '1': 'wide_viewer_enabled',
      '3': 1,
      '4': 1,
      '5': 8,
      '10': 'wideViewerEnabled'
    },
  ],
};

/// Descriptor for `ViewerPreferences`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List viewerPreferencesDescriptor = $convert.base64Decode(
    'ChFWaWV3ZXJQcmVmZXJlbmNlcxIuChN3aWRlX3ZpZXdlcl9lbmFibGVkGAEgASgIUhF3aWRlVm'
    'lld2VyRW5hYmxlZA==');

@$core.Deprecated('Use getViewerPreferencesRequestDescriptor instead')
const GetViewerPreferencesRequest$json = {
  '1': 'GetViewerPreferencesRequest',
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

/// Descriptor for `GetViewerPreferencesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getViewerPreferencesRequestDescriptor =
    $convert.base64Decode(
        'ChtHZXRWaWV3ZXJQcmVmZXJlbmNlc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
        '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use getViewerPreferencesResponseDescriptor instead')
const GetViewerPreferencesResponse$json = {
  '1': 'GetViewerPreferencesResponse',
  '2': [
    {
      '1': 'preferences',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ViewerPreferences',
      '10': 'preferences'
    },
  ],
};

/// Descriptor for `GetViewerPreferencesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getViewerPreferencesResponseDescriptor =
    $convert.base64Decode(
        'ChxHZXRWaWV3ZXJQcmVmZXJlbmNlc1Jlc3BvbnNlEj8KC3ByZWZlcmVuY2VzGAEgASgLMh0ucH'
        'VibGlyYS52MS5WaWV3ZXJQcmVmZXJlbmNlc1ILcHJlZmVyZW5jZXM=');

@$core.Deprecated('Use updateViewerPreferencesRequestDescriptor instead')
const UpdateViewerPreferencesRequest$json = {
  '1': 'UpdateViewerPreferencesRequest',
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
      '1': 'wide_viewer_enabled',
      '3': 2,
      '4': 1,
      '5': 8,
      '9': 0,
      '10': 'wideViewerEnabled',
      '17': true
    },
  ],
  '8': [
    {'1': '_wide_viewer_enabled'},
  ],
};

/// Descriptor for `UpdateViewerPreferencesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateViewerPreferencesRequestDescriptor =
    $convert.base64Decode(
        'Ch5VcGRhdGVWaWV3ZXJQcmVmZXJlbmNlc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibG'
        'lyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSMwoTd2lkZV92aWV3ZXJfZW5hYmxl'
        'ZBgCIAEoCEgAUhF3aWRlVmlld2VyRW5hYmxlZIgBAUIWChRfd2lkZV92aWV3ZXJfZW5hYmxlZA'
        '==');

@$core.Deprecated('Use updateViewerPreferencesResponseDescriptor instead')
const UpdateViewerPreferencesResponse$json = {
  '1': 'UpdateViewerPreferencesResponse',
  '2': [
    {
      '1': 'preferences',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.ViewerPreferences',
      '10': 'preferences'
    },
  ],
};

/// Descriptor for `UpdateViewerPreferencesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List updateViewerPreferencesResponseDescriptor =
    $convert.base64Decode(
        'Ch9VcGRhdGVWaWV3ZXJQcmVmZXJlbmNlc1Jlc3BvbnNlEj8KC3ByZWZlcmVuY2VzGAEgASgLMh'
        '0ucHVibGlyYS52MS5WaWV3ZXJQcmVmZXJlbmNlc1ILcHJlZmVyZW5jZXM=');

@$core.Deprecated('Use announcementItemDescriptor instead')
const AnnouncementItem$json = {
  '1': 'AnnouncementItem',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'announcement_type',
      '3': 2,
      '4': 1,
      '5': 9,
      '10': 'announcementType'
    },
    {'1': 'title', '3': 3, '4': 1, '5': 9, '10': 'title'},
    {'1': 'body', '3': 4, '4': 1, '5': 9, '10': 'body'},
    {'1': 'link_url', '3': 5, '4': 1, '5': 9, '10': 'linkUrl'},
    {'1': 'is_read', '3': 6, '4': 1, '5': 8, '10': 'isRead'},
    {'1': 'read_at', '3': 7, '4': 1, '5': 9, '10': 'readAt'},
    {'1': 'created_at', '3': 8, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'pinned', '3': 9, '4': 1, '5': 8, '10': 'pinned'},
    {'1': 'pinned_until', '3': 10, '4': 1, '5': 9, '10': 'pinnedUntil'},
  ],
};

/// Descriptor for `AnnouncementItem`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List announcementItemDescriptor = $convert.base64Decode(
    'ChBBbm5vdW5jZW1lbnRJdGVtEg4KAmlkGAEgASgJUgJpZBIrChFhbm5vdW5jZW1lbnRfdHlwZR'
    'gCIAEoCVIQYW5ub3VuY2VtZW50VHlwZRIUCgV0aXRsZRgDIAEoCVIFdGl0bGUSEgoEYm9keRgE'
    'IAEoCVIEYm9keRIZCghsaW5rX3VybBgFIAEoCVIHbGlua1VybBIXCgdpc19yZWFkGAYgASgIUg'
    'Zpc1JlYWQSFwoHcmVhZF9hdBgHIAEoCVIGcmVhZEF0Eh0KCmNyZWF0ZWRfYXQYCCABKAlSCWNy'
    'ZWF0ZWRBdBIWCgZwaW5uZWQYCSABKAhSBnBpbm5lZBIhCgxwaW5uZWRfdW50aWwYCiABKAlSC3'
    'Bpbm5lZFVudGls');

@$core.Deprecated('Use getPinnedAnnouncementRequestDescriptor instead')
const GetPinnedAnnouncementRequest$json = {
  '1': 'GetPinnedAnnouncementRequest',
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

/// Descriptor for `GetPinnedAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPinnedAnnouncementRequestDescriptor =
    $convert.base64Decode(
        'ChxHZXRQaW5uZWRBbm5vdW5jZW1lbnRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
        'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50');

@$core.Deprecated('Use getPinnedAnnouncementResponseDescriptor instead')
const GetPinnedAnnouncementResponse$json = {
  '1': 'GetPinnedAnnouncementResponse',
  '2': [
    {
      '1': 'announcement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.AnnouncementItem',
      '10': 'announcement'
    },
  ],
};

/// Descriptor for `GetPinnedAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPinnedAnnouncementResponseDescriptor =
    $convert.base64Decode(
        'Ch1HZXRQaW5uZWRBbm5vdW5jZW1lbnRSZXNwb25zZRJACgxhbm5vdW5jZW1lbnQYASABKAsyHC'
        '5wdWJsaXJhLnYxLkFubm91bmNlbWVudEl0ZW1SDGFubm91bmNlbWVudA==');

@$core.Deprecated('Use getAnnouncementRequestDescriptor instead')
const GetAnnouncementRequest$json = {
  '1': 'GetAnnouncementRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'announcement_id', '3': 2, '4': 1, '5': 9, '10': 'announcementId'},
  ],
};

/// Descriptor for `GetAnnouncementRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementRequestDescriptor = $convert.base64Decode(
    'ChZHZXRBbm5vdW5jZW1lbnRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudHlwZX'
    'MudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EicKD2Fubm91bmNlbWVudF9pZBgCIAEoCVIOYW5u'
    'b3VuY2VtZW50SWQ=');

@$core.Deprecated('Use getAnnouncementResponseDescriptor instead')
const GetAnnouncementResponse$json = {
  '1': 'GetAnnouncementResponse',
  '2': [
    {
      '1': 'announcement',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.AnnouncementItem',
      '10': 'announcement'
    },
  ],
};

/// Descriptor for `GetAnnouncementResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getAnnouncementResponseDescriptor =
    $convert.base64Decode(
        'ChdHZXRBbm5vdW5jZW1lbnRSZXNwb25zZRJACgxhbm5vdW5jZW1lbnQYASABKAsyHC5wdWJsaX'
        'JhLnYxLkFubm91bmNlbWVudEl0ZW1SDGFubm91bmNlbWVudA==');

@$core.Deprecated('Use listAnnouncementsRequestDescriptor instead')
const ListAnnouncementsRequest$json = {
  '1': 'ListAnnouncementsRequest',
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
  ],
  '9': [
    {'1': 3, '2': 4},
  ],
  '10': ['offset'],
};

/// Descriptor for `ListAnnouncementsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAnnouncementsRequestDescriptor = $convert.base64Decode(
    'ChhMaXN0QW5ub3VuY2VtZW50c1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSFAoFbGltaXQYAiABKAVSBWxpbWl0EhQKBXRv'
    'a2VuGAQgASgJUgV0b2tlbkoECAMQBFIGb2Zmc2V0');

@$core.Deprecated('Use listAnnouncementsResponseDescriptor instead')
const ListAnnouncementsResponse$json = {
  '1': 'ListAnnouncementsResponse',
  '2': [
    {
      '1': 'announcements',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.AnnouncementItem',
      '10': 'announcements'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListAnnouncementsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listAnnouncementsResponseDescriptor = $convert.base64Decode(
    'ChlMaXN0QW5ub3VuY2VtZW50c1Jlc3BvbnNlEkIKDWFubm91bmNlbWVudHMYASADKAsyHC5wdW'
    'JsaXJhLnYxLkFubm91bmNlbWVudEl0ZW1SDWFubm91bmNlbWVudHMSJQoOcHJldmlvdXNfdG9r'
    'ZW4YAiABKAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use markAnnouncementAsReadRequestDescriptor instead')
const MarkAnnouncementAsReadRequest$json = {
  '1': 'MarkAnnouncementAsReadRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'announcement_id', '3': 2, '4': 1, '5': 9, '10': 'announcementId'},
  ],
};

/// Descriptor for `MarkAnnouncementAsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAnnouncementAsReadRequestDescriptor =
    $convert.base64Decode(
        'Ch1NYXJrQW5ub3VuY2VtZW50QXNSZWFkUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
        'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBInCg9hbm5vdW5jZW1lbnRfaWQYAiAB'
        'KAlSDmFubm91bmNlbWVudElk');

@$core.Deprecated('Use markAnnouncementAsReadResponseDescriptor instead')
const MarkAnnouncementAsReadResponse$json = {
  '1': 'MarkAnnouncementAsReadResponse',
  '2': [
    {'1': 'marked', '3': 1, '4': 1, '5': 8, '10': 'marked'},
  ],
};

/// Descriptor for `MarkAnnouncementAsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAnnouncementAsReadResponseDescriptor =
    $convert.base64Decode(
        'Ch5NYXJrQW5ub3VuY2VtZW50QXNSZWFkUmVzcG9uc2USFgoGbWFya2VkGAEgASgIUgZtYXJrZW'
        'Q=');

@$core.Deprecated('Use markAllAnnouncementsAsReadRequestDescriptor instead')
const MarkAllAnnouncementsAsReadRequest$json = {
  '1': 'MarkAllAnnouncementsAsReadRequest',
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

/// Descriptor for `MarkAllAnnouncementsAsReadRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllAnnouncementsAsReadRequestDescriptor =
    $convert.base64Decode(
        'CiFNYXJrQWxsQW5ub3VuY2VtZW50c0FzUmVhZFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucH'
        'VibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use markAllAnnouncementsAsReadResponseDescriptor instead')
const MarkAllAnnouncementsAsReadResponse$json = {
  '1': 'MarkAllAnnouncementsAsReadResponse',
  '2': [
    {'1': 'marked_count', '3': 1, '4': 1, '5': 5, '10': 'markedCount'},
  ],
};

/// Descriptor for `MarkAllAnnouncementsAsReadResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List markAllAnnouncementsAsReadResponseDescriptor =
    $convert.base64Decode(
        'CiJNYXJrQWxsQW5ub3VuY2VtZW50c0FzUmVhZFJlc3BvbnNlEiEKDG1hcmtlZF9jb3VudBgBIA'
        'EoBVILbWFya2VkQ291bnQ=');

@$core.Deprecated('Use getMyLegalPageAgreementsRequestDescriptor instead')
const GetMyLegalPageAgreementsRequest$json = {
  '1': 'GetMyLegalPageAgreementsRequest',
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

/// Descriptor for `GetMyLegalPageAgreementsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyLegalPageAgreementsRequestDescriptor =
    $convert.base64Decode(
        'Ch9HZXRNeUxlZ2FsUGFnZUFncmVlbWVudHNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhYKBmxvY2FsZRgCIAEoCVIGbG9j'
        'YWxl');

@$core.Deprecated('Use getMyLegalPageAgreementsResponseDescriptor instead')
const GetMyLegalPageAgreementsResponse$json = {
  '1': 'GetMyLegalPageAgreementsResponse',
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

/// Descriptor for `GetMyLegalPageAgreementsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMyLegalPageAgreementsResponseDescriptor =
    $convert.base64Decode(
        'CiBHZXRNeUxlZ2FsUGFnZUFncmVlbWVudHNSZXNwb25zZRI6Cgp0ZXJtc19wYWdlGAEgASgLMh'
        'sucHVibGlyYS52MS5UZW5hbnRMZWdhbFBhZ2VSCXRlcm1zUGFnZRI+Cgxwcml2YWN5X3BhZ2UY'
        'AiABKAsyGy5wdWJsaXJhLnYxLlRlbmFudExlZ2FsUGFnZVILcHJpdmFjeVBhZ2U=');

@$core.Deprecated('Use agreeToLegalPagesRequestDescriptor instead')
const AgreeToLegalPagesRequest$json = {
  '1': 'AgreeToLegalPagesRequest',
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
      '1': 'agreed_page_version_ids',
      '3': 2,
      '4': 3,
      '5': 9,
      '10': 'agreedPageVersionIds'
    },
    {'1': 'locale', '3': 3, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `AgreeToLegalPagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List agreeToLegalPagesRequestDescriptor = $convert.base64Decode(
    'ChhBZ3JlZVRvTGVnYWxQYWdlc1JlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
    'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSNQoXYWdyZWVkX3BhZ2VfdmVyc2lvbl9pZHMY'
    'AiADKAlSFGFncmVlZFBhZ2VWZXJzaW9uSWRzEhYKBmxvY2FsZRgDIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use agreeToLegalPagesResponseDescriptor instead')
const AgreeToLegalPagesResponse$json = {
  '1': 'AgreeToLegalPagesResponse',
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

/// Descriptor for `AgreeToLegalPagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List agreeToLegalPagesResponseDescriptor = $convert.base64Decode(
    'ChlBZ3JlZVRvTGVnYWxQYWdlc1Jlc3BvbnNlEjoKCnRlcm1zX3BhZ2UYASABKAsyGy5wdWJsaX'
    'JhLnYxLlRlbmFudExlZ2FsUGFnZVIJdGVybXNQYWdlEj4KDHByaXZhY3lfcGFnZRgCIAEoCzIb'
    'LnB1YmxpcmEudjEuVGVuYW50TGVnYWxQYWdlUgtwcml2YWN5UGFnZQ==');

const $core.Map<$core.String, $core.dynamic> AuthServiceBase$json = {
  '1': 'AuthService',
  '2': [
    {
      '1': 'Login',
      '2': '.publira.v1.LoginRequest',
      '3': '.publira.v1.LoginResponse'
    },
    {
      '1': 'LoginWithIdToken',
      '2': '.publira.v1.LoginWithIdTokenRequest',
      '3': '.publira.v1.LoginWithIdTokenResponse'
    },
    {
      '1': 'ListMyIdentities',
      '2': '.publira.v1.ListMyIdentitiesRequest',
      '3': '.publira.v1.ListMyIdentitiesResponse'
    },
    {
      '1': 'UnlinkIdentity',
      '2': '.publira.v1.UnlinkIdentityRequest',
      '3': '.publira.v1.UnlinkIdentityResponse'
    },
    {
      '1': 'LinkIdentity',
      '2': '.publira.v1.LinkIdentityRequest',
      '3': '.publira.v1.LinkIdentityResponse'
    },
    {
      '1': 'BeginPasskeyLogin',
      '2': '.publira.v1.BeginPasskeyLoginRequest',
      '3': '.publira.v1.BeginPasskeyLoginResponse'
    },
    {
      '1': 'FinishPasskeyLogin',
      '2': '.publira.v1.FinishPasskeyLoginRequest',
      '3': '.publira.v1.FinishPasskeyLoginResponse'
    },
    {
      '1': 'BeginPasskeyRegistration',
      '2': '.publira.v1.BeginPasskeyRegistrationRequest',
      '3': '.publira.v1.BeginPasskeyRegistrationResponse'
    },
    {
      '1': 'FinishPasskeyRegistration',
      '2': '.publira.v1.FinishPasskeyRegistrationRequest',
      '3': '.publira.v1.FinishPasskeyRegistrationResponse'
    },
    {
      '1': 'ListMyPasskeys',
      '2': '.publira.v1.ListMyPasskeysRequest',
      '3': '.publira.v1.ListMyPasskeysResponse'
    },
    {
      '1': 'RenamePasskey',
      '2': '.publira.v1.RenamePasskeyRequest',
      '3': '.publira.v1.RenamePasskeyResponse'
    },
    {
      '1': 'DeletePasskey',
      '2': '.publira.v1.DeletePasskeyRequest',
      '3': '.publira.v1.DeletePasskeyResponse'
    },
    {
      '1': 'BeginPasskeyConfirmation',
      '2': '.publira.v1.BeginPasskeyConfirmationRequest',
      '3': '.publira.v1.BeginPasskeyConfirmationResponse'
    },
    {
      '1': 'CreateUser',
      '2': '.publira.v1.CreateUserRequest',
      '3': '.publira.v1.CreateUserResponse'
    },
    {
      '1': 'VerifyUserEmail',
      '2': '.publira.v1.VerifyUserEmailRequest',
      '3': '.publira.v1.VerifyUserEmailResponse'
    },
    {
      '1': 'RequestEmailVerification',
      '2': '.publira.v1.RequestEmailVerificationRequest',
      '3': '.publira.v1.RequestEmailVerificationResponse'
    },
    {
      '1': 'RequestEmailChange',
      '2': '.publira.v1.RequestEmailChangeRequest',
      '3': '.publira.v1.RequestEmailChangeResponse'
    },
    {
      '1': 'ConfirmEmailChange',
      '2': '.publira.v1.ConfirmEmailChangeRequest',
      '3': '.publira.v1.ConfirmEmailChangeResponse'
    },
    {
      '1': 'RequestPasswordReset',
      '2': '.publira.v1.RequestPasswordResetRequest',
      '3': '.publira.v1.RequestPasswordResetResponse'
    },
    {
      '1': 'ConfirmPasswordReset',
      '2': '.publira.v1.ConfirmPasswordResetRequest',
      '3': '.publira.v1.ConfirmPasswordResetResponse'
    },
    {
      '1': 'ChangePassword',
      '2': '.publira.v1.ChangePasswordRequest',
      '3': '.publira.v1.ChangePasswordResponse'
    },
    {
      '1': 'Logout',
      '2': '.publira.v1.LogoutRequest',
      '3': '.publira.v1.LogoutResponse'
    },
    {
      '1': 'GetMe',
      '2': '.publira.v1.GetMeRequest',
      '3': '.publira.v1.GetMeResponse'
    },
    {
      '1': 'UpdateMe',
      '2': '.publira.v1.UpdateMeRequest',
      '3': '.publira.v1.UpdateMeResponse'
    },
    {
      '1': 'UploadMyIcon',
      '2': '.publira.v1.UploadMyIconRequest',
      '3': '.publira.v1.UploadMyIconResponse'
    },
    {
      '1': 'SelectMyIcon',
      '2': '.publira.v1.SelectMyIconRequest',
      '3': '.publira.v1.SelectMyIconResponse'
    },
    {
      '1': 'DeleteMyIcon',
      '2': '.publira.v1.DeleteMyIconRequest',
      '3': '.publira.v1.DeleteMyIconResponse'
    },
    {
      '1': 'DeleteMe',
      '2': '.publira.v1.DeleteMeRequest',
      '3': '.publira.v1.DeleteMeResponse'
    },
    {
      '1': 'GetNotificationSettings',
      '2': '.publira.v1.GetNotificationSettingsRequest',
      '3': '.publira.v1.GetNotificationSettingsResponse'
    },
    {
      '1': 'UpdateNotificationSettings',
      '2': '.publira.v1.UpdateNotificationSettingsRequest',
      '3': '.publira.v1.UpdateNotificationSettingsResponse'
    },
    {
      '1': 'GetViewerPreferences',
      '2': '.publira.v1.GetViewerPreferencesRequest',
      '3': '.publira.v1.GetViewerPreferencesResponse'
    },
    {
      '1': 'UpdateViewerPreferences',
      '2': '.publira.v1.UpdateViewerPreferencesRequest',
      '3': '.publira.v1.UpdateViewerPreferencesResponse'
    },
    {
      '1': 'GetAnnouncement',
      '2': '.publira.v1.GetAnnouncementRequest',
      '3': '.publira.v1.GetAnnouncementResponse'
    },
    {
      '1': 'GetPinnedAnnouncement',
      '2': '.publira.v1.GetPinnedAnnouncementRequest',
      '3': '.publira.v1.GetPinnedAnnouncementResponse'
    },
    {
      '1': 'ListAnnouncements',
      '2': '.publira.v1.ListAnnouncementsRequest',
      '3': '.publira.v1.ListAnnouncementsResponse'
    },
    {
      '1': 'MarkAnnouncementAsRead',
      '2': '.publira.v1.MarkAnnouncementAsReadRequest',
      '3': '.publira.v1.MarkAnnouncementAsReadResponse'
    },
    {
      '1': 'MarkAllAnnouncementsAsRead',
      '2': '.publira.v1.MarkAllAnnouncementsAsReadRequest',
      '3': '.publira.v1.MarkAllAnnouncementsAsReadResponse'
    },
    {
      '1': 'GetMyLegalPageAgreements',
      '2': '.publira.v1.GetMyLegalPageAgreementsRequest',
      '3': '.publira.v1.GetMyLegalPageAgreementsResponse'
    },
    {
      '1': 'AgreeToLegalPages',
      '2': '.publira.v1.AgreeToLegalPagesRequest',
      '3': '.publira.v1.AgreeToLegalPagesResponse'
    },
  ],
};

@$core.Deprecated('Use authServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    AuthServiceBase$messageJson = {
  '.publira.v1.LoginRequest': LoginRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.LoginResponse': LoginResponse$json,
  '.publira.types.v1.User': $0.User$json,
  '.publira.types.v1.UserIconVariant': $0.UserIconVariant$json,
  '.publira.types.v1.AccessToken': $0.AccessToken$json,
  '.publira.v1.LoginWithIdTokenRequest': LoginWithIdTokenRequest$json,
  '.publira.v1.LoginWithIdTokenResponse': LoginWithIdTokenResponse$json,
  '.publira.v1.ListMyIdentitiesRequest': ListMyIdentitiesRequest$json,
  '.publira.v1.ListMyIdentitiesResponse': ListMyIdentitiesResponse$json,
  '.publira.v1.LinkedIdentity': LinkedIdentity$json,
  '.publira.v1.UnlinkIdentityRequest': UnlinkIdentityRequest$json,
  '.publira.v1.UnlinkIdentityResponse': UnlinkIdentityResponse$json,
  '.publira.v1.LinkIdentityRequest': LinkIdentityRequest$json,
  '.publira.v1.LinkIdentityResponse': LinkIdentityResponse$json,
  '.publira.v1.BeginPasskeyLoginRequest': BeginPasskeyLoginRequest$json,
  '.publira.v1.BeginPasskeyLoginResponse': BeginPasskeyLoginResponse$json,
  '.publira.v1.FinishPasskeyLoginRequest': FinishPasskeyLoginRequest$json,
  '.publira.v1.FinishPasskeyLoginResponse': FinishPasskeyLoginResponse$json,
  '.publira.v1.BeginPasskeyRegistrationRequest':
      BeginPasskeyRegistrationRequest$json,
  '.publira.v1.BeginPasskeyRegistrationResponse':
      BeginPasskeyRegistrationResponse$json,
  '.publira.v1.FinishPasskeyRegistrationRequest':
      FinishPasskeyRegistrationRequest$json,
  '.publira.v1.FinishPasskeyRegistrationResponse':
      FinishPasskeyRegistrationResponse$json,
  '.publira.v1.Passkey': Passkey$json,
  '.publira.v1.ListMyPasskeysRequest': ListMyPasskeysRequest$json,
  '.publira.v1.ListMyPasskeysResponse': ListMyPasskeysResponse$json,
  '.publira.v1.RenamePasskeyRequest': RenamePasskeyRequest$json,
  '.publira.v1.RenamePasskeyResponse': RenamePasskeyResponse$json,
  '.publira.v1.DeletePasskeyRequest': DeletePasskeyRequest$json,
  '.publira.v1.DeletePasskeyResponse': DeletePasskeyResponse$json,
  '.publira.v1.BeginPasskeyConfirmationRequest':
      BeginPasskeyConfirmationRequest$json,
  '.publira.v1.BeginPasskeyConfirmationResponse':
      BeginPasskeyConfirmationResponse$json,
  '.publira.v1.CreateUserRequest': CreateUserRequest$json,
  '.publira.v1.CreateUserResponse': CreateUserResponse$json,
  '.publira.v1.VerifyUserEmailRequest': VerifyUserEmailRequest$json,
  '.publira.v1.VerifyUserEmailResponse': VerifyUserEmailResponse$json,
  '.publira.v1.RequestEmailVerificationRequest':
      RequestEmailVerificationRequest$json,
  '.publira.v1.RequestEmailVerificationResponse':
      RequestEmailVerificationResponse$json,
  '.publira.v1.RequestEmailChangeRequest': RequestEmailChangeRequest$json,
  '.publira.v1.RequestEmailChangeResponse': RequestEmailChangeResponse$json,
  '.publira.v1.ConfirmEmailChangeRequest': ConfirmEmailChangeRequest$json,
  '.publira.v1.ConfirmEmailChangeResponse': ConfirmEmailChangeResponse$json,
  '.publira.v1.RequestPasswordResetRequest': RequestPasswordResetRequest$json,
  '.publira.v1.RequestPasswordResetResponse': RequestPasswordResetResponse$json,
  '.publira.v1.ConfirmPasswordResetRequest': ConfirmPasswordResetRequest$json,
  '.publira.v1.ConfirmPasswordResetResponse': ConfirmPasswordResetResponse$json,
  '.publira.v1.ChangePasswordRequest': ChangePasswordRequest$json,
  '.publira.v1.ChangePasswordResponse': ChangePasswordResponse$json,
  '.publira.v1.LogoutRequest': LogoutRequest$json,
  '.publira.v1.LogoutResponse': LogoutResponse$json,
  '.publira.v1.GetMeRequest': GetMeRequest$json,
  '.publira.v1.GetMeResponse': GetMeResponse$json,
  '.publira.v1.UpdateMeRequest': UpdateMeRequest$json,
  '.publira.v1.UpdateMeResponse': UpdateMeResponse$json,
  '.publira.v1.UploadMyIconRequest': UploadMyIconRequest$json,
  '.publira.types.v1.ImageCropRect': $0.ImageCropRect$json,
  '.publira.v1.UploadMyIconResponse': UploadMyIconResponse$json,
  '.publira.v1.SelectMyIconRequest': SelectMyIconRequest$json,
  '.publira.v1.SelectMyIconResponse': SelectMyIconResponse$json,
  '.publira.v1.DeleteMyIconRequest': DeleteMyIconRequest$json,
  '.publira.v1.DeleteMyIconResponse': DeleteMyIconResponse$json,
  '.publira.v1.DeleteMeRequest': DeleteMeRequest$json,
  '.publira.v1.DeleteMeResponse': DeleteMeResponse$json,
  '.publira.v1.GetNotificationSettingsRequest':
      GetNotificationSettingsRequest$json,
  '.publira.v1.GetNotificationSettingsResponse':
      GetNotificationSettingsResponse$json,
  '.publira.v1.UpdateNotificationSettingsRequest':
      UpdateNotificationSettingsRequest$json,
  '.publira.v1.UpdateNotificationSettingsResponse':
      UpdateNotificationSettingsResponse$json,
  '.publira.v1.GetViewerPreferencesRequest': GetViewerPreferencesRequest$json,
  '.publira.v1.GetViewerPreferencesResponse': GetViewerPreferencesResponse$json,
  '.publira.v1.ViewerPreferences': ViewerPreferences$json,
  '.publira.v1.UpdateViewerPreferencesRequest':
      UpdateViewerPreferencesRequest$json,
  '.publira.v1.UpdateViewerPreferencesResponse':
      UpdateViewerPreferencesResponse$json,
  '.publira.v1.GetAnnouncementRequest': GetAnnouncementRequest$json,
  '.publira.v1.GetAnnouncementResponse': GetAnnouncementResponse$json,
  '.publira.v1.AnnouncementItem': AnnouncementItem$json,
  '.publira.v1.GetPinnedAnnouncementRequest': GetPinnedAnnouncementRequest$json,
  '.publira.v1.GetPinnedAnnouncementResponse':
      GetPinnedAnnouncementResponse$json,
  '.publira.v1.ListAnnouncementsRequest': ListAnnouncementsRequest$json,
  '.publira.v1.ListAnnouncementsResponse': ListAnnouncementsResponse$json,
  '.publira.v1.MarkAnnouncementAsReadRequest':
      MarkAnnouncementAsReadRequest$json,
  '.publira.v1.MarkAnnouncementAsReadResponse':
      MarkAnnouncementAsReadResponse$json,
  '.publira.v1.MarkAllAnnouncementsAsReadRequest':
      MarkAllAnnouncementsAsReadRequest$json,
  '.publira.v1.MarkAllAnnouncementsAsReadResponse':
      MarkAllAnnouncementsAsReadResponse$json,
  '.publira.v1.GetMyLegalPageAgreementsRequest':
      GetMyLegalPageAgreementsRequest$json,
  '.publira.v1.GetMyLegalPageAgreementsResponse':
      GetMyLegalPageAgreementsResponse$json,
  '.publira.v1.TenantLegalPage': $1.TenantLegalPage$json,
  '.publira.v1.AgreeToLegalPagesRequest': AgreeToLegalPagesRequest$json,
  '.publira.v1.AgreeToLegalPagesResponse': AgreeToLegalPagesResponse$json,
};

/// Descriptor for `AuthService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List authServiceDescriptor = $convert.base64Decode(
    'CgtBdXRoU2VydmljZRI8CgVMb2dpbhIYLnB1YmxpcmEudjEuTG9naW5SZXF1ZXN0GhkucHVibG'
    'lyYS52MS5Mb2dpblJlc3BvbnNlEl0KEExvZ2luV2l0aElkVG9rZW4SIy5wdWJsaXJhLnYxLkxv'
    'Z2luV2l0aElkVG9rZW5SZXF1ZXN0GiQucHVibGlyYS52MS5Mb2dpbldpdGhJZFRva2VuUmVzcG'
    '9uc2USXQoQTGlzdE15SWRlbnRpdGllcxIjLnB1YmxpcmEudjEuTGlzdE15SWRlbnRpdGllc1Jl'
    'cXVlc3QaJC5wdWJsaXJhLnYxLkxpc3RNeUlkZW50aXRpZXNSZXNwb25zZRJXCg5VbmxpbmtJZG'
    'VudGl0eRIhLnB1YmxpcmEudjEuVW5saW5rSWRlbnRpdHlSZXF1ZXN0GiIucHVibGlyYS52MS5V'
    'bmxpbmtJZGVudGl0eVJlc3BvbnNlElEKDExpbmtJZGVudGl0eRIfLnB1YmxpcmEudjEuTGlua0'
    'lkZW50aXR5UmVxdWVzdBogLnB1YmxpcmEudjEuTGlua0lkZW50aXR5UmVzcG9uc2USYAoRQmVn'
    'aW5QYXNza2V5TG9naW4SJC5wdWJsaXJhLnYxLkJlZ2luUGFzc2tleUxvZ2luUmVxdWVzdBolLn'
    'B1YmxpcmEudjEuQmVnaW5QYXNza2V5TG9naW5SZXNwb25zZRJjChJGaW5pc2hQYXNza2V5TG9n'
    'aW4SJS5wdWJsaXJhLnYxLkZpbmlzaFBhc3NrZXlMb2dpblJlcXVlc3QaJi5wdWJsaXJhLnYxLk'
    'ZpbmlzaFBhc3NrZXlMb2dpblJlc3BvbnNlEnUKGEJlZ2luUGFzc2tleVJlZ2lzdHJhdGlvbhIr'
    'LnB1YmxpcmEudjEuQmVnaW5QYXNza2V5UmVnaXN0cmF0aW9uUmVxdWVzdBosLnB1YmxpcmEudj'
    'EuQmVnaW5QYXNza2V5UmVnaXN0cmF0aW9uUmVzcG9uc2USeAoZRmluaXNoUGFzc2tleVJlZ2lz'
    'dHJhdGlvbhIsLnB1YmxpcmEudjEuRmluaXNoUGFzc2tleVJlZ2lzdHJhdGlvblJlcXVlc3QaLS'
    '5wdWJsaXJhLnYxLkZpbmlzaFBhc3NrZXlSZWdpc3RyYXRpb25SZXNwb25zZRJXCg5MaXN0TXlQ'
    'YXNza2V5cxIhLnB1YmxpcmEudjEuTGlzdE15UGFzc2tleXNSZXF1ZXN0GiIucHVibGlyYS52MS'
    '5MaXN0TXlQYXNza2V5c1Jlc3BvbnNlElQKDVJlbmFtZVBhc3NrZXkSIC5wdWJsaXJhLnYxLlJl'
    'bmFtZVBhc3NrZXlSZXF1ZXN0GiEucHVibGlyYS52MS5SZW5hbWVQYXNza2V5UmVzcG9uc2USVA'
    'oNRGVsZXRlUGFzc2tleRIgLnB1YmxpcmEudjEuRGVsZXRlUGFzc2tleVJlcXVlc3QaIS5wdWJs'
    'aXJhLnYxLkRlbGV0ZVBhc3NrZXlSZXNwb25zZRJ1ChhCZWdpblBhc3NrZXlDb25maXJtYXRpb2'
    '4SKy5wdWJsaXJhLnYxLkJlZ2luUGFzc2tleUNvbmZpcm1hdGlvblJlcXVlc3QaLC5wdWJsaXJh'
    'LnYxLkJlZ2luUGFzc2tleUNvbmZpcm1hdGlvblJlc3BvbnNlEksKCkNyZWF0ZVVzZXISHS5wdW'
    'JsaXJhLnYxLkNyZWF0ZVVzZXJSZXF1ZXN0Gh4ucHVibGlyYS52MS5DcmVhdGVVc2VyUmVzcG9u'
    'c2USWgoPVmVyaWZ5VXNlckVtYWlsEiIucHVibGlyYS52MS5WZXJpZnlVc2VyRW1haWxSZXF1ZX'
    'N0GiMucHVibGlyYS52MS5WZXJpZnlVc2VyRW1haWxSZXNwb25zZRJ1ChhSZXF1ZXN0RW1haWxW'
    'ZXJpZmljYXRpb24SKy5wdWJsaXJhLnYxLlJlcXVlc3RFbWFpbFZlcmlmaWNhdGlvblJlcXVlc3'
    'QaLC5wdWJsaXJhLnYxLlJlcXVlc3RFbWFpbFZlcmlmaWNhdGlvblJlc3BvbnNlEmMKElJlcXVl'
    'c3RFbWFpbENoYW5nZRIlLnB1YmxpcmEudjEuUmVxdWVzdEVtYWlsQ2hhbmdlUmVxdWVzdBomLn'
    'B1YmxpcmEudjEuUmVxdWVzdEVtYWlsQ2hhbmdlUmVzcG9uc2USYwoSQ29uZmlybUVtYWlsQ2hh'
    'bmdlEiUucHVibGlyYS52MS5Db25maXJtRW1haWxDaGFuZ2VSZXF1ZXN0GiYucHVibGlyYS52MS'
    '5Db25maXJtRW1haWxDaGFuZ2VSZXNwb25zZRJpChRSZXF1ZXN0UGFzc3dvcmRSZXNldBInLnB1'
    'YmxpcmEudjEuUmVxdWVzdFBhc3N3b3JkUmVzZXRSZXF1ZXN0GigucHVibGlyYS52MS5SZXF1ZX'
    'N0UGFzc3dvcmRSZXNldFJlc3BvbnNlEmkKFENvbmZpcm1QYXNzd29yZFJlc2V0EicucHVibGly'
    'YS52MS5Db25maXJtUGFzc3dvcmRSZXNldFJlcXVlc3QaKC5wdWJsaXJhLnYxLkNvbmZpcm1QYX'
    'Nzd29yZFJlc2V0UmVzcG9uc2USVwoOQ2hhbmdlUGFzc3dvcmQSIS5wdWJsaXJhLnYxLkNoYW5n'
    'ZVBhc3N3b3JkUmVxdWVzdBoiLnB1YmxpcmEudjEuQ2hhbmdlUGFzc3dvcmRSZXNwb25zZRI/Cg'
    'ZMb2dvdXQSGS5wdWJsaXJhLnYxLkxvZ291dFJlcXVlc3QaGi5wdWJsaXJhLnYxLkxvZ291dFJl'
    'c3BvbnNlEjwKBUdldE1lEhgucHVibGlyYS52MS5HZXRNZVJlcXVlc3QaGS5wdWJsaXJhLnYxLk'
    'dldE1lUmVzcG9uc2USRQoIVXBkYXRlTWUSGy5wdWJsaXJhLnYxLlVwZGF0ZU1lUmVxdWVzdBoc'
    'LnB1YmxpcmEudjEuVXBkYXRlTWVSZXNwb25zZRJRCgxVcGxvYWRNeUljb24SHy5wdWJsaXJhLn'
    'YxLlVwbG9hZE15SWNvblJlcXVlc3QaIC5wdWJsaXJhLnYxLlVwbG9hZE15SWNvblJlc3BvbnNl'
    'ElEKDFNlbGVjdE15SWNvbhIfLnB1YmxpcmEudjEuU2VsZWN0TXlJY29uUmVxdWVzdBogLnB1Ym'
    'xpcmEudjEuU2VsZWN0TXlJY29uUmVzcG9uc2USUQoMRGVsZXRlTXlJY29uEh8ucHVibGlyYS52'
    'MS5EZWxldGVNeUljb25SZXF1ZXN0GiAucHVibGlyYS52MS5EZWxldGVNeUljb25SZXNwb25zZR'
    'JFCghEZWxldGVNZRIbLnB1YmxpcmEudjEuRGVsZXRlTWVSZXF1ZXN0GhwucHVibGlyYS52MS5E'
    'ZWxldGVNZVJlc3BvbnNlEnIKF0dldE5vdGlmaWNhdGlvblNldHRpbmdzEioucHVibGlyYS52MS'
    '5HZXROb3RpZmljYXRpb25TZXR0aW5nc1JlcXVlc3QaKy5wdWJsaXJhLnYxLkdldE5vdGlmaWNh'
    'dGlvblNldHRpbmdzUmVzcG9uc2USewoaVXBkYXRlTm90aWZpY2F0aW9uU2V0dGluZ3MSLS5wdW'
    'JsaXJhLnYxLlVwZGF0ZU5vdGlmaWNhdGlvblNldHRpbmdzUmVxdWVzdBouLnB1YmxpcmEudjEu'
    'VXBkYXRlTm90aWZpY2F0aW9uU2V0dGluZ3NSZXNwb25zZRJpChRHZXRWaWV3ZXJQcmVmZXJlbm'
    'NlcxInLnB1YmxpcmEudjEuR2V0Vmlld2VyUHJlZmVyZW5jZXNSZXF1ZXN0GigucHVibGlyYS52'
    'MS5HZXRWaWV3ZXJQcmVmZXJlbmNlc1Jlc3BvbnNlEnIKF1VwZGF0ZVZpZXdlclByZWZlcmVuY2'
    'VzEioucHVibGlyYS52MS5VcGRhdGVWaWV3ZXJQcmVmZXJlbmNlc1JlcXVlc3QaKy5wdWJsaXJh'
    'LnYxLlVwZGF0ZVZpZXdlclByZWZlcmVuY2VzUmVzcG9uc2USWgoPR2V0QW5ub3VuY2VtZW50Ei'
    'IucHVibGlyYS52MS5HZXRBbm5vdW5jZW1lbnRSZXF1ZXN0GiMucHVibGlyYS52MS5HZXRBbm5v'
    'dW5jZW1lbnRSZXNwb25zZRJsChVHZXRQaW5uZWRBbm5vdW5jZW1lbnQSKC5wdWJsaXJhLnYxLk'
    'dldFBpbm5lZEFubm91bmNlbWVudFJlcXVlc3QaKS5wdWJsaXJhLnYxLkdldFBpbm5lZEFubm91'
    'bmNlbWVudFJlc3BvbnNlEmAKEUxpc3RBbm5vdW5jZW1lbnRzEiQucHVibGlyYS52MS5MaXN0QW'
    '5ub3VuY2VtZW50c1JlcXVlc3QaJS5wdWJsaXJhLnYxLkxpc3RBbm5vdW5jZW1lbnRzUmVzcG9u'
    'c2USbwoWTWFya0Fubm91bmNlbWVudEFzUmVhZBIpLnB1YmxpcmEudjEuTWFya0Fubm91bmNlbW'
    'VudEFzUmVhZFJlcXVlc3QaKi5wdWJsaXJhLnYxLk1hcmtBbm5vdW5jZW1lbnRBc1JlYWRSZXNw'
    'b25zZRJ7ChpNYXJrQWxsQW5ub3VuY2VtZW50c0FzUmVhZBItLnB1YmxpcmEudjEuTWFya0FsbE'
    'Fubm91bmNlbWVudHNBc1JlYWRSZXF1ZXN0Gi4ucHVibGlyYS52MS5NYXJrQWxsQW5ub3VuY2Vt'
    'ZW50c0FzUmVhZFJlc3BvbnNlEnUKGEdldE15TGVnYWxQYWdlQWdyZWVtZW50cxIrLnB1Ymxpcm'
    'EudjEuR2V0TXlMZWdhbFBhZ2VBZ3JlZW1lbnRzUmVxdWVzdBosLnB1YmxpcmEudjEuR2V0TXlM'
    'ZWdhbFBhZ2VBZ3JlZW1lbnRzUmVzcG9uc2USYAoRQWdyZWVUb0xlZ2FsUGFnZXMSJC5wdWJsaX'
    'JhLnYxLkFncmVlVG9MZWdhbFBhZ2VzUmVxdWVzdBolLnB1YmxpcmEudjEuQWdyZWVUb0xlZ2Fs'
    'UGFnZXNSZXNwb25zZQ==');
