// This is a generated file - do not edit.
//
// Generated from publira/v1/auth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import 'auth.pb.dart' as $2;
import 'auth.pbjson.dart';

export 'auth.pb.dart';

abstract class AuthServiceBase extends $pb.GeneratedService {
  $async.Future<$2.LoginResponse> login(
      $pb.ServerContext ctx, $2.LoginRequest request);
  $async.Future<$2.LoginWithIdTokenResponse> loginWithIdToken(
      $pb.ServerContext ctx, $2.LoginWithIdTokenRequest request);
  $async.Future<$2.ListMyIdentitiesResponse> listMyIdentities(
      $pb.ServerContext ctx, $2.ListMyIdentitiesRequest request);
  $async.Future<$2.UnlinkIdentityResponse> unlinkIdentity(
      $pb.ServerContext ctx, $2.UnlinkIdentityRequest request);
  $async.Future<$2.LinkIdentityResponse> linkIdentity(
      $pb.ServerContext ctx, $2.LinkIdentityRequest request);
  $async.Future<$2.BeginPasskeyLoginResponse> beginPasskeyLogin(
      $pb.ServerContext ctx, $2.BeginPasskeyLoginRequest request);
  $async.Future<$2.FinishPasskeyLoginResponse> finishPasskeyLogin(
      $pb.ServerContext ctx, $2.FinishPasskeyLoginRequest request);
  $async.Future<$2.BeginPasskeyRegistrationResponse> beginPasskeyRegistration(
      $pb.ServerContext ctx, $2.BeginPasskeyRegistrationRequest request);
  $async.Future<$2.FinishPasskeyRegistrationResponse> finishPasskeyRegistration(
      $pb.ServerContext ctx, $2.FinishPasskeyRegistrationRequest request);
  $async.Future<$2.ListMyPasskeysResponse> listMyPasskeys(
      $pb.ServerContext ctx, $2.ListMyPasskeysRequest request);
  $async.Future<$2.RenamePasskeyResponse> renamePasskey(
      $pb.ServerContext ctx, $2.RenamePasskeyRequest request);
  $async.Future<$2.DeletePasskeyResponse> deletePasskey(
      $pb.ServerContext ctx, $2.DeletePasskeyRequest request);
  $async.Future<$2.BeginPasskeyConfirmationResponse> beginPasskeyConfirmation(
      $pb.ServerContext ctx, $2.BeginPasskeyConfirmationRequest request);
  $async.Future<$2.CreateUserResponse> createUser(
      $pb.ServerContext ctx, $2.CreateUserRequest request);
  $async.Future<$2.VerifyUserEmailResponse> verifyUserEmail(
      $pb.ServerContext ctx, $2.VerifyUserEmailRequest request);
  $async.Future<$2.RequestEmailVerificationResponse> requestEmailVerification(
      $pb.ServerContext ctx, $2.RequestEmailVerificationRequest request);
  $async.Future<$2.RequestEmailChangeResponse> requestEmailChange(
      $pb.ServerContext ctx, $2.RequestEmailChangeRequest request);
  $async.Future<$2.ConfirmEmailChangeResponse> confirmEmailChange(
      $pb.ServerContext ctx, $2.ConfirmEmailChangeRequest request);
  $async.Future<$2.RequestPasswordResetResponse> requestPasswordReset(
      $pb.ServerContext ctx, $2.RequestPasswordResetRequest request);
  $async.Future<$2.ConfirmPasswordResetResponse> confirmPasswordReset(
      $pb.ServerContext ctx, $2.ConfirmPasswordResetRequest request);
  $async.Future<$2.ChangePasswordResponse> changePassword(
      $pb.ServerContext ctx, $2.ChangePasswordRequest request);
  $async.Future<$2.LogoutResponse> logout(
      $pb.ServerContext ctx, $2.LogoutRequest request);
  $async.Future<$2.GetMeResponse> getMe(
      $pb.ServerContext ctx, $2.GetMeRequest request);
  $async.Future<$2.UpdateMeResponse> updateMe(
      $pb.ServerContext ctx, $2.UpdateMeRequest request);
  $async.Future<$2.UploadMyIconResponse> uploadMyIcon(
      $pb.ServerContext ctx, $2.UploadMyIconRequest request);
  $async.Future<$2.SelectMyIconResponse> selectMyIcon(
      $pb.ServerContext ctx, $2.SelectMyIconRequest request);
  $async.Future<$2.DeleteMyIconResponse> deleteMyIcon(
      $pb.ServerContext ctx, $2.DeleteMyIconRequest request);
  $async.Future<$2.DeleteMeResponse> deleteMe(
      $pb.ServerContext ctx, $2.DeleteMeRequest request);
  $async.Future<$2.GetNotificationSettingsResponse> getNotificationSettings(
      $pb.ServerContext ctx, $2.GetNotificationSettingsRequest request);
  $async.Future<$2.UpdateNotificationSettingsResponse>
      updateNotificationSettings(
          $pb.ServerContext ctx, $2.UpdateNotificationSettingsRequest request);
  $async.Future<$2.GetViewerPreferencesResponse> getViewerPreferences(
      $pb.ServerContext ctx, $2.GetViewerPreferencesRequest request);
  $async.Future<$2.UpdateViewerPreferencesResponse> updateViewerPreferences(
      $pb.ServerContext ctx, $2.UpdateViewerPreferencesRequest request);
  $async.Future<$2.GetAnnouncementResponse> getAnnouncement(
      $pb.ServerContext ctx, $2.GetAnnouncementRequest request);
  $async.Future<$2.GetPinnedAnnouncementResponse> getPinnedAnnouncement(
      $pb.ServerContext ctx, $2.GetPinnedAnnouncementRequest request);
  $async.Future<$2.ListAnnouncementsResponse> listAnnouncements(
      $pb.ServerContext ctx, $2.ListAnnouncementsRequest request);
  $async.Future<$2.MarkAnnouncementAsReadResponse> markAnnouncementAsRead(
      $pb.ServerContext ctx, $2.MarkAnnouncementAsReadRequest request);
  $async.Future<$2.MarkAllAnnouncementsAsReadResponse>
      markAllAnnouncementsAsRead(
          $pb.ServerContext ctx, $2.MarkAllAnnouncementsAsReadRequest request);
  $async.Future<$2.GetMyLegalPageAgreementsResponse> getMyLegalPageAgreements(
      $pb.ServerContext ctx, $2.GetMyLegalPageAgreementsRequest request);
  $async.Future<$2.AgreeToLegalPagesResponse> agreeToLegalPages(
      $pb.ServerContext ctx, $2.AgreeToLegalPagesRequest request);

  $pb.GeneratedMessage createRequest($core.String methodName) {
    switch (methodName) {
      case 'Login':
        return $2.LoginRequest();
      case 'LoginWithIdToken':
        return $2.LoginWithIdTokenRequest();
      case 'ListMyIdentities':
        return $2.ListMyIdentitiesRequest();
      case 'UnlinkIdentity':
        return $2.UnlinkIdentityRequest();
      case 'LinkIdentity':
        return $2.LinkIdentityRequest();
      case 'BeginPasskeyLogin':
        return $2.BeginPasskeyLoginRequest();
      case 'FinishPasskeyLogin':
        return $2.FinishPasskeyLoginRequest();
      case 'BeginPasskeyRegistration':
        return $2.BeginPasskeyRegistrationRequest();
      case 'FinishPasskeyRegistration':
        return $2.FinishPasskeyRegistrationRequest();
      case 'ListMyPasskeys':
        return $2.ListMyPasskeysRequest();
      case 'RenamePasskey':
        return $2.RenamePasskeyRequest();
      case 'DeletePasskey':
        return $2.DeletePasskeyRequest();
      case 'BeginPasskeyConfirmation':
        return $2.BeginPasskeyConfirmationRequest();
      case 'CreateUser':
        return $2.CreateUserRequest();
      case 'VerifyUserEmail':
        return $2.VerifyUserEmailRequest();
      case 'RequestEmailVerification':
        return $2.RequestEmailVerificationRequest();
      case 'RequestEmailChange':
        return $2.RequestEmailChangeRequest();
      case 'ConfirmEmailChange':
        return $2.ConfirmEmailChangeRequest();
      case 'RequestPasswordReset':
        return $2.RequestPasswordResetRequest();
      case 'ConfirmPasswordReset':
        return $2.ConfirmPasswordResetRequest();
      case 'ChangePassword':
        return $2.ChangePasswordRequest();
      case 'Logout':
        return $2.LogoutRequest();
      case 'GetMe':
        return $2.GetMeRequest();
      case 'UpdateMe':
        return $2.UpdateMeRequest();
      case 'UploadMyIcon':
        return $2.UploadMyIconRequest();
      case 'SelectMyIcon':
        return $2.SelectMyIconRequest();
      case 'DeleteMyIcon':
        return $2.DeleteMyIconRequest();
      case 'DeleteMe':
        return $2.DeleteMeRequest();
      case 'GetNotificationSettings':
        return $2.GetNotificationSettingsRequest();
      case 'UpdateNotificationSettings':
        return $2.UpdateNotificationSettingsRequest();
      case 'GetViewerPreferences':
        return $2.GetViewerPreferencesRequest();
      case 'UpdateViewerPreferences':
        return $2.UpdateViewerPreferencesRequest();
      case 'GetAnnouncement':
        return $2.GetAnnouncementRequest();
      case 'GetPinnedAnnouncement':
        return $2.GetPinnedAnnouncementRequest();
      case 'ListAnnouncements':
        return $2.ListAnnouncementsRequest();
      case 'MarkAnnouncementAsRead':
        return $2.MarkAnnouncementAsReadRequest();
      case 'MarkAllAnnouncementsAsRead':
        return $2.MarkAllAnnouncementsAsReadRequest();
      case 'GetMyLegalPageAgreements':
        return $2.GetMyLegalPageAgreementsRequest();
      case 'AgreeToLegalPages':
        return $2.AgreeToLegalPagesRequest();
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $async.Future<$pb.GeneratedMessage> handleCall($pb.ServerContext ctx,
      $core.String methodName, $pb.GeneratedMessage request) {
    switch (methodName) {
      case 'Login':
        return login(ctx, request as $2.LoginRequest);
      case 'LoginWithIdToken':
        return loginWithIdToken(ctx, request as $2.LoginWithIdTokenRequest);
      case 'ListMyIdentities':
        return listMyIdentities(ctx, request as $2.ListMyIdentitiesRequest);
      case 'UnlinkIdentity':
        return unlinkIdentity(ctx, request as $2.UnlinkIdentityRequest);
      case 'LinkIdentity':
        return linkIdentity(ctx, request as $2.LinkIdentityRequest);
      case 'BeginPasskeyLogin':
        return beginPasskeyLogin(ctx, request as $2.BeginPasskeyLoginRequest);
      case 'FinishPasskeyLogin':
        return finishPasskeyLogin(ctx, request as $2.FinishPasskeyLoginRequest);
      case 'BeginPasskeyRegistration':
        return beginPasskeyRegistration(
            ctx, request as $2.BeginPasskeyRegistrationRequest);
      case 'FinishPasskeyRegistration':
        return finishPasskeyRegistration(
            ctx, request as $2.FinishPasskeyRegistrationRequest);
      case 'ListMyPasskeys':
        return listMyPasskeys(ctx, request as $2.ListMyPasskeysRequest);
      case 'RenamePasskey':
        return renamePasskey(ctx, request as $2.RenamePasskeyRequest);
      case 'DeletePasskey':
        return deletePasskey(ctx, request as $2.DeletePasskeyRequest);
      case 'BeginPasskeyConfirmation':
        return beginPasskeyConfirmation(
            ctx, request as $2.BeginPasskeyConfirmationRequest);
      case 'CreateUser':
        return createUser(ctx, request as $2.CreateUserRequest);
      case 'VerifyUserEmail':
        return verifyUserEmail(ctx, request as $2.VerifyUserEmailRequest);
      case 'RequestEmailVerification':
        return requestEmailVerification(
            ctx, request as $2.RequestEmailVerificationRequest);
      case 'RequestEmailChange':
        return requestEmailChange(ctx, request as $2.RequestEmailChangeRequest);
      case 'ConfirmEmailChange':
        return confirmEmailChange(ctx, request as $2.ConfirmEmailChangeRequest);
      case 'RequestPasswordReset':
        return requestPasswordReset(
            ctx, request as $2.RequestPasswordResetRequest);
      case 'ConfirmPasswordReset':
        return confirmPasswordReset(
            ctx, request as $2.ConfirmPasswordResetRequest);
      case 'ChangePassword':
        return changePassword(ctx, request as $2.ChangePasswordRequest);
      case 'Logout':
        return logout(ctx, request as $2.LogoutRequest);
      case 'GetMe':
        return getMe(ctx, request as $2.GetMeRequest);
      case 'UpdateMe':
        return updateMe(ctx, request as $2.UpdateMeRequest);
      case 'UploadMyIcon':
        return uploadMyIcon(ctx, request as $2.UploadMyIconRequest);
      case 'SelectMyIcon':
        return selectMyIcon(ctx, request as $2.SelectMyIconRequest);
      case 'DeleteMyIcon':
        return deleteMyIcon(ctx, request as $2.DeleteMyIconRequest);
      case 'DeleteMe':
        return deleteMe(ctx, request as $2.DeleteMeRequest);
      case 'GetNotificationSettings':
        return getNotificationSettings(
            ctx, request as $2.GetNotificationSettingsRequest);
      case 'UpdateNotificationSettings':
        return updateNotificationSettings(
            ctx, request as $2.UpdateNotificationSettingsRequest);
      case 'GetViewerPreferences':
        return getViewerPreferences(
            ctx, request as $2.GetViewerPreferencesRequest);
      case 'UpdateViewerPreferences':
        return updateViewerPreferences(
            ctx, request as $2.UpdateViewerPreferencesRequest);
      case 'GetAnnouncement':
        return getAnnouncement(ctx, request as $2.GetAnnouncementRequest);
      case 'GetPinnedAnnouncement':
        return getPinnedAnnouncement(
            ctx, request as $2.GetPinnedAnnouncementRequest);
      case 'ListAnnouncements':
        return listAnnouncements(ctx, request as $2.ListAnnouncementsRequest);
      case 'MarkAnnouncementAsRead':
        return markAnnouncementAsRead(
            ctx, request as $2.MarkAnnouncementAsReadRequest);
      case 'MarkAllAnnouncementsAsRead':
        return markAllAnnouncementsAsRead(
            ctx, request as $2.MarkAllAnnouncementsAsReadRequest);
      case 'GetMyLegalPageAgreements':
        return getMyLegalPageAgreements(
            ctx, request as $2.GetMyLegalPageAgreementsRequest);
      case 'AgreeToLegalPages':
        return agreeToLegalPages(ctx, request as $2.AgreeToLegalPagesRequest);
      default:
        throw $core.ArgumentError('Unknown method: $methodName');
    }
  }

  $core.Map<$core.String, $core.dynamic> get $json => AuthServiceBase$json;
  $core.Map<$core.String, $core.Map<$core.String, $core.dynamic>>
      get $messageJson => AuthServiceBase$messageJson;
}
