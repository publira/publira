// This is a generated file - do not edit.
//
// Generated from publira/v1/subscription.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'subscription.pb.dart' as $2;
import 'subscription.pbjson.dart';

export 'subscription.pb.dart';

abstract class SubscriptionServiceBase extends $pb.GeneratedService {
  $async.Future<$2.ListSubscriptionPlansResponse> listSubscriptionPlans(
      $pb.ServerContext ctx, $2.ListSubscriptionPlansRequest request);
  $async.Future<$2.StartSubscriptionCheckoutResponse> startSubscriptionCheckout(
      $pb.ServerContext ctx, $2.StartSubscriptionCheckoutRequest request);
  $async.Future<$2.GetMySubscriptionResponse> getMySubscription(
      $pb.ServerContext ctx, $2.GetMySubscriptionRequest request);
  $async.Future<$2.CreateBillingPortalSessionResponse>
      createBillingPortalSession(
          $pb.ServerContext ctx, $2.CreateBillingPortalSessionRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListSubscriptionPlans':
        return $2.ListSubscriptionPlansRequest();
      case 'StartSubscriptionCheckout':
        return $2.StartSubscriptionCheckoutRequest();
      case 'GetMySubscription':
        return $2.GetMySubscriptionRequest();
      case 'CreateBillingPortalSession':
        return $2.CreateBillingPortalSessionRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListSubscriptionPlans':
        return listSubscriptionPlans(
            ctx, request as $2.ListSubscriptionPlansRequest);
      case 'StartSubscriptionCheckout':
        return startSubscriptionCheckout(
            ctx, request as $2.StartSubscriptionCheckoutRequest);
      case 'GetMySubscription':
        return getMySubscription(ctx, request as $2.GetMySubscriptionRequest);
      case 'CreateBillingPortalSession':
        return createBillingPortalSession(
            ctx, request as $2.CreateBillingPortalSessionRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json =>
      SubscriptionServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => SubscriptionServiceBase$messageJson;
}
