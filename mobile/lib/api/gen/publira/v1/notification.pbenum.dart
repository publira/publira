// This is a generated file - do not edit.
//
// Generated from publira/v1/notification.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// Which store issued the registration token, so a message can carry the
/// platform-specific block its delivery needs.
class PushPlatform extends $pb.ProtobufEnum {
  static const PushPlatform PUSH_PLATFORM_UNSPECIFIED =
      PushPlatform._(0, _omitEnumNames ? '' : 'PUSH_PLATFORM_UNSPECIFIED');
  static const PushPlatform PUSH_PLATFORM_ANDROID =
      PushPlatform._(1, _omitEnumNames ? '' : 'PUSH_PLATFORM_ANDROID');
  static const PushPlatform PUSH_PLATFORM_IOS =
      PushPlatform._(2, _omitEnumNames ? '' : 'PUSH_PLATFORM_IOS');
  static const PushPlatform PUSH_PLATFORM_WEB =
      PushPlatform._(3, _omitEnumNames ? '' : 'PUSH_PLATFORM_WEB');

  static const $core.List<PushPlatform> values = <PushPlatform>[
    PUSH_PLATFORM_UNSPECIFIED,
    PUSH_PLATFORM_ANDROID,
    PUSH_PLATFORM_IOS,
    PUSH_PLATFORM_WEB,
  ];

  static final $core.List<PushPlatform?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static PushPlatform? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const PushPlatform._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
