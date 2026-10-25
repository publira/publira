// This is a generated file - do not edit.
//
// Generated from publira/types/v1/types.proto.

// @dart = 3.3

// ignore_for_file: annotate_overrides, camel_case_types, comment_references
// ignore_for_file: constant_identifier_names
// ignore_for_file: curly_braces_in_flow_control_structures
// ignore_for_file: deprecated_member_use_from_same_package, library_prefixes
// ignore_for_file: non_constant_identifier_names, prefer_relative_imports

import 'dart:core' as $core;

import 'package:fixnum/fixnum.dart' as $fixnum;
import 'package:protobuf/protobuf.dart' as $pb;

import 'types.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'types.pbenum.dart';

/// TenantContext identifies a tenant for internal RPC wiring.
/// tenant_id is the primary key (UUID), not the public-facing short code.
///
/// Every publira.v1 and publira.admin.v1 RPC that names a tenant this way
/// refuses a suspended one before it does anything else, with
/// failed_precondition and the ErrorInfo reason TENANT_SUSPENDED. That covers
/// signing in and every request made with a session: a session is not ended by
/// suspension, and is honoured again once the tenant is resumed.
class TenantContext extends $pb.GeneratedMessage {
  factory TenantContext({
    $core.String? tenantId,
  }) {
    final result = TenantContext._();
    if (tenantId != null) result.tenantId = tenantId;
    return result;
  }

  TenantContext._();

  factory TenantContext.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantContext()..mergeFromBuffer(data, registry);
  factory TenantContext.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantContext()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantContext',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: TenantContext.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'tenantId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantContext clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantContext copyWith(void Function(TenantContext) updates) =>
      super.copyWith((message) => updates(message as TenantContext))
          as TenantContext;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantContext() / TenantContext.new instead')
  static TenantContext create() => TenantContext._();
  static $pb.GeneratedMessage $_createMessage() => TenantContext._();
  @$core.override
  TenantContext createEmptyInstance() => TenantContext._();
  @$core.pragma('dart2js:noInline')
  static TenantContext getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TenantContext>(
          TenantContext.$_createMessage);
  static TenantContext? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get tenantId => $_getSZ(0);
  @$pb.TagNumber(1)
  set tenantId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasTenantId() => $_has(0);
  @$pb.TagNumber(1)
  void clearTenantId() => $_clearField(1);
}

class User extends $pb.GeneratedMessage {
  factory User({
    $core.String? publicId,
    $core.String? name,
    $core.String? role,
    $core.String? birthDate,
    $core.String? email,
    $core.String? iconImageUpdatedAt,
    $core.Iterable<UserIconVariant>? iconImageVariants,
    $core.String? iconPresetId,
  }) {
    final result = User._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (role != null) result.role = role;
    if (birthDate != null) result.birthDate = birthDate;
    if (email != null) result.email = email;
    if (iconImageUpdatedAt != null)
      result.iconImageUpdatedAt = iconImageUpdatedAt;
    if (iconImageVariants != null)
      result.iconImageVariants.addAll(iconImageVariants);
    if (iconPresetId != null) result.iconPresetId = iconPresetId;
    return result;
  }

  User._();

  factory User.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      User()..mergeFromBuffer(data, registry);
  factory User.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      User()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'User',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: User.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'role')
    ..aOS(4, _omitFieldNames ? '' : 'birthDate')
    ..aOS(5, _omitFieldNames ? '' : 'email')
    ..aOS(6, _omitFieldNames ? '' : 'iconImageUpdatedAt')
    ..pPM<UserIconVariant>(7, _omitFieldNames ? '' : 'iconImageVariants',
        subBuilder: UserIconVariant.$_createMessage)
    ..aOS(8, _omitFieldNames ? '' : 'iconPresetId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  User clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  User copyWith(void Function(User) updates) =>
      super.copyWith((message) => updates(message as User)) as User;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use User() / User.new instead')
  static User create() => User._();
  static $pb.GeneratedMessage $_createMessage() => User._();
  @$core.override
  User createEmptyInstance() => User._();
  @$core.pragma('dart2js:noInline')
  static User getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<User>(User.$_createMessage);
  static User? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get role => $_getSZ(2);
  @$pb.TagNumber(3)
  set role($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasRole() => $_has(2);
  @$pb.TagNumber(3)
  void clearRole() => $_clearField(3);

  /// The reader's own birth date as YYYY-MM-DD, empty when they have given
  /// none. Set where a User stands for the account the request authenticated
  /// or signed in as, which is GetMe, UpdateMe, Login, LoginWithIdToken and
  /// FinishPasskeyLogin; empty everywhere a User names someone the caller is merely looking at, so
  /// a console listing accounts never carries it.
  @$pb.TagNumber(4)
  $core.String get birthDate => $_getSZ(3);
  @$pb.TagNumber(4)
  set birthDate($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasBirthDate() => $_has(3);
  @$pb.TagNumber(4)
  void clearBirthDate() => $_clearField(4);

  /// The account's email address, under the same rule as birth_date: set by the
  /// public API's GetMe, UpdateMe, Login, LoginWithIdToken and
  /// FinishPasskeyLogin, so a form can offer the reader their own address, and
  /// empty wherever a User names someone else.
  @$pb.TagNumber(5)
  $core.String get email => $_getSZ(4);
  @$pb.TagNumber(5)
  set email($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasEmail() => $_has(4);
  @$pb.TagNumber(5)
  void clearEmail() => $_clearField(5);

  /// The account's icon. Set where the public API answers with the caller's
  /// own account as GetMe reads it — GetMe, UpdateMe, UploadMyIcon,
  /// SelectMyIcon, DeleteMyIcon, Login, LoginWithIdToken and
  /// FinishPasskeyLogin — and empty wherever a User names someone else. The
  /// variant list is empty, and icon_image_updated_at with it, for an account
  /// that shows no icon.
  ///
  /// The icon is either one the reader uploaded or one of the tenant's presets
  /// (ReaderIconPreset), and the variants carry whichever it is, so a client
  /// renders both alike.
  @$pb.TagNumber(6)
  $core.String get iconImageUpdatedAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set iconImageUpdatedAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasIconImageUpdatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearIconImageUpdatedAt() => $_clearField(6);

  @$pb.TagNumber(7)
  $pb.PbList<UserIconVariant> get iconImageVariants => $_getList(6);

  /// The ReaderIconPreset.id of the preset the account shows, under the same
  /// rule as icon_image_variants, so a preset picker can mark the one in use.
  /// Empty for an account that shows an upload or no icon.
  @$pb.TagNumber(8)
  $core.String get iconPresetId => $_getSZ(7);
  @$pb.TagNumber(8)
  set iconPresetId($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasIconPresetId() => $_has(7);
  @$pb.TagNumber(8)
  void clearIconPresetId() => $_clearField(8);
}

/// One stored rendition of a reader's icon, in the shape the tenant's branding
/// images use. A replaced icon is stored under a new URL rather than over the
/// old one, and the old URL stops answering once it is replaced or removed, so
/// a page holding one has to read the account again rather than keep it.
class UserIconVariant extends $pb.GeneratedMessage {
  factory UserIconVariant({
    $core.String? label,
    $core.String? url,
    $core.String? contentType,
    $core.int? width,
    $core.int? height,
    $fixnum.Int64? fileSizeBytes,
  }) {
    final result = UserIconVariant._();
    if (label != null) result.label = label;
    if (url != null) result.url = url;
    if (contentType != null) result.contentType = contentType;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (fileSizeBytes != null) result.fileSizeBytes = fileSizeBytes;
    return result;
  }

  UserIconVariant._();

  factory UserIconVariant.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UserIconVariant()..mergeFromBuffer(data, registry);
  factory UserIconVariant.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      UserIconVariant()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'UserIconVariant',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: UserIconVariant.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'label')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'contentType')
    ..aI(4, _omitFieldNames ? '' : 'width')
    ..aI(5, _omitFieldNames ? '' : 'height')
    ..aInt64(6, _omitFieldNames ? '' : 'fileSizeBytes')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserIconVariant clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  UserIconVariant copyWith(void Function(UserIconVariant) updates) =>
      super.copyWith((message) => updates(message as UserIconVariant))
          as UserIconVariant;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use UserIconVariant() / UserIconVariant.new instead')
  static UserIconVariant create() => UserIconVariant._();
  static $pb.GeneratedMessage $_createMessage() => UserIconVariant._();
  @$core.override
  UserIconVariant createEmptyInstance() => UserIconVariant._();
  @$core.pragma('dart2js:noInline')
  static UserIconVariant getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<UserIconVariant>(
          UserIconVariant.$_createMessage);
  static UserIconVariant? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get label => $_getSZ(0);
  @$pb.TagNumber(1)
  set label($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLabel() => $_has(0);
  @$pb.TagNumber(1)
  void clearLabel() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get contentType => $_getSZ(2);
  @$pb.TagNumber(3)
  set contentType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContentType() => $_has(2);
  @$pb.TagNumber(3)
  void clearContentType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get width => $_getIZ(3);
  @$pb.TagNumber(4)
  set width($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasWidth() => $_has(3);
  @$pb.TagNumber(4)
  void clearWidth() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get height => $_getIZ(4);
  @$pb.TagNumber(5)
  set height($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasHeight() => $_has(4);
  @$pb.TagNumber(5)
  void clearHeight() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get fileSizeBytes => $_getI64(5);
  @$pb.TagNumber(6)
  set fileSizeBytes($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasFileSizeBytes() => $_has(5);
  @$pb.TagNumber(6)
  void clearFileSizeBytes() => $_clearField(6);
}

/// AccessToken is a JWT issued by Login. Clients send it as Authorization: Bearer.
class AccessToken extends $pb.GeneratedMessage {
  factory AccessToken({
    $core.String? token,
    $core.String? expiresAt,
  }) {
    final result = AccessToken._();
    if (token != null) result.token = token;
    if (expiresAt != null) result.expiresAt = expiresAt;
    return result;
  }

  AccessToken._();

  factory AccessToken.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AccessToken()..mergeFromBuffer(data, registry);
  factory AccessToken.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      AccessToken()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'AccessToken',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: AccessToken.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'token')
    ..aOS(2, _omitFieldNames ? '' : 'expiresAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AccessToken clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  AccessToken copyWith(void Function(AccessToken) updates) =>
      super.copyWith((message) => updates(message as AccessToken))
          as AccessToken;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use AccessToken() / AccessToken.new instead')
  static AccessToken create() => AccessToken._();
  static $pb.GeneratedMessage $_createMessage() => AccessToken._();
  @$core.override
  AccessToken createEmptyInstance() => AccessToken._();
  @$core.pragma('dart2js:noInline')
  static AccessToken getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<AccessToken>(
          AccessToken.$_createMessage);
  static AccessToken? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get token => $_getSZ(0);
  @$pb.TagNumber(1)
  set token($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasToken() => $_has(0);
  @$pb.TagNumber(1)
  void clearToken() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get expiresAt => $_getSZ(1);
  @$pb.TagNumber(2)
  set expiresAt($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasExpiresAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearExpiresAt() => $_clearField(2);
}

/// One entry of the creator-role vocabulary a tenant curates: original author,
/// artist, writer, supervisor, and whatever else its catalogue needs. It orders
/// the credits everywhere they are shown, so the leading role leads without
/// anyone ordering each series by hand.
class CreatorRole extends $pb.GeneratedMessage {
  factory CreatorRole({
    $core.String? publicId,
    $core.String? name,
    $core.String? id,
  }) {
    final result = CreatorRole._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (id != null) result.id = id;
    return result;
  }

  CreatorRole._();

  factory CreatorRole.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreatorRole()..mergeFromBuffer(data, registry);
  factory CreatorRole.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      CreatorRole()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'CreatorRole',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: CreatorRole.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatorRole clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  CreatorRole copyWith(void Function(CreatorRole) updates) =>
      super.copyWith((message) => updates(message as CreatorRole))
          as CreatorRole;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use CreatorRole() / CreatorRole.new instead')
  static CreatorRole create() => CreatorRole._();
  static $pb.GeneratedMessage $_createMessage() => CreatorRole._();
  @$core.override
  CreatorRole createEmptyInstance() => CreatorRole._();
  @$core.pragma('dart2js:noInline')
  static CreatorRole getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<CreatorRole>(
          CreatorRole.$_createMessage);
  static CreatorRole? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// The role's primary key, which the admin API addresses it by.
  @$pb.TagNumber(3)
  $core.String get id => $_getSZ(2);
  @$pb.TagNumber(3)
  set id($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasId() => $_has(2);
  @$pb.TagNumber(3)
  void clearId() => $_clearField(3);
}

class Creator extends $pb.GeneratedMessage {
  factory Creator({
    $core.String? publicId,
    $core.String? name,
    $core.String? profileText,
    $core.String? iconImageUrl,
    $fixnum.Int64? iconImageFileSizeBytes,
    $core.String? iconImageUpdatedAt,
    CreatorRole? role,
    CreatorCreditSource? source,
    $core.String? id,
  }) {
    final result = Creator._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (profileText != null) result.profileText = profileText;
    if (iconImageUrl != null) result.iconImageUrl = iconImageUrl;
    if (iconImageFileSizeBytes != null)
      result.iconImageFileSizeBytes = iconImageFileSizeBytes;
    if (iconImageUpdatedAt != null)
      result.iconImageUpdatedAt = iconImageUpdatedAt;
    if (role != null) result.role = role;
    if (source != null) result.source = source;
    if (id != null) result.id = id;
    return result;
  }

  Creator._();

  factory Creator.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Creator()..mergeFromBuffer(data, registry);
  factory Creator.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Creator()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Creator',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Creator.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(4, _omitFieldNames ? '' : 'profileText')
    ..aOS(5, _omitFieldNames ? '' : 'iconImageUrl')
    ..aInt64(6, _omitFieldNames ? '' : 'iconImageFileSizeBytes')
    ..aOS(7, _omitFieldNames ? '' : 'iconImageUpdatedAt')
    ..aOM<CreatorRole>(8, _omitFieldNames ? '' : 'role',
        subBuilder: CreatorRole.$_createMessage)
    ..aE<CreatorCreditSource>(9, _omitFieldNames ? '' : 'source',
        enumValues: CreatorCreditSource.values)
    ..aOS(10, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Creator clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Creator copyWith(void Function(Creator) updates) =>
      super.copyWith((message) => updates(message as Creator)) as Creator;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Creator() / Creator.new instead')
  static Creator create() => Creator._();
  static $pb.GeneratedMessage $_createMessage() => Creator._();
  @$core.override
  Creator createEmptyInstance() => Creator._();
  @$core.pragma('dart2js:noInline')
  static Creator getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Creator>(Creator.$_createMessage);
  static Creator? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(4)
  $core.String get profileText => $_getSZ(2);
  @$pb.TagNumber(4)
  set profileText($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasProfileText() => $_has(2);
  @$pb.TagNumber(4)
  void clearProfileText() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get iconImageUrl => $_getSZ(3);
  @$pb.TagNumber(5)
  set iconImageUrl($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasIconImageUrl() => $_has(3);
  @$pb.TagNumber(5)
  void clearIconImageUrl() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get iconImageFileSizeBytes => $_getI64(4);
  @$pb.TagNumber(6)
  set iconImageFileSizeBytes($fixnum.Int64 value) => $_setInt64(4, value);
  @$pb.TagNumber(6)
  $core.bool hasIconImageFileSizeBytes() => $_has(4);
  @$pb.TagNumber(6)
  void clearIconImageFileSizeBytes() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get iconImageUpdatedAt => $_getSZ(5);
  @$pb.TagNumber(7)
  set iconImageUpdatedAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(7)
  $core.bool hasIconImageUpdatedAt() => $_has(5);
  @$pb.TagNumber(7)
  void clearIconImageUpdatedAt() => $_clearField(7);

  /// The role this credit is held in. Set where a Creator stands for a credit
  /// on a series; empty where it stands for the person alone, as the creator
  /// console reads them.
  @$pb.TagNumber(8)
  CreatorRole get role => $_getN(6);
  @$pb.TagNumber(8)
  set role(CreatorRole value) => $_setField(8, value);
  @$pb.TagNumber(8)
  $core.bool hasRole() => $_has(6);
  @$pb.TagNumber(8)
  void clearRole() => $_clearField(8);
  @$pb.TagNumber(8)
  CreatorRole ensureRole() => $_ensure(6);

  /// Set when this creator stands for an episode credit. It lets an editor see
  /// which rows are local additions that a later range edit must leave alone.
  @$pb.TagNumber(9)
  CreatorCreditSource get source => $_getN(7);
  @$pb.TagNumber(9)
  set source(CreatorCreditSource value) => $_setField(9, value);
  @$pb.TagNumber(9)
  $core.bool hasSource() => $_has(7);
  @$pb.TagNumber(9)
  void clearSource() => $_clearField(9);

  /// The creator's primary key. The admin API addresses a creator by it, and
  /// the reader API sets it on a series' credits so a reader can follow them.
  @$pb.TagNumber(10)
  $core.String get id => $_getSZ(8);
  @$pb.TagNumber(10)
  set id($core.String value) => $_setString(8, value);
  @$pb.TagNumber(10)
  $core.bool hasId() => $_has(8);
  @$pb.TagNumber(10)
  void clearId() => $_clearField(10);
}

class Label extends $pb.GeneratedMessage {
  factory Label({
    $core.String? publicId,
    $core.String? name,
    $core.String? eyeCatchImageUpdatedAt,
    $core.Iterable<SeriesEyeCatchVariant>? eyeCatchImageVariants,
    $core.String? id,
  }) {
    final result = Label._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (eyeCatchImageUpdatedAt != null)
      result.eyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    if (id != null) result.id = id;
    return result;
  }

  Label._();

  factory Label.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Label()..mergeFromBuffer(data, registry);
  factory Label.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Label()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Label',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Label.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'eyeCatchImageUpdatedAt')
    ..pPM<SeriesEyeCatchVariant>(
        4, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: SeriesEyeCatchVariant.$_createMessage)
    ..aOS(5, _omitFieldNames ? '' : 'id')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Label clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Label copyWith(void Function(Label) updates) =>
      super.copyWith((message) => updates(message as Label)) as Label;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Label() / Label.new instead')
  static Label create() => Label._();
  static $pb.GeneratedMessage $_createMessage() => Label._();
  @$core.override
  Label createEmptyInstance() => Label._();
  @$core.pragma('dart2js:noInline')
  static Label getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Label>(Label.$_createMessage);
  static Label? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get eyeCatchImageUpdatedAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set eyeCatchImageUpdatedAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasEyeCatchImageUpdatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearEyeCatchImageUpdatedAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $pb.PbList<SeriesEyeCatchVariant> get eyeCatchImageVariants => $_getList(3);

  /// The label's primary key, which the admin API addresses it by.
  @$pb.TagNumber(5)
  $core.String get id => $_getSZ(4);
  @$pb.TagNumber(5)
  set id($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasId() => $_has(4);
  @$pb.TagNumber(5)
  void clearId() => $_clearField(5);
}

class SeriesEyeCatchVariant extends $pb.GeneratedMessage {
  factory SeriesEyeCatchVariant({
    $core.String? label,
    $core.String? url,
    $core.String? contentType,
    $core.int? width,
    $core.int? height,
    $fixnum.Int64? fileSizeBytes,
    $core.String? variantType,
  }) {
    final result = SeriesEyeCatchVariant._();
    if (label != null) result.label = label;
    if (url != null) result.url = url;
    if (contentType != null) result.contentType = contentType;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (fileSizeBytes != null) result.fileSizeBytes = fileSizeBytes;
    if (variantType != null) result.variantType = variantType;
    return result;
  }

  SeriesEyeCatchVariant._();

  factory SeriesEyeCatchVariant.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesEyeCatchVariant()..mergeFromBuffer(data, registry);
  factory SeriesEyeCatchVariant.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesEyeCatchVariant()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SeriesEyeCatchVariant',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: SeriesEyeCatchVariant.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'label')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'contentType')
    ..aI(4, _omitFieldNames ? '' : 'width')
    ..aI(5, _omitFieldNames ? '' : 'height')
    ..aInt64(6, _omitFieldNames ? '' : 'fileSizeBytes')
    ..aOS(7, _omitFieldNames ? '' : 'variantType')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesEyeCatchVariant clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesEyeCatchVariant copyWith(
          void Function(SeriesEyeCatchVariant) updates) =>
      super.copyWith((message) => updates(message as SeriesEyeCatchVariant))
          as SeriesEyeCatchVariant;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use SeriesEyeCatchVariant() / SeriesEyeCatchVariant.new instead')
  static SeriesEyeCatchVariant create() => SeriesEyeCatchVariant._();
  static $pb.GeneratedMessage $_createMessage() => SeriesEyeCatchVariant._();
  @$core.override
  SeriesEyeCatchVariant createEmptyInstance() => SeriesEyeCatchVariant._();
  @$core.pragma('dart2js:noInline')
  static SeriesEyeCatchVariant getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<SeriesEyeCatchVariant>(
          SeriesEyeCatchVariant.$_createMessage);
  static SeriesEyeCatchVariant? _defaultInstance;

  /// Label format: "{ratio}_{width}w" (for example "portrait_1200w",
  /// "landscape_1600w").
  @$pb.TagNumber(1)
  $core.String get label => $_getSZ(0);
  @$pb.TagNumber(1)
  set label($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLabel() => $_has(0);
  @$pb.TagNumber(1)
  void clearLabel() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get contentType => $_getSZ(2);
  @$pb.TagNumber(3)
  set contentType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContentType() => $_has(2);
  @$pb.TagNumber(3)
  void clearContentType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get width => $_getIZ(3);
  @$pb.TagNumber(4)
  set width($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasWidth() => $_has(3);
  @$pb.TagNumber(4)
  void clearWidth() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get height => $_getIZ(4);
  @$pb.TagNumber(5)
  set height($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasHeight() => $_has(4);
  @$pb.TagNumber(5)
  void clearHeight() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get fileSizeBytes => $_getI64(5);
  @$pb.TagNumber(6)
  set fileSizeBytes($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasFileSizeBytes() => $_has(5);
  @$pb.TagNumber(6)
  void clearFileSizeBytes() => $_clearField(6);

  /// Intended use: portrait / square / landscape / og.
  @$pb.TagNumber(7)
  $core.String get variantType => $_getSZ(6);
  @$pb.TagNumber(7)
  set variantType($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasVariantType() => $_has(6);
  @$pb.TagNumber(7)
  void clearVariantType() => $_clearField(7);
}

/// ImageCropRect names the part of an uploaded image a caller wants kept. It
/// is stated in pixels of that upload, with the origin at its top-left corner,
/// and it stands on its own: nothing records the image it was measured
/// against, so a rectangle only means anything alongside the bytes it came
/// with.
///
/// The rectangle says where the cut is taken, not what shape comes out. The
/// server still fits it to the target aspect ratio, so a selection that is a
/// few pixels off that ratio delivers the ratio delivery expects.
class ImageCropRect extends $pb.GeneratedMessage {
  factory ImageCropRect({
    $core.int? x,
    $core.int? y,
    $core.int? width,
    $core.int? height,
  }) {
    final result = ImageCropRect._();
    if (x != null) result.x = x;
    if (y != null) result.y = y;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    return result;
  }

  ImageCropRect._();

  factory ImageCropRect.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ImageCropRect()..mergeFromBuffer(data, registry);
  factory ImageCropRect.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ImageCropRect()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ImageCropRect',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: ImageCropRect.$_createMessage)
    ..aI(1, _omitFieldNames ? '' : 'x')
    ..aI(2, _omitFieldNames ? '' : 'y')
    ..aI(3, _omitFieldNames ? '' : 'width')
    ..aI(4, _omitFieldNames ? '' : 'height')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImageCropRect clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ImageCropRect copyWith(void Function(ImageCropRect) updates) =>
      super.copyWith((message) => updates(message as ImageCropRect))
          as ImageCropRect;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use ImageCropRect() / ImageCropRect.new instead')
  static ImageCropRect create() => ImageCropRect._();
  static $pb.GeneratedMessage $_createMessage() => ImageCropRect._();
  @$core.override
  ImageCropRect createEmptyInstance() => ImageCropRect._();
  @$core.pragma('dart2js:noInline')
  static ImageCropRect getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ImageCropRect>(
          ImageCropRect.$_createMessage);
  static ImageCropRect? _defaultInstance;

  @$pb.TagNumber(1)
  $core.int get x => $_getIZ(0);
  @$pb.TagNumber(1)
  set x($core.int value) => $_setSignedInt32(0, value);
  @$pb.TagNumber(1)
  $core.bool hasX() => $_has(0);
  @$pb.TagNumber(1)
  void clearX() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.int get y => $_getIZ(1);
  @$pb.TagNumber(2)
  set y($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasY() => $_has(1);
  @$pb.TagNumber(2)
  void clearY() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get width => $_getIZ(2);
  @$pb.TagNumber(3)
  set width($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasWidth() => $_has(2);
  @$pb.TagNumber(3)
  void clearWidth() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get height => $_getIZ(3);
  @$pb.TagNumber(4)
  set height($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasHeight() => $_has(3);
  @$pb.TagNumber(4)
  void clearHeight() => $_clearField(4);
}

/// One entry of the classification a tenant curates. The genre list is short,
/// ordered by the tenant, and managed from the console; `public_id` is what a
/// filter names, so a rename does not move it.
class Genre extends $pb.GeneratedMessage {
  factory Genre({
    $core.String? publicId,
    $core.String? name,
    $core.String? slug,
    $core.String? eyeCatchImageUpdatedAt,
    $core.Iterable<SeriesEyeCatchVariant>? eyeCatchImageVariants,
    $core.String? id,
    $core.String? locale,
    $core.Iterable<GenreTranslation>? translations,
  }) {
    final result = Genre._();
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    if (slug != null) result.slug = slug;
    if (eyeCatchImageUpdatedAt != null)
      result.eyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    if (id != null) result.id = id;
    if (locale != null) result.locale = locale;
    if (translations != null) result.translations.addAll(translations);
    return result;
  }

  Genre._();

  factory Genre.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Genre()..mergeFromBuffer(data, registry);
  factory Genre.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Genre()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Genre',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Genre.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'slug')
    ..aOS(4, _omitFieldNames ? '' : 'eyeCatchImageUpdatedAt')
    ..pPM<SeriesEyeCatchVariant>(
        5, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: SeriesEyeCatchVariant.$_createMessage)
    ..aOS(6, _omitFieldNames ? '' : 'id')
    ..aOS(7, _omitFieldNames ? '' : 'locale')
    ..pPM<GenreTranslation>(8, _omitFieldNames ? '' : 'translations',
        subBuilder: GenreTranslation.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Genre clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Genre copyWith(void Function(Genre) updates) =>
      super.copyWith((message) => updates(message as Genre)) as Genre;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Genre() / Genre.new instead')
  static Genre create() => Genre._();
  static $pb.GeneratedMessage $_createMessage() => Genre._();
  @$core.override
  Genre createEmptyInstance() => Genre._();
  @$core.pragma('dart2js:noInline')
  static Genre getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Genre>(Genre.$_createMessage);
  static Genre? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  /// The name of the translation in the locale the read asked for, else the
  /// tenant's default locale's, else the oldest one. The console's reads ask
  /// for the default locale.
  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// Unique within the tenant, derived from the name a reader in the tenant's
  /// default locale is shown, by every save that changes that name. It
  /// identifies the name rather than standing in for it: no save can give two
  /// genres names that differ there by case or spacing alone. It does not
  /// change with the locale a read asks for, nor when the tenant changes its
  /// default locale.
  @$pb.TagNumber(3)
  $core.String get slug => $_getSZ(2);
  @$pb.TagNumber(3)
  set slug($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSlug() => $_has(2);
  @$pb.TagNumber(3)
  void clearSlug() => $_clearField(3);

  /// The eye-catch the console uploaded, as a label carries one. Filled by the
  /// genre RPCs themselves; a genre listed on a series carries names only.
  @$pb.TagNumber(4)
  $core.String get eyeCatchImageUpdatedAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set eyeCatchImageUpdatedAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasEyeCatchImageUpdatedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearEyeCatchImageUpdatedAt() => $_clearField(4);

  @$pb.TagNumber(5)
  $pb.PbList<SeriesEyeCatchVariant> get eyeCatchImageVariants => $_getList(4);

  /// The genre's primary key, which the admin API addresses it by.
  @$pb.TagNumber(6)
  $core.String get id => $_getSZ(5);
  @$pb.TagNumber(6)
  set id($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasId() => $_has(5);
  @$pb.TagNumber(6)
  void clearId() => $_clearField(6);

  /// The locale of the translation `name` comes from, named the way
  /// Series.locale is: a public read names the one it served, and the
  /// console's reads leave it empty.
  @$pb.TagNumber(7)
  $core.String get locale => $_getSZ(6);
  @$pb.TagNumber(7)
  set locale($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasLocale() => $_has(6);
  @$pb.TagNumber(7)
  void clearLocale() => $_clearField(7);

  /// Every name the genre has, oldest first. Filled by the console's genre RPCs
  /// alone.
  @$pb.TagNumber(8)
  $pb.PbList<GenreTranslation> get translations => $_getList(7);
}

/// One locale's name of a genre.
class GenreTranslation extends $pb.GeneratedMessage {
  factory GenreTranslation({
    $core.String? locale,
    $core.String? name,
    $core.String? createdAt,
    $core.String? updatedAt,
  }) {
    final result = GenreTranslation._();
    if (locale != null) result.locale = locale;
    if (name != null) result.name = name;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    return result;
  }

  GenreTranslation._();

  factory GenreTranslation.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GenreTranslation()..mergeFromBuffer(data, registry);
  factory GenreTranslation.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      GenreTranslation()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'GenreTranslation',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: GenreTranslation.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'locale')
    ..aOS(2, _omitFieldNames ? '' : 'name')
    ..aOS(3, _omitFieldNames ? '' : 'createdAt')
    ..aOS(4, _omitFieldNames ? '' : 'updatedAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GenreTranslation clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  GenreTranslation copyWith(void Function(GenreTranslation) updates) =>
      super.copyWith((message) => updates(message as GenreTranslation))
          as GenreTranslation;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use GenreTranslation() / GenreTranslation.new instead')
  static GenreTranslation create() => GenreTranslation._();
  static $pb.GeneratedMessage $_createMessage() => GenreTranslation._();
  @$core.override
  GenreTranslation createEmptyInstance() => GenreTranslation._();
  @$core.pragma('dart2js:noInline')
  static GenreTranslation getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<GenreTranslation>(
          GenreTranslation.$_createMessage);
  static GenreTranslation? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get locale => $_getSZ(0);
  @$pb.TagNumber(1)
  set locale($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLocale() => $_has(0);
  @$pb.TagNumber(1)
  void clearLocale() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get name => $_getSZ(1);
  @$pb.TagNumber(2)
  set name($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasName() => $_has(1);
  @$pb.TagNumber(2)
  void clearName() => $_clearField(2);

  /// RFC 3339.
  @$pb.TagNumber(3)
  $core.String get createdAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set createdAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get updatedAt => $_getSZ(3);
  @$pb.TagNumber(4)
  set updatedAt($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasUpdatedAt() => $_has(3);
  @$pb.TagNumber(4)
  void clearUpdatedAt() => $_clearField(4);
}

/// A free-form label written on the series form. Tags have no console of their
/// own and no order: a tag exists because a series carries it, and stops
/// existing when the last one lets it go. It is addressed by slug, which is why
/// it carries no public_id.
class Tag extends $pb.GeneratedMessage {
  factory Tag({
    $core.String? name,
    $core.String? slug,
  }) {
    final result = Tag._();
    if (name != null) result.name = name;
    if (slug != null) result.slug = slug;
    return result;
  }

  Tag._();

  factory Tag.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Tag()..mergeFromBuffer(data, registry);
  factory Tag.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Tag()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Tag',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Tag.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'name')
    ..aOS(2, _omitFieldNames ? '' : 'slug')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Tag clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Tag copyWith(void Function(Tag) updates) =>
      super.copyWith((message) => updates(message as Tag)) as Tag;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Tag() / Tag.new instead')
  static Tag create() => Tag._();
  static $pb.GeneratedMessage $_createMessage() => Tag._();
  @$core.override
  Tag createEmptyInstance() => Tag._();
  @$core.pragma('dart2js:noInline')
  static Tag getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Tag>(Tag.$_createMessage);
  static Tag? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get name => $_getSZ(0);
  @$pb.TagNumber(1)
  set name($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasName() => $_has(0);
  @$pb.TagNumber(1)
  void clearName() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get slug => $_getSZ(1);
  @$pb.TagNumber(2)
  set slug($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSlug() => $_has(1);
  @$pb.TagNumber(2)
  void clearSlug() => $_clearField(2);
}

class Series extends $pb.GeneratedMessage {
  factory Series({
    $core.String? publicId,
    $core.String? title,
    $core.String? synopsis,
    Label? label,
    $core.Iterable<Creator>? creators,
    $core.int? readingPeriodHours,
    $core.String? eyeCatchImageUpdatedAt,
    $core.Iterable<SeriesEyeCatchVariant>? eyeCatchImageVariants,
    $core.bool? isPublished,
    $core.String? publishedAt,
    SeriesStatus? status,
    $core.Iterable<$core.int>? scheduleWeekdays,
    SeriesAgeRating? ageRating,
    $core.Iterable<Genre>? genres,
    $core.Iterable<Tag>? tags,
    $core.int? freeEpisodeCount,
    $core.double? ratingAverage,
    $fixnum.Int64? ratingCount,
    SurfaceAvailability? availability,
    $core.String? id,
    $core.int? rentalPeriodHours,
    $core.String? locale,
    $core.int? bundleDiscountPercent,
  }) {
    final result = Series._();
    if (publicId != null) result.publicId = publicId;
    if (title != null) result.title = title;
    if (synopsis != null) result.synopsis = synopsis;
    if (label != null) result.label = label;
    if (creators != null) result.creators.addAll(creators);
    if (readingPeriodHours != null)
      result.readingPeriodHours = readingPeriodHours;
    if (eyeCatchImageUpdatedAt != null)
      result.eyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    if (isPublished != null) result.isPublished = isPublished;
    if (publishedAt != null) result.publishedAt = publishedAt;
    if (status != null) result.status = status;
    if (scheduleWeekdays != null)
      result.scheduleWeekdays.addAll(scheduleWeekdays);
    if (ageRating != null) result.ageRating = ageRating;
    if (genres != null) result.genres.addAll(genres);
    if (tags != null) result.tags.addAll(tags);
    if (freeEpisodeCount != null) result.freeEpisodeCount = freeEpisodeCount;
    if (ratingAverage != null) result.ratingAverage = ratingAverage;
    if (ratingCount != null) result.ratingCount = ratingCount;
    if (availability != null) result.availability = availability;
    if (id != null) result.id = id;
    if (rentalPeriodHours != null) result.rentalPeriodHours = rentalPeriodHours;
    if (locale != null) result.locale = locale;
    if (bundleDiscountPercent != null)
      result.bundleDiscountPercent = bundleDiscountPercent;
    return result;
  }

  Series._();

  factory Series.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Series()..mergeFromBuffer(data, registry);
  factory Series.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Series()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Series',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Series.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aOS(3, _omitFieldNames ? '' : 'synopsis')
    ..aOM<Label>(4, _omitFieldNames ? '' : 'label',
        subBuilder: Label.$_createMessage)
    ..pPM<Creator>(5, _omitFieldNames ? '' : 'creators',
        subBuilder: Creator.$_createMessage)
    ..aI(6, _omitFieldNames ? '' : 'readingPeriodHours')
    ..aOS(9, _omitFieldNames ? '' : 'eyeCatchImageUpdatedAt')
    ..pPM<SeriesEyeCatchVariant>(
        10, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: SeriesEyeCatchVariant.$_createMessage)
    ..aOB(11, _omitFieldNames ? '' : 'isPublished')
    ..aOS(12, _omitFieldNames ? '' : 'publishedAt')
    ..aE<SeriesStatus>(13, _omitFieldNames ? '' : 'status',
        enumValues: SeriesStatus.values)
    ..p<$core.int>(
        14, _omitFieldNames ? '' : 'scheduleWeekdays', $pb.PbFieldType.K3)
    ..aE<SeriesAgeRating>(15, _omitFieldNames ? '' : 'ageRating',
        enumValues: SeriesAgeRating.values)
    ..pPM<Genre>(16, _omitFieldNames ? '' : 'genres',
        subBuilder: Genre.$_createMessage)
    ..pPM<Tag>(17, _omitFieldNames ? '' : 'tags',
        subBuilder: Tag.$_createMessage)
    ..aI(18, _omitFieldNames ? '' : 'freeEpisodeCount')
    ..aD(19, _omitFieldNames ? '' : 'ratingAverage')
    ..aInt64(20, _omitFieldNames ? '' : 'ratingCount')
    ..aE<SurfaceAvailability>(21, _omitFieldNames ? '' : 'availability',
        enumValues: SurfaceAvailability.values)
    ..aOS(22, _omitFieldNames ? '' : 'id')
    ..aI(23, _omitFieldNames ? '' : 'rentalPeriodHours')
    ..aOS(24, _omitFieldNames ? '' : 'locale')
    ..aI(25, _omitFieldNames ? '' : 'bundleDiscountPercent')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Series clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Series copyWith(void Function(Series) updates) =>
      super.copyWith((message) => updates(message as Series)) as Series;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Series() / Series.new instead')
  static Series create() => Series._();
  static $pb.GeneratedMessage $_createMessage() => Series._();
  @$core.override
  Series createEmptyInstance() => Series._();
  @$core.pragma('dart2js:noInline')
  static Series getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Series>(Series.$_createMessage);
  static Series? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get synopsis => $_getSZ(2);
  @$pb.TagNumber(3)
  set synopsis($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasSynopsis() => $_has(2);
  @$pb.TagNumber(3)
  void clearSynopsis() => $_clearField(3);

  @$pb.TagNumber(4)
  Label get label => $_getN(3);
  @$pb.TagNumber(4)
  set label(Label value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasLabel() => $_has(3);
  @$pb.TagNumber(4)
  void clearLabel() => $_clearField(4);
  @$pb.TagNumber(4)
  Label ensureLabel() => $_ensure(3);

  @$pb.TagNumber(5)
  $pb.PbList<Creator> get creators => $_getList(4);

  @$pb.TagNumber(6)
  $core.int get readingPeriodHours => $_getIZ(5);
  @$pb.TagNumber(6)
  set readingPeriodHours($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasReadingPeriodHours() => $_has(5);
  @$pb.TagNumber(6)
  void clearReadingPeriodHours() => $_clearField(6);

  @$pb.TagNumber(9)
  $core.String get eyeCatchImageUpdatedAt => $_getSZ(6);
  @$pb.TagNumber(9)
  set eyeCatchImageUpdatedAt($core.String value) => $_setString(6, value);
  @$pb.TagNumber(9)
  $core.bool hasEyeCatchImageUpdatedAt() => $_has(6);
  @$pb.TagNumber(9)
  void clearEyeCatchImageUpdatedAt() => $_clearField(9);

  @$pb.TagNumber(10)
  $pb.PbList<SeriesEyeCatchVariant> get eyeCatchImageVariants => $_getList(7);

  @$pb.TagNumber(11)
  $core.bool get isPublished => $_getBF(8);
  @$pb.TagNumber(11)
  set isPublished($core.bool value) => $_setBool(8, value);
  @$pb.TagNumber(11)
  $core.bool hasIsPublished() => $_has(8);
  @$pb.TagNumber(11)
  void clearIsPublished() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get publishedAt => $_getSZ(9);
  @$pb.TagNumber(12)
  set publishedAt($core.String value) => $_setString(9, value);
  @$pb.TagNumber(12)
  $core.bool hasPublishedAt() => $_has(9);
  @$pb.TagNumber(12)
  void clearPublishedAt() => $_clearField(12);

  @$pb.TagNumber(13)
  SeriesStatus get status => $_getN(10);
  @$pb.TagNumber(13)
  set status(SeriesStatus value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasStatus() => $_has(10);
  @$pb.TagNumber(13)
  void clearStatus() => $_clearField(13);

  /// The weekdays a new episode is expected, as EXTRACT(DOW) numbers: 0 is
  /// Sunday and 6 is Saturday. Ascending, without duplicates. Empty means the
  /// series keeps no weekly schedule, which is a statement rather than a gap.
  @$pb.TagNumber(14)
  $pb.PbList<$core.int> get scheduleWeekdays => $_getList(11);

  @$pb.TagNumber(15)
  SeriesAgeRating get ageRating => $_getN(12);
  @$pb.TagNumber(15)
  set ageRating(SeriesAgeRating value) => $_setField(15, value);
  @$pb.TagNumber(15)
  $core.bool hasAgeRating() => $_has(12);
  @$pb.TagNumber(15)
  void clearAgeRating() => $_clearField(15);

  /// In the tenant's genre order, not the order they were assigned in.
  @$pb.TagNumber(16)
  $pb.PbList<Genre> get genres => $_getList(13);

  /// By name, so a series presents its tags the same way every time.
  @$pb.TagNumber(17)
  $pb.PbList<Tag> get tags => $_getList(14);

  /// How many published episodes of this series a reader can open without
  /// paying: the ones priced at 0, and the priced ones a free window is open
  /// on at the moment of the read. It is counted per read rather than stored,
  /// so an episode leaving its free window stops counting the moment it does,
  /// and a series with no free episode carries 0 rather than nothing.
  @$pb.TagNumber(18)
  $core.int get freeEpisodeCount => $_getIZ(15);
  @$pb.TagNumber(18)
  set freeEpisodeCount($core.int value) => $_setSignedInt32(15, value);
  @$pb.TagNumber(18)
  $core.bool hasFreeEpisodeCount() => $_has(15);
  @$pb.TagNumber(18)
  void clearFreeEpisodeCount() => $_clearField(18);

  /// What the series is rated, to one decimal on the 1-5 scale its episodes are
  /// reacted to on. A reader never rates a series directly: the figure is the
  /// reaction points its episodes collected over the reads they were finished
  /// on, pulled towards the tenant's own mean while few readers have finished
  /// any of them, so a series two people read does not top the list at 5.0.
  ///
  /// 0 means the series has no figure yet rather than the worst one: nobody has
  /// reacted to it, or the reactions have not reached the daily aggregates the
  /// figure is derived from. A client shows nothing in that case rather than a
  /// zero. Set on the reads where a Series stands for one series a reader
  /// opened, and empty in the lists that carry a series as a link.
  @$pb.TagNumber(19)
  $core.double get ratingAverage => $_getN(16);
  @$pb.TagNumber(19)
  set ratingAverage($core.double value) => $_setDouble(16, value);
  @$pb.TagNumber(19)
  $core.bool hasRatingAverage() => $_has(16);
  @$pb.TagNumber(19)
  void clearRatingAverage() => $_clearField(19);

  /// How many readers are behind `rating_average`. A reader counts once for the
  /// series however many of its episodes they reacted to, so this is a
  /// headcount and not a count of reactions. It is set and cleared together
  /// with the figure.
  @$pb.TagNumber(20)
  $fixnum.Int64 get ratingCount => $_getI64(17);
  @$pb.TagNumber(20)
  set ratingCount($fixnum.Int64 value) => $_setInt64(17, value);
  @$pb.TagNumber(20)
  $core.bool hasRatingCount() => $_has(17);
  @$pb.TagNumber(20)
  void clearRatingCount() => $_clearField(20);

  /// Which surfaces the series may be shown on. Set on the console's reads;
  /// SURFACE_AVAILABILITY_UNSPECIFIED on the storefront's and the app's, where
  /// the catalog has already left out every series the caller may not show.
  @$pb.TagNumber(21)
  SurfaceAvailability get availability => $_getN(18);
  @$pb.TagNumber(21)
  set availability(SurfaceAvailability value) => $_setField(21, value);
  @$pb.TagNumber(21)
  $core.bool hasAvailability() => $_has(18);
  @$pb.TagNumber(21)
  void clearAvailability() => $_clearField(21);

  @$pb.TagNumber(22)
  $core.String get id => $_getSZ(19);
  @$pb.TagNumber(22)
  set id($core.String value) => $_setString(19, value);
  @$pb.TagNumber(22)
  $core.bool hasId() => $_has(19);
  @$pb.TagNumber(22)
  void clearId() => $_clearField(22);

  /// Where the rental period of each new episode in the series starts, as
  /// `reading_period_hours` is for the permanent copy's. Zero states none. Set
  /// on the console's reads and 0 on the public ones.
  @$pb.TagNumber(23)
  $core.int get rentalPeriodHours => $_getIZ(20);
  @$pb.TagNumber(23)
  set rentalPeriodHours($core.int value) => $_setSignedInt32(20, value);
  @$pb.TagNumber(23)
  $core.bool hasRentalPeriodHours() => $_has(20);
  @$pb.TagNumber(23)
  void clearRentalPeriodHours() => $_clearField(23);

  /// The locale of the translation `title` and `synopsis` come from. A public
  /// read names the one it served, which differs from the one asked for when
  /// the series has no translation in that locale, and may be a locale the
  /// tenant no longer offers when the series has none in its default locale
  /// either. Empty on the console's reads.
  @$pb.TagNumber(24)
  $core.String get locale => $_getSZ(21);
  @$pb.TagNumber(24)
  set locale($core.String value) => $_setString(21, value);
  @$pb.TagNumber(24)
  $core.bool hasLocale() => $_has(21);
  @$pb.TagNumber(24)
  void clearLocale() => $_clearField(24);

  /// What StartSeriesRemainderCheckout takes off the sum of the prices it
  /// sells, in whole percent from 1 to 99. Zero sells the rest of the series at
  /// that sum. Set on the console's reads and 0 on the public ones, where
  /// GetSeriesEpisodeAccess quotes the rest of the series to the reader.
  @$pb.TagNumber(25)
  $core.int get bundleDiscountPercent => $_getIZ(22);
  @$pb.TagNumber(25)
  set bundleDiscountPercent($core.int value) => $_setSignedInt32(22, value);
  @$pb.TagNumber(25)
  $core.bool hasBundleDiscountPercent() => $_has(22);
  @$pb.TagNumber(25)
  void clearBundleDiscountPercent() => $_clearField(25);
}

class Episode extends $pb.GeneratedMessage {
  factory Episode({
    $core.String? publicId,
    $core.String? title,
    $core.int? orderIndex,
    $core.int? price,
    $core.int? readingPeriodHours,
    $core.String? status,
    $core.String? scheduledAt,
    $core.String? publishedAt,
    $core.Iterable<Creator>? creators,
    $fixnum.Int64? ratingCount,
    ReadingDirection? readingDirection,
    $core.int? spreadStartIndex,
    SurfaceAvailability? availability,
    SurfaceAvailability? purchaseAvailability,
    $core.String? id,
    $core.String? freeUntil,
    $core.String? eyeCatchImageUpdatedAt,
    $core.Iterable<SeriesEyeCatchVariant>? eyeCatchImageVariants,
    $core.int? rentalPrice,
    $core.int? rentalPeriodHours,
    $core.String? locale,
    $core.int? campaignPrice,
    $core.String? campaignEndsAt,
    $core.int? coinPrice,
    $core.int? coinRentalPrice,
    $core.String? coinName,
  }) {
    final result = Episode._();
    if (publicId != null) result.publicId = publicId;
    if (title != null) result.title = title;
    if (orderIndex != null) result.orderIndex = orderIndex;
    if (price != null) result.price = price;
    if (readingPeriodHours != null)
      result.readingPeriodHours = readingPeriodHours;
    if (status != null) result.status = status;
    if (scheduledAt != null) result.scheduledAt = scheduledAt;
    if (publishedAt != null) result.publishedAt = publishedAt;
    if (creators != null) result.creators.addAll(creators);
    if (ratingCount != null) result.ratingCount = ratingCount;
    if (readingDirection != null) result.readingDirection = readingDirection;
    if (spreadStartIndex != null) result.spreadStartIndex = spreadStartIndex;
    if (availability != null) result.availability = availability;
    if (purchaseAvailability != null)
      result.purchaseAvailability = purchaseAvailability;
    if (id != null) result.id = id;
    if (freeUntil != null) result.freeUntil = freeUntil;
    if (eyeCatchImageUpdatedAt != null)
      result.eyeCatchImageUpdatedAt = eyeCatchImageUpdatedAt;
    if (eyeCatchImageVariants != null)
      result.eyeCatchImageVariants.addAll(eyeCatchImageVariants);
    if (rentalPrice != null) result.rentalPrice = rentalPrice;
    if (rentalPeriodHours != null) result.rentalPeriodHours = rentalPeriodHours;
    if (locale != null) result.locale = locale;
    if (campaignPrice != null) result.campaignPrice = campaignPrice;
    if (campaignEndsAt != null) result.campaignEndsAt = campaignEndsAt;
    if (coinPrice != null) result.coinPrice = coinPrice;
    if (coinRentalPrice != null) result.coinRentalPrice = coinRentalPrice;
    if (coinName != null) result.coinName = coinName;
    return result;
  }

  Episode._();

  factory Episode.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Episode()..mergeFromBuffer(data, registry);
  factory Episode.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Episode()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Episode',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Episode.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'title')
    ..aI(3, _omitFieldNames ? '' : 'orderIndex')
    ..aI(4, _omitFieldNames ? '' : 'price')
    ..aI(5, _omitFieldNames ? '' : 'readingPeriodHours')
    ..aOS(6, _omitFieldNames ? '' : 'status')
    ..aOS(7, _omitFieldNames ? '' : 'scheduledAt')
    ..aOS(8, _omitFieldNames ? '' : 'publishedAt')
    ..pPM<Creator>(9, _omitFieldNames ? '' : 'creators',
        subBuilder: Creator.$_createMessage)
    ..aInt64(10, _omitFieldNames ? '' : 'ratingCount')
    ..aE<ReadingDirection>(11, _omitFieldNames ? '' : 'readingDirection',
        enumValues: ReadingDirection.values)
    ..aI(12, _omitFieldNames ? '' : 'spreadStartIndex')
    ..aE<SurfaceAvailability>(13, _omitFieldNames ? '' : 'availability',
        enumValues: SurfaceAvailability.values)
    ..aE<SurfaceAvailability>(14, _omitFieldNames ? '' : 'purchaseAvailability',
        enumValues: SurfaceAvailability.values)
    ..aOS(15, _omitFieldNames ? '' : 'id')
    ..aOS(16, _omitFieldNames ? '' : 'freeUntil')
    ..aOS(17, _omitFieldNames ? '' : 'eyeCatchImageUpdatedAt')
    ..pPM<SeriesEyeCatchVariant>(
        18, _omitFieldNames ? '' : 'eyeCatchImageVariants',
        subBuilder: SeriesEyeCatchVariant.$_createMessage)
    ..aI(19, _omitFieldNames ? '' : 'rentalPrice')
    ..aI(20, _omitFieldNames ? '' : 'rentalPeriodHours')
    ..aOS(21, _omitFieldNames ? '' : 'locale')
    ..aI(22, _omitFieldNames ? '' : 'campaignPrice')
    ..aOS(23, _omitFieldNames ? '' : 'campaignEndsAt')
    ..aI(24, _omitFieldNames ? '' : 'coinPrice')
    ..aI(25, _omitFieldNames ? '' : 'coinRentalPrice')
    ..aOS(26, _omitFieldNames ? '' : 'coinName')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Episode clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Episode copyWith(void Function(Episode) updates) =>
      super.copyWith((message) => updates(message as Episode)) as Episode;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Episode() / Episode.new instead')
  static Episode create() => Episode._();
  static $pb.GeneratedMessage $_createMessage() => Episode._();
  @$core.override
  Episode createEmptyInstance() => Episode._();
  @$core.pragma('dart2js:noInline')
  static Episode getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Episode>(Episode.$_createMessage);
  static Episode? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get title => $_getSZ(1);
  @$pb.TagNumber(2)
  set title($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasTitle() => $_has(1);
  @$pb.TagNumber(2)
  void clearTitle() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get orderIndex => $_getIZ(2);
  @$pb.TagNumber(3)
  set orderIndex($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasOrderIndex() => $_has(2);
  @$pb.TagNumber(3)
  void clearOrderIndex() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get price => $_getIZ(3);
  @$pb.TagNumber(4)
  set price($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPrice() => $_has(3);
  @$pb.TagNumber(4)
  void clearPrice() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get readingPeriodHours => $_getIZ(4);
  @$pb.TagNumber(5)
  set readingPeriodHours($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasReadingPeriodHours() => $_has(4);
  @$pb.TagNumber(5)
  void clearReadingPeriodHours() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get status => $_getSZ(5);
  @$pb.TagNumber(6)
  set status($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasStatus() => $_has(5);
  @$pb.TagNumber(6)
  void clearStatus() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get scheduledAt => $_getSZ(6);
  @$pb.TagNumber(7)
  set scheduledAt($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasScheduledAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearScheduledAt() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get publishedAt => $_getSZ(7);
  @$pb.TagNumber(8)
  set publishedAt($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasPublishedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearPublishedAt() => $_clearField(8);

  /// Who this episode is credited to, in role priority order. Every episode
  /// carries its own credits, baked from the series when it was created, so an
  /// artist who took over at episode 12 is on episode 12 onwards and not on the
  /// eleven before it. Set where an Episode stands for one episode a reader or
  /// an editor opened; empty in the lists that carry an episode as a link.
  @$pb.TagNumber(9)
  $pb.PbList<Creator> get creators => $_getList(8);

  /// How many readers have rated this episode. Set on the same reads `creators`
  /// is: a rating is given at the end of an episode, so the figure belongs to
  /// the episode a reader opened rather than to every link that names it.
  ///
  /// It counts readers rather than the points they gave, so it means the same
  /// thing whichever press mode the tenant chose. It is the stored tally rather
  /// than a count taken at read time, so the episode read carries one more
  /// column instead of one more scan.
  @$pb.TagNumber(10)
  $fixnum.Int64 get ratingCount => $_getI64(9);
  @$pb.TagNumber(10)
  set ratingCount($fixnum.Int64 value) => $_setInt64(9, value);
  @$pb.TagNumber(10)
  $core.bool hasRatingCount() => $_has(9);
  @$pb.TagNumber(10)
  void clearRatingCount() => $_clearField(10);

  /// Which way the pages are turned, and the zero-based index of the page from
  /// which two pages share a screen: every page before it stands alone. Both are
  /// resolved — the episode's own value where it states one, and its series'
  /// where it does not — so a viewer lays the body out from these two fields
  /// alone. Set on the reads that carry `creators`; READING_DIRECTION_UNSPECIFIED
  /// and 0 in the lists that carry an episode as a link.
  ///
  /// The index may lie past the last page when the series states it for longer
  /// episodes than this one, and the episode is then laid out without a spread.
  @$pb.TagNumber(11)
  ReadingDirection get readingDirection => $_getN(10);
  @$pb.TagNumber(11)
  set readingDirection(ReadingDirection value) => $_setField(11, value);
  @$pb.TagNumber(11)
  $core.bool hasReadingDirection() => $_has(10);
  @$pb.TagNumber(11)
  void clearReadingDirection() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.int get spreadStartIndex => $_getIZ(11);
  @$pb.TagNumber(12)
  set spreadStartIndex($core.int value) => $_setSignedInt32(11, value);
  @$pb.TagNumber(12)
  $core.bool hasSpreadStartIndex() => $_has(11);
  @$pb.TagNumber(12)
  void clearSpreadStartIndex() => $_clearField(12);

  /// The episode's own availability, and SURFACE_AVAILABILITY_UNSPECIFIED
  /// where it follows its series. Set on the console's reads and unspecified on
  /// the public ones, like Series.availability. It is the override rather than
  /// a resolved value because the series bounds it: an episode is shown only
  /// where its series is too, so a series and an episode naming different
  /// single surfaces leave the episode shown nowhere, which no one value says.
  @$pb.TagNumber(13)
  SurfaceAvailability get availability => $_getN(12);
  @$pb.TagNumber(13)
  set availability(SurfaceAvailability value) => $_setField(13, value);
  @$pb.TagNumber(13)
  $core.bool hasAvailability() => $_has(12);
  @$pb.TagNumber(13)
  void clearAvailability() => $_clearField(13);

  /// Which surfaces the episode may be bought on, resolved: the episode's own
  /// value, else its series', else the tenant's. Set on GetEpisodeDetail, on
  /// the episodes GetSeriesDetail lists, and on the console's GetEpisode and
  /// the episode writes that answer in its shape; SURFACE_AVAILABILITY_UNSPECIFIED
  /// elsewhere. A client offers the checkout only where this names its own
  /// surface, because StartEpisodeCheckout refuses it anywhere else.
  @$pb.TagNumber(14)
  SurfaceAvailability get purchaseAvailability => $_getN(13);
  @$pb.TagNumber(14)
  set purchaseAvailability(SurfaceAvailability value) => $_setField(14, value);
  @$pb.TagNumber(14)
  $core.bool hasPurchaseAvailability() => $_has(13);
  @$pb.TagNumber(14)
  void clearPurchaseAvailability() => $_clearField(14);

  @$pb.TagNumber(15)
  $core.String get id => $_getSZ(14);
  @$pb.TagNumber(15)
  set id($core.String value) => $_setString(14, value);
  @$pb.TagNumber(15)
  $core.bool hasId() => $_has(14);
  @$pb.TagNumber(15)
  void clearId() => $_clearField(15);

  /// RFC3339 end of the free window open on this episode, and empty when none
  /// is. It is what GetEpisodeDetailResponse.free_until reports for the same
  /// episode, so a row in a list can say how long a priced episode stays free
  /// without the episode being opened. `price` stays the stored price meanwhile,
  /// because that is what the episode costs again once the window closes.
  /// 9999-12-31T00:00:00Z is a window the series' free-after-publication rule
  /// opened, which has no end of its own: the episode is free for as long as
  /// the rule covers it.
  ///
  /// Set on the public reads that carry `price`: GetEpisodeDetail, the episodes
  /// GetSeriesDetail lists, GetMySeriesProgress and ListMyRecentSeries. Empty
  /// on the console's reads, and in the lists that carry an episode as a link
  /// without a price.
  @$pb.TagNumber(16)
  $core.String get freeUntil => $_getSZ(15);
  @$pb.TagNumber(16)
  set freeUntil($core.String value) => $_setString(15, value);
  @$pb.TagNumber(16)
  $core.bool hasFreeUntil() => $_has(15);
  @$pb.TagNumber(16)
  void clearFreeUntil() => $_clearField(16);

  /// The episode's own eye-catch, in the shape Series carries one. Empty when
  /// the episode has none, which is not an error to show: the series' eye-catch
  /// stands in for it. Set on GetEpisodeDetail, on the episodes GetSeriesDetail
  /// lists, on the member's own lists of episodes (ListMyEpisodeReads,
  /// ListMyRecentSeries and ListMyFollowUpdates), and on the console's episode
  /// reads and the episode writes that answer in their shape; empty elsewhere.
  @$pb.TagNumber(17)
  $core.String get eyeCatchImageUpdatedAt => $_getSZ(16);
  @$pb.TagNumber(17)
  set eyeCatchImageUpdatedAt($core.String value) => $_setString(16, value);
  @$pb.TagNumber(17)
  $core.bool hasEyeCatchImageUpdatedAt() => $_has(16);
  @$pb.TagNumber(17)
  void clearEyeCatchImageUpdatedAt() => $_clearField(17);

  @$pb.TagNumber(18)
  $pb.PbList<SeriesEyeCatchVariant> get eyeCatchImageVariants => $_getList(17);

  /// The rental: what renting the episode costs, in the minor unit `price` is
  /// in, and how long the rental opens it. Both are 0 on an episode that is not
  /// rented, and both are set on one that is: `price` then stays what the
  /// permanent copy costs, and `reading_period_hours` its expiry, if any. A
  /// rental is always cheaper than the permanent copy.
  ///
  /// Set on GetEpisodeDetail, on the episodes GetSeriesDetail lists, and on the
  /// console's episode reads and writes; 0 elsewhere.
  @$pb.TagNumber(19)
  $core.int get rentalPrice => $_getIZ(18);
  @$pb.TagNumber(19)
  set rentalPrice($core.int value) => $_setSignedInt32(18, value);
  @$pb.TagNumber(19)
  $core.bool hasRentalPrice() => $_has(18);
  @$pb.TagNumber(19)
  void clearRentalPrice() => $_clearField(19);

  @$pb.TagNumber(20)
  $core.int get rentalPeriodHours => $_getIZ(19);
  @$pb.TagNumber(20)
  set rentalPeriodHours($core.int value) => $_setSignedInt32(19, value);
  @$pb.TagNumber(20)
  $core.bool hasRentalPeriodHours() => $_has(19);
  @$pb.TagNumber(20)
  void clearRentalPeriodHours() => $_clearField(20);

  /// The locale of the translation `title` comes from, named the way
  /// Series.locale is: a public read names the one it served, and the
  /// console's reads leave it empty.
  @$pb.TagNumber(21)
  $core.String get locale => $_getSZ(20);
  @$pb.TagNumber(21)
  set locale($core.String value) => $_setString(20, value);
  @$pb.TagNumber(21)
  $core.bool hasLocale() => $_has(20);
  @$pb.TagNumber(21)
  void clearLocale() => $_clearField(21);

  /// The campaign price open on the episode: what its permanent copy sells for
  /// until `campaign_ends_at` (RFC3339), in the minor unit `price` is in, and
  /// what StartEpisodeCheckout charges for it meanwhile. `price` stays the
  /// stored price, because that is what the permanent copy costs again once the
  /// campaign ends, and the rental keeps `rental_price`. A campaign price is
  /// always below `price`. Both are 0 and empty when no campaign is open, and a
  /// free window open over a campaign still opens the episode to everyone.
  ///
  /// Set on GetEpisodeDetail and on the episodes GetSeriesDetail lists; 0 and
  /// empty elsewhere, the console's reads included.
  @$pb.TagNumber(22)
  $core.int get campaignPrice => $_getIZ(21);
  @$pb.TagNumber(22)
  set campaignPrice($core.int value) => $_setSignedInt32(21, value);
  @$pb.TagNumber(22)
  $core.bool hasCampaignPrice() => $_has(21);
  @$pb.TagNumber(22)
  void clearCampaignPrice() => $_clearField(22);

  @$pb.TagNumber(23)
  $core.String get campaignEndsAt => $_getSZ(22);
  @$pb.TagNumber(23)
  set campaignEndsAt($core.String value) => $_setString(22, value);
  @$pb.TagNumber(23)
  $core.bool hasCampaignEndsAt() => $_has(22);
  @$pb.TagNumber(23)
  void clearCampaignEndsAt() => $_clearField(23);

  /// What the episode costs in the tenant's coins, which CoinService.
  /// PayEpisodeWithCoins spends: coin_price for the permanent copy, at
  /// campaign_price while a campaign is open and at price otherwise, and
  /// coin_rental_price for the rental, at rental_price. Each is that price
  /// divided by the value of one coin, rounded up. coin_name is the tenant's
  /// word for its coins in the reader's locale, so a client never names them
  /// itself.
  ///
  /// All three are 0 and empty on a free episode, and coin_rental_price on one
  /// that is not rented. They are 0 and empty too while the platform does not
  /// allow tenant coins or the tenant has not turned its coins on, and a client
  /// offers coins only where coin_price or coin_rental_price is set.
  ///
  /// Set on GetEpisodeDetail and on the episodes GetSeriesDetail lists; 0 and
  /// empty elsewhere, the console's reads included.
  @$pb.TagNumber(24)
  $core.int get coinPrice => $_getIZ(23);
  @$pb.TagNumber(24)
  set coinPrice($core.int value) => $_setSignedInt32(23, value);
  @$pb.TagNumber(24)
  $core.bool hasCoinPrice() => $_has(23);
  @$pb.TagNumber(24)
  void clearCoinPrice() => $_clearField(24);

  @$pb.TagNumber(25)
  $core.int get coinRentalPrice => $_getIZ(24);
  @$pb.TagNumber(25)
  set coinRentalPrice($core.int value) => $_setSignedInt32(24, value);
  @$pb.TagNumber(25)
  $core.bool hasCoinRentalPrice() => $_has(24);
  @$pb.TagNumber(25)
  void clearCoinRentalPrice() => $_clearField(25);

  @$pb.TagNumber(26)
  $core.String get coinName => $_getSZ(25);
  @$pb.TagNumber(26)
  set coinName($core.String value) => $_setString(25, value);
  @$pb.TagNumber(26)
  $core.bool hasCoinName() => $_has(25);
  @$pb.TagNumber(26)
  void clearCoinName() => $_clearField(26);
}

class EpisodeImage extends $pb.GeneratedMessage {
  factory EpisodeImage({
    $core.String? id,
    $core.String? imageUrl,
    $core.String? contentType,
    $fixnum.Int64? fileSizeBytes,
    $core.int? displayOrder,
    $core.int? width,
    $core.int? height,
  }) {
    final result = EpisodeImage._();
    if (id != null) result.id = id;
    if (imageUrl != null) result.imageUrl = imageUrl;
    if (contentType != null) result.contentType = contentType;
    if (fileSizeBytes != null) result.fileSizeBytes = fileSizeBytes;
    if (displayOrder != null) result.displayOrder = displayOrder;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    return result;
  }

  EpisodeImage._();

  factory EpisodeImage.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeImage()..mergeFromBuffer(data, registry);
  factory EpisodeImage.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeImage()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EpisodeImage',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: EpisodeImage.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'imageUrl')
    ..aOS(3, _omitFieldNames ? '' : 'contentType')
    ..aInt64(4, _omitFieldNames ? '' : 'fileSizeBytes')
    ..aI(5, _omitFieldNames ? '' : 'displayOrder')
    ..aI(6, _omitFieldNames ? '' : 'width')
    ..aI(7, _omitFieldNames ? '' : 'height')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeImage clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeImage copyWith(void Function(EpisodeImage) updates) =>
      super.copyWith((message) => updates(message as EpisodeImage))
          as EpisodeImage;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use EpisodeImage() / EpisodeImage.new instead')
  static EpisodeImage create() => EpisodeImage._();
  static $pb.GeneratedMessage $_createMessage() => EpisodeImage._();
  @$core.override
  EpisodeImage createEmptyInstance() => EpisodeImage._();
  @$core.pragma('dart2js:noInline')
  static EpisodeImage getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<EpisodeImage>(
          EpisodeImage.$_createMessage);
  static EpisodeImage? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get imageUrl => $_getSZ(1);
  @$pb.TagNumber(2)
  set imageUrl($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasImageUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearImageUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get contentType => $_getSZ(2);
  @$pb.TagNumber(3)
  set contentType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContentType() => $_has(2);
  @$pb.TagNumber(3)
  void clearContentType() => $_clearField(3);

  @$pb.TagNumber(4)
  $fixnum.Int64 get fileSizeBytes => $_getI64(3);
  @$pb.TagNumber(4)
  set fileSizeBytes($fixnum.Int64 value) => $_setInt64(3, value);
  @$pb.TagNumber(4)
  $core.bool hasFileSizeBytes() => $_has(3);
  @$pb.TagNumber(4)
  void clearFileSizeBytes() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get displayOrder => $_getIZ(4);
  @$pb.TagNumber(5)
  set displayOrder($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasDisplayOrder() => $_has(4);
  @$pb.TagNumber(5)
  void clearDisplayOrder() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.int get width => $_getIZ(5);
  @$pb.TagNumber(6)
  set width($core.int value) => $_setSignedInt32(5, value);
  @$pb.TagNumber(6)
  $core.bool hasWidth() => $_has(5);
  @$pb.TagNumber(6)
  void clearWidth() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.int get height => $_getIZ(6);
  @$pb.TagNumber(7)
  set height($core.int value) => $_setSignedInt32(6, value);
  @$pb.TagNumber(7)
  $core.bool hasHeight() => $_has(6);
  @$pb.TagNumber(7)
  void clearHeight() => $_clearField(7);
}

/// A stored tenant branding image, in the shape the eye-catch images already
/// use. `variant_type` names what the image is for — `logo`, `icon`, or
/// `sign_in` — the way the eye-catch variants name their aspect ratio; it is not
/// a size. Sizes are the image server's job: it resizes on request from the
/// stored master.
class TenantImageVariant extends $pb.GeneratedMessage {
  factory TenantImageVariant({
    $core.String? label,
    $core.String? url,
    $core.String? contentType,
    $core.int? width,
    $core.int? height,
    $fixnum.Int64? fileSizeBytes,
    $core.String? variantType,
  }) {
    final result = TenantImageVariant._();
    if (label != null) result.label = label;
    if (url != null) result.url = url;
    if (contentType != null) result.contentType = contentType;
    if (width != null) result.width = width;
    if (height != null) result.height = height;
    if (fileSizeBytes != null) result.fileSizeBytes = fileSizeBytes;
    if (variantType != null) result.variantType = variantType;
    return result;
  }

  TenantImageVariant._();

  factory TenantImageVariant.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantImageVariant()..mergeFromBuffer(data, registry);
  factory TenantImageVariant.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantImageVariant()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantImageVariant',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: TenantImageVariant.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'label')
    ..aOS(2, _omitFieldNames ? '' : 'url')
    ..aOS(3, _omitFieldNames ? '' : 'contentType')
    ..aI(4, _omitFieldNames ? '' : 'width')
    ..aI(5, _omitFieldNames ? '' : 'height')
    ..aInt64(6, _omitFieldNames ? '' : 'fileSizeBytes')
    ..aOS(7, _omitFieldNames ? '' : 'variantType')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantImageVariant clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantImageVariant copyWith(void Function(TenantImageVariant) updates) =>
      super.copyWith((message) => updates(message as TenantImageVariant))
          as TenantImageVariant;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantImageVariant() / TenantImageVariant.new instead')
  static TenantImageVariant create() => TenantImageVariant._();
  static $pb.GeneratedMessage $_createMessage() => TenantImageVariant._();
  @$core.override
  TenantImageVariant createEmptyInstance() => TenantImageVariant._();
  @$core.pragma('dart2js:noInline')
  static TenantImageVariant getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<TenantImageVariant>(
          TenantImageVariant.$_createMessage);
  static TenantImageVariant? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get label => $_getSZ(0);
  @$pb.TagNumber(1)
  set label($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasLabel() => $_has(0);
  @$pb.TagNumber(1)
  void clearLabel() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get url => $_getSZ(1);
  @$pb.TagNumber(2)
  set url($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasUrl() => $_has(1);
  @$pb.TagNumber(2)
  void clearUrl() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get contentType => $_getSZ(2);
  @$pb.TagNumber(3)
  set contentType($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasContentType() => $_has(2);
  @$pb.TagNumber(3)
  void clearContentType() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.int get width => $_getIZ(3);
  @$pb.TagNumber(4)
  set width($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasWidth() => $_has(3);
  @$pb.TagNumber(4)
  void clearWidth() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.int get height => $_getIZ(4);
  @$pb.TagNumber(5)
  set height($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasHeight() => $_has(4);
  @$pb.TagNumber(5)
  void clearHeight() => $_clearField(5);

  @$pb.TagNumber(6)
  $fixnum.Int64 get fileSizeBytes => $_getI64(5);
  @$pb.TagNumber(6)
  set fileSizeBytes($fixnum.Int64 value) => $_setInt64(5, value);
  @$pb.TagNumber(6)
  $core.bool hasFileSizeBytes() => $_has(5);
  @$pb.TagNumber(6)
  void clearFileSizeBytes() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get variantType => $_getSZ(6);
  @$pb.TagNumber(7)
  set variantType($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasVariantType() => $_has(6);
  @$pb.TagNumber(7)
  void clearVariantType() => $_clearField(7);
}

class TenantTheme extends $pb.GeneratedMessage {
  factory TenantTheme({
    $core.String? primaryColor,
    $core.String? secondaryColor,
    $core.String? accentColor,
    $core.String? backgroundColor,
    $core.String? foregroundColor,
    $core.String? surfaceColor,
    $core.String? surfaceForegroundColor,
    $core.String? cardColor,
    $core.String? cardForegroundColor,
    $core.String? popoverColor,
    $core.String? popoverForegroundColor,
    $core.String? primaryForegroundColor,
    $core.String? secondaryForegroundColor,
    $core.String? accentForegroundColor,
    $core.String? mutedColor,
    $core.String? mutedForegroundColor,
    $core.String? borderColor,
    $core.String? inputColor,
    $core.String? ringColor,
    $core.String? successColor,
    $core.String? successForegroundColor,
    $core.String? warningColor,
    $core.String? warningForegroundColor,
    $core.String? destructiveColor,
    $core.String? destructiveForegroundColor,
    $core.String? infoColor,
    $core.String? infoForegroundColor,
    $core.String? iconImageUpdatedAt,
    $core.Iterable<TenantImageVariant>? iconImageVariants,
    $core.String? logoImageUpdatedAt,
    $core.Iterable<TenantImageVariant>? logoImageVariants,
    $core.String? serifFontFamily,
    $core.String? sansFontFamily,
    $core.String? signInImageUpdatedAt,
    $core.Iterable<TenantImageVariant>? signInImageVariants,
  }) {
    final result = TenantTheme._();
    if (primaryColor != null) result.primaryColor = primaryColor;
    if (secondaryColor != null) result.secondaryColor = secondaryColor;
    if (accentColor != null) result.accentColor = accentColor;
    if (backgroundColor != null) result.backgroundColor = backgroundColor;
    if (foregroundColor != null) result.foregroundColor = foregroundColor;
    if (surfaceColor != null) result.surfaceColor = surfaceColor;
    if (surfaceForegroundColor != null)
      result.surfaceForegroundColor = surfaceForegroundColor;
    if (cardColor != null) result.cardColor = cardColor;
    if (cardForegroundColor != null)
      result.cardForegroundColor = cardForegroundColor;
    if (popoverColor != null) result.popoverColor = popoverColor;
    if (popoverForegroundColor != null)
      result.popoverForegroundColor = popoverForegroundColor;
    if (primaryForegroundColor != null)
      result.primaryForegroundColor = primaryForegroundColor;
    if (secondaryForegroundColor != null)
      result.secondaryForegroundColor = secondaryForegroundColor;
    if (accentForegroundColor != null)
      result.accentForegroundColor = accentForegroundColor;
    if (mutedColor != null) result.mutedColor = mutedColor;
    if (mutedForegroundColor != null)
      result.mutedForegroundColor = mutedForegroundColor;
    if (borderColor != null) result.borderColor = borderColor;
    if (inputColor != null) result.inputColor = inputColor;
    if (ringColor != null) result.ringColor = ringColor;
    if (successColor != null) result.successColor = successColor;
    if (successForegroundColor != null)
      result.successForegroundColor = successForegroundColor;
    if (warningColor != null) result.warningColor = warningColor;
    if (warningForegroundColor != null)
      result.warningForegroundColor = warningForegroundColor;
    if (destructiveColor != null) result.destructiveColor = destructiveColor;
    if (destructiveForegroundColor != null)
      result.destructiveForegroundColor = destructiveForegroundColor;
    if (infoColor != null) result.infoColor = infoColor;
    if (infoForegroundColor != null)
      result.infoForegroundColor = infoForegroundColor;
    if (iconImageUpdatedAt != null)
      result.iconImageUpdatedAt = iconImageUpdatedAt;
    if (iconImageVariants != null)
      result.iconImageVariants.addAll(iconImageVariants);
    if (logoImageUpdatedAt != null)
      result.logoImageUpdatedAt = logoImageUpdatedAt;
    if (logoImageVariants != null)
      result.logoImageVariants.addAll(logoImageVariants);
    if (serifFontFamily != null) result.serifFontFamily = serifFontFamily;
    if (sansFontFamily != null) result.sansFontFamily = sansFontFamily;
    if (signInImageUpdatedAt != null)
      result.signInImageUpdatedAt = signInImageUpdatedAt;
    if (signInImageVariants != null)
      result.signInImageVariants.addAll(signInImageVariants);
    return result;
  }

  TenantTheme._();

  factory TenantTheme.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantTheme()..mergeFromBuffer(data, registry);
  factory TenantTheme.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      TenantTheme()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'TenantTheme',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: TenantTheme.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'primaryColor')
    ..aOS(2, _omitFieldNames ? '' : 'secondaryColor')
    ..aOS(3, _omitFieldNames ? '' : 'accentColor')
    ..aOS(5, _omitFieldNames ? '' : 'backgroundColor')
    ..aOS(6, _omitFieldNames ? '' : 'foregroundColor')
    ..aOS(7, _omitFieldNames ? '' : 'surfaceColor')
    ..aOS(8, _omitFieldNames ? '' : 'surfaceForegroundColor')
    ..aOS(9, _omitFieldNames ? '' : 'cardColor')
    ..aOS(10, _omitFieldNames ? '' : 'cardForegroundColor')
    ..aOS(11, _omitFieldNames ? '' : 'popoverColor')
    ..aOS(12, _omitFieldNames ? '' : 'popoverForegroundColor')
    ..aOS(13, _omitFieldNames ? '' : 'primaryForegroundColor')
    ..aOS(14, _omitFieldNames ? '' : 'secondaryForegroundColor')
    ..aOS(15, _omitFieldNames ? '' : 'accentForegroundColor')
    ..aOS(16, _omitFieldNames ? '' : 'mutedColor')
    ..aOS(17, _omitFieldNames ? '' : 'mutedForegroundColor')
    ..aOS(18, _omitFieldNames ? '' : 'borderColor')
    ..aOS(19, _omitFieldNames ? '' : 'inputColor')
    ..aOS(20, _omitFieldNames ? '' : 'ringColor')
    ..aOS(21, _omitFieldNames ? '' : 'successColor')
    ..aOS(22, _omitFieldNames ? '' : 'successForegroundColor')
    ..aOS(23, _omitFieldNames ? '' : 'warningColor')
    ..aOS(24, _omitFieldNames ? '' : 'warningForegroundColor')
    ..aOS(25, _omitFieldNames ? '' : 'destructiveColor')
    ..aOS(26, _omitFieldNames ? '' : 'destructiveForegroundColor')
    ..aOS(27, _omitFieldNames ? '' : 'infoColor')
    ..aOS(28, _omitFieldNames ? '' : 'infoForegroundColor')
    ..aOS(30, _omitFieldNames ? '' : 'iconImageUpdatedAt')
    ..pPM<TenantImageVariant>(31, _omitFieldNames ? '' : 'iconImageVariants',
        subBuilder: TenantImageVariant.$_createMessage)
    ..aOS(32, _omitFieldNames ? '' : 'logoImageUpdatedAt')
    ..pPM<TenantImageVariant>(33, _omitFieldNames ? '' : 'logoImageVariants',
        subBuilder: TenantImageVariant.$_createMessage)
    ..aOS(34, _omitFieldNames ? '' : 'serifFontFamily')
    ..aOS(35, _omitFieldNames ? '' : 'sansFontFamily')
    ..aOS(36, _omitFieldNames ? '' : 'signInImageUpdatedAt')
    ..pPM<TenantImageVariant>(37, _omitFieldNames ? '' : 'signInImageVariants',
        subBuilder: TenantImageVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantTheme clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  TenantTheme copyWith(void Function(TenantTheme) updates) =>
      super.copyWith((message) => updates(message as TenantTheme))
          as TenantTheme;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use TenantTheme() / TenantTheme.new instead')
  static TenantTheme create() => TenantTheme._();
  static $pb.GeneratedMessage $_createMessage() => TenantTheme._();
  @$core.override
  TenantTheme createEmptyInstance() => TenantTheme._();
  @$core.pragma('dart2js:noInline')
  static TenantTheme getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<TenantTheme>(
          TenantTheme.$_createMessage);
  static TenantTheme? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get primaryColor => $_getSZ(0);
  @$pb.TagNumber(1)
  set primaryColor($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPrimaryColor() => $_has(0);
  @$pb.TagNumber(1)
  void clearPrimaryColor() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get secondaryColor => $_getSZ(1);
  @$pb.TagNumber(2)
  set secondaryColor($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSecondaryColor() => $_has(1);
  @$pb.TagNumber(2)
  void clearSecondaryColor() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get accentColor => $_getSZ(2);
  @$pb.TagNumber(3)
  set accentColor($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasAccentColor() => $_has(2);
  @$pb.TagNumber(3)
  void clearAccentColor() => $_clearField(3);

  @$pb.TagNumber(5)
  $core.String get backgroundColor => $_getSZ(3);
  @$pb.TagNumber(5)
  set backgroundColor($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasBackgroundColor() => $_has(3);
  @$pb.TagNumber(5)
  void clearBackgroundColor() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get foregroundColor => $_getSZ(4);
  @$pb.TagNumber(6)
  set foregroundColor($core.String value) => $_setString(4, value);
  @$pb.TagNumber(6)
  $core.bool hasForegroundColor() => $_has(4);
  @$pb.TagNumber(6)
  void clearForegroundColor() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get surfaceColor => $_getSZ(5);
  @$pb.TagNumber(7)
  set surfaceColor($core.String value) => $_setString(5, value);
  @$pb.TagNumber(7)
  $core.bool hasSurfaceColor() => $_has(5);
  @$pb.TagNumber(7)
  void clearSurfaceColor() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get surfaceForegroundColor => $_getSZ(6);
  @$pb.TagNumber(8)
  set surfaceForegroundColor($core.String value) => $_setString(6, value);
  @$pb.TagNumber(8)
  $core.bool hasSurfaceForegroundColor() => $_has(6);
  @$pb.TagNumber(8)
  void clearSurfaceForegroundColor() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get cardColor => $_getSZ(7);
  @$pb.TagNumber(9)
  set cardColor($core.String value) => $_setString(7, value);
  @$pb.TagNumber(9)
  $core.bool hasCardColor() => $_has(7);
  @$pb.TagNumber(9)
  void clearCardColor() => $_clearField(9);

  @$pb.TagNumber(10)
  $core.String get cardForegroundColor => $_getSZ(8);
  @$pb.TagNumber(10)
  set cardForegroundColor($core.String value) => $_setString(8, value);
  @$pb.TagNumber(10)
  $core.bool hasCardForegroundColor() => $_has(8);
  @$pb.TagNumber(10)
  void clearCardForegroundColor() => $_clearField(10);

  @$pb.TagNumber(11)
  $core.String get popoverColor => $_getSZ(9);
  @$pb.TagNumber(11)
  set popoverColor($core.String value) => $_setString(9, value);
  @$pb.TagNumber(11)
  $core.bool hasPopoverColor() => $_has(9);
  @$pb.TagNumber(11)
  void clearPopoverColor() => $_clearField(11);

  @$pb.TagNumber(12)
  $core.String get popoverForegroundColor => $_getSZ(10);
  @$pb.TagNumber(12)
  set popoverForegroundColor($core.String value) => $_setString(10, value);
  @$pb.TagNumber(12)
  $core.bool hasPopoverForegroundColor() => $_has(10);
  @$pb.TagNumber(12)
  void clearPopoverForegroundColor() => $_clearField(12);

  @$pb.TagNumber(13)
  $core.String get primaryForegroundColor => $_getSZ(11);
  @$pb.TagNumber(13)
  set primaryForegroundColor($core.String value) => $_setString(11, value);
  @$pb.TagNumber(13)
  $core.bool hasPrimaryForegroundColor() => $_has(11);
  @$pb.TagNumber(13)
  void clearPrimaryForegroundColor() => $_clearField(13);

  @$pb.TagNumber(14)
  $core.String get secondaryForegroundColor => $_getSZ(12);
  @$pb.TagNumber(14)
  set secondaryForegroundColor($core.String value) => $_setString(12, value);
  @$pb.TagNumber(14)
  $core.bool hasSecondaryForegroundColor() => $_has(12);
  @$pb.TagNumber(14)
  void clearSecondaryForegroundColor() => $_clearField(14);

  @$pb.TagNumber(15)
  $core.String get accentForegroundColor => $_getSZ(13);
  @$pb.TagNumber(15)
  set accentForegroundColor($core.String value) => $_setString(13, value);
  @$pb.TagNumber(15)
  $core.bool hasAccentForegroundColor() => $_has(13);
  @$pb.TagNumber(15)
  void clearAccentForegroundColor() => $_clearField(15);

  @$pb.TagNumber(16)
  $core.String get mutedColor => $_getSZ(14);
  @$pb.TagNumber(16)
  set mutedColor($core.String value) => $_setString(14, value);
  @$pb.TagNumber(16)
  $core.bool hasMutedColor() => $_has(14);
  @$pb.TagNumber(16)
  void clearMutedColor() => $_clearField(16);

  @$pb.TagNumber(17)
  $core.String get mutedForegroundColor => $_getSZ(15);
  @$pb.TagNumber(17)
  set mutedForegroundColor($core.String value) => $_setString(15, value);
  @$pb.TagNumber(17)
  $core.bool hasMutedForegroundColor() => $_has(15);
  @$pb.TagNumber(17)
  void clearMutedForegroundColor() => $_clearField(17);

  @$pb.TagNumber(18)
  $core.String get borderColor => $_getSZ(16);
  @$pb.TagNumber(18)
  set borderColor($core.String value) => $_setString(16, value);
  @$pb.TagNumber(18)
  $core.bool hasBorderColor() => $_has(16);
  @$pb.TagNumber(18)
  void clearBorderColor() => $_clearField(18);

  @$pb.TagNumber(19)
  $core.String get inputColor => $_getSZ(17);
  @$pb.TagNumber(19)
  set inputColor($core.String value) => $_setString(17, value);
  @$pb.TagNumber(19)
  $core.bool hasInputColor() => $_has(17);
  @$pb.TagNumber(19)
  void clearInputColor() => $_clearField(19);

  @$pb.TagNumber(20)
  $core.String get ringColor => $_getSZ(18);
  @$pb.TagNumber(20)
  set ringColor($core.String value) => $_setString(18, value);
  @$pb.TagNumber(20)
  $core.bool hasRingColor() => $_has(18);
  @$pb.TagNumber(20)
  void clearRingColor() => $_clearField(20);

  @$pb.TagNumber(21)
  $core.String get successColor => $_getSZ(19);
  @$pb.TagNumber(21)
  set successColor($core.String value) => $_setString(19, value);
  @$pb.TagNumber(21)
  $core.bool hasSuccessColor() => $_has(19);
  @$pb.TagNumber(21)
  void clearSuccessColor() => $_clearField(21);

  @$pb.TagNumber(22)
  $core.String get successForegroundColor => $_getSZ(20);
  @$pb.TagNumber(22)
  set successForegroundColor($core.String value) => $_setString(20, value);
  @$pb.TagNumber(22)
  $core.bool hasSuccessForegroundColor() => $_has(20);
  @$pb.TagNumber(22)
  void clearSuccessForegroundColor() => $_clearField(22);

  @$pb.TagNumber(23)
  $core.String get warningColor => $_getSZ(21);
  @$pb.TagNumber(23)
  set warningColor($core.String value) => $_setString(21, value);
  @$pb.TagNumber(23)
  $core.bool hasWarningColor() => $_has(21);
  @$pb.TagNumber(23)
  void clearWarningColor() => $_clearField(23);

  @$pb.TagNumber(24)
  $core.String get warningForegroundColor => $_getSZ(22);
  @$pb.TagNumber(24)
  set warningForegroundColor($core.String value) => $_setString(22, value);
  @$pb.TagNumber(24)
  $core.bool hasWarningForegroundColor() => $_has(22);
  @$pb.TagNumber(24)
  void clearWarningForegroundColor() => $_clearField(24);

  @$pb.TagNumber(25)
  $core.String get destructiveColor => $_getSZ(23);
  @$pb.TagNumber(25)
  set destructiveColor($core.String value) => $_setString(23, value);
  @$pb.TagNumber(25)
  $core.bool hasDestructiveColor() => $_has(23);
  @$pb.TagNumber(25)
  void clearDestructiveColor() => $_clearField(25);

  @$pb.TagNumber(26)
  $core.String get destructiveForegroundColor => $_getSZ(24);
  @$pb.TagNumber(26)
  set destructiveForegroundColor($core.String value) => $_setString(24, value);
  @$pb.TagNumber(26)
  $core.bool hasDestructiveForegroundColor() => $_has(24);
  @$pb.TagNumber(26)
  void clearDestructiveForegroundColor() => $_clearField(26);

  @$pb.TagNumber(27)
  $core.String get infoColor => $_getSZ(25);
  @$pb.TagNumber(27)
  set infoColor($core.String value) => $_setString(25, value);
  @$pb.TagNumber(27)
  $core.bool hasInfoColor() => $_has(25);
  @$pb.TagNumber(27)
  void clearInfoColor() => $_clearField(27);

  @$pb.TagNumber(28)
  $core.String get infoForegroundColor => $_getSZ(26);
  @$pb.TagNumber(28)
  set infoForegroundColor($core.String value) => $_setString(26, value);
  @$pb.TagNumber(28)
  $core.bool hasInfoForegroundColor() => $_has(26);
  @$pb.TagNumber(28)
  void clearInfoForegroundColor() => $_clearField(28);

  /// Tenant icon, uploaded and stored independently from the logo. The
  /// variant list is empty when the tenant has not set one.
  @$pb.TagNumber(30)
  $core.String get iconImageUpdatedAt => $_getSZ(27);
  @$pb.TagNumber(30)
  set iconImageUpdatedAt($core.String value) => $_setString(27, value);
  @$pb.TagNumber(30)
  $core.bool hasIconImageUpdatedAt() => $_has(27);
  @$pb.TagNumber(30)
  void clearIconImageUpdatedAt() => $_clearField(30);

  @$pb.TagNumber(31)
  $pb.PbList<TenantImageVariant> get iconImageVariants => $_getList(28);

  /// Tenant logo. The variant list is empty when the tenant has not set one.
  @$pb.TagNumber(32)
  $core.String get logoImageUpdatedAt => $_getSZ(29);
  @$pb.TagNumber(32)
  set logoImageUpdatedAt($core.String value) => $_setString(29, value);
  @$pb.TagNumber(32)
  $core.bool hasLogoImageUpdatedAt() => $_has(29);
  @$pb.TagNumber(32)
  void clearLogoImageUpdatedAt() => $_clearField(32);

  @$pb.TagNumber(33)
  $pb.PbList<TenantImageVariant> get logoImageVariants => $_getList(30);

  /// A CSS font-family list for reading text. Empty uses the brief's default stack.
  @$pb.TagNumber(34)
  $core.String get serifFontFamily => $_getSZ(31);
  @$pb.TagNumber(34)
  set serifFontFamily($core.String value) => $_setString(31, value);
  @$pb.TagNumber(34)
  $core.bool hasSerifFontFamily() => $_has(31);
  @$pb.TagNumber(34)
  void clearSerifFontFamily() => $_clearField(34);

  /// A CSS font-family list for interface text. Empty uses the brief's default stack.
  @$pb.TagNumber(35)
  $core.String get sansFontFamily => $_getSZ(32);
  @$pb.TagNumber(35)
  set sansFontFamily($core.String value) => $_setString(32, value);
  @$pb.TagNumber(35)
  $core.bool hasSansFontFamily() => $_has(32);
  @$pb.TagNumber(35)
  void clearSansFontFamily() => $_clearField(35);

  /// The image beside the storefront's sign-in and sign-up forms, uploaded for
  /// that panel alone. The variant list is empty when the tenant has not set
  /// one.
  @$pb.TagNumber(36)
  $core.String get signInImageUpdatedAt => $_getSZ(33);
  @$pb.TagNumber(36)
  set signInImageUpdatedAt($core.String value) => $_setString(33, value);
  @$pb.TagNumber(36)
  $core.bool hasSignInImageUpdatedAt() => $_has(33);
  @$pb.TagNumber(36)
  void clearSignInImageUpdatedAt() => $_clearField(36);

  @$pb.TagNumber(37)
  $pb.PbList<TenantImageVariant> get signInImageVariants => $_getList(34);
}

/// A page as seen through one of its translations, which supplies the title and
/// the published version.
class Page extends $pb.GeneratedMessage {
  factory Page({
    $core.String? id,
    $core.String? slug,
    $core.String? title,
    $core.String? publishedVersionId,
    $core.String? createdAt,
    $core.String? updatedAt,
    $core.bool? displayInFooter,
    $core.String? locale,
  }) {
    final result = Page._();
    if (id != null) result.id = id;
    if (slug != null) result.slug = slug;
    if (title != null) result.title = title;
    if (publishedVersionId != null)
      result.publishedVersionId = publishedVersionId;
    if (createdAt != null) result.createdAt = createdAt;
    if (updatedAt != null) result.updatedAt = updatedAt;
    if (displayInFooter != null) result.displayInFooter = displayInFooter;
    if (locale != null) result.locale = locale;
    return result;
  }

  Page._();

  factory Page.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Page()..mergeFromBuffer(data, registry);
  factory Page.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Page()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Page',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Page.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'slug')
    ..aOS(3, _omitFieldNames ? '' : 'title')
    ..aOS(4, _omitFieldNames ? '' : 'publishedVersionId')
    ..aOS(5, _omitFieldNames ? '' : 'createdAt')
    ..aOS(6, _omitFieldNames ? '' : 'updatedAt')
    ..aOB(7, _omitFieldNames ? '' : 'displayInFooter')
    ..aOS(8, _omitFieldNames ? '' : 'locale')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Page clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Page copyWith(void Function(Page) updates) =>
      super.copyWith((message) => updates(message as Page)) as Page;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Page() / Page.new instead')
  static Page create() => Page._();
  static $pb.GeneratedMessage $_createMessage() => Page._();
  @$core.override
  Page createEmptyInstance() => Page._();
  @$core.pragma('dart2js:noInline')
  static Page getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Page>(Page.$_createMessage);
  static Page? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get slug => $_getSZ(1);
  @$pb.TagNumber(2)
  set slug($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasSlug() => $_has(1);
  @$pb.TagNumber(2)
  void clearSlug() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get title => $_getSZ(2);
  @$pb.TagNumber(3)
  set title($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearTitle() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get publishedVersionId => $_getSZ(3);
  @$pb.TagNumber(4)
  set publishedVersionId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasPublishedVersionId() => $_has(3);
  @$pb.TagNumber(4)
  void clearPublishedVersionId() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get createdAt => $_getSZ(4);
  @$pb.TagNumber(5)
  set createdAt($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasCreatedAt() => $_has(4);
  @$pb.TagNumber(5)
  void clearCreatedAt() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get updatedAt => $_getSZ(5);
  @$pb.TagNumber(6)
  set updatedAt($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasUpdatedAt() => $_has(5);
  @$pb.TagNumber(6)
  void clearUpdatedAt() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.bool get displayInFooter => $_getBF(6);
  @$pb.TagNumber(7)
  set displayInFooter($core.bool value) => $_setBool(6, value);
  @$pb.TagNumber(7)
  $core.bool hasDisplayInFooter() => $_has(6);
  @$pb.TagNumber(7)
  void clearDisplayInFooter() => $_clearField(7);

  /// The locale of the translation the title and published version come from.
  /// A public read names the one it served, which differs from the one asked
  /// for when the page has no published translation in that locale.
  @$pb.TagNumber(8)
  $core.String get locale => $_getSZ(7);
  @$pb.TagNumber(8)
  set locale($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasLocale() => $_has(7);
  @$pb.TagNumber(8)
  void clearLocale() => $_clearField(8);
}

class PageVersion extends $pb.GeneratedMessage {
  factory PageVersion({
    $core.String? id,
    $core.String? pageId,
    $core.int? versionNumber,
    $core.String? contentMarkdown,
    $core.String? authorUserId,
    $core.String? status,
    $core.String? publishAt,
    $core.String? createdAt,
    $core.String? publishedAt,
    $core.String? agreementRequiredAt,
  }) {
    final result = PageVersion._();
    if (id != null) result.id = id;
    if (pageId != null) result.pageId = pageId;
    if (versionNumber != null) result.versionNumber = versionNumber;
    if (contentMarkdown != null) result.contentMarkdown = contentMarkdown;
    if (authorUserId != null) result.authorUserId = authorUserId;
    if (status != null) result.status = status;
    if (publishAt != null) result.publishAt = publishAt;
    if (createdAt != null) result.createdAt = createdAt;
    if (publishedAt != null) result.publishedAt = publishedAt;
    if (agreementRequiredAt != null)
      result.agreementRequiredAt = agreementRequiredAt;
    return result;
  }

  PageVersion._();

  factory PageVersion.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PageVersion()..mergeFromBuffer(data, registry);
  factory PageVersion.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PageVersion()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PageVersion',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: PageVersion.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'pageId')
    ..aI(3, _omitFieldNames ? '' : 'versionNumber')
    ..aOS(4, _omitFieldNames ? '' : 'contentMarkdown')
    ..aOS(5, _omitFieldNames ? '' : 'authorUserId')
    ..aOS(6, _omitFieldNames ? '' : 'status')
    ..aOS(7, _omitFieldNames ? '' : 'publishAt')
    ..aOS(8, _omitFieldNames ? '' : 'createdAt')
    ..aOS(9, _omitFieldNames ? '' : 'publishedAt')
    ..aOS(10, _omitFieldNames ? '' : 'agreementRequiredAt')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PageVersion clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PageVersion copyWith(void Function(PageVersion) updates) =>
      super.copyWith((message) => updates(message as PageVersion))
          as PageVersion;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PageVersion() / PageVersion.new instead')
  static PageVersion create() => PageVersion._();
  static $pb.GeneratedMessage $_createMessage() => PageVersion._();
  @$core.override
  PageVersion createEmptyInstance() => PageVersion._();
  @$core.pragma('dart2js:noInline')
  static PageVersion getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PageVersion>(
          PageVersion.$_createMessage);
  static PageVersion? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get pageId => $_getSZ(1);
  @$pb.TagNumber(2)
  set pageId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasPageId() => $_has(1);
  @$pb.TagNumber(2)
  void clearPageId() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.int get versionNumber => $_getIZ(2);
  @$pb.TagNumber(3)
  set versionNumber($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasVersionNumber() => $_has(2);
  @$pb.TagNumber(3)
  void clearVersionNumber() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get contentMarkdown => $_getSZ(3);
  @$pb.TagNumber(4)
  set contentMarkdown($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasContentMarkdown() => $_has(3);
  @$pb.TagNumber(4)
  void clearContentMarkdown() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get authorUserId => $_getSZ(4);
  @$pb.TagNumber(5)
  set authorUserId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAuthorUserId() => $_has(4);
  @$pb.TagNumber(5)
  void clearAuthorUserId() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get status => $_getSZ(5);
  @$pb.TagNumber(6)
  set status($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasStatus() => $_has(5);
  @$pb.TagNumber(6)
  void clearStatus() => $_clearField(6);

  @$pb.TagNumber(7)
  $core.String get publishAt => $_getSZ(6);
  @$pb.TagNumber(7)
  set publishAt($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasPublishAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearPublishAt() => $_clearField(7);

  @$pb.TagNumber(8)
  $core.String get createdAt => $_getSZ(7);
  @$pb.TagNumber(8)
  set createdAt($core.String value) => $_setString(7, value);
  @$pb.TagNumber(8)
  $core.bool hasCreatedAt() => $_has(7);
  @$pb.TagNumber(8)
  void clearCreatedAt() => $_clearField(8);

  @$pb.TagNumber(9)
  $core.String get publishedAt => $_getSZ(8);
  @$pb.TagNumber(9)
  set publishedAt($core.String value) => $_setString(8, value);
  @$pb.TagNumber(9)
  $core.bool hasPublishedAt() => $_has(8);
  @$pb.TagNumber(9)
  void clearPublishedAt() => $_clearField(9);

  /// When the last publication of this version asked every reader to agree to
  /// the page again (AdminPagesService.PublishVersion's require_agreement).
  /// Empty where no publication of it did.
  @$pb.TagNumber(10)
  $core.String get agreementRequiredAt => $_getSZ(9);
  @$pb.TagNumber(10)
  set agreementRequiredAt($core.String value) => $_setString(9, value);
  @$pb.TagNumber(10)
  $core.bool hasAgreementRequiredAt() => $_has(9);
  @$pb.TagNumber(10)
  void clearAgreementRequiredAt() => $_clearField(10);
}

/// A volume: a run of a series' episodes sold together, at a price of its own,
/// in one checkout. Buying it opens every episode it holds, which the episode
/// reads then report as EPISODE_ENTITLEMENT_SOURCE_PURCHASE.
class Volume extends $pb.GeneratedMessage {
  factory Volume({
    $core.String? id,
    $core.String? publicId,
    $core.String? title,
    $core.int? orderIndex,
    $core.int? price,
    $core.Iterable<$core.String>? episodeIds,
    $core.String? coverImageUpdatedAt,
    $core.Iterable<SeriesEyeCatchVariant>? coverImageVariants,
  }) {
    final result = Volume._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (title != null) result.title = title;
    if (orderIndex != null) result.orderIndex = orderIndex;
    if (price != null) result.price = price;
    if (episodeIds != null) result.episodeIds.addAll(episodeIds);
    if (coverImageUpdatedAt != null)
      result.coverImageUpdatedAt = coverImageUpdatedAt;
    if (coverImageVariants != null)
      result.coverImageVariants.addAll(coverImageVariants);
    return result;
  }

  Volume._();

  factory Volume.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Volume()..mergeFromBuffer(data, registry);
  factory Volume.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      Volume()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'Volume',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: Volume.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aOS(3, _omitFieldNames ? '' : 'title')
    ..aI(4, _omitFieldNames ? '' : 'orderIndex')
    ..aI(5, _omitFieldNames ? '' : 'price')
    ..pPS(6, _omitFieldNames ? '' : 'episodeIds')
    ..aOS(7, _omitFieldNames ? '' : 'coverImageUpdatedAt')
    ..pPM<SeriesEyeCatchVariant>(8, _omitFieldNames ? '' : 'coverImageVariants',
        subBuilder: SeriesEyeCatchVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Volume clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  Volume copyWith(void Function(Volume) updates) =>
      super.copyWith((message) => updates(message as Volume)) as Volume;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use Volume() / Volume.new instead')
  static Volume create() => Volume._();
  static $pb.GeneratedMessage $_createMessage() => Volume._();
  @$core.override
  Volume createEmptyInstance() => Volume._();
  @$core.pragma('dart2js:noInline')
  static Volume getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<Volume>(Volume.$_createMessage);
  static Volume? _defaultInstance;

  /// The volume's primary key, which StartVolumeCheckout addresses it by.
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

  @$pb.TagNumber(3)
  $core.String get title => $_getSZ(2);
  @$pb.TagNumber(3)
  set title($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasTitle() => $_has(2);
  @$pb.TagNumber(3)
  void clearTitle() => $_clearField(3);

  /// Where the volume stands among its series' volumes, ascending.
  @$pb.TagNumber(4)
  $core.int get orderIndex => $_getIZ(3);
  @$pb.TagNumber(4)
  set orderIndex($core.int value) => $_setSignedInt32(3, value);
  @$pb.TagNumber(4)
  $core.bool hasOrderIndex() => $_has(3);
  @$pb.TagNumber(4)
  void clearOrderIndex() => $_clearField(4);

  /// What the volume costs, in the minor unit of the tenant currency, as
  /// Episode.price is. Never 0: a volume is never free.
  @$pb.TagNumber(5)
  $core.int get price => $_getIZ(4);
  @$pb.TagNumber(5)
  set price($core.int value) => $_setSignedInt32(4, value);
  @$pb.TagNumber(5)
  $core.bool hasPrice() => $_has(4);
  @$pb.TagNumber(5)
  void clearPrice() => $_clearField(5);

  /// The episodes the volume holds, by Episode.id, in the volume's own order.
  /// On a public read, only the episodes that read lists for the calling
  /// surface; a volume none of whose episodes it lists is not in the answer.
  @$pb.TagNumber(6)
  $pb.PbList<$core.String> get episodeIds => $_getList(5);

  /// The cover, stored the way a series eye-catch is. Empty when the volume has
  /// none, and the series' eye-catch stands in for it then.
  @$pb.TagNumber(7)
  $core.String get coverImageUpdatedAt => $_getSZ(6);
  @$pb.TagNumber(7)
  set coverImageUpdatedAt($core.String value) => $_setString(6, value);
  @$pb.TagNumber(7)
  $core.bool hasCoverImageUpdatedAt() => $_has(6);
  @$pb.TagNumber(7)
  void clearCoverImageUpdatedAt() => $_clearField(7);

  @$pb.TagNumber(8)
  $pb.PbList<SeriesEyeCatchVariant> get coverImageVariants => $_getList(7);
}

/// The rest of a series, bought in one StartSeriesRemainderCheckout: every
/// episode the reader could buy and did not hold when the checkout started.
/// Buying it opens each of them, which the episode reads then report as
/// EPISODE_ENTITLEMENT_SOURCE_PURCHASE.
class SeriesBundle extends $pb.GeneratedMessage {
  factory SeriesBundle({
    $core.String? id,
    $core.int? episodeCount,
    $core.int? discountPercent,
  }) {
    final result = SeriesBundle._();
    if (id != null) result.id = id;
    if (episodeCount != null) result.episodeCount = episodeCount;
    if (discountPercent != null) result.discountPercent = discountPercent;
    return result;
  }

  SeriesBundle._();

  factory SeriesBundle.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesBundle()..mergeFromBuffer(data, registry);
  factory SeriesBundle.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      SeriesBundle()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'SeriesBundle',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: SeriesBundle.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aI(2, _omitFieldNames ? '' : 'episodeCount')
    ..aI(3, _omitFieldNames ? '' : 'discountPercent')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesBundle clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  SeriesBundle copyWith(void Function(SeriesBundle) updates) =>
      super.copyWith((message) => updates(message as SeriesBundle))
          as SeriesBundle;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use SeriesBundle() / SeriesBundle.new instead')
  static SeriesBundle create() => SeriesBundle._();
  static $pb.GeneratedMessage $_createMessage() => SeriesBundle._();
  @$core.override
  SeriesBundle createEmptyInstance() => SeriesBundle._();
  @$core.pragma('dart2js:noInline')
  static SeriesBundle getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<SeriesBundle>(
          SeriesBundle.$_createMessage);
  static SeriesBundle? _defaultInstance;

  /// The bundle's primary key, a UUID.
  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  /// How many episodes the checkout sold.
  @$pb.TagNumber(2)
  $core.int get episodeCount => $_getIZ(1);
  @$pb.TagNumber(2)
  set episodeCount($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(2)
  $core.bool hasEpisodeCount() => $_has(1);
  @$pb.TagNumber(2)
  void clearEpisodeCount() => $_clearField(2);

  /// The series' bundle discount the checkout took off, in whole percent; 0
  /// when it took none.
  @$pb.TagNumber(3)
  $core.int get discountPercent => $_getIZ(2);
  @$pb.TagNumber(3)
  set discountPercent($core.int value) => $_setSignedInt32(2, value);
  @$pb.TagNumber(3)
  $core.bool hasDiscountPercent() => $_has(2);
  @$pb.TagNumber(3)
  void clearDiscountPercent() => $_clearField(3);
}

/// A pack of the tenant's coins as a purchase bought it: the coins and the bonus
/// coins the reader was shown when the checkout or the store's payment sheet
/// opened, which are what the purchase granted however the pack has changed
/// since.
class PurchasedCoinPack extends $pb.GeneratedMessage {
  factory PurchasedCoinPack({
    $core.String? id,
    $core.String? publicId,
    $core.int? coins,
    $core.int? bonusCoins,
  }) {
    final result = PurchasedCoinPack._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (coins != null) result.coins = coins;
    if (bonusCoins != null) result.bonusCoins = bonusCoins;
    return result;
  }

  PurchasedCoinPack._();

  factory PurchasedCoinPack.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PurchasedCoinPack()..mergeFromBuffer(data, registry);
  factory PurchasedCoinPack.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PurchasedCoinPack()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PurchasedCoinPack',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: PurchasedCoinPack.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aI(3, _omitFieldNames ? '' : 'coins')
    ..aI(4, _omitFieldNames ? '' : 'bonusCoins')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PurchasedCoinPack clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PurchasedCoinPack copyWith(void Function(PurchasedCoinPack) updates) =>
      super.copyWith((message) => updates(message as PurchasedCoinPack))
          as PurchasedCoinPack;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use PurchasedCoinPack() / PurchasedCoinPack.new instead')
  static PurchasedCoinPack create() => PurchasedCoinPack._();
  static $pb.GeneratedMessage $_createMessage() => PurchasedCoinPack._();
  @$core.override
  PurchasedCoinPack createEmptyInstance() => PurchasedCoinPack._();
  @$core.pragma('dart2js:noInline')
  static PurchasedCoinPack getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<PurchasedCoinPack>(
          PurchasedCoinPack.$_createMessage);
  static PurchasedCoinPack? _defaultInstance;

  /// The pack's primary key, a UUID.
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
}

/// An icon the tenant provides for its readers to pick. A reader's account
/// that shows it carries the same variants in User.icon_image_variants.
class ReaderIconPreset extends $pb.GeneratedMessage {
  factory ReaderIconPreset({
    $core.String? id,
    $core.String? createdAt,
    $core.Iterable<UserIconVariant>? variants,
  }) {
    final result = ReaderIconPreset._();
    if (id != null) result.id = id;
    if (createdAt != null) result.createdAt = createdAt;
    if (variants != null) result.variants.addAll(variants);
    return result;
  }

  ReaderIconPreset._();

  factory ReaderIconPreset.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReaderIconPreset()..mergeFromBuffer(data, registry);
  factory ReaderIconPreset.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReaderIconPreset()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReaderIconPreset',
      package:
          const $pb.PackageName(_omitMessageNames ? '' : 'publira.types.v1'),
      createEmptyInstance: ReaderIconPreset.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'createdAt')
    ..pPM<UserIconVariant>(3, _omitFieldNames ? '' : 'variants',
        subBuilder: UserIconVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReaderIconPreset clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReaderIconPreset copyWith(void Function(ReaderIconPreset) updates) =>
      super.copyWith((message) => updates(message as ReaderIconPreset))
          as ReaderIconPreset;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use ReaderIconPreset() / ReaderIconPreset.new instead')
  static ReaderIconPreset create() => ReaderIconPreset._();
  static $pb.GeneratedMessage $_createMessage() => ReaderIconPreset._();
  @$core.override
  ReaderIconPreset createEmptyInstance() => ReaderIconPreset._();
  @$core.pragma('dart2js:noInline')
  static ReaderIconPreset getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<ReaderIconPreset>(
          ReaderIconPreset.$_createMessage);
  static ReaderIconPreset? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get id => $_getSZ(0);
  @$pb.TagNumber(1)
  set id($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasId() => $_has(0);
  @$pb.TagNumber(1)
  void clearId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get createdAt => $_getSZ(1);
  @$pb.TagNumber(2)
  set createdAt($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasCreatedAt() => $_has(1);
  @$pb.TagNumber(2)
  void clearCreatedAt() => $_clearField(2);

  /// The stored renditions, largest first.
  @$pb.TagNumber(3)
  $pb.PbList<UserIconVariant> get variants => $_getList(2);
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
