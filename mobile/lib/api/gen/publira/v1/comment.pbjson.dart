// This is a generated file - do not edit.
//
// Generated from publira/v1/comment.proto.

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

@$core.Deprecated('Use commentReportReasonDescriptor instead')
const CommentReportReason$json = {
  '1': 'CommentReportReason',
  '2': [
    {'1': 'COMMENT_REPORT_REASON_UNSPECIFIED', '2': 0},
    {'1': 'COMMENT_REPORT_REASON_SPAM', '2': 1},
    {'1': 'COMMENT_REPORT_REASON_ABUSE', '2': 2},
    {'1': 'COMMENT_REPORT_REASON_SPOILER', '2': 3},
    {'1': 'COMMENT_REPORT_REASON_OTHER', '2': 4},
  ],
};

/// Descriptor for `CommentReportReason`. Decode as a `google.protobuf.EnumDescriptorProto`.
final $typed_data.Uint8List commentReportReasonDescriptor = $convert.base64Decode(
    'ChNDb21tZW50UmVwb3J0UmVhc29uEiUKIUNPTU1FTlRfUkVQT1JUX1JFQVNPTl9VTlNQRUNJRk'
    'lFRBAAEh4KGkNPTU1FTlRfUkVQT1JUX1JFQVNPTl9TUEFNEAESHwobQ09NTUVOVF9SRVBPUlRf'
    'UkVBU09OX0FCVVNFEAISIQodQ09NTUVOVF9SRVBPUlRfUkVBU09OX1NQT0lMRVIQAxIfChtDT0'
    '1NRU5UX1JFUE9SVF9SRUFTT05fT1RIRVIQBA==');

@$core.Deprecated('Use episodeCommentCreatorDescriptor instead')
const EpisodeCommentCreator$json = {
  '1': 'EpisodeCommentCreator',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
  ],
};

/// Descriptor for `EpisodeCommentCreator`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List episodeCommentCreatorDescriptor = $convert.base64Decode(
    'ChVFcGlzb2RlQ29tbWVudENyZWF0b3ISDgoCaWQYASABKAlSAmlkEhsKCXB1YmxpY19pZBgCIA'
    'EoCVIIcHVibGljSWQSEgoEbmFtZRgDIAEoCVIEbmFtZQ==');

@$core.Deprecated('Use episodeCommentDescriptor instead')
const EpisodeComment$json = {
  '1': 'EpisodeComment',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'body', '3': 2, '4': 1, '5': 9, '10': 'body'},
    {'1': 'created_at', '3': 3, '4': 1, '5': 9, '10': 'createdAt'},
    {'1': 'author_public_id', '3': 4, '4': 1, '5': 9, '10': 'authorPublicId'},
    {'1': 'author_name', '3': 5, '4': 1, '5': 9, '10': 'authorName'},
    {'1': 'id', '3': 6, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'creator',
      '3': 7,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.EpisodeCommentCreator',
      '10': 'creator'
    },
    {
      '1': 'author_icon_image_variants',
      '3': 8,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.UserIconVariant',
      '10': 'authorIconImageVariants'
    },
  ],
};

/// Descriptor for `EpisodeComment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List episodeCommentDescriptor = $convert.base64Decode(
    'Cg5FcGlzb2RlQ29tbWVudBIbCglwdWJsaWNfaWQYASABKAlSCHB1YmxpY0lkEhIKBGJvZHkYAi'
    'ABKAlSBGJvZHkSHQoKY3JlYXRlZF9hdBgDIAEoCVIJY3JlYXRlZEF0EigKEGF1dGhvcl9wdWJs'
    'aWNfaWQYBCABKAlSDmF1dGhvclB1YmxpY0lkEh8KC2F1dGhvcl9uYW1lGAUgASgJUgphdXRob3'
    'JOYW1lEg4KAmlkGAYgASgJUgJpZBI7CgdjcmVhdG9yGAcgASgLMiEucHVibGlyYS52MS5FcGlz'
    'b2RlQ29tbWVudENyZWF0b3JSB2NyZWF0b3ISXgoaYXV0aG9yX2ljb25faW1hZ2VfdmFyaWFudH'
    'MYCCADKAsyIS5wdWJsaXJhLnR5cGVzLnYxLlVzZXJJY29uVmFyaWFudFIXYXV0aG9ySWNvbklt'
    'YWdlVmFyaWFudHM=');

@$core.Deprecated('Use myEpisodeCommentDescriptor instead')
const MyEpisodeComment$json = {
  '1': 'MyEpisodeComment',
  '2': [
    {'1': 'public_id', '3': 1, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'body', '3': 2, '4': 1, '5': 9, '10': 'body'},
    {'1': 'created_at', '3': 3, '4': 1, '5': 9, '10': 'createdAt'},
    {
      '1': 'awaiting_approval',
      '3': 4,
      '4': 1,
      '5': 8,
      '10': 'awaitingApproval'
    },
    {'1': 'id', '3': 5, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'creator',
      '3': 6,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.EpisodeCommentCreator',
      '10': 'creator'
    },
  ],
};

/// Descriptor for `MyEpisodeComment`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List myEpisodeCommentDescriptor = $convert.base64Decode(
    'ChBNeUVwaXNvZGVDb21tZW50EhsKCXB1YmxpY19pZBgBIAEoCVIIcHVibGljSWQSEgoEYm9keR'
    'gCIAEoCVIEYm9keRIdCgpjcmVhdGVkX2F0GAMgASgJUgljcmVhdGVkQXQSKwoRYXdhaXRpbmdf'
    'YXBwcm92YWwYBCABKAhSEGF3YWl0aW5nQXBwcm92YWwSDgoCaWQYBSABKAlSAmlkEjsKB2NyZW'
    'F0b3IYBiABKAsyIS5wdWJsaXJhLnYxLkVwaXNvZGVDb21tZW50Q3JlYXRvclIHY3JlYXRvcg==');

@$core.Deprecated('Use listEpisodeCommentsRequestDescriptor instead')
const ListEpisodeCommentsRequest$json = {
  '1': 'ListEpisodeCommentsRequest',
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
    {'1': 'episode_id', '3': 6, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `ListEpisodeCommentsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listEpisodeCommentsRequestDescriptor = $convert.base64Decode(
    'ChpMaXN0RXBpc29kZUNvbW1lbnRzUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaXJhLn'
    'R5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIUCgVsaW1pdBgDIAEoBVIFbGltaXQSFAoF'
    'dG9rZW4YBCABKAlSBXRva2VuEjkKB3N1cmZhY2UYBSABKA4yHy5wdWJsaXJhLnR5cGVzLnYxLk'
    'NsaWVudFN1cmZhY2VSB3N1cmZhY2USHQoKZXBpc29kZV9pZBgGIAEoCVIJZXBpc29kZUlkSgQI'
    'AhADUhFlcGlzb2RlX3B1YmxpY19pZA==');

@$core.Deprecated('Use listEpisodeCommentsResponseDescriptor instead')
const ListEpisodeCommentsResponse$json = {
  '1': 'ListEpisodeCommentsResponse',
  '2': [
    {
      '1': 'comments',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.EpisodeComment',
      '10': 'comments'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListEpisodeCommentsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listEpisodeCommentsResponseDescriptor =
    $convert.base64Decode(
        'ChtMaXN0RXBpc29kZUNvbW1lbnRzUmVzcG9uc2USNgoIY29tbWVudHMYASADKAsyGi5wdWJsaX'
        'JhLnYxLkVwaXNvZGVDb21tZW50Ughjb21tZW50cxIlCg5wcmV2aW91c190b2tlbhgCIAEoCVIN'
        'cHJldmlvdXNUb2tlbhIdCgpuZXh0X3Rva2VuGAMgASgJUgluZXh0VG9rZW4=');

@$core.Deprecated('Use listMyEpisodeCommentsRequestDescriptor instead')
const ListMyEpisodeCommentsRequest$json = {
  '1': 'ListMyEpisodeCommentsRequest',
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
    {'1': 'episode_id', '3': 6, '4': 1, '5': 9, '10': 'episodeId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['episode_public_id'],
};

/// Descriptor for `ListMyEpisodeCommentsRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyEpisodeCommentsRequestDescriptor = $convert.base64Decode(
    'ChxMaXN0TXlFcGlzb2RlQ29tbWVudHNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhQKBWxpbWl0GAMgASgFUgVsaW1pdBIU'
    'CgV0b2tlbhgEIAEoCVIFdG9rZW4SOQoHc3VyZmFjZRgFIAEoDjIfLnB1YmxpcmEudHlwZXMudj'
    'EuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCgplcGlzb2RlX2lkGAYgASgJUgllcGlzb2RlSWRK'
    'BAgCEANSEWVwaXNvZGVfcHVibGljX2lk');

@$core.Deprecated('Use listMyEpisodeCommentsResponseDescriptor instead')
const ListMyEpisodeCommentsResponse$json = {
  '1': 'ListMyEpisodeCommentsResponse',
  '2': [
    {
      '1': 'comments',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.MyEpisodeComment',
      '10': 'comments'
    },
    {'1': 'previous_token', '3': 2, '4': 1, '5': 9, '10': 'previousToken'},
    {'1': 'next_token', '3': 3, '4': 1, '5': 9, '10': 'nextToken'},
  ],
};

/// Descriptor for `ListMyEpisodeCommentsResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listMyEpisodeCommentsResponseDescriptor =
    $convert.base64Decode(
        'Ch1MaXN0TXlFcGlzb2RlQ29tbWVudHNSZXNwb25zZRI4Cghjb21tZW50cxgBIAMoCzIcLnB1Ym'
        'xpcmEudjEuTXlFcGlzb2RlQ29tbWVudFIIY29tbWVudHMSJQoOcHJldmlvdXNfdG9rZW4YAiAB'
        'KAlSDXByZXZpb3VzVG9rZW4SHQoKbmV4dF90b2tlbhgDIAEoCVIJbmV4dFRva2Vu');

@$core.Deprecated('Use postEpisodeCommentRequestDescriptor instead')
const PostEpisodeCommentRequest$json = {
  '1': 'PostEpisodeCommentRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'body', '3': 3, '4': 1, '5': 9, '10': 'body'},
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

/// Descriptor for `PostEpisodeCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postEpisodeCommentRequestDescriptor = $convert.base64Decode(
    'ChlQb3N0RXBpc29kZUNvbW1lbnRSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1YmxpcmEudH'
    'lwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EhIKBGJvZHkYAyABKAlSBGJvZHkSOQoHc3Vy'
    'ZmFjZRgEIAEoDjIfLnB1YmxpcmEudHlwZXMudjEuQ2xpZW50U3VyZmFjZVIHc3VyZmFjZRIdCg'
    'plcGlzb2RlX2lkGAUgASgJUgllcGlzb2RlSWRKBAgCEANSEWVwaXNvZGVfcHVibGljX2lk');

@$core.Deprecated('Use postEpisodeCommentResponseDescriptor instead')
const PostEpisodeCommentResponse$json = {
  '1': 'PostEpisodeCommentResponse',
  '2': [
    {
      '1': 'comment',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.MyEpisodeComment',
      '10': 'comment'
    },
  ],
};

/// Descriptor for `PostEpisodeCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List postEpisodeCommentResponseDescriptor =
    $convert.base64Decode(
        'ChpQb3N0RXBpc29kZUNvbW1lbnRSZXNwb25zZRI2Cgdjb21tZW50GAEgASgLMhwucHVibGlyYS'
        '52MS5NeUVwaXNvZGVDb21tZW50Ugdjb21tZW50');

@$core.Deprecated('Use withdrawEpisodeCommentRequestDescriptor instead')
const WithdrawEpisodeCommentRequest$json = {
  '1': 'WithdrawEpisodeCommentRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'comment_id', '3': 3, '4': 1, '5': 9, '10': 'commentId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['comment_public_id'],
};

/// Descriptor for `WithdrawEpisodeCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List withdrawEpisodeCommentRequestDescriptor =
    $convert.base64Decode(
        'Ch1XaXRoZHJhd0VwaXNvZGVDb21tZW50UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
        'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIdCgpjb21tZW50X2lkGAMgASgJUglj'
        'b21tZW50SWRKBAgCEANSEWNvbW1lbnRfcHVibGljX2lk');

@$core.Deprecated('Use withdrawEpisodeCommentResponseDescriptor instead')
const WithdrawEpisodeCommentResponse$json = {
  '1': 'WithdrawEpisodeCommentResponse',
};

/// Descriptor for `WithdrawEpisodeCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List withdrawEpisodeCommentResponseDescriptor =
    $convert.base64Decode('Ch5XaXRoZHJhd0VwaXNvZGVDb21tZW50UmVzcG9uc2U=');

@$core.Deprecated('Use reportEpisodeCommentRequestDescriptor instead')
const ReportEpisodeCommentRequest$json = {
  '1': 'ReportEpisodeCommentRequest',
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
      '1': 'reason',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.CommentReportReason',
      '10': 'reason'
    },
    {'1': 'note', '3': 4, '4': 1, '5': 9, '10': 'note'},
    {
      '1': 'surface',
      '3': 5,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.ClientSurface',
      '10': 'surface'
    },
    {'1': 'comment_id', '3': 6, '4': 1, '5': 9, '10': 'commentId'},
  ],
  '9': [
    {'1': 2, '2': 3},
  ],
  '10': ['comment_public_id'],
};

/// Descriptor for `ReportEpisodeCommentRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List reportEpisodeCommentRequestDescriptor = $convert.base64Decode(
    'ChtSZXBvcnRFcGlzb2RlQ29tbWVudFJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS'
    '50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQSNwoGcmVhc29uGAMgASgOMh8ucHVibGly'
    'YS52MS5Db21tZW50UmVwb3J0UmVhc29uUgZyZWFzb24SEgoEbm90ZRgEIAEoCVIEbm90ZRI5Cg'
    'dzdXJmYWNlGAUgASgOMh8ucHVibGlyYS50eXBlcy52MS5DbGllbnRTdXJmYWNlUgdzdXJmYWNl'
    'Eh0KCmNvbW1lbnRfaWQYBiABKAlSCWNvbW1lbnRJZEoECAIQA1IRY29tbWVudF9wdWJsaWNfaW'
    'Q=');

@$core.Deprecated('Use reportEpisodeCommentResponseDescriptor instead')
const ReportEpisodeCommentResponse$json = {
  '1': 'ReportEpisodeCommentResponse',
};

/// Descriptor for `ReportEpisodeCommentResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List reportEpisodeCommentResponseDescriptor =
    $convert.base64Decode('ChxSZXBvcnRFcGlzb2RlQ29tbWVudFJlc3BvbnNl');

const $core.Map<$core.String, $core.dynamic> CommentServiceBase$json = {
  '1': 'CommentService',
  '2': [
    {
      '1': 'ListEpisodeComments',
      '2': '.publira.v1.ListEpisodeCommentsRequest',
      '3': '.publira.v1.ListEpisodeCommentsResponse'
    },
    {
      '1': 'ListMyEpisodeComments',
      '2': '.publira.v1.ListMyEpisodeCommentsRequest',
      '3': '.publira.v1.ListMyEpisodeCommentsResponse'
    },
    {
      '1': 'PostEpisodeComment',
      '2': '.publira.v1.PostEpisodeCommentRequest',
      '3': '.publira.v1.PostEpisodeCommentResponse'
    },
    {
      '1': 'WithdrawEpisodeComment',
      '2': '.publira.v1.WithdrawEpisodeCommentRequest',
      '3': '.publira.v1.WithdrawEpisodeCommentResponse'
    },
    {
      '1': 'ReportEpisodeComment',
      '2': '.publira.v1.ReportEpisodeCommentRequest',
      '3': '.publira.v1.ReportEpisodeCommentResponse'
    },
  ],
};

@$core.Deprecated('Use commentServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    CommentServiceBase$messageJson = {
  '.publira.v1.ListEpisodeCommentsRequest': ListEpisodeCommentsRequest$json,
  '.publira.types.v1.TenantContext': $0.TenantContext$json,
  '.publira.v1.ListEpisodeCommentsResponse': ListEpisodeCommentsResponse$json,
  '.publira.v1.EpisodeComment': EpisodeComment$json,
  '.publira.v1.EpisodeCommentCreator': EpisodeCommentCreator$json,
  '.publira.types.v1.UserIconVariant': $0.UserIconVariant$json,
  '.publira.v1.ListMyEpisodeCommentsRequest': ListMyEpisodeCommentsRequest$json,
  '.publira.v1.ListMyEpisodeCommentsResponse':
      ListMyEpisodeCommentsResponse$json,
  '.publira.v1.MyEpisodeComment': MyEpisodeComment$json,
  '.publira.v1.PostEpisodeCommentRequest': PostEpisodeCommentRequest$json,
  '.publira.v1.PostEpisodeCommentResponse': PostEpisodeCommentResponse$json,
  '.publira.v1.WithdrawEpisodeCommentRequest':
      WithdrawEpisodeCommentRequest$json,
  '.publira.v1.WithdrawEpisodeCommentResponse':
      WithdrawEpisodeCommentResponse$json,
  '.publira.v1.ReportEpisodeCommentRequest': ReportEpisodeCommentRequest$json,
  '.publira.v1.ReportEpisodeCommentResponse': ReportEpisodeCommentResponse$json,
};

/// Descriptor for `CommentService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List commentServiceDescriptor = $convert.base64Decode(
    'Cg5Db21tZW50U2VydmljZRJmChNMaXN0RXBpc29kZUNvbW1lbnRzEiYucHVibGlyYS52MS5MaX'
    'N0RXBpc29kZUNvbW1lbnRzUmVxdWVzdBonLnB1YmxpcmEudjEuTGlzdEVwaXNvZGVDb21tZW50'
    'c1Jlc3BvbnNlEmwKFUxpc3RNeUVwaXNvZGVDb21tZW50cxIoLnB1YmxpcmEudjEuTGlzdE15RX'
    'Bpc29kZUNvbW1lbnRzUmVxdWVzdBopLnB1YmxpcmEudjEuTGlzdE15RXBpc29kZUNvbW1lbnRz'
    'UmVzcG9uc2USYwoSUG9zdEVwaXNvZGVDb21tZW50EiUucHVibGlyYS52MS5Qb3N0RXBpc29kZU'
    'NvbW1lbnRSZXF1ZXN0GiYucHVibGlyYS52MS5Qb3N0RXBpc29kZUNvbW1lbnRSZXNwb25zZRJv'
    'ChZXaXRoZHJhd0VwaXNvZGVDb21tZW50EikucHVibGlyYS52MS5XaXRoZHJhd0VwaXNvZGVDb2'
    '1tZW50UmVxdWVzdBoqLnB1YmxpcmEudjEuV2l0aGRyYXdFcGlzb2RlQ29tbWVudFJlc3BvbnNl'
    'EmkKFFJlcG9ydEVwaXNvZGVDb21tZW50EicucHVibGlyYS52MS5SZXBvcnRFcGlzb2RlQ29tbW'
    'VudFJlcXVlc3QaKC5wdWJsaXJhLnYxLlJlcG9ydEVwaXNvZGVDb21tZW50UmVzcG9uc2U=');
