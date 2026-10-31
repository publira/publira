// This is a generated file - do not edit.
//
// Generated from publira/v1/subscription.proto.

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

import '../types/v1/types.pbjson.dart' as $1;
import 'catalog.pbjson.dart' as $0;

@$core.Deprecated('Use subscriptionPlanDescriptor instead')
const SubscriptionPlan$json = {
  '1': 'SubscriptionPlan',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {'1': 'public_id', '3': 2, '4': 1, '5': 9, '10': 'publicId'},
    {'1': 'name', '3': 3, '4': 1, '5': 9, '10': 'name'},
    {'1': 'description', '3': 4, '4': 1, '5': 9, '10': 'description'},
    {'1': 'price_amount', '3': 5, '4': 1, '5': 5, '10': 'priceAmount'},
    {'1': 'currency', '3': 6, '4': 1, '5': 9, '10': 'currency'},
    {
      '1': 'interval',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SubscriptionInterval',
      '10': 'interval'
    },
    {'1': 'interval_count', '3': 8, '4': 1, '5': 5, '10': 'intervalCount'},
    {
      '1': 'scope',
      '3': 9,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SubscriptionPlanScope',
      '10': 'scope'
    },
    {'1': 'label_ids', '3': 10, '4': 3, '5': 9, '10': 'labelIds'},
    {'1': 'series_ids', '3': 11, '4': 3, '5': 9, '10': 'seriesIds'},
    {
      '1': 'labels',
      '3': 12,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.PublishedLabel',
      '10': 'labels'
    },
    {
      '1': 'series',
      '3': 13,
      '4': 3,
      '5': 11,
      '6': '.publira.types.v1.Series',
      '10': 'series'
    },
    {
      '1': 'app_store_product_id',
      '3': 14,
      '4': 1,
      '5': 9,
      '10': 'appStoreProductId'
    },
    {
      '1': 'google_play_product_id',
      '3': 15,
      '4': 1,
      '5': 9,
      '10': 'googlePlayProductId'
    },
  ],
};

/// Descriptor for `SubscriptionPlan`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List subscriptionPlanDescriptor = $convert.base64Decode(
    'ChBTdWJzY3JpcHRpb25QbGFuEg4KAmlkGAEgASgJUgJpZBIbCglwdWJsaWNfaWQYAiABKAlSCH'
    'B1YmxpY0lkEhIKBG5hbWUYAyABKAlSBG5hbWUSIAoLZGVzY3JpcHRpb24YBCABKAlSC2Rlc2Ny'
    'aXB0aW9uEiEKDHByaWNlX2Ftb3VudBgFIAEoBVILcHJpY2VBbW91bnQSGgoIY3VycmVuY3kYBi'
    'ABKAlSCGN1cnJlbmN5EkIKCGludGVydmFsGAcgASgOMiYucHVibGlyYS50eXBlcy52MS5TdWJz'
    'Y3JpcHRpb25JbnRlcnZhbFIIaW50ZXJ2YWwSJQoOaW50ZXJ2YWxfY291bnQYCCABKAVSDWludG'
    'VydmFsQ291bnQSPQoFc2NvcGUYCSABKA4yJy5wdWJsaXJhLnR5cGVzLnYxLlN1YnNjcmlwdGlv'
    'blBsYW5TY29wZVIFc2NvcGUSGwoJbGFiZWxfaWRzGAogAygJUghsYWJlbElkcxIdCgpzZXJpZX'
    'NfaWRzGAsgAygJUglzZXJpZXNJZHMSMgoGbGFiZWxzGAwgAygLMhoucHVibGlyYS52MS5QdWJs'
    'aXNoZWRMYWJlbFIGbGFiZWxzEjAKBnNlcmllcxgNIAMoCzIYLnB1YmxpcmEudHlwZXMudjEuU2'
    'VyaWVzUgZzZXJpZXMSLwoUYXBwX3N0b3JlX3Byb2R1Y3RfaWQYDiABKAlSEWFwcFN0b3JlUHJv'
    'ZHVjdElkEjMKFmdvb2dsZV9wbGF5X3Byb2R1Y3RfaWQYDyABKAlSE2dvb2dsZVBsYXlQcm9kdW'
    'N0SWQ=');

@$core.Deprecated('Use subscriptionDescriptor instead')
const Subscription$json = {
  '1': 'Subscription',
  '2': [
    {'1': 'id', '3': 1, '4': 1, '5': 9, '10': 'id'},
    {
      '1': 'plan',
      '3': 2,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.SubscriptionPlan',
      '10': 'plan'
    },
    {
      '1': 'status',
      '3': 3,
      '4': 1,
      '5': 14,
      '6': '.publira.types.v1.SubscriptionStatus',
      '10': 'status'
    },
    {
      '1': 'current_period_end',
      '3': 4,
      '4': 1,
      '5': 9,
      '10': 'currentPeriodEnd'
    },
    {
      '1': 'cancel_at_period_end',
      '3': 5,
      '4': 1,
      '5': 8,
      '10': 'cancelAtPeriodEnd'
    },
    {'1': 'created_at', '3': 6, '4': 1, '5': 9, '10': 'createdAt'},
    {
      '1': 'store',
      '3': 7,
      '4': 1,
      '5': 14,
      '6': '.publira.v1.InAppPurchaseStore',
      '10': 'store'
    },
  ],
};

/// Descriptor for `Subscription`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List subscriptionDescriptor = $convert.base64Decode(
    'CgxTdWJzY3JpcHRpb24SDgoCaWQYASABKAlSAmlkEjAKBHBsYW4YAiABKAsyHC5wdWJsaXJhLn'
    'YxLlN1YnNjcmlwdGlvblBsYW5SBHBsYW4SPAoGc3RhdHVzGAMgASgOMiQucHVibGlyYS50eXBl'
    'cy52MS5TdWJzY3JpcHRpb25TdGF0dXNSBnN0YXR1cxIsChJjdXJyZW50X3BlcmlvZF9lbmQYBC'
    'ABKAlSEGN1cnJlbnRQZXJpb2RFbmQSLwoUY2FuY2VsX2F0X3BlcmlvZF9lbmQYBSABKAhSEWNh'
    'bmNlbEF0UGVyaW9kRW5kEh0KCmNyZWF0ZWRfYXQYBiABKAlSCWNyZWF0ZWRBdBI0CgVzdG9yZR'
    'gHIAEoDjIeLnB1YmxpcmEudjEuSW5BcHBQdXJjaGFzZVN0b3JlUgVzdG9yZQ==');

@$core.Deprecated('Use listSubscriptionPlansRequestDescriptor instead')
const ListSubscriptionPlansRequest$json = {
  '1': 'ListSubscriptionPlansRequest',
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
    {'1': 'locale', '3': 3, '4': 1, '5': 9, '10': 'locale'},
  ],
};

/// Descriptor for `ListSubscriptionPlansRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSubscriptionPlansRequestDescriptor = $convert.base64Decode(
    'ChxMaXN0U3Vic2NyaXB0aW9uUGxhbnNSZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ymxpcm'
    'EudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjkKB3N1cmZhY2UYAiABKA4yHy5wdWJs'
    'aXJhLnR5cGVzLnYxLkNsaWVudFN1cmZhY2VSB3N1cmZhY2USFgoGbG9jYWxlGAMgASgJUgZsb2'
    'NhbGU=');

@$core.Deprecated('Use listSubscriptionPlansResponseDescriptor instead')
const ListSubscriptionPlansResponse$json = {
  '1': 'ListSubscriptionPlansResponse',
  '2': [
    {
      '1': 'plans',
      '3': 1,
      '4': 3,
      '5': 11,
      '6': '.publira.v1.SubscriptionPlan',
      '10': 'plans'
    },
  ],
};

/// Descriptor for `ListSubscriptionPlansResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List listSubscriptionPlansResponseDescriptor =
    $convert.base64Decode(
        'Ch1MaXN0U3Vic2NyaXB0aW9uUGxhbnNSZXNwb25zZRIyCgVwbGFucxgBIAMoCzIcLnB1Ymxpcm'
        'EudjEuU3Vic2NyaXB0aW9uUGxhblIFcGxhbnM=');

@$core.Deprecated('Use startSubscriptionCheckoutRequestDescriptor instead')
const StartSubscriptionCheckoutRequest$json = {
  '1': 'StartSubscriptionCheckoutRequest',
  '2': [
    {
      '1': 'tenant',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.types.v1.TenantContext',
      '10': 'tenant'
    },
    {'1': 'plan_id', '3': 2, '4': 1, '5': 9, '10': 'planId'},
  ],
};

/// Descriptor for `StartSubscriptionCheckoutRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startSubscriptionCheckoutRequestDescriptor =
    $convert.base64Decode(
        'CiBTdGFydFN1YnNjcmlwdGlvbkNoZWNrb3V0UmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdW'
        'JsaXJhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBIXCgdwbGFuX2lkGAIgASgJUgZw'
        'bGFuSWQ=');

@$core.Deprecated('Use startSubscriptionCheckoutResponseDescriptor instead')
const StartSubscriptionCheckoutResponse$json = {
  '1': 'StartSubscriptionCheckoutResponse',
  '2': [
    {'1': 'checkout_url', '3': 1, '4': 1, '5': 9, '10': 'checkoutUrl'},
  ],
};

/// Descriptor for `StartSubscriptionCheckoutResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startSubscriptionCheckoutResponseDescriptor =
    $convert.base64Decode(
        'CiFTdGFydFN1YnNjcmlwdGlvbkNoZWNrb3V0UmVzcG9uc2USIQoMY2hlY2tvdXRfdXJsGAEgAS'
        'gJUgtjaGVja291dFVybA==');

@$core.Deprecated('Use getMySubscriptionRequestDescriptor instead')
const GetMySubscriptionRequest$json = {
  '1': 'GetMySubscriptionRequest',
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

/// Descriptor for `GetMySubscriptionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySubscriptionRequestDescriptor =
    $convert.base64Decode(
        'ChhHZXRNeVN1YnNjcmlwdGlvblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucHVibGlyYS50eX'
        'Blcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use getMySubscriptionResponseDescriptor instead')
const GetMySubscriptionResponse$json = {
  '1': 'GetMySubscriptionResponse',
  '2': [
    {
      '1': 'subscription',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.Subscription',
      '10': 'subscription'
    },
  ],
};

/// Descriptor for `GetMySubscriptionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List getMySubscriptionResponseDescriptor =
    $convert.base64Decode(
        'ChlHZXRNeVN1YnNjcmlwdGlvblJlc3BvbnNlEjwKDHN1YnNjcmlwdGlvbhgBIAEoCzIYLnB1Ym'
        'xpcmEudjEuU3Vic2NyaXB0aW9uUgxzdWJzY3JpcHRpb24=');

@$core.Deprecated('Use createBillingPortalSessionRequestDescriptor instead')
const CreateBillingPortalSessionRequest$json = {
  '1': 'CreateBillingPortalSessionRequest',
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

/// Descriptor for `CreateBillingPortalSessionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createBillingPortalSessionRequestDescriptor =
    $convert.base64Decode(
        'CiFDcmVhdGVCaWxsaW5nUG9ydGFsU2Vzc2lvblJlcXVlc3QSNwoGdGVuYW50GAEgASgLMh8ucH'
        'VibGlyYS50eXBlcy52MS5UZW5hbnRDb250ZXh0UgZ0ZW5hbnQ=');

@$core.Deprecated('Use createBillingPortalSessionResponseDescriptor instead')
const CreateBillingPortalSessionResponse$json = {
  '1': 'CreateBillingPortalSessionResponse',
  '2': [
    {'1': 'url', '3': 1, '4': 1, '5': 9, '10': 'url'},
  ],
};

/// Descriptor for `CreateBillingPortalSessionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List createBillingPortalSessionResponseDescriptor =
    $convert.base64Decode(
        'CiJDcmVhdGVCaWxsaW5nUG9ydGFsU2Vzc2lvblJlc3BvbnNlEhAKA3VybBgBIAEoCVIDdXJs');

@$core.Deprecated('Use startStoreSubscriptionRequestDescriptor instead')
const StartStoreSubscriptionRequest$json = {
  '1': 'StartStoreSubscriptionRequest',
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
    {'1': 'plan_id', '3': 3, '4': 1, '5': 9, '10': 'planId'},
  ],
};

/// Descriptor for `StartStoreSubscriptionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startStoreSubscriptionRequestDescriptor = $convert.base64Decode(
    'Ch1TdGFydFN0b3JlU3Vic2NyaXB0aW9uUmVxdWVzdBI3CgZ0ZW5hbnQYASABKAsyHy5wdWJsaX'
    'JhLnR5cGVzLnYxLlRlbmFudENvbnRleHRSBnRlbmFudBI0CgVzdG9yZRgCIAEoDjIeLnB1Ymxp'
    'cmEudjEuSW5BcHBQdXJjaGFzZVN0b3JlUgVzdG9yZRIXCgdwbGFuX2lkGAMgASgJUgZwbGFuSW'
    'Q=');

@$core.Deprecated('Use startStoreSubscriptionResponseDescriptor instead')
const StartStoreSubscriptionResponse$json = {
  '1': 'StartStoreSubscriptionResponse',
  '2': [
    {'1': 'intent_id', '3': 1, '4': 1, '5': 9, '10': 'intentId'},
    {'1': 'product_id', '3': 2, '4': 1, '5': 9, '10': 'productId'},
  ],
};

/// Descriptor for `StartStoreSubscriptionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List startStoreSubscriptionResponseDescriptor =
    $convert.base64Decode(
        'Ch5TdGFydFN0b3JlU3Vic2NyaXB0aW9uUmVzcG9uc2USGwoJaW50ZW50X2lkGAEgASgJUghpbn'
        'RlbnRJZBIdCgpwcm9kdWN0X2lkGAIgASgJUglwcm9kdWN0SWQ=');

@$core.Deprecated('Use confirmStoreSubscriptionRequestDescriptor instead')
const ConfirmStoreSubscriptionRequest$json = {
  '1': 'ConfirmStoreSubscriptionRequest',
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
  ],
};

/// Descriptor for `ConfirmStoreSubscriptionRequest`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmStoreSubscriptionRequestDescriptor =
    $convert.base64Decode(
        'Ch9Db25maXJtU3RvcmVTdWJzY3JpcHRpb25SZXF1ZXN0EjcKBnRlbmFudBgBIAEoCzIfLnB1Ym'
        'xpcmEudHlwZXMudjEuVGVuYW50Q29udGV4dFIGdGVuYW50EjQKBXN0b3JlGAIgASgOMh4ucHVi'
        'bGlyYS52MS5JbkFwcFB1cmNoYXNlU3RvcmVSBXN0b3JlEiAKC3RyYW5zYWN0aW9uGAMgASgJUg'
        't0cmFuc2FjdGlvbhIdCgpwcm9kdWN0X2lkGAQgASgJUglwcm9kdWN0SWQ=');

@$core.Deprecated('Use confirmStoreSubscriptionResponseDescriptor instead')
const ConfirmStoreSubscriptionResponse$json = {
  '1': 'ConfirmStoreSubscriptionResponse',
  '2': [
    {
      '1': 'subscription',
      '3': 1,
      '4': 1,
      '5': 11,
      '6': '.publira.v1.Subscription',
      '10': 'subscription'
    },
  ],
};

/// Descriptor for `ConfirmStoreSubscriptionResponse`. Decode as a `google.protobuf.DescriptorProto`.
final $typed_data.Uint8List confirmStoreSubscriptionResponseDescriptor =
    $convert.base64Decode(
        'CiBDb25maXJtU3RvcmVTdWJzY3JpcHRpb25SZXNwb25zZRI8CgxzdWJzY3JpcHRpb24YASABKA'
        'syGC5wdWJsaXJhLnYxLlN1YnNjcmlwdGlvblIMc3Vic2NyaXB0aW9u');

const $core.Map<$core.String, $core.dynamic> SubscriptionServiceBase$json = {
  '1': 'SubscriptionService',
  '2': [
    {
      '1': 'ListSubscriptionPlans',
      '2': '.publira.v1.ListSubscriptionPlansRequest',
      '3': '.publira.v1.ListSubscriptionPlansResponse'
    },
    {
      '1': 'StartSubscriptionCheckout',
      '2': '.publira.v1.StartSubscriptionCheckoutRequest',
      '3': '.publira.v1.StartSubscriptionCheckoutResponse'
    },
    {
      '1': 'GetMySubscription',
      '2': '.publira.v1.GetMySubscriptionRequest',
      '3': '.publira.v1.GetMySubscriptionResponse'
    },
    {
      '1': 'CreateBillingPortalSession',
      '2': '.publira.v1.CreateBillingPortalSessionRequest',
      '3': '.publira.v1.CreateBillingPortalSessionResponse'
    },
    {
      '1': 'StartStoreSubscription',
      '2': '.publira.v1.StartStoreSubscriptionRequest',
      '3': '.publira.v1.StartStoreSubscriptionResponse'
    },
    {
      '1': 'ConfirmStoreSubscription',
      '2': '.publira.v1.ConfirmStoreSubscriptionRequest',
      '3': '.publira.v1.ConfirmStoreSubscriptionResponse'
    },
  ],
};

@$core.Deprecated('Use subscriptionServiceDescriptor instead')
const $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
    SubscriptionServiceBase$messageJson = {
  '.publira.v1.ListSubscriptionPlansRequest': ListSubscriptionPlansRequest$json,
  '.publira.types.v1.TenantContext': $1.TenantContext$json,
  '.publira.v1.ListSubscriptionPlansResponse':
      ListSubscriptionPlansResponse$json,
  '.publira.v1.SubscriptionPlan': SubscriptionPlan$json,
  '.publira.v1.PublishedLabel': $0.PublishedLabel$json,
  '.publira.types.v1.SeriesEyeCatchVariant': $1.SeriesEyeCatchVariant$json,
  '.publira.types.v1.Series': $1.Series$json,
  '.publira.types.v1.Label': $1.Label$json,
  '.publira.types.v1.Creator': $1.Creator$json,
  '.publira.types.v1.CreatorRole': $1.CreatorRole$json,
  '.publira.types.v1.Genre': $1.Genre$json,
  '.publira.types.v1.GenreTranslation': $1.GenreTranslation$json,
  '.publira.types.v1.Tag': $1.Tag$json,
  '.publira.v1.StartSubscriptionCheckoutRequest':
      StartSubscriptionCheckoutRequest$json,
  '.publira.v1.StartSubscriptionCheckoutResponse':
      StartSubscriptionCheckoutResponse$json,
  '.publira.v1.GetMySubscriptionRequest': GetMySubscriptionRequest$json,
  '.publira.v1.GetMySubscriptionResponse': GetMySubscriptionResponse$json,
  '.publira.v1.Subscription': Subscription$json,
  '.publira.v1.CreateBillingPortalSessionRequest':
      CreateBillingPortalSessionRequest$json,
  '.publira.v1.CreateBillingPortalSessionResponse':
      CreateBillingPortalSessionResponse$json,
  '.publira.v1.StartStoreSubscriptionRequest':
      StartStoreSubscriptionRequest$json,
  '.publira.v1.StartStoreSubscriptionResponse':
      StartStoreSubscriptionResponse$json,
  '.publira.v1.ConfirmStoreSubscriptionRequest':
      ConfirmStoreSubscriptionRequest$json,
  '.publira.v1.ConfirmStoreSubscriptionResponse':
      ConfirmStoreSubscriptionResponse$json,
};

/// Descriptor for `SubscriptionService`. Decode as a `google.protobuf.ServiceDescriptorProto`.
final $typed_data.Uint8List subscriptionServiceDescriptor = $convert.base64Decode(
    'ChNTdWJzY3JpcHRpb25TZXJ2aWNlEmwKFUxpc3RTdWJzY3JpcHRpb25QbGFucxIoLnB1Ymxpcm'
    'EudjEuTGlzdFN1YnNjcmlwdGlvblBsYW5zUmVxdWVzdBopLnB1YmxpcmEudjEuTGlzdFN1YnNj'
    'cmlwdGlvblBsYW5zUmVzcG9uc2USeAoZU3RhcnRTdWJzY3JpcHRpb25DaGVja291dBIsLnB1Ym'
    'xpcmEudjEuU3RhcnRTdWJzY3JpcHRpb25DaGVja291dFJlcXVlc3QaLS5wdWJsaXJhLnYxLlN0'
    'YXJ0U3Vic2NyaXB0aW9uQ2hlY2tvdXRSZXNwb25zZRJgChFHZXRNeVN1YnNjcmlwdGlvbhIkLn'
    'B1YmxpcmEudjEuR2V0TXlTdWJzY3JpcHRpb25SZXF1ZXN0GiUucHVibGlyYS52MS5HZXRNeVN1'
    'YnNjcmlwdGlvblJlc3BvbnNlEnsKGkNyZWF0ZUJpbGxpbmdQb3J0YWxTZXNzaW9uEi0ucHVibG'
    'lyYS52MS5DcmVhdGVCaWxsaW5nUG9ydGFsU2Vzc2lvblJlcXVlc3QaLi5wdWJsaXJhLnYxLkNy'
    'ZWF0ZUJpbGxpbmdQb3J0YWxTZXNzaW9uUmVzcG9uc2USbwoWU3RhcnRTdG9yZVN1YnNjcmlwdG'
    'lvbhIpLnB1YmxpcmEudjEuU3RhcnRTdG9yZVN1YnNjcmlwdGlvblJlcXVlc3QaKi5wdWJsaXJh'
    'LnYxLlN0YXJ0U3RvcmVTdWJzY3JpcHRpb25SZXNwb25zZRJ1ChhDb25maXJtU3RvcmVTdWJzY3'
    'JpcHRpb24SKy5wdWJsaXJhLnYxLkNvbmZpcm1TdG9yZVN1YnNjcmlwdGlvblJlcXVlc3QaLC5w'
    'dWJsaXJhLnYxLkNvbmZpcm1TdG9yZVN1YnNjcmlwdGlvblJlc3BvbnNl');
