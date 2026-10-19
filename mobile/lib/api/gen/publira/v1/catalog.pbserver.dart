// This is a generated file - do not edit.
//
// Generated from publira/v1/catalog.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'catalog.pb.dart' as $1;
import 'catalog.pbjson.dart';

export 'catalog.pb.dart';

abstract class CatalogServiceBase extends $pb.GeneratedService {
  $async.Future<$1.ListPublishedLabelsResponse> listPublishedLabels(
      $pb.ServerContext ctx, $1.ListPublishedLabelsRequest request);
  $async.Future<$1.ListPublishedSeriesResponse> listPublishedSeries(
      $pb.ServerContext ctx, $1.ListPublishedSeriesRequest request);
  $async.Future<$1.GetSeriesDetailResponse> getSeriesDetail(
      $pb.ServerContext ctx, $1.GetSeriesDetailRequest request);
  $async.Future<$1.GetSeriesEpisodeAccessResponse> getSeriesEpisodeAccess(
      $pb.ServerContext ctx, $1.GetSeriesEpisodeAccessRequest request);
  $async.Future<$1.GetEpisodeDetailResponse> getEpisodeDetail(
      $pb.ServerContext ctx, $1.GetEpisodeDetailRequest request);
  $async.Future<$1.ListPublishedCreatorsResponse> listPublishedCreators(
      $pb.ServerContext ctx, $1.ListPublishedCreatorsRequest request);
  $async.Future<$1.GetPublishedCreatorDetailResponse> getPublishedCreatorDetail(
      $pb.ServerContext ctx, $1.GetPublishedCreatorDetailRequest request);
  $async.Future<$1.GetPublishedLabelDetailResponse> getPublishedLabelDetail(
      $pb.ServerContext ctx, $1.GetPublishedLabelDetailRequest request);
  $async.Future<$1.ListPublishedGenresResponse> listPublishedGenres(
      $pb.ServerContext ctx, $1.ListPublishedGenresRequest request);
  $async.Future<$1.ListPublishedTagsResponse> listPublishedTags(
      $pb.ServerContext ctx, $1.ListPublishedTagsRequest request);
  $async.Future<$1.SearchPublishedSeriesResponse> searchPublishedSeries(
      $pb.ServerContext ctx, $1.SearchPublishedSeriesRequest request);
  $async.Future<$1.SearchPublishedCreatorsResponse> searchPublishedCreators(
      $pb.ServerContext ctx, $1.SearchPublishedCreatorsRequest request);
  $async.Future<$1.SearchPublishedLabelsResponse> searchPublishedLabels(
      $pb.ServerContext ctx, $1.SearchPublishedLabelsRequest request);
  $async.Future<$1.ListRecommendedSeriesResponse> listRecommendedSeries(
      $pb.ServerContext ctx, $1.ListRecommendedSeriesRequest request);
  $async.Future<$1.ListMyRecommendedSeriesResponse> listMyRecommendedSeries(
      $pb.ServerContext ctx, $1.ListMyRecommendedSeriesRequest request);
  $async.Future<$1.ListRankedSeriesResponse> listRankedSeries(
      $pb.ServerContext ctx, $1.ListRankedSeriesRequest request);
  $async.Future<$1.ListRelatedSeriesResponse> listRelatedSeries(
      $pb.ServerContext ctx, $1.ListRelatedSeriesRequest request);
  $async.Future<$1.ListSitemapEntriesResponse> listSitemapEntries(
      $pb.ServerContext ctx, $1.ListSitemapEntriesRequest request);
  $async.Future<$1.ListCampaignBannersResponse> listCampaignBanners(
      $pb.ServerContext ctx, $1.ListCampaignBannersRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'ListPublishedLabels':
        return $1.ListPublishedLabelsRequest();
      case 'ListPublishedSeries':
        return $1.ListPublishedSeriesRequest();
      case 'GetSeriesDetail':
        return $1.GetSeriesDetailRequest();
      case 'GetSeriesEpisodeAccess':
        return $1.GetSeriesEpisodeAccessRequest();
      case 'GetEpisodeDetail':
        return $1.GetEpisodeDetailRequest();
      case 'ListPublishedCreators':
        return $1.ListPublishedCreatorsRequest();
      case 'GetPublishedCreatorDetail':
        return $1.GetPublishedCreatorDetailRequest();
      case 'GetPublishedLabelDetail':
        return $1.GetPublishedLabelDetailRequest();
      case 'ListPublishedGenres':
        return $1.ListPublishedGenresRequest();
      case 'ListPublishedTags':
        return $1.ListPublishedTagsRequest();
      case 'SearchPublishedSeries':
        return $1.SearchPublishedSeriesRequest();
      case 'SearchPublishedCreators':
        return $1.SearchPublishedCreatorsRequest();
      case 'SearchPublishedLabels':
        return $1.SearchPublishedLabelsRequest();
      case 'ListRecommendedSeries':
        return $1.ListRecommendedSeriesRequest();
      case 'ListMyRecommendedSeries':
        return $1.ListMyRecommendedSeriesRequest();
      case 'ListRankedSeries':
        return $1.ListRankedSeriesRequest();
      case 'ListRelatedSeries':
        return $1.ListRelatedSeriesRequest();
      case 'ListSitemapEntries':
        return $1.ListSitemapEntriesRequest();
      case 'ListCampaignBanners':
        return $1.ListCampaignBannersRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'ListPublishedLabels':
        return listPublishedLabels(
            ctx, request as $1.ListPublishedLabelsRequest);
      case 'ListPublishedSeries':
        return listPublishedSeries(
            ctx, request as $1.ListPublishedSeriesRequest);
      case 'GetSeriesDetail':
        return getSeriesDetail(ctx, request as $1.GetSeriesDetailRequest);
      case 'GetSeriesEpisodeAccess':
        return getSeriesEpisodeAccess(
            ctx, request as $1.GetSeriesEpisodeAccessRequest);
      case 'GetEpisodeDetail':
        return getEpisodeDetail(ctx, request as $1.GetEpisodeDetailRequest);
      case 'ListPublishedCreators':
        return listPublishedCreators(
            ctx, request as $1.ListPublishedCreatorsRequest);
      case 'GetPublishedCreatorDetail':
        return getPublishedCreatorDetail(
            ctx, request as $1.GetPublishedCreatorDetailRequest);
      case 'GetPublishedLabelDetail':
        return getPublishedLabelDetail(
            ctx, request as $1.GetPublishedLabelDetailRequest);
      case 'ListPublishedGenres':
        return listPublishedGenres(
            ctx, request as $1.ListPublishedGenresRequest);
      case 'ListPublishedTags':
        return listPublishedTags(ctx, request as $1.ListPublishedTagsRequest);
      case 'SearchPublishedSeries':
        return searchPublishedSeries(
            ctx, request as $1.SearchPublishedSeriesRequest);
      case 'SearchPublishedCreators':
        return searchPublishedCreators(
            ctx, request as $1.SearchPublishedCreatorsRequest);
      case 'SearchPublishedLabels':
        return searchPublishedLabels(
            ctx, request as $1.SearchPublishedLabelsRequest);
      case 'ListRecommendedSeries':
        return listRecommendedSeries(
            ctx, request as $1.ListRecommendedSeriesRequest);
      case 'ListMyRecommendedSeries':
        return listMyRecommendedSeries(
            ctx, request as $1.ListMyRecommendedSeriesRequest);
      case 'ListRankedSeries':
        return listRankedSeries(ctx, request as $1.ListRankedSeriesRequest);
      case 'ListRelatedSeries':
        return listRelatedSeries(ctx, request as $1.ListRelatedSeriesRequest);
      case 'ListSitemapEntries':
        return listSitemapEntries(ctx, request as $1.ListSitemapEntriesRequest);
      case 'ListCampaignBanners':
        return listCampaignBanners(
            ctx, request as $1.ListCampaignBannersRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => CatalogServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => CatalogServiceBase$messageJson;
}

abstract class EpisodeReadServiceBase extends $pb.GeneratedService {
  $async.Future<$1.MarkEpisodeAsReadResponse> markEpisodeAsRead(
      $pb.ServerContext ctx, $1.MarkEpisodeAsReadRequest request);
  $async.Future<$1.SaveReadingPositionResponse> saveReadingPosition(
      $pb.ServerContext ctx, $1.SaveReadingPositionRequest request);
  $async.Future<$1.GetMyReadingPositionResponse> getMyReadingPosition(
      $pb.ServerContext ctx, $1.GetMyReadingPositionRequest request);
  $async.Future<$1.GetMySeriesProgressResponse> getMySeriesProgress(
      $pb.ServerContext ctx, $1.GetMySeriesProgressRequest request);
  $async.Future<$1.ListMyRecentSeriesResponse> listMyRecentSeries(
      $pb.ServerContext ctx, $1.ListMyRecentSeriesRequest request);
  $async.Future<$1.ListMyEpisodeReadsResponse> listMyEpisodeReads(
      $pb.ServerContext ctx, $1.ListMyEpisodeReadsRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'MarkEpisodeAsRead':
        return $1.MarkEpisodeAsReadRequest();
      case 'SaveReadingPosition':
        return $1.SaveReadingPositionRequest();
      case 'GetMyReadingPosition':
        return $1.GetMyReadingPositionRequest();
      case 'GetMySeriesProgress':
        return $1.GetMySeriesProgressRequest();
      case 'ListMyRecentSeries':
        return $1.ListMyRecentSeriesRequest();
      case 'ListMyEpisodeReads':
        return $1.ListMyEpisodeReadsRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'MarkEpisodeAsRead':
        return markEpisodeAsRead(ctx, request as $1.MarkEpisodeAsReadRequest);
      case 'SaveReadingPosition':
        return saveReadingPosition(
            ctx, request as $1.SaveReadingPositionRequest);
      case 'GetMyReadingPosition':
        return getMyReadingPosition(
            ctx, request as $1.GetMyReadingPositionRequest);
      case 'GetMySeriesProgress':
        return getMySeriesProgress(
            ctx, request as $1.GetMySeriesProgressRequest);
      case 'ListMyRecentSeries':
        return listMyRecentSeries(ctx, request as $1.ListMyRecentSeriesRequest);
      case 'ListMyEpisodeReads':
        return listMyEpisodeReads(ctx, request as $1.ListMyEpisodeReadsRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json =>
      EpisodeReadServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => EpisodeReadServiceBase$messageJson;
}

abstract class FollowServiceBase extends $pb.GeneratedService {
  $async.Future<$1.GetMyFollowStatusResponse> getMyFollowStatus(
      $pb.ServerContext ctx, $1.GetMyFollowStatusRequest request);
  $async.Future<$1.FollowResponse> follow(
      $pb.ServerContext ctx, $1.FollowRequest request);
  $async.Future<$1.UnfollowResponse> unfollow(
      $pb.ServerContext ctx, $1.UnfollowRequest request);
  $async.Future<$1.ListMyFollowsResponse> listMyFollows(
      $pb.ServerContext ctx, $1.ListMyFollowsRequest request);
  $async.Future<$1.ListMyFollowUpdatesResponse> listMyFollowUpdates(
      $pb.ServerContext ctx, $1.ListMyFollowUpdatesRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'GetMyFollowStatus':
        return $1.GetMyFollowStatusRequest();
      case 'Follow':
        return $1.FollowRequest();
      case 'Unfollow':
        return $1.UnfollowRequest();
      case 'ListMyFollows':
        return $1.ListMyFollowsRequest();
      case 'ListMyFollowUpdates':
        return $1.ListMyFollowUpdatesRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'GetMyFollowStatus':
        return getMyFollowStatus(ctx, request as $1.GetMyFollowStatusRequest);
      case 'Follow':
        return follow(ctx, request as $1.FollowRequest);
      case 'Unfollow':
        return unfollow(ctx, request as $1.UnfollowRequest);
      case 'ListMyFollows':
        return listMyFollows(ctx, request as $1.ListMyFollowsRequest);
      case 'ListMyFollowUpdates':
        return listMyFollowUpdates(
            ctx, request as $1.ListMyFollowUpdatesRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => FollowServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => FollowServiceBase$messageJson;
}

abstract class RatingServiceBase extends $pb.GeneratedService {
  $async.Future<$1.RateEpisodeResponse> rateEpisode(
      $pb.ServerContext ctx, $1.RateEpisodeRequest request);
  $async.Future<$1.GetMyEpisodeRatingResponse> getMyEpisodeRating(
      $pb.ServerContext ctx, $1.GetMyEpisodeRatingRequest request);
  $async.Future<$1.GetMySeriesRatingResponse> getMySeriesRating(
      $pb.ServerContext ctx, $1.GetMySeriesRatingRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'RateEpisode':
        return $1.RateEpisodeRequest();
      case 'GetMyEpisodeRating':
        return $1.GetMyEpisodeRatingRequest();
      case 'GetMySeriesRating':
        return $1.GetMySeriesRatingRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'RateEpisode':
        return rateEpisode(ctx, request as $1.RateEpisodeRequest);
      case 'GetMyEpisodeRating':
        return getMyEpisodeRating(ctx, request as $1.GetMyEpisodeRatingRequest);
      case 'GetMySeriesRating':
        return getMySeriesRating(ctx, request as $1.GetMySeriesRatingRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => RatingServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => RatingServiceBase$messageJson;
}

abstract class ContentViewServiceBase extends $pb.GeneratedService {
  $async.Future<$1.RecordContentViewResponse> recordContentView(
      $pb.ServerContext ctx, $1.RecordContentViewRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'RecordContentView':
        return $1.RecordContentViewRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'RecordContentView':
        return recordContentView(ctx, request as $1.RecordContentViewRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json =>
      ContentViewServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => ContentViewServiceBase$messageJson;
}

abstract class PurchaseServiceBase extends $pb.GeneratedService {
  $async.Future<$1.StartEpisodeCheckoutResponse> startEpisodeCheckout(
      $pb.ServerContext ctx, $1.StartEpisodeCheckoutRequest request);
  $async.Future<$1.StartVolumeCheckoutResponse> startVolumeCheckout(
      $pb.ServerContext ctx, $1.StartVolumeCheckoutRequest request);
  $async.Future<$1.StartSeriesRemainderCheckoutResponse>
      startSeriesRemainderCheckout($pb.ServerContext ctx,
          $1.StartSeriesRemainderCheckoutRequest request);
  $async.Future<$1.ListMyPurchasesResponse> listMyPurchases(
      $pb.ServerContext ctx, $1.ListMyPurchasesRequest request);
  $async.Future<$1.ProcessPaymentWebhookResponse> processPaymentWebhook(
      $pb.ServerContext ctx, $1.ProcessPaymentWebhookRequest request);
  $async.Future<$1.StartStorePurchaseResponse> startStorePurchase(
      $pb.ServerContext ctx, $1.StartStorePurchaseRequest request);
  $async.Future<$1.ConfirmStorePurchaseResponse> confirmStorePurchase(
      $pb.ServerContext ctx, $1.ConfirmStorePurchaseRequest request);
  $async.Future<$1.ProcessAppStoreNotificationResponse>
      processAppStoreNotification(
          $pb.ServerContext ctx, $1.ProcessAppStoreNotificationRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'StartEpisodeCheckout':
        return $1.StartEpisodeCheckoutRequest();
      case 'StartVolumeCheckout':
        return $1.StartVolumeCheckoutRequest();
      case 'StartSeriesRemainderCheckout':
        return $1.StartSeriesRemainderCheckoutRequest();
      case 'ListMyPurchases':
        return $1.ListMyPurchasesRequest();
      case 'ProcessPaymentWebhook':
        return $1.ProcessPaymentWebhookRequest();
      case 'StartStorePurchase':
        return $1.StartStorePurchaseRequest();
      case 'ConfirmStorePurchase':
        return $1.ConfirmStorePurchaseRequest();
      case 'ProcessAppStoreNotification':
        return $1.ProcessAppStoreNotificationRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'StartEpisodeCheckout':
        return startEpisodeCheckout(
            ctx, request as $1.StartEpisodeCheckoutRequest);
      case 'StartVolumeCheckout':
        return startVolumeCheckout(
            ctx, request as $1.StartVolumeCheckoutRequest);
      case 'StartSeriesRemainderCheckout':
        return startSeriesRemainderCheckout(
            ctx, request as $1.StartSeriesRemainderCheckoutRequest);
      case 'ListMyPurchases':
        return listMyPurchases(ctx, request as $1.ListMyPurchasesRequest);
      case 'ProcessPaymentWebhook':
        return processPaymentWebhook(
            ctx, request as $1.ProcessPaymentWebhookRequest);
      case 'StartStorePurchase':
        return startStorePurchase(ctx, request as $1.StartStorePurchaseRequest);
      case 'ConfirmStorePurchase':
        return confirmStorePurchase(
            ctx, request as $1.ConfirmStorePurchaseRequest);
      case 'ProcessAppStoreNotification':
        return processAppStoreNotification(
            ctx, request as $1.ProcessAppStoreNotificationRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => PurchaseServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => PurchaseServiceBase$messageJson;
}

abstract class WaitFreeServiceBase extends $pb.GeneratedService {
  $async.Future<$1.GetMyTicketStateResponse> getMyTicketState(
      $pb.ServerContext ctx, $1.GetMyTicketStateRequest request);
  $async.Future<$1.UseTicketResponse> useTicket(
      $pb.ServerContext ctx, $1.UseTicketRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'GetMyTicketState':
        return $1.GetMyTicketStateRequest();
      case 'UseTicket':
        return $1.UseTicketRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'GetMyTicketState':
        return getMyTicketState(ctx, request as $1.GetMyTicketStateRequest);
      case 'UseTicket':
        return useTicket(ctx, request as $1.UseTicketRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => WaitFreeServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => WaitFreeServiceBase$messageJson;
}
