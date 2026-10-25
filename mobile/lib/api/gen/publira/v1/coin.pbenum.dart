// This is a generated file - do not edit.
//
// Generated from publira/v1/coin.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

class CoinTransactionKind extends $pb.ProtobufEnum {
  static const CoinTransactionKind COIN_TRANSACTION_KIND_UNSPECIFIED =
      CoinTransactionKind._(
          0, _omitEnumNames ? '' : 'COIN_TRANSACTION_KIND_UNSPECIFIED');

  /// Coins added to the balance.
  static const CoinTransactionKind COIN_TRANSACTION_KIND_GRANT =
      CoinTransactionKind._(
          1, _omitEnumNames ? '' : 'COIN_TRANSACTION_KIND_GRANT');

  /// Coins spent on an episode.
  static const CoinTransactionKind COIN_TRANSACTION_KIND_SPEND =
      CoinTransactionKind._(
          2, _omitEnumNames ? '' : 'COIN_TRANSACTION_KIND_SPEND');

  /// Coins taken back, because the pack that granted them was refunded or
  /// disputed.
  static const CoinTransactionKind COIN_TRANSACTION_KIND_REVOCATION =
      CoinTransactionKind._(
          3, _omitEnumNames ? '' : 'COIN_TRANSACTION_KIND_REVOCATION');

  /// Coins that lapsed unspent once their grant expired. They are never
  /// restored.
  static const CoinTransactionKind COIN_TRANSACTION_KIND_EXPIRY =
      CoinTransactionKind._(
          4, _omitEnumNames ? '' : 'COIN_TRANSACTION_KIND_EXPIRY');

  static const $core.List<CoinTransactionKind> values = <CoinTransactionKind>[
    COIN_TRANSACTION_KIND_UNSPECIFIED,
    COIN_TRANSACTION_KIND_GRANT,
    COIN_TRANSACTION_KIND_SPEND,
    COIN_TRANSACTION_KIND_REVOCATION,
    COIN_TRANSACTION_KIND_EXPIRY,
  ];

  static final $core.List<CoinTransactionKind?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static CoinTransactionKind? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CoinTransactionKind._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
