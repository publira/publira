// This is a generated file - do not edit.
//
// Generated from publira/v1/page.proto.

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

@$core.Deprecated('Use listPublishedPagesRequestDescriptor instead')
const ListPublishedPagesRequest$json = {
  '1': 'ListPublishedPagesRequest',
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

/// Descriptor for `ListPublishedPagesRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedPagesRequestDescriptor =
    $convert.base64Decode(
        'ChlMaXN0UHVibGlzaGVkUGFnZXNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
        'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhYKBmxvY2FsZRgCIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use listPublishedPagesResponseDescriptor instead')
const ListPublishedPagesResponse$json = {
  '1': 'ListPublishedPagesResponse',
  '2': [
    {
      '1': 'pages',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Page',
      '10': 'pages'
    },
  ],
};

/// Descriptor for `ListPublishedPagesResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedPagesResponseDescriptor =
    $convert.base64Decode(
        'ChpMaXN0UHVibGlzaGVkUGFnZXNSZXNwb25zZRIsCgVwYWdlcxgBIAMoCzIWLnB1YmxpcmEudH'
        'lwZXMudjEuUGFnZVIFcGFnZXM=');

@$core.Deprecated('Use listPublishedPageSlugsRequestDescriptor instead')
const ListPublishedPageSlugsRequest$json = {
  '1': 'ListPublishedPageSlugsRequest',
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

/// Descriptor for `ListPublishedPageSlugsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedPageSlugsRequestDescriptor =
    $convert.base64Decode(
        'Ch1MaXN0UHVibGlzaGVkUGFnZVNsdWdzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
        'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudA==');

@$core.Deprecated('Use listPublishedPageSlugsResponseDescriptor instead')
const ListPublishedPageSlugsResponse$json = {
  '1': 'ListPublishedPageSlugsResponse',
  '2': [
    {'1': 'slugs', '3': 1, '4': 3, '5': 9, '10': 'slugs'},
  ],
};

/// Descriptor for `ListPublishedPageSlugsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listPublishedPageSlugsResponseDescriptor =
    $convert.base64Decode(
        'Ch5MaXN0UHVibGlzaGVkUGFnZVNsdWdzUmVzcG9uc2USFAoFc2x1Z3MYASADKAlSBXNsdWdz');

@$core.Deprecated('Use getPublishedPageRequestDescriptor instead')
const GetPublishedPageRequest$json = {
  '1': 'GetPublishedPageRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'slug', '3': 2, '4': 1, '5': 9, '10': 'slug'},
    {'1': 'locale', '3': 3, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `GetPublishedPageRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedPageRequestDescriptor = $convert.base64Decode(
    'ChdHZXRQdWJsaXNoZWRQYWdlUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLnR5cG'
    'VzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBISCgRzbHVnGAIgASgJUgRzbHVnEhYKBmxvY2Fs'
    'ZRgDIAEoCVIGbG9jYWxl');

@$core.Deprecated('Use getPublishedPageResponseDescriptor instead')
const GetPublishedPageResponse$json = {
  '1': 'GetPublishedPageResponse',
  '2': [
    {
      '1': 'page',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.Page',
      '10': 'page'
    },
    {
      '1': 'version',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.PageVersion',
      '10': 'version'
    },
    {
      '1': 'published_locales',
      '3': 3,
      '4': 3,
      '5': 9,
      '10': 'publishedLocales'
    },
  ],
};

/// Descriptor for `GetPublishedPageResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getPublishedPageResponseDescriptor = $convert.base64Decode(
    'ChhHZXRQdWJsaXNoZWRQYWdlUmVzcG9uc2USKgoEcGFnZRgBIAEoCzIWLnB1YmxpcmEudHlwZX'
    'MudjEuUGFnZVIEcGFnZRI3Cgd2ZXJzaW9uGAIgASgLMh0ucHVibGlyYS50eXBlcy52MS5QYWdl'
    'VmVyc2lvblIHdmVyc2lvbhIrChFwdWJsaXNoZWRfbG9jYWxlcxgDIAMoCVIQcHVibGlzaGVkTG'
    '9jYWxlcw==');

const $core.Map<$core.String, $core.dynamic> PublicPagesServiceBase$json = {
  '1': 'PublicPagesService',
  '2': [
    {
      '1': 'ListPublishedPages',
      '2': '.publira.v1.ListPublishedPagesRequest',
      '3': '.publira.v1.ListPublishedPagesResponse'
    },
    {
      '1': 'ListPublishedPageSlugs',
      '2': '.publira.v1.ListPublishedPageSlugsRequest',
      '3': '.publira.v1.ListPublishedPageSlugsResponse'
    },
    {
      '1': 'GetPublishedPage',
      '2': '.publira.v1.GetPublishedPageRequest',
      '3': '.publira.v1.GetPublishedPageResponse'
    },
  ],
};

@$core.Deprecated('Use publicPagesServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    PublicPagesServiceBase$messageJson = {
  '.publira.v1.ListPublishedPagesRequest': ListPublishedPagesRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ListPublishedPagesResponse': ListPublishedPagesResponse$json,
  '.publira.types.v1.Page': $0.Page$json,
  '.publira.v1.ListPublishedPageSlugsRequest':
      ListPublishedPageSlugsRequest$json,
  '.publira.v1.ListPublishedPageSlugsResponse':
      ListPublishedPageSlugsResponse$json,
  '.publira.v1.GetPublishedPageRequest': GetPublishedPageRequest$json,
  '.publira.v1.GetPublishedPageResponse': GetPublishedPageResponse$json,
  '.publira.types.v1.PageVersion': $0.PageVersion$json,
};

/// Descriptor for `PublicPagesService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List publicPagesServiceDescriptor = $convert.base64Decode(
    'ChJQdWJsaWNQYWdlc1NlcnZpY2USYwoSTGlzdFB1Ymxpc2hlZFBhZ2VzEiUucHVibGlyYS52MS'
    '5MaXN0UHVibGlzaGVkUGFnZXNSZXF1ZXN0GiYucHVibGlyYS52MS5MaXN0UHVibGlzaGVkUGFn'
    'ZXNSZXNwb25zZRJvChZMaXN0UHVibGlzaGVkUGFnZVNsdWdzEikucHVibGlyYS52MS5MaXN0UH'
    'VibGlzaGVkUGFnZVNsdWdzUmVxdWVzdBoqLnB1YmxpcmEudjEuTGlzdFB1Ymxpc2hlZFBhZ2VT'
    'bHVnc1Jlc3BvbnNlEl0KEEdldFB1Ymxpc2hlZFBhZ2USIy5wdWJsaXJhLnYxLkdldFB1Ymxpc2'
    'hlZFBhZ2VSZXF1ZXN0GiQucHVibGlyYS52MS5HZXRQdWJsaXNoZWRQYWdlUmVzcG9uc2U=');
