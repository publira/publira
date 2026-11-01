// This is a generated file - do not edit.
//
// Generated from publira/v1/creator.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'creator.pb.dart' as $1;
import 'creator.pbjson.dart';

export 'creator.pb.dart';

abstract class CreatorServiceBase extends $pb.GeneratedService {
  $async.Future<$1.ListMyCreatorsResponse> listMyCreators(
      $pb.ServerContext ctx, $1.ListMyCreatorsRequest request);
  $async.Future<$1.GetMyCreatorStatsResponse> getMyCreatorStats(
      $pb.ServerContext ctx, $1.GetMyCreatorStatsRequest request);
  $async.Future<$1.ListMyCreatorStatementsResponse> listMyCreatorStatements(
      $pb.ServerContext ctx, $1.ListMyCreatorStatementsRequest request);
  $async.Future<$1.GetMyCreatorStatementResponse> getMyCreatorStatement(
      $pb.ServerContext ctx, $1.GetMyCreatorStatementRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListMyCreators':
        return $1.ListMyCreatorsRequest();
      case 'GetMyCreatorStats':
        return $1.GetMyCreatorStatsRequest();
      case 'ListMyCreatorStatements':
        return $1.ListMyCreatorStatementsRequest();
      case 'GetMyCreatorStatement':
        return $1.GetMyCreatorStatementRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListMyCreators':
        return listMyCreators(ctx, request as $1.ListMyCreatorsRequest);
      case 'GetMyCreatorStats':
        return getMyCreatorStats(ctx, request as $1.GetMyCreatorStatsRequest);
      case 'ListMyCreatorStatements':
        return listMyCreatorStatements(
            ctx, request as $1.ListMyCreatorStatementsRequest);
      case 'GetMyCreatorStatement':
        return getMyCreatorStatement(
            ctx, request as $1.GetMyCreatorStatementRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => CreatorServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => CreatorServiceBase$messageJson;
}
