// This is a generated file - do not edit.
//
// Generated from publira/v1/comment.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// Why a reader says a comment breaks the rules.
///
/// The list is short on purpose: a reporter picks from it in one glance, and
/// staff working the queue can sort by it. Anything the four do not cover is
/// OTHER plus the reporter's own sentence.
class CommentReportReason extends $pb.ProtobufEnum {
  static const CommentReportReason COMMENT_REPORT_REASON_UNSPECIFIED =
      CommentReportReason._(
          0, _omitEnumNames ? '' : 'COMMENT_REPORT_REASON_UNSPECIFIED');
  static const CommentReportReason COMMENT_REPORT_REASON_SPAM =
      CommentReportReason._(
          1, _omitEnumNames ? '' : 'COMMENT_REPORT_REASON_SPAM');
  static const CommentReportReason COMMENT_REPORT_REASON_ABUSE =
      CommentReportReason._(
          2, _omitEnumNames ? '' : 'COMMENT_REPORT_REASON_ABUSE');
  static const CommentReportReason COMMENT_REPORT_REASON_SPOILER =
      CommentReportReason._(
          3, _omitEnumNames ? '' : 'COMMENT_REPORT_REASON_SPOILER');
  static const CommentReportReason COMMENT_REPORT_REASON_OTHER =
      CommentReportReason._(
          4, _omitEnumNames ? '' : 'COMMENT_REPORT_REASON_OTHER');

  static const $core.List<CommentReportReason> values = <CommentReportReason>[
    COMMENT_REPORT_REASON_UNSPECIFIED,
    COMMENT_REPORT_REASON_SPAM,
    COMMENT_REPORT_REASON_ABUSE,
    COMMENT_REPORT_REASON_SPOILER,
    COMMENT_REPORT_REASON_OTHER,
  ];

  static final $core.List<CommentReportReason?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 4);
  static CommentReportReason? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const CommentReportReason._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
