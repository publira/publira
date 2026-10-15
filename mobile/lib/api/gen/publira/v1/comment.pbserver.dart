// This is a generated file - do not edit.
//
// Generated from publira/v1/comment.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'comment.pb.dart' as $1;
import 'comment.pbjson.dart';

export 'comment.pb.dart';

abstract class CommentServiceBase extends $pb.GeneratedService {
  $async.Future<$1.ListEpisodeCommentsResponse> listEpisodeComments(
      $pb.ServerContext ctx, $1.ListEpisodeCommentsRequest request);
  $async.Future<$1.ListMyEpisodeCommentsResponse> listMyEpisodeComments(
      $pb.ServerContext ctx, $1.ListMyEpisodeCommentsRequest request);
  $async.Future<$1.PostEpisodeCommentResponse> postEpisodeComment(
      $pb.ServerContext ctx, $1.PostEpisodeCommentRequest request);
  $async.Future<$1.WithdrawEpisodeCommentResponse> withdrawEpisodeComment(
      $pb.ServerContext ctx, $1.WithdrawEpisodeCommentRequest request);
  $async.Future<$1.ReportEpisodeCommentResponse> reportEpisodeComment(
      $pb.ServerContext ctx, $1.ReportEpisodeCommentRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListEpisodeComments':
        return $1.ListEpisodeCommentsRequest();
      case 'ListMyEpisodeComments':
        return $1.ListMyEpisodeCommentsRequest();
      case 'PostEpisodeComment':
        return $1.PostEpisodeCommentRequest();
      case 'WithdrawEpisodeComment':
        return $1.WithdrawEpisodeCommentRequest();
      case 'ReportEpisodeComment':
        return $1.ReportEpisodeCommentRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListEpisodeComments':
        return listEpisodeComments(
            ctx, request as $1.ListEpisodeCommentsRequest);
      case 'ListMyEpisodeComments':
        return listMyEpisodeComments(
            ctx, request as $1.ListMyEpisodeCommentsRequest);
      case 'PostEpisodeComment':
        return postEpisodeComment(ctx, request as $1.PostEpisodeCommentRequest);
      case 'WithdrawEpisodeComment':
        return withdrawEpisodeComment(
            ctx, request as $1.WithdrawEpisodeCommentRequest);
      case 'ReportEpisodeComment':
        return reportEpisodeComment(
            ctx, request as $1.ReportEpisodeCommentRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => CommentServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => CommentServiceBase$messageJson;
}
