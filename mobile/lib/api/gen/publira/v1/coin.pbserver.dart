// This is a generated file - do not edit.
//
// Generated from publira/v1/coin.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'coin.pb.dart' as $2;
import 'coin.pbjson.dart';

export 'coin.pb.dart';

abstract class CoinServiceBase extends $pb.GeneratedService {
  $async.Future<$2.GetCoinSettingsResponse> getCoinSettings(
      $pb.ServerContext ctx, $2.GetCoinSettingsRequest request);
  $async.Future<$2.GetCoinBalanceResponse> getCoinBalance(
      $pb.ServerContext ctx, $2.GetCoinBalanceRequest request);
  $async.Future<$2.ListCoinTransactionsResponse> listCoinTransactions(
      $pb.ServerContext ctx, $2.ListCoinTransactionsRequest request);
  $async.Future<$2.PayEpisodeWithCoinsResponse> payEpisodeWithCoins(
      $pb.ServerContext ctx, $2.PayEpisodeWithCoinsRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'GetCoinSettings':
        return $2.GetCoinSettingsRequest();
      case 'GetCoinBalance':
        return $2.GetCoinBalanceRequest();
      case 'ListCoinTransactions':
        return $2.ListCoinTransactionsRequest();
      case 'PayEpisodeWithCoins':
        return $2.PayEpisodeWithCoinsRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'GetCoinSettings':
        return getCoinSettings(ctx, request as $2.GetCoinSettingsRequest);
      case 'GetCoinBalance':
        return getCoinBalance(ctx, request as $2.GetCoinBalanceRequest);
      case 'ListCoinTransactions':
        return listCoinTransactions(
            ctx, request as $2.ListCoinTransactionsRequest);
      case 'PayEpisodeWithCoins':
        return payEpisodeWithCoins(
            ctx, request as $2.PayEpisodeWithCoinsRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => CoinServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => CoinServiceBase$messageJson;
}
