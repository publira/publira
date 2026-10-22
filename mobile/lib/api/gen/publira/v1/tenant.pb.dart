// This is a generated file - do not edit.
//
// Generated from publira/v1/tenant.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:async' as $async;
import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

import '../types/v1/types.pb.dart' as $0;

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

class GetTenantRequest extends $pb.GeneratedMessage {
  factory GetTenantRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = GetTenantRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetTenantRequest._();

  factory GetTenantRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantRequest()..mergeFromBuffer(data, registry);
  factory GetTenantRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantRequest copyWith(void Function(GetTenantRequest) updates) =>
      super.copyWith((message) => updates(message as GetTenantRequest))
          as GetTenantRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use GetTenantRequest() / GetTenantRequest.new instead')
  static GetTenantRequest create() => GetTenantRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetTenantRequest._();
  @$core.override
  GetTenantRequest createEmptyInstance() => GetTenantRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetTenantRequest>(
          GetTenantRequest.$_createMessage);
  static GetTenantRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  /// The reader's locale. GetTenantResponse.copyright_text, site_description,
  /// and site_tagline are read from the tenant's copy in this locale, else in
  /// its default locale, else its oldest. Empty means the tenant's default
  /// locale.
  @$pb.TagNumber(2)
  $core.String get locale => $_getSZ(1);
  @$pb.TagNumber(2)
  set locale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocale() => $_clearField(2);
}

class GetTenantLegalPagesRequest extends $pb.GeneratedMessage {
  factory GetTenantLegalPagesRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = GetTenantLegalPagesRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetTenantLegalPagesRequest._();

  factory GetTenantLegalPagesRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantLegalPagesRequest()..mergeFromBuffer(data, registry);
  factory GetTenantLegalPagesRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantLegalPagesRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantLegalPagesRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantLegalPagesRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantLegalPagesRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantLegalPagesRequest copyWith(
          void Function(GetTenantLegalPagesRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetTenantLegalPagesRequest))
          as GetTenantLegalPagesRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantLegalPagesRequest() / GetTenantLegalPagesRequest.new instead')
  static GetTenantLegalPagesRequest create() => GetTenantLegalPagesRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantLegalPagesRequest._();
  @$core.override
  GetTenantLegalPagesRequest createEmptyInstance() =>
      GetTenantLegalPagesRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantLegalPagesRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantLegalPagesRequest>(
          GetTenantLegalPagesRequest.$_createMessage);
  static GetTenantLegalPagesRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);

  /// The reader's locale. Each page is read in its published translation in
  /// this locale, else the tenant's default locale, else its oldest published
  /// one, and TenantLegalPage.locale names the one read. Empty means the
  /// tenant's default locale.
  @$pb.TagNumber(2)
  $core.String get locale => $_getSZ(1);
  @$pb.TagNumber(2)
  set locale($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLocale() => $_has(1);
  @$pb.TagNumber(2)
  void clearLocale() => $_clearField(2);
}

/// A published page the tenant names for a role, in one of its translations.
/// The slug is in storage form ("/privacy"), which is also the path the
/// storefront serves it at.
class TenantLegalPage extends $pb.GeneratedMessage {
  factory TenantLegalPage({
    $core.String? slug,
    $core.String? title,
    $core.String? versionId,
    $core.String? locale,
  }) {
    final result = TenantLegalPage._();
    if (slug != null) result.slug = slug;
    if (title != null) result.title = title;
    if (versionId != null) result.versionId = versionId;
    if (locale != null) result.locale = locale;
    return result;
  }

  TenantLegalPage._();

  factory TenantLegalPage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantLegalPage()..mergeFromBuffer(data, registry);
  factory TenantLegalPage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantLegalPage()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantLegalPage',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantLegalPage.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'slug')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'versionId')
    ..aOS(4, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantLegalPage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantLegalPage copyWith(void Function(TenantLegalPage) updates) =>
      super.copyWith((message) => updates(message as TenantLegalPage))
          as TenantLegalPage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantLegalPage() / TenantLegalPage.new instead')
  static TenantLegalPage create() => TenantLegalPage._();
  static $pb.GeneratedMessage $_createMessage() => TenantLegalPage._();
  @$core.override
  TenantLegalPage createEmptyInstance() => TenantLegalPage._();
  @$core.pragma('dart2js:noInline')
  static TenantLegalPage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TenantLegalPage>(
          TenantLegalPage.$_createMessage);
  static TenantLegalPage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get slug => $_getSZ(0);
  @$pb.TagNumber(1)
  set slug($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasSlug() => $_has(0);
  @$pb.TagNumber(1)
  void clearSlug() => $_clearField(1);

  /// The title of the translation read.
  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  /// The published version of the translation read, which a sign-up sends back
  /// in CreateUserRequest.agreed_page_version_ids, and an existing reader in
  /// AuthService.AgreeToLegalPages.
  @$pb.TagNumber(3)
  $core.String get versionId => $_getSZ(2);
  @$pb.TagNumber(3)
  set versionId($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVersionId() => $_has(2);
  @$pb.TagNumber(3)
  void clearVersionId() => $_clearField(3);

  /// The locale of the translation read, which differs from the one asked for
  /// when the page has no published translation in it.
  @$pb.TagNumber(4)
  $core.String get locale => $_getSZ(3);
  @$pb.TagNumber(4)
  set locale($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasLocale() => $_has(3);
  @$pb.TagNumber(4)
  void clearLocale() => $_clearField(4);
}

/// The pages the tenant names as its terms of service and its privacy policy.
/// A role is absent where the tenant has named no page for it, and where the
/// page it named is not published, so a link built from one always resolves.
class GetTenantLegalPagesResponse extends $pb.GeneratedMessage {
  factory GetTenantLegalPagesResponse({
    TenantLegalPage? termsPage,
    TenantLegalPage? privacyPage,
  }) {
    final result = GetTenantLegalPagesResponse._();
    if (termsPage != null) result.termsPage = termsPage;
    if (privacyPage != null) result.privacyPage = privacyPage;
    return result;
  }

  GetTenantLegalPagesResponse._();

  factory GetTenantLegalPagesResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantLegalPagesResponse()..mergeFromBuffer(data, registry);
  factory GetTenantLegalPagesResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantLegalPagesResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantLegalPagesResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantLegalPagesResponse.$_createMessage)
    ..aOM<TenantLegalPage>(1, _omitFieldNames ? '' : 'termsPage',
        subBuilder: TenantLegalPage.$_createMessage)
    ..aOM<TenantLegalPage>(2, _omitFieldNames ? '' : 'privacyPage',
        subBuilder: TenantLegalPage.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantLegalPagesResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantLegalPagesResponse copyWith(
          void Function(GetTenantLegalPagesResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetTenantLegalPagesResponse))
          as GetTenantLegalPagesResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantLegalPagesResponse() / GetTenantLegalPagesResponse.new instead')
  static GetTenantLegalPagesResponse create() =>
      GetTenantLegalPagesResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantLegalPagesResponse._();
  @$core.override
  GetTenantLegalPagesResponse createEmptyInstance() =>
      GetTenantLegalPagesResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantLegalPagesResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantLegalPagesResponse>(
          GetTenantLegalPagesResponse.$_createMessage);
  static GetTenantLegalPagesResponse? _defaultInstance;

  @$pb.TagNumber(1)
  TenantLegalPage get termsPage => $_getN(0);
  @$pb.TagNumber(1)
  set termsPage(TenantLegalPage value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTermsPage() => $_has(0);
  @$pb.TagNumber(1)
  void clearTermsPage() => $_clearField(1);
  @$pb.TagNumber(1)
  TenantLegalPage ensureTermsPage() => $_ensure(0);

  @$pb.TagNumber(2)
  TenantLegalPage get privacyPage => $_getN(1);
  @$pb.TagNumber(2)
  set privacyPage(TenantLegalPage value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasPrivacyPage() => $_has(1);
  @$pb.TagNumber(2)
  void clearPrivacyPage() => $_clearField(2);
  @$pb.TagNumber(2)
  TenantLegalPage ensurePrivacyPage() => $_ensure(1);
}

class GetTenantResponse extends $pb.GeneratedMessage {
  factory GetTenantResponse({
    $core.String? tenantPublicId,
    $core.String? tenantName,
    $core.String? tenantDomain,
    $core.String? copyrightText,
    $core.String? siteDescription,
    $core.String? siteTagline,
    $0.TenantTheme? theme,
    $core.String? timezone,
    $core.String? defaultLocale,
    $core.bool? acceptsPayments,
    $0.CommentMode? commentMode,
    $0.AgeVerification? ageVerification,
    $core.String? webPushVapidPublicKey,
    $core.String? appStoreUrl,
    $core.String? googlePlayUrl,
    $0.AppPurchaseRoute? appPurchaseRoute,
    $core.bool? acceptsAppStorePayments,
    $core.bool? acceptsGooglePlayPayments,
    TenantAppleSignIn? appleSignIn,
    TenantGoogleSignIn? googleSignIn,
    $core.String? currency,
    $core.Iterable<$core.String>? supportedLocales,
  }) {
    final result = GetTenantResponse._();
    if (tenantPublicId != null) result.tenantPublicId = tenantPublicId;
    if (tenantName != null) result.tenantName = tenantName;
    if (tenantDomain != null) result.tenantDomain = tenantDomain;
    if (copyrightText != null) result.copyrightText = copyrightText;
    if (siteDescription != null) result.siteDescription = siteDescription;
    if (siteTagline != null) result.siteTagline = siteTagline;
    if (theme != null) result.theme = theme;
    if (timezone != null) result.timezone = timezone;
    if (defaultLocale != null) result.defaultLocale = defaultLocale;
    if (acceptsPayments != null) result.acceptsPayments = acceptsPayments;
    if (commentMode != null) result.commentMode = commentMode;
    if (ageVerification != null) result.ageVerification = ageVerification;
    if (webPushVapidPublicKey != null)
      result.webPushVapidPublicKey = webPushVapidPublicKey;
    if (appStoreUrl != null) result.appStoreUrl = appStoreUrl;
    if (googlePlayUrl != null) result.googlePlayUrl = googlePlayUrl;
    if (appPurchaseRoute != null) result.appPurchaseRoute = appPurchaseRoute;
    if (acceptsAppStorePayments != null)
      result.acceptsAppStorePayments = acceptsAppStorePayments;
    if (acceptsGooglePlayPayments != null)
      result.acceptsGooglePlayPayments = acceptsGooglePlayPayments;
    if (appleSignIn != null) result.appleSignIn = appleSignIn;
    if (googleSignIn != null) result.googleSignIn = googleSignIn;
    if (currency != null) result.currency = currency;
    if (supportedLocales != null)
      result.supportedLocales.addAll(supportedLocales);
    return result;
  }

  GetTenantResponse._();

  factory GetTenantResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantResponse()..mergeFromBuffer(data, registry);
  factory GetTenantResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantResponse.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'tenantPublicId')
    ..aOS(2, _omitFieldNames ? '' : 'tenantName')
    ..aOS(3, _omitFieldNames ? '' : 'tenantDomain')
    ..aOS(4, _omitFieldNames ? '' : 'copyrightText')
    ..aOS(5, _omitFieldNames ? '' : 'siteDescription')
    ..aOS(6, _omitFieldNames ? '' : 'siteTagline')
    ..aOM<$0.TenantTheme>(7, _omitFieldNames ? '' : 'theme',
        subBuilder: $0.TenantTheme.$_createMessage)
    ..aOS(8, _omitFieldNames ? '' : 'timezone')
    ..aOS(9, _omitFieldNames ? '' : 'defaultLocale')
    ..aOB(10, _omitFieldNames ? '' : 'acceptsPayments')
    ..aE<$0.CommentMode>(11, _omitFieldNames ? '' : 'commentMode',
        enumValues: $0.CommentMode.values)
    ..aE<$0.AgeVerification>(12, _omitFieldNames ? '' : 'ageVerification',
        enumValues: $0.AgeVerification.values)
    ..aOS(13, _omitFieldNames ? '' : 'webPushVapidPublicKey')
    ..aOS(14, _omitFieldNames ? '' : 'appStoreUrl')
    ..aOS(15, _omitFieldNames ? '' : 'googlePlayUrl')
    ..aE<$0.AppPurchaseRoute>(18, _omitFieldNames ? '' : 'appPurchaseRoute',
        enumValues: $0.AppPurchaseRoute.values)
    ..aOB(19, _omitFieldNames ? '' : 'acceptsAppStorePayments')
    ..aOB(20, _omitFieldNames ? '' : 'acceptsGooglePlayPayments')
    ..aOM<TenantAppleSignIn>(21, _omitFieldNames ? '' : 'appleSignIn',
        subBuilder: TenantAppleSignIn.$_createMessage)
    ..aOM<TenantGoogleSignIn>(22, _omitFieldNames ? '' : 'googleSignIn',
        subBuilder: TenantGoogleSignIn.$_createMessage)
    ..aOS(23, _omitFieldNames ? '' : 'currency')
    ..pPS(24, _omitFieldNames ? '' : 'supportedLocales')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantResponse copyWith(void Function(GetTenantResponse) updates) =>
      super.copyWith((message) => updates(message as GetTenantResponse))
          as GetTenantResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use GetTenantResponse() / GetTenantResponse.new instead')
  static GetTenantResponse create() => GetTenantResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetTenantResponse._();
  @$core.override
  GetTenantResponse createEmptyInstance() => GetTenantResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GetTenantResponse>(
          GetTenantResponse.$_createMessage);
  static GetTenantResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get tenantPublicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set tenantPublicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTenantPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenantPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get tenantName => $_getSZ(1);
  @$pb.TagNumber(2)
  set tenantName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTenantName() => $_has(1);
  @$pb.TagNumber(2)
  void clearTenantName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get tenantDomain => $_getSZ(2);
  @$pb.TagNumber(3)
  set tenantDomain($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTenantDomain() => $_has(2);
  @$pb.TagNumber(3)
  void clearTenantDomain() => $_clearField(3);

  /// The site copy of the locale GetTenantRequest.locale resolves to, taken
  /// together from one locale's copy: a field that copy leaves empty is empty
  /// here rather than filled in from another locale.
  @$pb.TagNumber(4)
  $core.String get copyrightText => $_getSZ(3);
  @$pb.TagNumber(4)
  set copyrightText($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCopyrightText() => $_has(3);
  @$pb.TagNumber(4)
  void clearCopyrightText() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get siteDescription => $_getSZ(4);
  @$pb.TagNumber(5)
  set siteDescription($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSiteDescription() => $_has(4);
  @$pb.TagNumber(5)
  void clearSiteDescription() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get siteTagline => $_getSZ(5);
  @$pb.TagNumber(6)
  set siteTagline($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasSiteTagline() => $_has(5);
  @$pb.TagNumber(6)
  void clearSiteTagline() => $_clearField(6);

  /// Public branding colors (defaults applied when unset).
  @$pb.TagNumber(7)
  $0.TenantTheme get theme => $_getN(6);
  @$pb.TagNumber(7)
  set theme($0.TenantTheme value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasTheme() => $_has(6);
  @$pb.TagNumber(7)
  void clearTheme() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.TenantTheme ensureTheme() => $_ensure(6);

  /// IANA time zone name used to render tenant wall-clock date/time (e.g. Asia/Tokyo).
  /// Never empty; the default is applied when unset.
  @$pb.TagNumber(8)
  $core.String get timezone => $_getSZ(7);
  @$pb.TagNumber(8)
  set timezone($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasTimezone() => $_has(7);
  @$pb.TagNumber(8)
  void clearTimezone() => $_clearField(8);

  /// UI locale code used when the visitor has not chosen one (ja, en). The
  /// tenant's own saved value, never a stand-in: a stored code naming no
  /// supported locale fails this RPC rather than answering another language.
  @$pb.TagNumber(9)
  $core.String get defaultLocale => $_getSZ(8);
  @$pb.TagNumber(9)
  set defaultLocale($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasDefaultLocale() => $_has(8);
  @$pb.TagNumber(9)
  void clearDefaultLocale() => $_clearField(9);

  /// Whether the tenant can currently accept episode payments. This never
  /// exposes payment-provider credentials or their configuration details.
  @$pb.TagNumber(10)
  $core.bool get acceptsPayments => $_getBF(9);
  @$pb.TagNumber(10)
  set acceptsPayments($core.bool value) => $_setBool(9, value);
  @$pb.TagNumber(10)
  $core.bool hasAcceptsPayments() => $_has(9);
  @$pb.TagNumber(10)
  void clearAcceptsPayments() => $_clearField(10);

  /// How reader comments on this tenant's episodes are published, for every
  /// series that states nothing of its own. A series carrying its own mode
  /// overrides this one, and CatalogService.GetSeriesDetail carries the two
  /// already resolved, so a page about one series reads the mode there rather
  /// than here.
  @$pb.TagNumber(11)
  $0.CommentMode get commentMode => $_getN(10);
  @$pb.TagNumber(11)
  set commentMode($0.CommentMode value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasCommentMode() => $_has(10);
  @$pb.TagNumber(11)
  void clearCommentMode() => $_clearField(11);

  /// Which of this tenant's age ratings a reader has to prove an age for. The
  /// public site reads it to decide whether the sign-up form asks for a birth
  /// date at all, so it is answered here rather than only where a body is
  /// opened.
  @$pb.TagNumber(12)
  $0.AgeVerification get ageVerification => $_getN(11);
  @$pb.TagNumber(12)
  set ageVerification($0.AgeVerification value) => $_setField(12, value);
  @$pb.TagNumber(12)
  $core.bool hasAgeVerification() => $_has(11);
  @$pb.TagNumber(12)
  void clearAgeVerification() => $_clearField(12);

  /// VAPID public key for Web Push. Empty means Web Push is not configured.
  @$pb.TagNumber(13)
  $core.String get webPushVapidPublicKey => $_getSZ(12);
  @$pb.TagNumber(13)
  set webPushVapidPublicKey($core.String value) => $_setString(12, value);
  @$pb.TagNumber(13)
  $core.bool hasWebPushVapidPublicKey() => $_has(12);
  @$pb.TagNumber(13)
  void clearWebPushVapidPublicKey() => $_clearField(13);

  /// The store listings of the tenant's app, where the storefront sends a
  /// reader to buy an episode sold in the app alone. Empty where the tenant has
  /// no listing in that store.
  @$pb.TagNumber(14)
  $core.String get appStoreUrl => $_getSZ(13);
  @$pb.TagNumber(14)
  set appStoreUrl($core.String value) => $_setString(13, value);
  @$pb.TagNumber(14)
  $core.bool hasAppStoreUrl() => $_has(13);
  @$pb.TagNumber(14)
  void clearAppStoreUrl() => $_clearField(14);

  @$pb.TagNumber(15)
  $core.String get googlePlayUrl => $_getSZ(14);
  @$pb.TagNumber(15)
  set googlePlayUrl($core.String value) => $_setString(14, value);
  @$pb.TagNumber(15)
  $core.bool hasGooglePlayUrl() => $_has(14);
  @$pb.TagNumber(15)
  void clearGooglePlayUrl() => $_clearField(15);

  /// Which purchase the tenant's app offers for an episode it may sell. Never
  /// APP_PURCHASE_ROUTE_UNSPECIFIED: a tenant that has chosen nothing sells
  /// through the external checkout.
  @$pb.TagNumber(18)
  $0.AppPurchaseRoute get appPurchaseRoute => $_getN(15);
  @$pb.TagNumber(18)
  set appPurchaseRoute($0.AppPurchaseRoute value) => $_setField(18, value);
  @$pb.TagNumber(18)
  $core.bool hasAppPurchaseRoute() => $_has(15);
  @$pb.TagNumber(18)
  void clearAppPurchaseRoute() => $_clearField(18);

  /// Whether the tenant's app can sell an episode through the App Store's and
  /// Google Play's in-app purchase right now: the route is
  /// APP_PURCHASE_ROUTE_STORE and that store is ready, which is what
  /// PurchaseService.StartStorePurchase requires. The route needs only one
  /// ready store, so the app on the other platform offers no purchase. Like
  /// accepts_payments, this exposes nothing of the credentials.
  @$pb.TagNumber(19)
  $core.bool get acceptsAppStorePayments => $_getBF(16);
  @$pb.TagNumber(19)
  set acceptsAppStorePayments($core.bool value) => $_setBool(16, value);
  @$pb.TagNumber(19)
  $core.bool hasAcceptsAppStorePayments() => $_has(16);
  @$pb.TagNumber(19)
  void clearAcceptsAppStorePayments() => $_clearField(19);

  @$pb.TagNumber(20)
  $core.bool get acceptsGooglePlayPayments => $_getBF(17);
  @$pb.TagNumber(20)
  set acceptsGooglePlayPayments($core.bool value) => $_setBool(17, value);
  @$pb.TagNumber(20)
  $core.bool hasAcceptsGooglePlayPayments() => $_has(17);
  @$pb.TagNumber(20)
  void clearAcceptsGooglePlayPayments() => $_clearField(20);

  /// The providers a reader can sign in with, with the public client IDs each
  /// one signs in through. A provider is absent where the tenant has not
  /// enabled it or it is not ready, and AuthService.LoginWithIdToken refuses it
  /// then.
  @$pb.TagNumber(21)
  TenantAppleSignIn get appleSignIn => $_getN(18);
  @$pb.TagNumber(21)
  set appleSignIn(TenantAppleSignIn value) => $_setField(21, value);
  @$pb.TagNumber(21)
  $core.bool hasAppleSignIn() => $_has(18);
  @$pb.TagNumber(21)
  void clearAppleSignIn() => $_clearField(21);
  @$pb.TagNumber(21)
  TenantAppleSignIn ensureAppleSignIn() => $_ensure(18);

  @$pb.TagNumber(22)
  TenantGoogleSignIn get googleSignIn => $_getN(19);
  @$pb.TagNumber(22)
  set googleSignIn(TenantGoogleSignIn value) => $_setField(22, value);
  @$pb.TagNumber(22)
  $core.bool hasGoogleSignIn() => $_has(19);
  @$pb.TagNumber(22)
  void clearGoogleSignIn() => $_clearField(22);
  @$pb.TagNumber(22)
  TenantGoogleSignIn ensureGoogleSignIn() => $_ensure(19);

  /// The ISO 4217 code, in capitals, of the currency the tenant sells in. Every
  /// price the catalog answers is an integer in its minor unit, so a price of
  /// 500 is 500 yen in JPY and 5.00 dollars in USD. Never empty: a tenant that
  /// has saved no payment settings sells in the platform's default currency.
  @$pb.TagNumber(23)
  $core.String get currency => $_getSZ(20);
  @$pb.TagNumber(23)
  set currency($core.String value) => $_setString(20, value);
  @$pb.TagNumber(23)
  $core.bool hasCurrency() => $_has(20);
  @$pb.TagNumber(23)
  void clearCurrency() => $_clearField(23);

  /// UI locale codes the tenant's site offers its readers, in the order of the
  /// locale registry (locales/index.json). Always holds default_locale, so it is
  /// never empty; like default_locale, a stored code naming no supported locale
  /// fails this RPC rather than being left out.
  @$pb.TagNumber(24)
  $pb.PbList<$core.String> get supportedLocales => $_getList(21);
}

/// How a client signs a reader in with Apple. The iOS app signs in with its own
/// bundle identifier, which GetTenantMobileAppAssociation names.
class TenantAppleSignIn extends $pb.GeneratedMessage {
  factory TenantAppleSignIn({
    $core.String? servicesId,
  }) {
    final result = TenantAppleSignIn._();
    if (servicesId != null) result.servicesId = servicesId;
    return result;
  }

  TenantAppleSignIn._();

  factory TenantAppleSignIn.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantAppleSignIn()..mergeFromBuffer(data, registry);
  factory TenantAppleSignIn.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantAppleSignIn()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantAppleSignIn',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantAppleSignIn.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'servicesId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantAppleSignIn clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantAppleSignIn copyWith(void Function(TenantAppleSignIn) updates) =>
      super.copyWith((message) => updates(message as TenantAppleSignIn))
          as TenantAppleSignIn;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantAppleSignIn() / TenantAppleSignIn.new instead')
  static TenantAppleSignIn create() => TenantAppleSignIn._();
  static $pb.GeneratedMessage $_createMessage() => TenantAppleSignIn._();
  @$core.override
  TenantAppleSignIn createEmptyInstance() => TenantAppleSignIn._();
  @$core.pragma('dart2js:noInline')
  static TenantAppleSignIn getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TenantAppleSignIn>(
          TenantAppleSignIn.$_createMessage);
  static TenantAppleSignIn? _defaultInstance;

  /// The Services ID the storefront and the Android app sign in with. Empty
  /// where only the iOS app may.
  @$pb.TagNumber(1)
  $core.String get servicesId => $_getSZ(0);
  @$pb.TagNumber(1)
  set servicesId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasServicesId() => $_has(0);
  @$pb.TagNumber(1)
  void clearServicesId() => $_clearField(1);
}

/// How a client signs a reader in with Google. The Android app signs in with
/// web_client_id as its server client ID.
class TenantGoogleSignIn extends $pb.GeneratedMessage {
  factory TenantGoogleSignIn({
    $core.String? webClientId,
    $core.String? iosClientId,
  }) {
    final result = TenantGoogleSignIn._();
    if (webClientId != null) result.webClientId = webClientId;
    if (iosClientId != null) result.iosClientId = iosClientId;
    return result;
  }

  TenantGoogleSignIn._();

  factory TenantGoogleSignIn.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantGoogleSignIn()..mergeFromBuffer(data, registry);
  factory TenantGoogleSignIn.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantGoogleSignIn()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantGoogleSignIn',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantGoogleSignIn.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'webClientId')
    ..aOS(2, _omitFieldNames ? '' : 'iosClientId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantGoogleSignIn clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantGoogleSignIn copyWith(void Function(TenantGoogleSignIn) updates) =>
      super.copyWith((message) => updates(message as TenantGoogleSignIn))
          as TenantGoogleSignIn;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantGoogleSignIn() / TenantGoogleSignIn.new instead')
  static TenantGoogleSignIn create() => TenantGoogleSignIn._();
  static $pb.GeneratedMessage $_createMessage() => TenantGoogleSignIn._();
  @$core.override
  TenantGoogleSignIn createEmptyInstance() => TenantGoogleSignIn._();
  @$core.pragma('dart2js:noInline')
  static TenantGoogleSignIn getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TenantGoogleSignIn>(
          TenantGoogleSignIn.$_createMessage);
  static TenantGoogleSignIn? _defaultInstance;

  /// Empty where the tenant has no client of that kind.
  @$pb.TagNumber(1)
  $core.String get webClientId => $_getSZ(0);
  @$pb.TagNumber(1)
  set webClientId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasWebClientId() => $_has(0);
  @$pb.TagNumber(1)
  void clearWebClientId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get iosClientId => $_getSZ(1);
  @$pb.TagNumber(2)
  set iosClientId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasIosClientId() => $_has(1);
  @$pb.TagNumber(2)
  void clearIosClientId() => $_clearField(2);
}

class GetTenantReaderIconPolicyRequest extends $pb.GeneratedMessage {
  factory GetTenantReaderIconPolicyRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetTenantReaderIconPolicyRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetTenantReaderIconPolicyRequest._();

  factory GetTenantReaderIconPolicyRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantReaderIconPolicyRequest()..mergeFromBuffer(data, registry);
  factory GetTenantReaderIconPolicyRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantReaderIconPolicyRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantReaderIconPolicyRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantReaderIconPolicyRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantReaderIconPolicyRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantReaderIconPolicyRequest copyWith(
          void Function(GetTenantReaderIconPolicyRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetTenantReaderIconPolicyRequest))
          as GetTenantReaderIconPolicyRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantReaderIconPolicyRequest() / GetTenantReaderIconPolicyRequest.new instead')
  static GetTenantReaderIconPolicyRequest create() =>
      GetTenantReaderIconPolicyRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantReaderIconPolicyRequest._();
  @$core.override
  GetTenantReaderIconPolicyRequest createEmptyInstance() =>
      GetTenantReaderIconPolicyRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantReaderIconPolicyRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantReaderIconPolicyRequest>(
          GetTenantReaderIconPolicyRequest.$_createMessage);
  static GetTenantReaderIconPolicyRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);
}

/// What a reader of the tenant may show as an icon, which decides the icon
/// field a settings screen offers: AuthService.UploadMyIcon under UPLOAD,
/// AuthService.SelectMyIcon with one of presets under PRESET, and none under
/// DISABLED. AuthService.DeleteMyIcon is accepted under every policy.
class GetTenantReaderIconPolicyResponse extends $pb.GeneratedMessage {
  factory GetTenantReaderIconPolicyResponse({
    $0.ReaderIconPolicy? policy,
    $core.Iterable<$0.ReaderIconPreset>? presets,
  }) {
    final result = GetTenantReaderIconPolicyResponse._();
    if (policy != null) result.policy = policy;
    if (presets != null) result.presets.addAll(presets);
    return result;
  }

  GetTenantReaderIconPolicyResponse._();

  factory GetTenantReaderIconPolicyResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantReaderIconPolicyResponse()..mergeFromBuffer(data, registry);
  factory GetTenantReaderIconPolicyResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantReaderIconPolicyResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantReaderIconPolicyResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantReaderIconPolicyResponse.$_createMessage)
    ..aE<$0.ReaderIconPolicy>(1, _omitFieldNames ? '' : 'policy',
        enumValues: $0.ReaderIconPolicy.values)
    ..pPM<$0.ReaderIconPreset>(2, _omitFieldNames ? '' : 'presets',
        subBuilder: $0.ReaderIconPreset.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantReaderIconPolicyResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantReaderIconPolicyResponse copyWith(
          void Function(GetTenantReaderIconPolicyResponse) updates) =>
      super.copyWith((message) =>
              updates(message as GetTenantReaderIconPolicyResponse))
          as GetTenantReaderIconPolicyResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantReaderIconPolicyResponse() / GetTenantReaderIconPolicyResponse.new instead')
  static GetTenantReaderIconPolicyResponse create() =>
      GetTenantReaderIconPolicyResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantReaderIconPolicyResponse._();
  @$core.override
  GetTenantReaderIconPolicyResponse createEmptyInstance() =>
      GetTenantReaderIconPolicyResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantReaderIconPolicyResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantReaderIconPolicyResponse>(
          GetTenantReaderIconPolicyResponse.$_createMessage);
  static GetTenantReaderIconPolicyResponse? _defaultInstance;

  /// Never READER_ICON_POLICY_UNSPECIFIED: a tenant that has chosen nothing
  /// lets readers upload.
  @$pb.TagNumber(1)
  $0.ReaderIconPolicy get policy => $_getN(0);
  @$pb.TagNumber(1)
  set policy($0.ReaderIconPolicy value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPolicy() => $_has(0);
  @$pb.TagNumber(1)
  void clearPolicy() => $_clearField(1);

  /// The presets a reader may pick, oldest first. Empty unless policy is
  /// READER_ICON_POLICY_PRESET.
  @$pb.TagNumber(2)
  $pb.PbList<$0.ReaderIconPreset> get presets => $_getList(1);
}

class GetTenantMobileAppAssociationRequest extends $pb.GeneratedMessage {
  factory GetTenantMobileAppAssociationRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetTenantMobileAppAssociationRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetTenantMobileAppAssociationRequest._();

  factory GetTenantMobileAppAssociationRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantMobileAppAssociationRequest()..mergeFromBuffer(data, registry);
  factory GetTenantMobileAppAssociationRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantMobileAppAssociationRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantMobileAppAssociationRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantMobileAppAssociationRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantMobileAppAssociationRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantMobileAppAssociationRequest copyWith(
          void Function(GetTenantMobileAppAssociationRequest) updates) =>
      super.copyWith((message) =>
              updates(message as GetTenantMobileAppAssociationRequest))
          as GetTenantMobileAppAssociationRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantMobileAppAssociationRequest() / GetTenantMobileAppAssociationRequest.new instead')
  static GetTenantMobileAppAssociationRequest create() =>
      GetTenantMobileAppAssociationRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantMobileAppAssociationRequest._();
  @$core.override
  GetTenantMobileAppAssociationRequest createEmptyInstance() =>
      GetTenantMobileAppAssociationRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantMobileAppAssociationRequest getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<
              GetTenantMobileAppAssociationRequest>(
          GetTenantMobileAppAssociationRequest.$_createMessage);
  static GetTenantMobileAppAssociationRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);
}

/// The Android app the tenant's links open in, as assetlinks.json names it.
class TenantAndroidAppAssociation extends $pb.GeneratedMessage {
  factory TenantAndroidAppAssociation({
    $core.String? applicationId,
    $core.Iterable<$core.String>? sha256CertFingerprints,
  }) {
    final result = TenantAndroidAppAssociation._();
    if (applicationId != null) result.applicationId = applicationId;
    if (sha256CertFingerprints != null)
      result.sha256CertFingerprints.addAll(sha256CertFingerprints);
    return result;
  }

  TenantAndroidAppAssociation._();

  factory TenantAndroidAppAssociation.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantAndroidAppAssociation()..mergeFromBuffer(data, registry);
  factory TenantAndroidAppAssociation.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantAndroidAppAssociation()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantAndroidAppAssociation',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantAndroidAppAssociation.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'applicationId')
    ..pPS(2, _omitFieldNames ? '' : 'sha256CertFingerprints')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantAndroidAppAssociation clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantAndroidAppAssociation copyWith(
          void Function(TenantAndroidAppAssociation) updates) =>
      super.copyWith(
              (message) => updates(message as TenantAndroidAppAssociation))
          as TenantAndroidAppAssociation;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use TenantAndroidAppAssociation() / TenantAndroidAppAssociation.new instead')
  static TenantAndroidAppAssociation create() =>
      TenantAndroidAppAssociation._();
  static $pb.GeneratedMessage $_createMessage() =>
      TenantAndroidAppAssociation._();
  @$core.override
  TenantAndroidAppAssociation createEmptyInstance() =>
      TenantAndroidAppAssociation._();
  @$core.pragma('dart2js:noInline')
  static TenantAndroidAppAssociation getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TenantAndroidAppAssociation>(
          TenantAndroidAppAssociation.$_createMessage);
  static TenantAndroidAppAssociation? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get applicationId => $_getSZ(0);
  @$pb.TagNumber(1)
  set applicationId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasApplicationId() => $_has(0);
  @$pb.TagNumber(1)
  void clearApplicationId() => $_clearField(1);

  /// Colon-separated hex in capital letters (AA:BB:...), one per signing
  /// certificate. Never empty.
  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get sha256CertFingerprints => $_getList(1);
}

/// The iOS app the tenant's links open in, which apple-app-site-association
/// names as <team_id>.<bundle_identifier>.
class TenantIosAppAssociation extends $pb.GeneratedMessage {
  factory TenantIosAppAssociation({
    $core.String? teamId,
    $core.String? bundleIdentifier,
  }) {
    final result = TenantIosAppAssociation._();
    if (teamId != null) result.teamId = teamId;
    if (bundleIdentifier != null) result.bundleIdentifier = bundleIdentifier;
    return result;
  }

  TenantIosAppAssociation._();

  factory TenantIosAppAssociation.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantIosAppAssociation()..mergeFromBuffer(data, registry);
  factory TenantIosAppAssociation.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantIosAppAssociation()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantIosAppAssociation',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantIosAppAssociation.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'teamId')
    ..aOS(2, _omitFieldNames ? '' : 'bundleIdentifier')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantIosAppAssociation clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantIosAppAssociation copyWith(
          void Function(TenantIosAppAssociation) updates) =>
      super.copyWith((message) => updates(message as TenantIosAppAssociation))
          as TenantIosAppAssociation;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use TenantIosAppAssociation() / TenantIosAppAssociation.new instead')
  static TenantIosAppAssociation create() => TenantIosAppAssociation._();
  static $pb.GeneratedMessage $_createMessage() => TenantIosAppAssociation._();
  @$core.override
  TenantIosAppAssociation createEmptyInstance() => TenantIosAppAssociation._();
  @$core.pragma('dart2js:noInline')
  static TenantIosAppAssociation getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TenantIosAppAssociation>(
          TenantIosAppAssociation.$_createMessage);
  static TenantIosAppAssociation? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get teamId => $_getSZ(0);
  @$pb.TagNumber(1)
  set teamId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTeamId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTeamId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get bundleIdentifier => $_getSZ(1);
  @$pb.TagNumber(2)
  set bundleIdentifier($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBundleIdentifier() => $_has(1);
  @$pb.TagNumber(2)
  void clearBundleIdentifier() => $_clearField(2);
}

/// A platform is absent where the tenant has no app on it, and nothing stands
/// in for it.
class GetTenantMobileAppAssociationResponse extends $pb.GeneratedMessage {
  factory GetTenantMobileAppAssociationResponse({
    TenantAndroidAppAssociation? android,
    TenantIosAppAssociation? ios,
  }) {
    final result = GetTenantMobileAppAssociationResponse._();
    if (android != null) result.android = android;
    if (ios != null) result.ios = ios;
    return result;
  }

  GetTenantMobileAppAssociationResponse._();

  factory GetTenantMobileAppAssociationResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantMobileAppAssociationResponse()..mergeFromBuffer(data, registry);
  factory GetTenantMobileAppAssociationResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantMobileAppAssociationResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantMobileAppAssociationResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance:
          GetTenantMobileAppAssociationResponse.$_createMessage)
    ..aOM<TenantAndroidAppAssociation>(1, _omitFieldNames ? '' : 'android',
        subBuilder: TenantAndroidAppAssociation.$_createMessage)
    ..aOM<TenantIosAppAssociation>(2, _omitFieldNames ? '' : 'ios',
        subBuilder: TenantIosAppAssociation.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantMobileAppAssociationResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantMobileAppAssociationResponse copyWith(
          void Function(GetTenantMobileAppAssociationResponse) updates) =>
      super.copyWith((message) =>
              updates(message as GetTenantMobileAppAssociationResponse))
          as GetTenantMobileAppAssociationResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantMobileAppAssociationResponse() / GetTenantMobileAppAssociationResponse.new instead')
  static GetTenantMobileAppAssociationResponse create() =>
      GetTenantMobileAppAssociationResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantMobileAppAssociationResponse._();
  @$core.override
  GetTenantMobileAppAssociationResponse createEmptyInstance() =>
      GetTenantMobileAppAssociationResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantMobileAppAssociationResponse getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<
              GetTenantMobileAppAssociationResponse>(
          GetTenantMobileAppAssociationResponse.$_createMessage);
  static GetTenantMobileAppAssociationResponse? _defaultInstance;

  @$pb.TagNumber(1)
  TenantAndroidAppAssociation get android => $_getN(0);
  @$pb.TagNumber(1)
  set android(TenantAndroidAppAssociation value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasAndroid() => $_has(0);
  @$pb.TagNumber(1)
  void clearAndroid() => $_clearField(1);
  @$pb.TagNumber(1)
  TenantAndroidAppAssociation ensureAndroid() => $_ensure(0);

  @$pb.TagNumber(2)
  TenantIosAppAssociation get ios => $_getN(1);
  @$pb.TagNumber(2)
  set ios(TenantIosAppAssociation value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasIos() => $_has(1);
  @$pb.TagNumber(2)
  void clearIos() => $_clearField(2);
  @$pb.TagNumber(2)
  TenantIosAppAssociation ensureIos() => $_ensure(1);
}

class GetTenantAnalyticsSettingsRequest extends $pb.GeneratedMessage {
  factory GetTenantAnalyticsSettingsRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetTenantAnalyticsSettingsRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetTenantAnalyticsSettingsRequest._();

  factory GetTenantAnalyticsSettingsRequest.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantAnalyticsSettingsRequest()..mergeFromBuffer(data, registry);
  factory GetTenantAnalyticsSettingsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantAnalyticsSettingsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantAnalyticsSettingsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantAnalyticsSettingsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantAnalyticsSettingsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantAnalyticsSettingsRequest copyWith(
          void Function(GetTenantAnalyticsSettingsRequest) updates) =>
      super.copyWith((message) =>
              updates(message as GetTenantAnalyticsSettingsRequest))
          as GetTenantAnalyticsSettingsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantAnalyticsSettingsRequest() / GetTenantAnalyticsSettingsRequest.new instead')
  static GetTenantAnalyticsSettingsRequest create() =>
      GetTenantAnalyticsSettingsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantAnalyticsSettingsRequest._();
  @$core.override
  GetTenantAnalyticsSettingsRequest createEmptyInstance() =>
      GetTenantAnalyticsSettingsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantAnalyticsSettingsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantAnalyticsSettingsRequest>(
          GetTenantAnalyticsSettingsRequest.$_createMessage);
  static GetTenantAnalyticsSettingsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);
}

/// The Google tag the storefront loads, with only the values its serving mode
/// uses.
class TenantGoogleTag extends $pb.GeneratedMessage {
  factory TenantGoogleTag({
    $core.String? ga4MeasurementId,
    $core.String? gtmContainerId,
    $0.GoogleTagServingMode? servingMode,
    $core.String? serverContainerUrl,
    $core.String? gatewayPath,
  }) {
    final result = TenantGoogleTag._();
    if (ga4MeasurementId != null) result.ga4MeasurementId = ga4MeasurementId;
    if (gtmContainerId != null) result.gtmContainerId = gtmContainerId;
    if (servingMode != null) result.servingMode = servingMode;
    if (serverContainerUrl != null)
      result.serverContainerUrl = serverContainerUrl;
    if (gatewayPath != null) result.gatewayPath = gatewayPath;
    return result;
  }

  TenantGoogleTag._();

  factory TenantGoogleTag.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantGoogleTag()..mergeFromBuffer(data, registry);
  factory TenantGoogleTag.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantGoogleTag()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantGoogleTag',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: TenantGoogleTag.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'ga4MeasurementId')
    ..aOS(2, _omitFieldNames ? '' : 'gtmContainerId')
    ..aE<$0.GoogleTagServingMode>(3, _omitFieldNames ? '' : 'servingMode',
        enumValues: $0.GoogleTagServingMode.values)
    ..aOS(4, _omitFieldNames ? '' : 'serverContainerUrl')
    ..aOS(5, _omitFieldNames ? '' : 'gatewayPath')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantGoogleTag clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantGoogleTag copyWith(void Function(TenantGoogleTag) updates) =>
      super.copyWith((message) => updates(message as TenantGoogleTag))
          as TenantGoogleTag;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantGoogleTag() / TenantGoogleTag.new instead')
  static TenantGoogleTag create() => TenantGoogleTag._();
  static $pb.GeneratedMessage $_createMessage() => TenantGoogleTag._();
  @$core.override
  TenantGoogleTag createEmptyInstance() => TenantGoogleTag._();
  @$core.pragma('dart2js:noInline')
  static TenantGoogleTag getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TenantGoogleTag>(
          TenantGoogleTag.$_createMessage);
  static TenantGoogleTag? _defaultInstance;

  /// Either ID or both is set. Empty where the tenant has none.
  @$pb.TagNumber(1)
  $core.String get ga4MeasurementId => $_getSZ(0);
  @$pb.TagNumber(1)
  set ga4MeasurementId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasGa4MeasurementId() => $_has(0);
  @$pb.TagNumber(1)
  void clearGa4MeasurementId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get gtmContainerId => $_getSZ(1);
  @$pb.TagNumber(2)
  set gtmContainerId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasGtmContainerId() => $_has(1);
  @$pb.TagNumber(2)
  void clearGtmContainerId() => $_clearField(2);

  /// Never GOOGLE_TAG_SERVING_MODE_UNSPECIFIED.
  @$pb.TagNumber(3)
  $0.GoogleTagServingMode get servingMode => $_getN(2);
  @$pb.TagNumber(3)
  set servingMode($0.GoogleTagServingMode value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasServingMode() => $_has(2);
  @$pb.TagNumber(3)
  void clearServingMode() => $_clearField(3);

  /// The origin of the tenant's server container: set in
  /// GOOGLE_TAG_SERVING_MODE_SERVER_CONTAINER, and in
  /// GOOGLE_TAG_SERVING_MODE_GATEWAY where the gateway forwards to it rather
  /// than to Google. Empty otherwise.
  @$pb.TagNumber(4)
  $core.String get serverContainerUrl => $_getSZ(3);
  @$pb.TagNumber(4)
  set serverContainerUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasServerContainerUrl() => $_has(3);
  @$pb.TagNumber(4)
  void clearServerContainerUrl() => $_clearField(4);

  /// The first path segment the gateway answers on: set in
  /// GOOGLE_TAG_SERVING_MODE_GATEWAY alone.
  @$pb.TagNumber(5)
  $core.String get gatewayPath => $_getSZ(4);
  @$pb.TagNumber(5)
  set gatewayPath($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasGatewayPath() => $_has(4);
  @$pb.TagNumber(5)
  void clearGatewayPath() => $_clearField(5);
}

class GetTenantAnalyticsSettingsResponse extends $pb.GeneratedMessage {
  factory GetTenantAnalyticsSettingsResponse({
    TenantGoogleTag? googleTag,
  }) {
    final result = GetTenantAnalyticsSettingsResponse._();
    if (googleTag != null) result.googleTag = googleTag;
    return result;
  }

  GetTenantAnalyticsSettingsResponse._();

  factory GetTenantAnalyticsSettingsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantAnalyticsSettingsResponse()..mergeFromBuffer(data, registry);
  factory GetTenantAnalyticsSettingsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantAnalyticsSettingsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantAnalyticsSettingsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantAnalyticsSettingsResponse.$_createMessage)
    ..aOM<TenantGoogleTag>(1, _omitFieldNames ? '' : 'googleTag',
        subBuilder: TenantGoogleTag.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantAnalyticsSettingsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantAnalyticsSettingsResponse copyWith(
          void Function(GetTenantAnalyticsSettingsResponse) updates) =>
      super.copyWith((message) =>
              updates(message as GetTenantAnalyticsSettingsResponse))
          as GetTenantAnalyticsSettingsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantAnalyticsSettingsResponse() / GetTenantAnalyticsSettingsResponse.new instead')
  static GetTenantAnalyticsSettingsResponse create() =>
      GetTenantAnalyticsSettingsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantAnalyticsSettingsResponse._();
  @$core.override
  GetTenantAnalyticsSettingsResponse createEmptyInstance() =>
      GetTenantAnalyticsSettingsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantAnalyticsSettingsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantAnalyticsSettingsResponse>(
          GetTenantAnalyticsSettingsResponse.$_createMessage);
  static GetTenantAnalyticsSettingsResponse? _defaultInstance;

  /// Absent where the tenant loads no tag: it names neither ID.
  @$pb.TagNumber(1)
  TenantGoogleTag get googleTag => $_getN(0);
  @$pb.TagNumber(1)
  set googleTag(TenantGoogleTag value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasGoogleTag() => $_has(0);
  @$pb.TagNumber(1)
  void clearGoogleTag() => $_clearField(1);
  @$pb.TagNumber(1)
  TenantGoogleTag ensureGoogleTag() => $_ensure(0);
}

class GetTenantCrawlerSettingsRequest extends $pb.GeneratedMessage {
  factory GetTenantCrawlerSettingsRequest({
    $0.TenantContext? tenant,
  }) {
    final result = GetTenantCrawlerSettingsRequest._();
    if (tenant != null) result.tenant = tenant;
    return result;
  }

  GetTenantCrawlerSettingsRequest._();

  factory GetTenantCrawlerSettingsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantCrawlerSettingsRequest()..mergeFromBuffer(data, registry);
  factory GetTenantCrawlerSettingsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantCrawlerSettingsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantCrawlerSettingsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantCrawlerSettingsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantCrawlerSettingsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantCrawlerSettingsRequest copyWith(
          void Function(GetTenantCrawlerSettingsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as GetTenantCrawlerSettingsRequest))
          as GetTenantCrawlerSettingsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantCrawlerSettingsRequest() / GetTenantCrawlerSettingsRequest.new instead')
  static GetTenantCrawlerSettingsRequest create() =>
      GetTenantCrawlerSettingsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantCrawlerSettingsRequest._();
  @$core.override
  GetTenantCrawlerSettingsRequest createEmptyInstance() =>
      GetTenantCrawlerSettingsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetTenantCrawlerSettingsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantCrawlerSettingsRequest>(
          GetTenantCrawlerSettingsRequest.$_createMessage);
  static GetTenantCrawlerSettingsRequest? _defaultInstance;

  @$pb.TagNumber(1)
  $0.TenantContext get tenant => $_getN(0);
  @$pb.TagNumber(1)
  set tenant($0.TenantContext value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasTenant() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenant() => $_clearField(1);
  @$pb.TagNumber(1)
  $0.TenantContext ensureTenant() => $_ensure(0);
}

/// What the tenant's robots.txt excludes. Both lists are empty for a tenant
/// that excludes nothing.
class GetTenantCrawlerSettingsResponse extends $pb.GeneratedMessage {
  factory GetTenantCrawlerSettingsResponse({
    $core.Iterable<$core.String>? excludedUserAgents,
    $core.Iterable<$core.String>? excludedPaths,
  }) {
    final result = GetTenantCrawlerSettingsResponse._();
    if (excludedUserAgents != null)
      result.excludedUserAgents.addAll(excludedUserAgents);
    if (excludedPaths != null) result.excludedPaths.addAll(excludedPaths);
    return result;
  }

  GetTenantCrawlerSettingsResponse._();

  factory GetTenantCrawlerSettingsResponse.fromBuffer(
          $core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantCrawlerSettingsResponse()..mergeFromBuffer(data, registry);
  factory GetTenantCrawlerSettingsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetTenantCrawlerSettingsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetTenantCrawlerSettingsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetTenantCrawlerSettingsResponse.$_createMessage)
    ..pPS(1, _omitFieldNames ? '' : 'excludedUserAgents')
    ..pPS(2, _omitFieldNames ? '' : 'excludedPaths')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantCrawlerSettingsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetTenantCrawlerSettingsResponse copyWith(
          void Function(GetTenantCrawlerSettingsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as GetTenantCrawlerSettingsResponse))
          as GetTenantCrawlerSettingsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetTenantCrawlerSettingsResponse() / GetTenantCrawlerSettingsResponse.new instead')
  static GetTenantCrawlerSettingsResponse create() =>
      GetTenantCrawlerSettingsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      GetTenantCrawlerSettingsResponse._();
  @$core.override
  GetTenantCrawlerSettingsResponse createEmptyInstance() =>
      GetTenantCrawlerSettingsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetTenantCrawlerSettingsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetTenantCrawlerSettingsResponse>(
          GetTenantCrawlerSettingsResponse.$_createMessage);
  static GetTenantCrawlerSettingsResponse? _defaultInstance;

  /// User-agent tokens to refuse every path to, each one a token the server
  /// knows (GPTBot, Googlebot-Image), so it is safe to write into a
  /// User-agent line as it is.
  @$pb.TagNumber(1)
  $pb.PbList<$core.String> get excludedUserAgents => $_getList(0);

  /// Paths to refuse to every crawler, each with what lies under it, in
  /// lexical order. A path starts with /, carries no trailing / unless it is /
  /// itself, and holds no whitespace, control character, *, $, ?, or #, so it
  /// is safe to write into a Disallow line as it is. None of them names
  /// /robots.txt, /sitemap.xml, or /sitemap or anything under it.
  @$pb.TagNumber(2)
  $pb.PbList<$core.String> get excludedPaths => $_getList(1);
}

class TenantServiceApi {
  final $pb.RpcClient _client;

  TenantServiceApi(this._client);

  $async.Future<GetTenantResponse> getTenant(
          $pb.ClientContext? ctx, GetTenantRequest request) =>
      _client.invoke<GetTenantResponse>(
          ctx, 'TenantService', 'GetTenant', request, GetTenantResponse());
  $async.Future<GetTenantLegalPagesResponse> getTenantLegalPages(
          $pb.ClientContext? ctx, GetTenantLegalPagesRequest request) =>
      _client.invoke<GetTenantLegalPagesResponse>(ctx, 'TenantService',
          'GetTenantLegalPages', request, GetTenantLegalPagesResponse());
  $async.Future<GetTenantMobileAppAssociationResponse>
      getTenantMobileAppAssociation($pb.ClientContext? ctx,
              GetTenantMobileAppAssociationRequest request) =>
          _client.invoke<GetTenantMobileAppAssociationResponse>(
              ctx,
              'TenantService',
              'GetTenantMobileAppAssociation',
              request,
              GetTenantMobileAppAssociationResponse());
  $async.Future<GetTenantReaderIconPolicyResponse> getTenantReaderIconPolicy(
          $pb.ClientContext? ctx, GetTenantReaderIconPolicyRequest request) =>
      _client.invoke<GetTenantReaderIconPolicyResponse>(
          ctx,
          'TenantService',
          'GetTenantReaderIconPolicy',
          request,
          GetTenantReaderIconPolicyResponse());
  $async.Future<GetTenantAnalyticsSettingsResponse> getTenantAnalyticsSettings(
          $pb.ClientContext? ctx, GetTenantAnalyticsSettingsRequest request) =>
      _client.invoke<GetTenantAnalyticsSettingsResponse>(
          ctx,
          'TenantService',
          'GetTenantAnalyticsSettings',
          request,
          GetTenantAnalyticsSettingsResponse());
  $async.Future<GetTenantCrawlerSettingsResponse> getTenantCrawlerSettings(
          $pb.ClientContext? ctx, GetTenantCrawlerSettingsRequest request) =>
      _client.invoke<GetTenantCrawlerSettingsResponse>(
          ctx,
          'TenantService',
          'GetTenantCrawlerSettings',
          request,
          GetTenantCrawlerSettingsResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
