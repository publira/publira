// This is a generated file - do not edit.
//
// Generated from publira/v1/page.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'page.pb.dart' as $1;
import 'page.pbjson.dart';

export 'page.pb.dart';

abstract class PublicPagesServiceBase extends $pb.GeneratedService {
  $async.Future<$1.ListPublishedPagesResponse> listPublishedPages(
      $pb.ServerContext ctx, $1.ListPublishedPagesRequest request);
  $async.Future<$1.ListPublishedPageSlugsResponse> listPublishedPageSlugs(
      $pb.ServerContext ctx, $1.ListPublishedPageSlugsRequest request);
  $async.Future<$1.GetPublishedPageResponse> getPublishedPage(
      $pb.ServerContext ctx, $1.GetPublishedPageRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListPublishedPages':
        return $1.ListPublishedPagesRequest();
      case 'ListPublishedPageSlugs':
        return $1.ListPublishedPageSlugsRequest();
      case 'GetPublishedPage':
        return $1.GetPublishedPageRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListPublishedPages':
        return listPublishedPages(ctx, request as $1.ListPublishedPagesRequest);
      case 'ListPublishedPageSlugs':
        return listPublishedPageSlugs(
            ctx, request as $1.ListPublishedPageSlugsRequest);
      case 'GetPublishedPage':
        return getPublishedPage(ctx, request as $1.GetPublishedPageRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json =>
      PublicPagesServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => PublicPagesServiceBase$messageJson;
}
