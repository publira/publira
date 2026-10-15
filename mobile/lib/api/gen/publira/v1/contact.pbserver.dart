// This is a generated file - do not edit.
//
// Generated from publira/v1/contact.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'contact.pb.dart' as $1;
import 'contact.pbjson.dart';

export 'contact.pb.dart';

abstract class ContactServiceBase extends $pb.GeneratedService {
  $async.Future<$1.SubmitContactMessageResponse> submitContactMessage(
      $pb.ServerContext ctx, $1.SubmitContactMessageRequest request);
  $async.Future<$1.ProcessInboundEmailWebhookResponse>
      processInboundEmailWebhook(
          $pb.ServerContext ctx, $1.ProcessInboundEmailWebhookRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'SubmitContactMessage':
        return $1.SubmitContactMessageRequest();
      case 'ProcessInboundEmailWebhook':
        return $1.ProcessInboundEmailWebhookRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'SubmitContactMessage':
        return submitContactMessage(
            ctx, request as $1.SubmitContactMessageRequest);
      case 'ProcessInboundEmailWebhook':
        return processInboundEmailWebhook(
            ctx, request as $1.ProcessInboundEmailWebhookRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => ContactServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => ContactServiceBase$messageJson;
}
