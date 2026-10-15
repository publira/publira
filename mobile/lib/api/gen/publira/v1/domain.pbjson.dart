// This is a generated file - do not edit.
//
// Generated from publira/v1/domain.proto.

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

@$core.Deprecated('Use getTenantByDomainRequestDescriptor instead')
const GetTenantByDomainRequest$json = {
  '1': 'GetTenantByDomainRequest',
  '2': [
    {'1': 'domains', '3': 1, '4': 3, '5': 9, '10': 'domains'},
  ],
};

/// Descriptor for `GetTenantByDomainRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantByDomainRequestDescriptor =
    $convert.base64Decode(
        'ChhHZXRUZW5hbnRCeURvbWFpblJlcXVlc3QSGAoHZG9tYWlucxgBIAMoCVIHZG9tYWlucw==');

@$core.Deprecated('Use getTenantByDomainResponseDescriptor instead')
const GetTenantByDomainResponse$json = {
  '1': 'GetTenantByDomainResponse',
  '2': [
    {'1': 'tenant_id', '3': 1, '4': 1, '5': 9, '10': 'tenantId'},
    {'1': 'default_locale', '3': 2, '4': 1, '5': 9, '10': 'defaultLocale'},
    {
      '1': 'supported_locales',
      '3': 3,
      '4': 3,
      '5': 9,
      '10': 'supportedLocales'
    },
  ],
};

/// Descriptor for `GetTenantByDomainResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getTenantByDomainResponseDescriptor = $convert.base64Decode(
    'ChlHZXRUZW5hbnRCeURvbWFpblJlc3BvbnNlEhsKCXRlbmFudF9pZBgBIAEoCVIIdGVuYW50SW'
    'QSJQoOZGVmYXVsdF9sb2NhbGUYAiABKAlSDWRlZmF1bHRMb2NhbGUSKwoRc3VwcG9ydGVkX2xv'
    'Y2FsZXMYAyADKAlSEHN1cHBvcnRlZExvY2FsZXM=');

const $core.Map<$core.String, $core.dynamic> DomainServiceBase$json = {
  '1': 'DomainService',
  '2': [
    {
      '1': 'GetTenantByDomain',
      '2': '.publira.v1.GetTenantByDomainRequest',
      '3': '.publira.v1.GetTenantByDomainResponse'
    },
  ],
};

@$core.Deprecated('Use domainServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    DomainServiceBase$messageJson = {
  '.publira.v1.GetTenantByDomainRequest': GetTenantByDomainRequest$json,
  '.publira.v1.GetTenantByDomainResponse': GetTenantByDomainResponse$json,
};

/// Descriptor for `DomainService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List domainServiceDescriptor = $convert.base64Decode(
    'Cg1Eb21haW5TZXJ2aWNlEmAKEUdldFRlbmFudEJ5RG9tYWluEiQucHVibGlyYS52MS5HZXRUZW'
    '5hbnRCeURvbWFpblJlcXVlc3QaJS5wdWJsaXJhLnYxLkdldFRlbmFudEJ5RG9tYWluUmVzcG9u'
    'c2U=');
