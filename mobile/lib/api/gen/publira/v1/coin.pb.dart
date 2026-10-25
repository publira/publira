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

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import '../types/v1/types.pb.dart' as $0;
import 'catalog.pb.dart' as $1;
import 'coin.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'coin.pbenum.dart';

/// What a prepaid instrument has to disclose wherever its coins are sold: who
/// issues them, the terms they are sold under, how to reach the issuer, and a
/// notice in the tenant's own words.
class CoinDisclosures extends $pb.GeneratedMessage {
  factory CoinDisclosures({
    $core.String? issuerName,
    $core.String? termsUrl,
    $core.String? contact,
    $core.String? notice,
  }) {
    final result = CoinDisclosures._();
    if (issuerName != null) result.issuerName = issuerName;
    if (termsUrl != null) result.termsUrl = termsUrl;
    if (contact != null) result.contact = contact;
    if (notice != null) result.notice = notice;
    return result;
  }

  CoinDisclosures._();

  factory CoinDisclosures.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinDisclosures()..mergeFromBuffer(data, registry);
  factory CoinDisclosures.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinDisclosures()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CoinDisclosures',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CoinDisclosures.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'issuerName')
    ..aOS(2, _omitFieldNames ? '' : 'termsUrl')
    ..aOS(3, _omitFieldNames ? '' : 'contact')
    ..aOS(4, _omitFieldNames ? '' : 'notice')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinDisclosures clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinDisclosures copyWith(void Function(CoinDisclosures) updates) =>
      super.copyWith((message) => updates(message as CoinDisclosures))
          as CoinDisclosures;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CoinDisclosures() / CoinDisclosures.new instead')
  static CoinDisclosures create() => CoinDisclosures._();
  static $pb.GeneratedMessage $_createMessage() => CoinDisclosures._();
  @$core.override
  CoinDisclosures createEmptyInstance() => CoinDisclosures._();
  @$core.pragma('dart2js:noInline')
  static CoinDisclosures getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CoinDisclosures>(
          CoinDisclosures.$_createMessage);
  static CoinDisclosures? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get issuerName => $_getSZ(0);
  @$pb.TagNumber(1)
  set issuerName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasIssuerName() => $_has(0);
  @$pb.TagNumber(1)
  void clearIssuerName() => $_clearField(1);

  /// An absolute http or https URL.
  @$pb.TagNumber(2)
  $core.String get termsUrl => $_getSZ(1);
  @$pb.TagNumber(2)
  set termsUrl($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTermsUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearTermsUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get contact => $_getSZ(2);
  @$pb.TagNumber(3)
  set contact($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContact() => $_has(2);
  @$pb.TagNumber(3)
  void clearContact() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get notice => $_getSZ(3);
  @$pb.TagNumber(4)
  set notice($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNotice() => $_has(3);
  @$pb.TagNumber(4)
  void clearNotice() => $_clearField(4);
}

/// A pack of coins the tenant has on sale.
class CoinPack extends $pb.GeneratedMessage {
  factory CoinPack({
    $core.String? id,
    $core.String? publicId,
    $core.int? coins,
    $core.int? bonusCoins,
    $core.int? price,
    $core.String? currency,
  }) {
    final result = CoinPack._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (coins != null) result.coins = coins;
    if (bonusCoins != null) result.bonusCoins = bonusCoins;
    if (price != null) result.price = price;
    if (currency != null) result.currency = currency;
    return result;
  }

  CoinPack._();

  factory CoinPack.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinPack()..mergeFromBuffer(data, registry);
  factory CoinPack.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinPack()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CoinPack',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CoinPack.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aI(3, _omitFieldNames ? '' : 'coins')
    ..aI(4, _omitFieldNames ? '' : 'bonusCoins')
    ..aI(5, _omitFieldNames ? '' : 'price')
    ..aOS(6, _omitFieldNames ? '' : 'currency')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinPack clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinPack copyWith(void Function(CoinPack) updates) =>
      super.copyWith((message) => updates(message as CoinPack)) as CoinPack;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CoinPack() / CoinPack.new instead')
  static CoinPack create() => CoinPack._();
  static $pb.GeneratedMessage $_createMessage() => CoinPack._();
  @$core.override
  CoinPack createEmptyInstance() => CoinPack._();
  @$core.pragma('dart2js:noInline')
  static CoinPack getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<CoinPack>(CoinPack.$_createMessage);
  static CoinPack? _defaultInstance;

  /// The pack's primary key.
  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get publicId => $_getSZ(1);
  @$pb.TagNumber(2)
  set publicId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPublicId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPublicId() => $_clearField(2);

  /// The coins a purchase of the pack grants, and the bonus coins it grants on
  /// top of them.
  @$pb.TagNumber(3)
  $core.int get coins => $_getIZ(2);
  @$pb.TagNumber(3)
  set coins($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCoins() => $_has(2);
  @$pb.TagNumber(3)
  void clearCoins() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get bonusCoins => $_getIZ(3);
  @$pb.TagNumber(4)
  set bonusCoins($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBonusCoins() => $_has(3);
  @$pb.TagNumber(4)
  void clearBonusCoins() => $_clearField(4);

  /// In the minor unit of currency.
  @$pb.TagNumber(5)
  $core.int get price => $_getIZ(4);
  @$pb.TagNumber(5)
  set price($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPrice() => $_has(4);
  @$pb.TagNumber(5)
  void clearPrice() => $_clearField(5);

  /// The ISO 4217 code, in capitals, of the tenant currency price is in.
  @$pb.TagNumber(6)
  $core.String get currency => $_getSZ(5);
  @$pb.TagNumber(6)
  set currency($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasCurrency() => $_has(5);
  @$pb.TagNumber(6)
  void clearCurrency() => $_clearField(6);
}

/// What a client needs to show the tenant's coins at all.
class CoinSettings extends $pb.GeneratedMessage {
  factory CoinSettings({
    $core.String? coinName,
    $core.int? coinUnitAmount,
    $core.String? currency,
    $core.int? expiryDays,
    $core.bool? selling,
    $core.Iterable<CoinPack>? packs,
    CoinDisclosures? disclosures,
  }) {
    final result = CoinSettings._();
    if (coinName != null) result.coinName = coinName;
    if (coinUnitAmount != null) result.coinUnitAmount = coinUnitAmount;
    if (currency != null) result.currency = currency;
    if (expiryDays != null) result.expiryDays = expiryDays;
    if (selling != null) result.selling = selling;
    if (packs != null) result.packs.addAll(packs);
    if (disclosures != null) result.disclosures = disclosures;
    return result;
  }

  CoinSettings._();

  factory CoinSettings.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinSettings()..mergeFromBuffer(data, registry);
  factory CoinSettings.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinSettings()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CoinSettings',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CoinSettings.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'coinName')
    ..aI(2, _omitFieldNames ? '' : 'coinUnitAmount')
    ..aOS(3, _omitFieldNames ? '' : 'currency')
    ..aI(4, _omitFieldNames ? '' : 'expiryDays')
    ..aOB(5, _omitFieldNames ? '' : 'selling')
    ..pPM<CoinPack>(6, _omitFieldNames ? '' : 'packs',
        subBuilder: CoinPack.$_createMessage)
    ..aOM<CoinDisclosures>(7, _omitFieldNames ? '' : 'disclosures',
        subBuilder: CoinDisclosures.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinSettings clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinSettings copyWith(void Function(CoinSettings) updates) =>
      super.copyWith((message) => updates(message as CoinSettings))
          as CoinSettings;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CoinSettings() / CoinSettings.new instead')
  static CoinSettings create() => CoinSettings._();
  static $pb.GeneratedMessage $_createMessage() => CoinSettings._();
  @$core.override
  CoinSettings createEmptyInstance() => CoinSettings._();
  @$core.pragma('dart2js:noInline')
  static CoinSettings getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CoinSettings>(
          CoinSettings.$_createMessage);
  static CoinSettings? _defaultInstance;

  /// The tenant's word for its coins in the request's locale, else in the
  /// tenant's default locale: the unit noun that follows a number, such as
  /// "Points" in "120 Points". A client shows this wherever it names the
  /// coins, and never a word of its own.
  @$pb.TagNumber(1)
  $core.String get coinName => $_getSZ(0);
  @$pb.TagNumber(1)
  set coinName($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCoinName() => $_has(0);
  @$pb.TagNumber(1)
  void clearCoinName() => $_clearField(1);

  /// What one coin is worth, in the minor unit of currency.
  @$pb.TagNumber(2)
  $core.int get coinUnitAmount => $_getIZ(1);
  @$pb.TagNumber(2)
  set coinUnitAmount($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCoinUnitAmount() => $_has(1);
  @$pb.TagNumber(2)
  void clearCoinUnitAmount() => $_clearField(2);

  /// The ISO 4217 code, in capitals, of the tenant's currency.
  @$pb.TagNumber(3)
  $core.String get currency => $_getSZ(2);
  @$pb.TagNumber(3)
  set currency($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCurrency() => $_has(2);
  @$pb.TagNumber(3)
  void clearCurrency() => $_clearField(3);

  /// How many days after purchase a coin can be spent.
  @$pb.TagNumber(4)
  $core.int get expiryDays => $_getIZ(3);
  @$pb.TagNumber(4)
  set expiryDays($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasExpiryDays() => $_has(3);
  @$pb.TagNumber(4)
  void clearExpiryDays() => $_clearField(4);

  /// Whether the tenant sells packs now. A tenant can stop selling while
  /// readers spend the coins they hold, so false still leaves a balance to
  /// spend.
  @$pb.TagNumber(5)
  $core.bool get selling => $_getBF(4);
  @$pb.TagNumber(5)
  set selling($core.bool value) => $_setBool(4, value);
  @$pb.TagNumber(5)
  $core.bool hasSelling() => $_has(4);
  @$pb.TagNumber(5)
  void clearSelling() => $_clearField(5);

  /// The packs on sale, in the order the tenant sells them. Empty while
  /// selling is false.
  @$pb.TagNumber(6)
  $pb.PbList<CoinPack> get packs => $_getList(5);

  @$pb.TagNumber(7)
  CoinDisclosures get disclosures => $_getN(6);
  @$pb.TagNumber(7)
  set disclosures(CoinDisclosures value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasDisclosures() => $_has(6);
  @$pb.TagNumber(7)
  void clearDisclosures() => $_clearField(7);
  @$pb.TagNumber(7)
  CoinDisclosures ensureDisclosures() => $_ensure(6);
}

/// Answers the tenant's coin settings. Optional authentication.
class GetCoinSettingsRequest extends $pb.GeneratedMessage {
  factory GetCoinSettingsRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = GetCoinSettingsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetCoinSettingsRequest._();

  factory GetCoinSettingsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinSettingsRequest()..mergeFromBuffer(data, registry);
  factory GetCoinSettingsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinSettingsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCoinSettingsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetCoinSettingsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinSettingsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinSettingsRequest copyWith(
          void Function(GetCoinSettingsRequest) updates) =>
      super.copyWith((message) => updates(message as GetCoinSettingsRequest))
          as GetCoinSettingsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetCoinSettingsRequest() / GetCoinSettingsRequest.new instead')
  static GetCoinSettingsRequest create() => GetCoinSettingsRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetCoinSettingsRequest._();
  @$core.override
  GetCoinSettingsRequest createEmptyInstance() => GetCoinSettingsRequest._();
  @$core.pragma('dart2js:noInline')
  static GetCoinSettingsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCoinSettingsRequest>(
          GetCoinSettingsRequest.$_createMessage);
  static GetCoinSettingsRequest? _defaultInstance;

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

  /// The reader's locale, which coin_name is given in. Empty means the
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

class GetCoinSettingsResponse extends $pb.GeneratedMessage {
  factory GetCoinSettingsResponse({
    CoinSettings? settings,
  }) {
    final result = GetCoinSettingsResponse._();
    if (settings != null) result.settings = settings;
    return result;
  }

  GetCoinSettingsResponse._();

  factory GetCoinSettingsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinSettingsResponse()..mergeFromBuffer(data, registry);
  factory GetCoinSettingsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinSettingsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCoinSettingsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetCoinSettingsResponse.$_createMessage)
    ..aOM<CoinSettings>(1, _omitFieldNames ? '' : 'settings',
        subBuilder: CoinSettings.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinSettingsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinSettingsResponse copyWith(
          void Function(GetCoinSettingsResponse) updates) =>
      super.copyWith((message) => updates(message as GetCoinSettingsResponse))
          as GetCoinSettingsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetCoinSettingsResponse() / GetCoinSettingsResponse.new instead')
  static GetCoinSettingsResponse create() => GetCoinSettingsResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetCoinSettingsResponse._();
  @$core.override
  GetCoinSettingsResponse createEmptyInstance() => GetCoinSettingsResponse._();
  @$core.pragma('dart2js:noInline')
  static GetCoinSettingsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCoinSettingsResponse>(
          GetCoinSettingsResponse.$_createMessage);
  static GetCoinSettingsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  CoinSettings get settings => $_getN(0);
  @$pb.TagNumber(1)
  set settings(CoinSettings value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasSettings() => $_has(0);
  @$pb.TagNumber(1)
  void clearSettings() => $_clearField(1);
  @$pb.TagNumber(1)
  CoinSettings ensureSettings() => $_ensure(0);
}

/// A reader's coins: how many they can spend now, and the next of them to
/// expire.
class CoinBalance extends $pb.GeneratedMessage {
  factory CoinBalance({
    $fixnum.Int64? coins,
    $core.String? coinName,
    $core.String? nearestExpiryAt,
    $fixnum.Int64? nearestExpiryCoins,
  }) {
    final result = CoinBalance._();
    if (coins != null) result.coins = coins;
    if (coinName != null) result.coinName = coinName;
    if (nearestExpiryAt != null) result.nearestExpiryAt = nearestExpiryAt;
    if (nearestExpiryCoins != null)
      result.nearestExpiryCoins = nearestExpiryCoins;
    return result;
  }

  CoinBalance._();

  factory CoinBalance.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinBalance()..mergeFromBuffer(data, registry);
  factory CoinBalance.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinBalance()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CoinBalance',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CoinBalance.$_createMessage)
    ..aInt64(1, _omitFieldNames ? '' : 'coins')
    ..aOS(2, _omitFieldNames ? '' : 'coinName')
    ..aOS(3, _omitFieldNames ? '' : 'nearestExpiryAt')
    ..aInt64(4, _omitFieldNames ? '' : 'nearestExpiryCoins')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinBalance clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinBalance copyWith(void Function(CoinBalance) updates) =>
      super.copyWith((message) => updates(message as CoinBalance))
          as CoinBalance;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CoinBalance() / CoinBalance.new instead')
  static CoinBalance create() => CoinBalance._();
  static $pb.GeneratedMessage $_createMessage() => CoinBalance._();
  @$core.override
  CoinBalance createEmptyInstance() => CoinBalance._();
  @$core.pragma('dart2js:noInline')
  static CoinBalance getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CoinBalance>(
          CoinBalance.$_createMessage);
  static CoinBalance? _defaultInstance;

  /// The coins of every grant that has not expired, less what has been spent
  /// from them.
  @$pb.TagNumber(1)
  $fixnum.Int64 get coins => $_getI64(0);
  @$pb.TagNumber(1)
  set coins($fixnum.Int64 value) => $_setInt64(0, value);
  @$pb.TagNumber(1)
  $core.bool hasCoins() => $_has(0);
  @$pb.TagNumber(1)
  void clearCoins() => $_clearField(1);

  /// The tenant's word for its coins, as CoinSettings.coin_name gives it.
  @$pb.TagNumber(2)
  $core.String get coinName => $_getSZ(1);
  @$pb.TagNumber(2)
  set coinName($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCoinName() => $_has(1);
  @$pb.TagNumber(2)
  void clearCoinName() => $_clearField(2);

  /// RFC3339: when the coins that expire first expire, and how many of the
  /// balance expire then. Empty and 0 while the balance is 0.
  @$pb.TagNumber(3)
  $core.String get nearestExpiryAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set nearestExpiryAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNearestExpiryAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearNearestExpiryAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get nearestExpiryCoins => $_getI64(3);
  @$pb.TagNumber(4)
  set nearestExpiryCoins($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasNearestExpiryCoins() => $_has(3);
  @$pb.TagNumber(4)
  void clearNearestExpiryCoins() => $_clearField(4);
}

/// Answers the signed-in reader's balance.
class GetCoinBalanceRequest extends $pb.GeneratedMessage {
  factory GetCoinBalanceRequest({
    $0.TenantContext? tenant,
    $core.String? locale,
  }) {
    final result = GetCoinBalanceRequest._();
    if (tenant != null) result.tenant = tenant;
    if (locale != null) result.locale = locale;
    return result;
  }

  GetCoinBalanceRequest._();

  factory GetCoinBalanceRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinBalanceRequest()..mergeFromBuffer(data, registry);
  factory GetCoinBalanceRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinBalanceRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCoinBalanceRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetCoinBalanceRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinBalanceRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinBalanceRequest copyWith(
          void Function(GetCoinBalanceRequest) updates) =>
      super.copyWith((message) => updates(message as GetCoinBalanceRequest))
          as GetCoinBalanceRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetCoinBalanceRequest() / GetCoinBalanceRequest.new instead')
  static GetCoinBalanceRequest create() => GetCoinBalanceRequest._();
  static $pb.GeneratedMessage $_createMessage() => GetCoinBalanceRequest._();
  @$core.override
  GetCoinBalanceRequest createEmptyInstance() => GetCoinBalanceRequest._();
  @$core.pragma('dart2js:noInline')
  static GetCoinBalanceRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCoinBalanceRequest>(
          GetCoinBalanceRequest.$_createMessage);
  static GetCoinBalanceRequest? _defaultInstance;

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

  /// The reader's locale, which coin_name is given in. Empty means the
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

class GetCoinBalanceResponse extends $pb.GeneratedMessage {
  factory GetCoinBalanceResponse({
    CoinBalance? balance,
  }) {
    final result = GetCoinBalanceResponse._();
    if (balance != null) result.balance = balance;
    return result;
  }

  GetCoinBalanceResponse._();

  factory GetCoinBalanceResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinBalanceResponse()..mergeFromBuffer(data, registry);
  factory GetCoinBalanceResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GetCoinBalanceResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GetCoinBalanceResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: GetCoinBalanceResponse.$_createMessage)
    ..aOM<CoinBalance>(1, _omitFieldNames ? '' : 'balance',
        subBuilder: CoinBalance.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinBalanceResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GetCoinBalanceResponse copyWith(
          void Function(GetCoinBalanceResponse) updates) =>
      super.copyWith((message) => updates(message as GetCoinBalanceResponse))
          as GetCoinBalanceResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use GetCoinBalanceResponse() / GetCoinBalanceResponse.new instead')
  static GetCoinBalanceResponse create() => GetCoinBalanceResponse._();
  static $pb.GeneratedMessage $_createMessage() => GetCoinBalanceResponse._();
  @$core.override
  GetCoinBalanceResponse createEmptyInstance() => GetCoinBalanceResponse._();
  @$core.pragma('dart2js:noInline')
  static GetCoinBalanceResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<GetCoinBalanceResponse>(
          GetCoinBalanceResponse.$_createMessage);
  static GetCoinBalanceResponse? _defaultInstance;

  @$pb.TagNumber(1)
  CoinBalance get balance => $_getN(0);
  @$pb.TagNumber(1)
  set balance(CoinBalance value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasBalance() => $_has(0);
  @$pb.TagNumber(1)
  void clearBalance() => $_clearField(1);
  @$pb.TagNumber(1)
  CoinBalance ensureBalance() => $_ensure(0);
}

/// One entry of a reader's coin history.
class CoinTransaction extends $pb.GeneratedMessage {
  factory CoinTransaction({
    $core.String? id,
    CoinTransactionKind? kind,
    $core.int? coins,
    $core.String? createdAt,
    $core.String? expiresAt,
    $core.String? purchaseId,
    $0.Episode? episode,
    $0.Series? series,
  }) {
    final result = CoinTransaction._();
    if (id != null) result.id = id;
    if (kind != null) result.kind = kind;
    if (coins != null) result.coins = coins;
    if (createdAt != null) result.createdAt = createdAt;
    if (expiresAt != null) result.expiresAt = expiresAt;
    if (purchaseId != null) result.purchaseId = purchaseId;
    if (episode != null) result.episode = episode;
    if (series != null) result.series = series;
    return result;
  }

  CoinTransaction._();

  factory CoinTransaction.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinTransaction()..mergeFromBuffer(data, registry);
  factory CoinTransaction.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CoinTransaction()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CoinTransaction',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: CoinTransaction.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aE<CoinTransactionKind>(2, _omitFieldNames ? '' : 'kind',
        enumValues: CoinTransactionKind.values)
    ..aI(3, _omitFieldNames ? '' : 'coins')
    ..aOS(4, _omitFieldNames ? '' : 'createdAt')
    ..aOS(5, _omitFieldNames ? '' : 'expiresAt')
    ..aOS(6, _omitFieldNames ? '' : 'purchaseId')
    ..aOM<$0.Episode>(7, _omitFieldNames ? '' : 'episode',
        subBuilder: $0.Episode.$_createMessage)
    ..aOM<$0.Series>(8, _omitFieldNames ? '' : 'series',
        subBuilder: $0.Series.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinTransaction clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CoinTransaction copyWith(void Function(CoinTransaction) updates) =>
      super.copyWith((message) => updates(message as CoinTransaction))
          as CoinTransaction;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CoinTransaction() / CoinTransaction.new instead')
  static CoinTransaction create() => CoinTransaction._();
  static $pb.GeneratedMessage $_createMessage() => CoinTransaction._();
  @$core.override
  CoinTransaction createEmptyInstance() => CoinTransaction._();
  @$core.pragma('dart2js:noInline')
  static CoinTransaction getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CoinTransaction>(
          CoinTransaction.$_createMessage);
  static CoinTransaction? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  CoinTransactionKind get kind => $_getN(1);
  @$pb.TagNumber(2)
  set kind(CoinTransactionKind value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasKind() => $_has(1);
  @$pb.TagNumber(2)
  void clearKind() => $_clearField(2);

  /// How many coins moved, always positive: kind says which way.
  @$pb.TagNumber(3)
  $core.int get coins => $_getIZ(2);
  @$pb.TagNumber(3)
  set coins($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCoins() => $_has(2);
  @$pb.TagNumber(3)
  void clearCoins() => $_clearField(3);

  /// RFC3339. An expiry is dated when its grant expired.
  @$pb.TagNumber(4)
  $core.String get createdAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set createdAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCreatedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearCreatedAt() => $_clearField(4);

  /// On a grant: when the coins it added expire.
  @$pb.TagNumber(5)
  $core.String get expiresAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set expiresAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasExpiresAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearExpiresAt() => $_clearField(5);

  /// On a spend: the purchase it paid for, and the episode and series of that
  /// purchase, titled in the request's locale. The episode carries the id, the
  /// public_id, the title, the locale, and the order_index, and the series the
  /// id, the public_id, the title, and the locale. Both are left out for an
  /// episode the calling surface may not show; the purchase is not.
  @$pb.TagNumber(6)
  $core.String get purchaseId => $_getSZ(5);
  @$pb.TagNumber(6)
  set purchaseId($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasPurchaseId() => $_has(5);
  @$pb.TagNumber(6)
  void clearPurchaseId() => $_clearField(6);

  @$pb.TagNumber(7)
  $0.Episode get episode => $_getN(6);
  @$pb.TagNumber(7)
  set episode($0.Episode value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasEpisode() => $_has(6);
  @$pb.TagNumber(7)
  void clearEpisode() => $_clearField(7);
  @$pb.TagNumber(7)
  $0.Episode ensureEpisode() => $_ensure(6);

  @$pb.TagNumber(8)
  $0.Series get series => $_getN(7);
  @$pb.TagNumber(8)
  set series($0.Series value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasSeries() => $_has(7);
  @$pb.TagNumber(8)
  void clearSeries() => $_clearField(8);
  @$pb.TagNumber(8)
  $0.Series ensureSeries() => $_ensure(7);
}

/// Cursor pagination, newest first. Field shape and token rules:
/// proto/README.md.
class ListCoinTransactionsRequest extends $pb.GeneratedMessage {
  factory ListCoinTransactionsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = ListCoinTransactionsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  ListCoinTransactionsRequest._();

  factory ListCoinTransactionsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListCoinTransactionsRequest()..mergeFromBuffer(data, registry);
  factory ListCoinTransactionsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListCoinTransactionsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListCoinTransactionsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListCoinTransactionsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(2, _omitFieldNames ? '' : 'limit')
    ..aOS(3, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListCoinTransactionsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListCoinTransactionsRequest copyWith(
          void Function(ListCoinTransactionsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListCoinTransactionsRequest))
          as ListCoinTransactionsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListCoinTransactionsRequest() / ListCoinTransactionsRequest.new instead')
  static ListCoinTransactionsRequest create() =>
      ListCoinTransactionsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListCoinTransactionsRequest._();
  @$core.override
  ListCoinTransactionsRequest createEmptyInstance() =>
      ListCoinTransactionsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListCoinTransactionsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListCoinTransactionsRequest>(
          ListCoinTransactionsRequest.$_createMessage);
  static ListCoinTransactionsRequest? _defaultInstance;

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

  /// Max items in one page. <= 0 or > 100 falls back to 20.
  @$pb.TagNumber(2)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(2)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(2)
  void clearLimit() => $_clearField(2);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(3)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(3)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearToken() => $_clearField(3);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  /// The reader's locale, which coin_name and every title are given in. Empty
  /// means the tenant's default locale.
  @$pb.TagNumber(5)
  $core.String get locale => $_getSZ(4);
  @$pb.TagNumber(5)
  set locale($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasLocale() => $_has(4);
  @$pb.TagNumber(5)
  void clearLocale() => $_clearField(5);
}

class ListCoinTransactionsResponse extends $pb.GeneratedMessage {
  factory ListCoinTransactionsResponse({
    $core.Iterable<CoinTransaction>? transactions,
    $core.String? previousToken,
    $core.String? nextToken,
    $core.String? coinName,
  }) {
    final result = ListCoinTransactionsResponse._();
    if (transactions != null) result.transactions.addAll(transactions);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    if (coinName != null) result.coinName = coinName;
    return result;
  }

  ListCoinTransactionsResponse._();

  factory ListCoinTransactionsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListCoinTransactionsResponse()..mergeFromBuffer(data, registry);
  factory ListCoinTransactionsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListCoinTransactionsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListCoinTransactionsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListCoinTransactionsResponse.$_createMessage)
    ..pPM<CoinTransaction>(1, _omitFieldNames ? '' : 'transactions',
        subBuilder: CoinTransaction.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..aOS(4, _omitFieldNames ? '' : 'coinName')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListCoinTransactionsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListCoinTransactionsResponse copyWith(
          void Function(ListCoinTransactionsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListCoinTransactionsResponse))
          as ListCoinTransactionsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListCoinTransactionsResponse() / ListCoinTransactionsResponse.new instead')
  static ListCoinTransactionsResponse create() =>
      ListCoinTransactionsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListCoinTransactionsResponse._();
  @$core.override
  ListCoinTransactionsResponse createEmptyInstance() =>
      ListCoinTransactionsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListCoinTransactionsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListCoinTransactionsResponse>(
          ListCoinTransactionsResponse.$_createMessage);
  static ListCoinTransactionsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $pb.PbList<CoinTransaction> get transactions => $_getList(0);

  /// Token for the previous page. Empty on the first page.
  @$pb.TagNumber(2)
  $core.String get previousToken => $_getSZ(1);
  @$pb.TagNumber(2)
  set previousToken($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPreviousToken() => $_has(1);
  @$pb.TagNumber(2)
  void clearPreviousToken() => $_clearField(2);

  /// Token for the next page. Empty on the last page.
  @$pb.TagNumber(3)
  $core.String get nextToken => $_getSZ(2);
  @$pb.TagNumber(3)
  set nextToken($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasNextToken() => $_has(2);
  @$pb.TagNumber(3)
  void clearNextToken() => $_clearField(3);

  /// The tenant's word for its coins, as CoinSettings.coin_name gives it, which
  /// every amount in transactions is counted in.
  @$pb.TagNumber(4)
  $core.String get coinName => $_getSZ(3);
  @$pb.TagNumber(4)
  set coinName($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCoinName() => $_has(3);
  @$pb.TagNumber(4)
  void clearCoinName() => $_clearField(4);
}

/// Opens an episode for the signed-in reader by spending the episode's coin
/// price (Episode.coin_price for the permanent copy, Episode.coin_rental_price
/// for the rental) from their balance, drawing on the coins that expire first.
/// It records a purchase as a checkout does, which opens the episode for the
/// same reading period and appears in ListMyPurchases with coins_spent.
///
/// An episode the calling surface may not show is not_found, and one it shows
/// but may not sell (Episode.purchase_availability) is failed_precondition, as
/// they are for StartEpisodeCheckout, and so are a free episode and the rental
/// of an episode that is not rented. A reader who holds an active permanent
/// copy is already_exists for either kind, and one who holds an active rental
/// for another rental. An episode that credits a creator the reader's account
/// is linked to is permission_denied with the ErrorInfo reason
/// READER_CREDITED_ON_EPISODE.
///
/// A coin price other than `coins` is failed_precondition with the ErrorInfo
/// reason COIN_PRICE_CHANGED and the price now in the metadata as
/// `coin_price`, so a reader is never charged other than what they were shown.
/// A balance short of the price is failed_precondition with the ErrorInfo
/// reason COIN_BALANCE_INSUFFICIENT and the coins missing in the metadata as
/// `shortfall`, so a client can offer the smallest pack that covers it;
/// nothing is spent.
///
/// Each call spends the reader's allowance for coin payments, and a reader past
/// it is resource_exhausted before anything is read.
class PayEpisodeWithCoinsRequest extends $pb.GeneratedMessage {
  factory PayEpisodeWithCoinsRequest({
    $0.TenantContext? tenant,
    $core.String? episodeId,
    $0.PurchaseKind? kind,
    $core.int? coins,
    $core.String? idempotencyKey,
    $0.ClientSurface? surface,
    $core.String? locale,
  }) {
    final result = PayEpisodeWithCoinsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (episodeId != null) result.episodeId = episodeId;
    if (kind != null) result.kind = kind;
    if (coins != null) result.coins = coins;
    if (idempotencyKey != null) result.idempotencyKey = idempotencyKey;
    if (surface != null) result.surface = surface;
    if (locale != null) result.locale = locale;
    return result;
  }

  PayEpisodeWithCoinsRequest._();

  factory PayEpisodeWithCoinsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PayEpisodeWithCoinsRequest()..mergeFromBuffer(data, registry);
  factory PayEpisodeWithCoinsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PayEpisodeWithCoinsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PayEpisodeWithCoinsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PayEpisodeWithCoinsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'episodeId')
    ..aE<$0.PurchaseKind>(3, _omitFieldNames ? '' : 'kind',
        enumValues: $0.PurchaseKind.values)
    ..aI(4, _omitFieldNames ? '' : 'coins')
    ..aOS(5, _omitFieldNames ? '' : 'idempotencyKey')
    ..aE<$0.ClientSurface>(6, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(7, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PayEpisodeWithCoinsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PayEpisodeWithCoinsRequest copyWith(
          void Function(PayEpisodeWithCoinsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as PayEpisodeWithCoinsRequest))
          as PayEpisodeWithCoinsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use PayEpisodeWithCoinsRequest() / PayEpisodeWithCoinsRequest.new instead')
  static PayEpisodeWithCoinsRequest create() => PayEpisodeWithCoinsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      PayEpisodeWithCoinsRequest._();
  @$core.override
  PayEpisodeWithCoinsRequest createEmptyInstance() =>
      PayEpisodeWithCoinsRequest._();
  @$core.pragma('dart2js:noInline')
  static PayEpisodeWithCoinsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PayEpisodeWithCoinsRequest>(
          PayEpisodeWithCoinsRequest.$_createMessage);
  static PayEpisodeWithCoinsRequest? _defaultInstance;

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

  @$pb.TagNumber(2)
  $core.String get episodeId => $_getSZ(1);
  @$pb.TagNumber(2)
  set episodeId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisodeId() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisodeId() => $_clearField(2);

  /// Which of the episode's sales to pay for. Unspecified is the permanent
  /// copy.
  @$pb.TagNumber(3)
  $0.PurchaseKind get kind => $_getN(2);
  @$pb.TagNumber(3)
  set kind($0.PurchaseKind value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasKind() => $_has(2);
  @$pb.TagNumber(3)
  void clearKind() => $_clearField(3);

  /// The coin price the reader was shown and agreed to. Required.
  @$pb.TagNumber(4)
  $core.int get coins => $_getIZ(3);
  @$pb.TagNumber(4)
  set coins($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasCoins() => $_has(3);
  @$pb.TagNumber(4)
  void clearCoins() => $_clearField(4);

  /// A key of the client's choosing, 1 to 200 characters, that names this one
  /// payment. A request sent again with a key that already paid answers that
  /// payment and spends nothing, so a double tap or a retried request spends
  /// once; the same key sent for another episode or kind is invalid_argument.
  /// Required.
  @$pb.TagNumber(5)
  $core.String get idempotencyKey => $_getSZ(4);
  @$pb.TagNumber(5)
  set idempotencyKey($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasIdempotencyKey() => $_has(4);
  @$pb.TagNumber(5)
  void clearIdempotencyKey() => $_clearField(5);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(6)
  $0.ClientSurface get surface => $_getN(5);
  @$pb.TagNumber(6)
  set surface($0.ClientSurface value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasSurface() => $_has(5);
  @$pb.TagNumber(6)
  void clearSurface() => $_clearField(6);

  /// The reader's locale, which every title and coin_name in the answer is
  /// given in. Empty means the tenant's default locale.
  @$pb.TagNumber(7)
  $core.String get locale => $_getSZ(6);
  @$pb.TagNumber(7)
  set locale($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasLocale() => $_has(6);
  @$pb.TagNumber(7)
  void clearLocale() => $_clearField(7);
}

class PayEpisodeWithCoinsResponse extends $pb.GeneratedMessage {
  factory PayEpisodeWithCoinsResponse({
    $1.MyPurchase? purchase,
    CoinBalance? balance,
  }) {
    final result = PayEpisodeWithCoinsResponse._();
    if (purchase != null) result.purchase = purchase;
    if (balance != null) result.balance = balance;
    return result;
  }

  PayEpisodeWithCoinsResponse._();

  factory PayEpisodeWithCoinsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PayEpisodeWithCoinsResponse()..mergeFromBuffer(data, registry);
  factory PayEpisodeWithCoinsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PayEpisodeWithCoinsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PayEpisodeWithCoinsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PayEpisodeWithCoinsResponse.$_createMessage)
    ..aOM<$1.MyPurchase>(1, _omitFieldNames ? '' : 'purchase',
        subBuilder: $1.MyPurchase.$_createMessage)
    ..aOM<CoinBalance>(2, _omitFieldNames ? '' : 'balance',
        subBuilder: CoinBalance.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PayEpisodeWithCoinsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PayEpisodeWithCoinsResponse copyWith(
          void Function(PayEpisodeWithCoinsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as PayEpisodeWithCoinsResponse))
          as PayEpisodeWithCoinsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use PayEpisodeWithCoinsResponse() / PayEpisodeWithCoinsResponse.new instead')
  static PayEpisodeWithCoinsResponse create() =>
      PayEpisodeWithCoinsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      PayEpisodeWithCoinsResponse._();
  @$core.override
  PayEpisodeWithCoinsResponse createEmptyInstance() =>
      PayEpisodeWithCoinsResponse._();
  @$core.pragma('dart2js:noInline')
  static PayEpisodeWithCoinsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PayEpisodeWithCoinsResponse>(
          PayEpisodeWithCoinsResponse.$_createMessage);
  static PayEpisodeWithCoinsResponse? _defaultInstance;

  @$pb.TagNumber(1)
  $1.MyPurchase get purchase => $_getN(0);
  @$pb.TagNumber(1)
  set purchase($1.MyPurchase value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasPurchase() => $_has(0);
  @$pb.TagNumber(1)
  void clearPurchase() => $_clearField(1);
  @$pb.TagNumber(1)
  $1.MyPurchase ensurePurchase() => $_ensure(0);

  /// The balance once the payment is made.
  @$pb.TagNumber(2)
  CoinBalance get balance => $_getN(1);
  @$pb.TagNumber(2)
  set balance(CoinBalance value) => $_setField(2, value);
  @$pb.TagNumber(2)
  $core.bool hasBalance() => $_has(1);
  @$pb.TagNumber(2)
  void clearBalance() => $_clearField(2);
  @$pb.TagNumber(2)
  CoinBalance ensureBalance() => $_ensure(1);
}

/// A tenant's coins: what they are, how many a reader holds, and spending them
/// on an episode. Every RPC here is failed_precondition with the ErrorInfo
/// reason COINS_UNAVAILABLE while the platform does not allow tenant coins or
/// the tenant has not turned its coins on, and a client answered that shows
/// nothing about coins. GetCoinSettings takes optional authentication; the
/// others answer the signed-in reader alone.
class CoinServiceApi {
  final $pb.RpcClient _client;

  CoinServiceApi(this._client);

  $async.Future<GetCoinSettingsResponse> getCoinSettings(
          $pb.ClientContext? ctx, GetCoinSettingsRequest request) =>
      _client.invoke<GetCoinSettingsResponse>(ctx, 'CoinService',
          'GetCoinSettings', request, GetCoinSettingsResponse());
  $async.Future<GetCoinBalanceResponse> getCoinBalance(
          $pb.ClientContext? ctx, GetCoinBalanceRequest request) =>
      _client.invoke<GetCoinBalanceResponse>(ctx, 'CoinService',
          'GetCoinBalance', request, GetCoinBalanceResponse());
  $async.Future<ListCoinTransactionsResponse> listCoinTransactions(
          $pb.ClientContext? ctx, ListCoinTransactionsRequest request) =>
      _client.invoke<ListCoinTransactionsResponse>(ctx, 'CoinService',
          'ListCoinTransactions', request, ListCoinTransactionsResponse());
  $async.Future<PayEpisodeWithCoinsResponse> payEpisodeWithCoins(
          $pb.ClientContext? ctx, PayEpisodeWithCoinsRequest request) =>
      _client.invoke<PayEpisodeWithCoinsResponse>(ctx, 'CoinService',
          'PayEpisodeWithCoins', request, PayEpisodeWithCoinsResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
