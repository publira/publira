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

/// What becomes of a reader's request for their archive.
class DataExportState extends $pb.ProtobufEnum {
  static const DataExportState DATA_EXPORT_STATE_UNSPECIFIED =
      DataExportState._(
          0, _omitEnumNames ? '' : 'DATA_EXPORT_STATE_UNSPECIFIED');

  /// Asked for, and not built yet.
  static const DataExportState DATA_EXPORT_STATE_PENDING =
      DataExportState._(1, _omitEnumNames ? '' : 'DATA_EXPORT_STATE_PENDING');

  /// Built, and DownloadMyDataExport streams it until expires_at.
  static const DataExportState DATA_EXPORT_STATE_READY =
      DataExportState._(2, _omitEnumNames ? '' : 'DATA_EXPORT_STATE_READY');

  /// Given up on, because the install had no object store to keep it in. The
  /// reader may ask again.
  static const DataExportState DATA_EXPORT_STATE_FAILED =
      DataExportState._(3, _omitEnumNames ? '' : 'DATA_EXPORT_STATE_FAILED');

  static const $core.List<DataExportState> values = <DataExportState>[
    DATA_EXPORT_STATE_UNSPECIFIED,
    DATA_EXPORT_STATE_PENDING,
    DATA_EXPORT_STATE_READY,
    DATA_EXPORT_STATE_FAILED,
  ];

  static final $core.List<DataExportState?> _byValue =
      $pb.ProtobufEnum.$_initByValueList(values, 3);
  static DataExportState? valueOf($core.int value) =>
      value < 0 || value >= _byValue.length ? null : _byValue[value];

  const DataExportState._(super.value, super.name);
}

const $core.bool _omitEnumNames =
    $core.bool.fromEnvironment('protobuf.omit_enum_names');
