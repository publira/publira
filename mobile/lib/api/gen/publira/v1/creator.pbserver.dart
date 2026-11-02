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

import 'creator.pb.dart' as $2;
import 'creator.pbjson.dart';

export 'creator.pb.dart';

abstract class CreatorServiceBase extends $pb.GeneratedService {
  $async.Future<$2.ListMyCreatorsResponse> listMyCreators(
      $pb.ServerContext ctx, $2.ListMyCreatorsRequest request);
  $async.Future<$2.GetMyCreatorStatsResponse> getMyCreatorStats(
      $pb.ServerContext ctx, $2.GetMyCreatorStatsRequest request);
  $async.Future<$2.ListMyCreatorStatementsResponse> listMyCreatorStatements(
      $pb.ServerContext ctx, $2.ListMyCreatorStatementsRequest request);
  $async.Future<$2.GetMyCreatorStatementResponse> getMyCreatorStatement(
      $pb.ServerContext ctx, $2.GetMyCreatorStatementRequest request);
  $async.Future<$2.ListMyCreatorEpisodeCommentsResponse>
      listMyCreatorEpisodeComments($pb.ServerContext ctx,
          $2.ListMyCreatorEpisodeCommentsRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListMyCreators':
        return $2.ListMyCreatorsRequest();
      case 'GetMyCreatorStats':
        return $2.GetMyCreatorStatsRequest();
      case 'ListMyCreatorStatements':
        return $2.ListMyCreatorStatementsRequest();
      case 'GetMyCreatorStatement':
        return $2.GetMyCreatorStatementRequest();
      case 'ListMyCreatorEpisodeComments':
        return $2.ListMyCreatorEpisodeCommentsRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListMyCreators':
        return listMyCreators(ctx, request as $2.ListMyCreatorsRequest);
      case 'GetMyCreatorStats':
        return getMyCreatorStats(ctx, request as $2.GetMyCreatorStatsRequest);
      case 'ListMyCreatorStatements':
        return listMyCreatorStatements(
            ctx, request as $2.ListMyCreatorStatementsRequest);
      case 'GetMyCreatorStatement':
        return getMyCreatorStatement(
            ctx, request as $2.GetMyCreatorStatementRequest);
      case 'ListMyCreatorEpisodeComments':
        return listMyCreatorEpisodeComments(
            ctx, request as $2.ListMyCreatorEpisodeCommentsRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => CreatorServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => CreatorServiceBase$messageJson;
}
