// This is a generated file - do not edit.
//
// Generated from publira/v1/auth.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:protobuf/protobuf.dart' as $pb;

/// A provider a reader signs in with instead of a password.
class IdentityProvider extends $pb.ProtobufEnum {
  static const IdentityProvider IDENTITY_PROVIDER_UNSPECIFIED =
      IdentityProvider._(
          0, _omitEnumNames ? '' : 'IDENTITY_PROVIDER_UNSPECIFIED');
  static const IdentityProvider IDENTITY_PROVIDER_APPLE =
      IdentityProvider._(1, _omitEnumNames ? '' : 'IDENTITY_PROVIDER_APPLE');
  static const IdentityProvider IDENTITY_PROVIDER_GOOGLE =
      IdentityProvider._(2, _omitEnumNames ? '' : 'IDENTITY_PROVIDER_GOOGLE');

  static const $core.List<IdentityProvider> values = <IdentityProvider>[
    IDENTITY_PROVIDER_UNSPECIFIED,
    IDENTITY_PROVIDER_APPLE,
    IDENTITY_PROVIDER_GOOGLE,
  ];

  static final $core.List<IdentityProvider?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 2);
  static IdentityProvider? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const IdentityProvider._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
