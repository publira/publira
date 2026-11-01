// This is a generated file - do not edit.
//
// Generated from publira/v1/creator.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// What one line of a creator's statement credits.
class CreatorStatementLineSource extends $pb.ProtobufEnum {
  static const CreatorStatementLineSource
      CREATOR_STATEMENT_LINE_SOURCE_UNSPECIFIED = CreatorStatementLineSource._(
          0, _omitEnumNames ? '' : 'CREATOR_STATEMENT_LINE_SOURCE_UNSPECIFIED');

  /// The episode's sales.
  static const CreatorStatementLineSource CREATOR_STATEMENT_LINE_SOURCE_SALE =
      CreatorStatementLineSource._(
          1, _omitEnumNames ? '' : 'CREATOR_STATEMENT_LINE_SOURCE_SALE');

  /// The parts of the month's subscription payments shared to the episode.
  static const CreatorStatementLineSource
      CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION = CreatorStatementLineSource._(
          2,
          _omitEnumNames ? '' : 'CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION');

  static const $core.List<CreatorStatementLineSource> values =
      <CreatorStatementLineSource>[
    CREATOR_STATEMENT_LINE_SOURCE_UNSPECIFIED,
    CREATOR_STATEMENT_LINE_SOURCE_SALE,
    CREATOR_STATEMENT_LINE_SOURCE_SUBSCRIPTION,
  ];

  static final $core.List<CreatorStatementLineSource?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static CreatorStatementLineSource? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CreatorStatementLineSource._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
