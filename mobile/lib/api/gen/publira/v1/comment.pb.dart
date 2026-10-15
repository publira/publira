// This is a generated file - do not edit.
//
// Generated from publira/v1/comment.proto.

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
import 'comment.pbenum.dart';

export 'package:protobuf/protobuf.dart' show GeneratedMessageGenericExtensions;

export 'comment.pbenum.dart';

/// The credit a comment's author holds on the episode the comment is on.
///
/// A storefront shows the comment under this name rather than the account's:
/// a reader recognises the name the work is credited to, and a mark beside a
/// name they do not know identifies nobody. The id lets the mark link to the
/// creator.
///
/// It is decided per episode. The same account commenting on a work that does
/// not credit it carries none. An account whose creators hold several credits
/// on the episode is named by the one that leads its credit line.
class EpisodeCommentCreator extends $pb.GeneratedMessage {
  factory EpisodeCommentCreator({
    $core.String? id,
    $core.String? publicId,
    $core.String? name,
  }) {
    final result = EpisodeCommentCreator._();
    if (id != null) result.id = id;
    if (publicId != null) result.publicId = publicId;
    if (name != null) result.name = name;
    return result;
  }

  EpisodeCommentCreator._();

  factory EpisodeCommentCreator.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeCommentCreator()..mergeFromBuffer(data, registry);
  factory EpisodeCommentCreator.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeCommentCreator()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EpisodeCommentCreator',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: EpisodeCommentCreator.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'id')
    ..aOS(2, _omitFieldNames ? '' : 'publicId')
    ..aOS(3, _omitFieldNames ? '' : 'name')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeCommentCreator clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeCommentCreator copyWith(
          void Function(EpisodeCommentCreator) updates) =>
      super.copyWith((message) => updates(message as EpisodeCommentCreator))
          as EpisodeCommentCreator;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use EpisodeCommentCreator() / EpisodeCommentCreator.new instead')
  static EpisodeCommentCreator create() => EpisodeCommentCreator._();
  static $pb.GeneratedMessage $_createMessage() => EpisodeCommentCreator._();
  @$core.override
  EpisodeCommentCreator createEmptyInstance() => EpisodeCommentCreator._();
  @$core.pragma('dart2js:noInline')
  static EpisodeCommentCreator getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<EpisodeCommentCreator>(
          EpisodeCommentCreator.$_createMessage);
  static EpisodeCommentCreator? _defaultInstance;

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
  $core.String get name => $_getSZ(2);
  @$pb.TagNumber(3)
  set name($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasName() => $_has(2);
  @$pb.TagNumber(3)
  void clearName() => $_clearField(3);
}

/// One reader comment on an episode, as every visitor of that episode sees it.
///
/// The author is named by the identifiers a storefront may show next to the
/// text. There is no status field: a comment reaches this message only while it
/// is published, so a reader never learns that another one exists in any other
/// state.
class EpisodeComment extends $pb.GeneratedMessage {
  factory EpisodeComment({
    $core.String? publicId,
    $core.String? body,
    $core.String? createdAt,
    $core.String? authorPublicId,
    $core.String? authorName,
    $core.String? id,
    EpisodeCommentCreator? creator,
    $core.Iterable<$0.UserIconVariant>? authorIconImageVariants,
  }) {
    final result = EpisodeComment._();
    if (publicId != null) result.publicId = publicId;
    if (body != null) result.body = body;
    if (createdAt != null) result.createdAt = createdAt;
    if (authorPublicId != null) result.authorPublicId = authorPublicId;
    if (authorName != null) result.authorName = authorName;
    if (id != null) result.id = id;
    if (creator != null) result.creator = creator;
    if (authorIconImageVariants != null)
      result.authorIconImageVariants.addAll(authorIconImageVariants);
    return result;
  }

  EpisodeComment._();

  factory EpisodeComment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeComment()..mergeFromBuffer(data, registry);
  factory EpisodeComment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      EpisodeComment()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'EpisodeComment',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: EpisodeComment.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'body')
    ..aOS(3, _omitFieldNames ? '' : 'createdAt')
    ..aOS(4, _omitFieldNames ? '' : 'authorPublicId')
    ..aOS(5, _omitFieldNames ? '' : 'authorName')
    ..aOS(6, _omitFieldNames ? '' : 'id')
    ..aOM<EpisodeCommentCreator>(7, _omitFieldNames ? '' : 'creator',
        subBuilder: EpisodeCommentCreator.$_createMessage)
    ..pPM<$0.UserIconVariant>(
        8, _omitFieldNames ? '' : 'authorIconImageVariants',
        subBuilder: $0.UserIconVariant.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeComment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  EpisodeComment copyWith(void Function(EpisodeComment) updates) =>
      super.copyWith((message) => updates(message as EpisodeComment))
          as EpisodeComment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use EpisodeComment() / EpisodeComment.new instead')
  static EpisodeComment create() => EpisodeComment._();
  static $pb.GeneratedMessage $_createMessage() => EpisodeComment._();
  @$core.override
  EpisodeComment createEmptyInstance() => EpisodeComment._();
  @$core.pragma('dart2js:noInline')
  static EpisodeComment getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<EpisodeComment>(
          EpisodeComment.$_createMessage);
  static EpisodeComment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get body => $_getSZ(1);
  @$pb.TagNumber(2)
  set body($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBody() => $_has(1);
  @$pb.TagNumber(2)
  void clearBody() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get createdAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set createdAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);

  @$pb.TagNumber(4)
  $core.String get authorPublicId => $_getSZ(3);
  @$pb.TagNumber(4)
  set authorPublicId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAuthorPublicId() => $_has(3);
  @$pb.TagNumber(4)
  void clearAuthorPublicId() => $_clearField(4);

  /// The author's display name, as stored on their account.
  @$pb.TagNumber(5)
  $core.String get authorName => $_getSZ(4);
  @$pb.TagNumber(5)
  set authorName($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasAuthorName() => $_has(4);
  @$pb.TagNumber(5)
  void clearAuthorName() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get id => $_getSZ(5);
  @$pb.TagNumber(6)
  set id($core.String value) => $_setString(5, value);
  @$pb.TagNumber(6)
  $core.bool hasId() => $_has(5);
  @$pb.TagNumber(6)
  void clearId() => $_clearField(6);

  /// Set when the author is a creator this episode credits, and unset for
  /// every other comment.
  @$pb.TagNumber(7)
  EpisodeCommentCreator get creator => $_getN(6);
  @$pb.TagNumber(7)
  set creator(EpisodeCommentCreator value) => $_setField(7, value);
  @$pb.TagNumber(7)
  $core.bool hasCreator() => $_has(6);
  @$pb.TagNumber(7)
  void clearCreator() => $_clearField(7);
  @$pb.TagNumber(7)
  EpisodeCommentCreator ensureCreator() => $_ensure(6);

  /// The author's icon as their account shows it now, and empty for an account
  /// that shows none.
  @$pb.TagNumber(8)
  $pb.PbList<$0.UserIconVariant> get authorIconImageVariants => $_getList(7);
}

/// One of the caller's own comments that ListEpisodeComments cannot carry.
///
/// It has the same fields a published comment is rendered from, minus the author
/// the caller already is, so the site renders it in place among the public ones.
class MyEpisodeComment extends $pb.GeneratedMessage {
  factory MyEpisodeComment({
    $core.String? publicId,
    $core.String? body,
    $core.String? createdAt,
    $core.bool? awaitingApproval,
    $core.String? id,
    EpisodeCommentCreator? creator,
  }) {
    final result = MyEpisodeComment._();
    if (publicId != null) result.publicId = publicId;
    if (body != null) result.body = body;
    if (createdAt != null) result.createdAt = createdAt;
    if (awaitingApproval != null) result.awaitingApproval = awaitingApproval;
    if (id != null) result.id = id;
    if (creator != null) result.creator = creator;
    return result;
  }

  MyEpisodeComment._();

  factory MyEpisodeComment.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyEpisodeComment()..mergeFromBuffer(data, registry);
  factory MyEpisodeComment.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      MyEpisodeComment()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'MyEpisodeComment',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: MyEpisodeComment.$_createMessage)
    ..aOS(1, _omitFieldNames ? '' : 'publicId')
    ..aOS(2, _omitFieldNames ? '' : 'body')
    ..aOS(3, _omitFieldNames ? '' : 'createdAt')
    ..aOB(4, _omitFieldNames ? '' : 'awaitingApproval')
    ..aOS(5, _omitFieldNames ? '' : 'id')
    ..aOM<EpisodeCommentCreator>(6, _omitFieldNames ? '' : 'creator',
        subBuilder: EpisodeCommentCreator.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyEpisodeComment clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  MyEpisodeComment copyWith(void Function(MyEpisodeComment) updates) =>
      super.copyWith((message) => updates(message as MyEpisodeComment))
          as MyEpisodeComment;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated('Use MyEpisodeComment() / MyEpisodeComment.new instead')
  static MyEpisodeComment create() => MyEpisodeComment._();
  static $pb.GeneratedMessage $_createMessage() => MyEpisodeComment._();
  @$core.override
  MyEpisodeComment createEmptyInstance() => MyEpisodeComment._();
  @$core.pragma('dart2js:noInline')
  static MyEpisodeComment getDefault() =>
      _defaultInstance ??= $pb.GeneratedMessage.$_defaultFor<MyEpisodeComment>(
          MyEpisodeComment.$_createMessage);
  static MyEpisodeComment? _defaultInstance;

  @$pb.TagNumber(1)
  $core.String get publicId => $_getSZ(0);
  @$pb.TagNumber(1)
  set publicId($core.String value) => $_setString(0, value);
  @$pb.TagNumber(1)
  $core.bool hasPublicId() => $_has(0);
  @$pb.TagNumber(1)
  void clearPublicId() => $_clearField(1);

  @$pb.TagNumber(2)
  $core.String get body => $_getSZ(1);
  @$pb.TagNumber(2)
  set body($core.String value) => $_setString(1, value);
  @$pb.TagNumber(2)
  $core.bool hasBody() => $_has(1);
  @$pb.TagNumber(2)
  void clearBody() => $_clearField(2);

  @$pb.TagNumber(3)
  $core.String get createdAt => $_getSZ(2);
  @$pb.TagNumber(3)
  set createdAt($core.String value) => $_setString(2, value);
  @$pb.TagNumber(3)
  $core.bool hasCreatedAt() => $_has(2);
  @$pb.TagNumber(3)
  void clearCreatedAt() => $_clearField(3);

  /// True while the comment is still waiting for staff approval, which is what
  /// the site tells the author about a comment nobody else can read yet.
  ///
  /// It stays true for a comment removed before it was ever approved, and false
  /// for one removed after it was published, because it reports the state the
  /// comment would return to. Removal is silent by design: nothing in this
  /// message changes when staff remove a comment.
  @$pb.TagNumber(4)
  $core.bool get awaitingApproval => $_getBF(3);
  @$pb.TagNumber(4)
  set awaitingApproval($core.bool value) => $_setBool(3, value);
  @$pb.TagNumber(4)
  $core.bool hasAwaitingApproval() => $_has(3);
  @$pb.TagNumber(4)
  void clearAwaitingApproval() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get id => $_getSZ(4);
  @$pb.TagNumber(5)
  set id($core.String value) => $_setString(4, value);
  @$pb.TagNumber(5)
  $core.bool hasId() => $_has(4);
  @$pb.TagNumber(5)
  void clearId() => $_clearField(5);

  /// The same mark EpisodeComment carries, so the caller's own comment reads
  /// the same before it is published as after.
  @$pb.TagNumber(6)
  EpisodeCommentCreator get creator => $_getN(5);
  @$pb.TagNumber(6)
  set creator(EpisodeCommentCreator value) => $_setField(6, value);
  @$pb.TagNumber(6)
  $core.bool hasCreator() => $_has(5);
  @$pb.TagNumber(6)
  void clearCreator() => $_clearField(6);
  @$pb.TagNumber(6)
  EpisodeCommentCreator ensureCreator() => $_ensure(5);
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListEpisodeCommentsRequest extends $pb.GeneratedMessage {
  factory ListEpisodeCommentsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = ListEpisodeCommentsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  ListEpisodeCommentsRequest._();

  factory ListEpisodeCommentsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListEpisodeCommentsRequest()..mergeFromBuffer(data, registry);
  factory ListEpisodeCommentsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListEpisodeCommentsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListEpisodeCommentsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListEpisodeCommentsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListEpisodeCommentsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListEpisodeCommentsRequest copyWith(
          void Function(ListEpisodeCommentsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListEpisodeCommentsRequest))
          as ListEpisodeCommentsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListEpisodeCommentsRequest() / ListEpisodeCommentsRequest.new instead')
  static ListEpisodeCommentsRequest create() => ListEpisodeCommentsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListEpisodeCommentsRequest._();
  @$core.override
  ListEpisodeCommentsRequest createEmptyInstance() =>
      ListEpisodeCommentsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListEpisodeCommentsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListEpisodeCommentsRequest>(
          ListEpisodeCommentsRequest.$_createMessage);
  static ListEpisodeCommentsRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get episodeId => $_getSZ(4);
  @$pb.TagNumber(6)
  set episodeId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(6)
  $core.bool hasEpisodeId() => $_has(4);
  @$pb.TagNumber(6)
  void clearEpisodeId() => $_clearField(6);
}

class ListEpisodeCommentsResponse extends $pb.GeneratedMessage {
  factory ListEpisodeCommentsResponse({
    $core.Iterable<EpisodeComment>? comments,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListEpisodeCommentsResponse._();
    if (comments != null) result.comments.addAll(comments);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListEpisodeCommentsResponse._();

  factory ListEpisodeCommentsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListEpisodeCommentsResponse()..mergeFromBuffer(data, registry);
  factory ListEpisodeCommentsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListEpisodeCommentsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListEpisodeCommentsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListEpisodeCommentsResponse.$_createMessage)
    ..pPM<EpisodeComment>(1, _omitFieldNames ? '' : 'comments',
        subBuilder: EpisodeComment.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListEpisodeCommentsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListEpisodeCommentsResponse copyWith(
          void Function(ListEpisodeCommentsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListEpisodeCommentsResponse))
          as ListEpisodeCommentsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListEpisodeCommentsResponse() / ListEpisodeCommentsResponse.new instead')
  static ListEpisodeCommentsResponse create() =>
      ListEpisodeCommentsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListEpisodeCommentsResponse._();
  @$core.override
  ListEpisodeCommentsResponse createEmptyInstance() =>
      ListEpisodeCommentsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListEpisodeCommentsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListEpisodeCommentsResponse>(
          ListEpisodeCommentsResponse.$_createMessage);
  static ListEpisodeCommentsResponse? _defaultInstance;

  /// Newest first.
  @$pb.TagNumber(1)
  $pb.PbList<EpisodeComment> get comments => $_getList(0);

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
}

/// Cursor pagination. Field shape and token rules: proto/README.md.
class ListMyEpisodeCommentsRequest extends $pb.GeneratedMessage {
  factory ListMyEpisodeCommentsRequest({
    $0.TenantContext? tenant,
    $core.int? limit,
    $core.String? token,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = ListMyEpisodeCommentsRequest._();
    if (tenant != null) result.tenant = tenant;
    if (limit != null) result.limit = limit;
    if (token != null) result.token = token;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  ListMyEpisodeCommentsRequest._();

  factory ListMyEpisodeCommentsRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeCommentsRequest()..mergeFromBuffer(data, registry);
  factory ListMyEpisodeCommentsRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeCommentsRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyEpisodeCommentsRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyEpisodeCommentsRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aI(3, _omitFieldNames ? '' : 'limit')
    ..aOS(4, _omitFieldNames ? '' : 'token')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeCommentsRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeCommentsRequest copyWith(
          void Function(ListMyEpisodeCommentsRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyEpisodeCommentsRequest))
          as ListMyEpisodeCommentsRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyEpisodeCommentsRequest() / ListMyEpisodeCommentsRequest.new instead')
  static ListMyEpisodeCommentsRequest create() =>
      ListMyEpisodeCommentsRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyEpisodeCommentsRequest._();
  @$core.override
  ListMyEpisodeCommentsRequest createEmptyInstance() =>
      ListMyEpisodeCommentsRequest._();
  @$core.pragma('dart2js:noInline')
  static ListMyEpisodeCommentsRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyEpisodeCommentsRequest>(
          ListMyEpisodeCommentsRequest.$_createMessage);
  static ListMyEpisodeCommentsRequest? _defaultInstance;

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
  @$pb.TagNumber(3)
  $core.int get limit => $_getIZ(1);
  @$pb.TagNumber(3)
  set limit($core.int value) => $_setSignedInt32(1, value);
  @$pb.TagNumber(3)
  $core.bool hasLimit() => $_has(1);
  @$pb.TagNumber(3)
  void clearLimit() => $_clearField(3);

  /// Opaque token from a previous response. Empty for the first page.
  @$pb.TagNumber(4)
  $core.String get token => $_getSZ(2);
  @$pb.TagNumber(4)
  set token($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasToken() => $_has(2);
  @$pb.TagNumber(4)
  void clearToken() => $_clearField(4);

  /// The client making the read. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get episodeId => $_getSZ(4);
  @$pb.TagNumber(6)
  set episodeId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(6)
  $core.bool hasEpisodeId() => $_has(4);
  @$pb.TagNumber(6)
  void clearEpisodeId() => $_clearField(6);
}

class ListMyEpisodeCommentsResponse extends $pb.GeneratedMessage {
  factory ListMyEpisodeCommentsResponse({
    $core.Iterable<MyEpisodeComment>? comments,
    $core.String? previousToken,
    $core.String? nextToken,
  }) {
    final result = ListMyEpisodeCommentsResponse._();
    if (comments != null) result.comments.addAll(comments);
    if (previousToken != null) result.previousToken = previousToken;
    if (nextToken != null) result.nextToken = nextToken;
    return result;
  }

  ListMyEpisodeCommentsResponse._();

  factory ListMyEpisodeCommentsResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeCommentsResponse()..mergeFromBuffer(data, registry);
  factory ListMyEpisodeCommentsResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ListMyEpisodeCommentsResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ListMyEpisodeCommentsResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ListMyEpisodeCommentsResponse.$_createMessage)
    ..pPM<MyEpisodeComment>(1, _omitFieldNames ? '' : 'comments',
        subBuilder: MyEpisodeComment.$_createMessage)
    ..aOS(2, _omitFieldNames ? '' : 'previousToken')
    ..aOS(3, _omitFieldNames ? '' : 'nextToken')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeCommentsResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ListMyEpisodeCommentsResponse copyWith(
          void Function(ListMyEpisodeCommentsResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ListMyEpisodeCommentsResponse))
          as ListMyEpisodeCommentsResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ListMyEpisodeCommentsResponse() / ListMyEpisodeCommentsResponse.new instead')
  static ListMyEpisodeCommentsResponse create() =>
      ListMyEpisodeCommentsResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ListMyEpisodeCommentsResponse._();
  @$core.override
  ListMyEpisodeCommentsResponse createEmptyInstance() =>
      ListMyEpisodeCommentsResponse._();
  @$core.pragma('dart2js:noInline')
  static ListMyEpisodeCommentsResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ListMyEpisodeCommentsResponse>(
          ListMyEpisodeCommentsResponse.$_createMessage);
  static ListMyEpisodeCommentsResponse? _defaultInstance;

  /// Newest first.
  @$pb.TagNumber(1)
  $pb.PbList<MyEpisodeComment> get comments => $_getList(0);

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
}

class PostEpisodeCommentRequest extends $pb.GeneratedMessage {
  factory PostEpisodeCommentRequest({
    $0.TenantContext? tenant,
    $core.String? body,
    $0.ClientSurface? surface,
    $core.String? episodeId,
  }) {
    final result = PostEpisodeCommentRequest._();
    if (tenant != null) result.tenant = tenant;
    if (body != null) result.body = body;
    if (surface != null) result.surface = surface;
    if (episodeId != null) result.episodeId = episodeId;
    return result;
  }

  PostEpisodeCommentRequest._();

  factory PostEpisodeCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PostEpisodeCommentRequest()..mergeFromBuffer(data, registry);
  factory PostEpisodeCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PostEpisodeCommentRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostEpisodeCommentRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PostEpisodeCommentRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'body')
    ..aE<$0.ClientSurface>(4, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(5, _omitFieldNames ? '' : 'episodeId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostEpisodeCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostEpisodeCommentRequest copyWith(
          void Function(PostEpisodeCommentRequest) updates) =>
      super.copyWith((message) => updates(message as PostEpisodeCommentRequest))
          as PostEpisodeCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use PostEpisodeCommentRequest() / PostEpisodeCommentRequest.new instead')
  static PostEpisodeCommentRequest create() => PostEpisodeCommentRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      PostEpisodeCommentRequest._();
  @$core.override
  PostEpisodeCommentRequest createEmptyInstance() =>
      PostEpisodeCommentRequest._();
  @$core.pragma('dart2js:noInline')
  static PostEpisodeCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostEpisodeCommentRequest>(
          PostEpisodeCommentRequest.$_createMessage);
  static PostEpisodeCommentRequest? _defaultInstance;

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

  /// Non-blank after trimming and at most 1000 Unicode code points. Anything
  /// else is invalid_argument.
  @$pb.TagNumber(3)
  $core.String get body => $_getSZ(1);
  @$pb.TagNumber(3)
  set body($core.String value) => $_setString(1, value);
  @$pb.TagNumber(3)
  $core.bool hasBody() => $_has(1);
  @$pb.TagNumber(3)
  void clearBody() => $_clearField(3);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(4)
  $0.ClientSurface get surface => $_getN(2);
  @$pb.TagNumber(4)
  set surface($0.ClientSurface value) => $_setField(4, value);
  @$pb.TagNumber(4)
  $core.bool hasSurface() => $_has(2);
  @$pb.TagNumber(4)
  void clearSurface() => $_clearField(4);

  @$pb.TagNumber(5)
  $core.String get episodeId => $_getSZ(3);
  @$pb.TagNumber(5)
  set episodeId($core.String value) => $_setString(3, value);
  @$pb.TagNumber(5)
  $core.bool hasEpisodeId() => $_has(3);
  @$pb.TagNumber(5)
  void clearEpisodeId() => $_clearField(5);
}

class PostEpisodeCommentResponse extends $pb.GeneratedMessage {
  factory PostEpisodeCommentResponse({
    MyEpisodeComment? comment,
  }) {
    final result = PostEpisodeCommentResponse._();
    if (comment != null) result.comment = comment;
    return result;
  }

  PostEpisodeCommentResponse._();

  factory PostEpisodeCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PostEpisodeCommentResponse()..mergeFromBuffer(data, registry);
  factory PostEpisodeCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      PostEpisodeCommentResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'PostEpisodeCommentResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: PostEpisodeCommentResponse.$_createMessage)
    ..aOM<MyEpisodeComment>(1, _omitFieldNames ? '' : 'comment',
        subBuilder: MyEpisodeComment.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostEpisodeCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  PostEpisodeCommentResponse copyWith(
          void Function(PostEpisodeCommentResponse) updates) =>
      super.copyWith(
              (message) => updates(message as PostEpisodeCommentResponse))
          as PostEpisodeCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use PostEpisodeCommentResponse() / PostEpisodeCommentResponse.new instead')
  static PostEpisodeCommentResponse create() => PostEpisodeCommentResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      PostEpisodeCommentResponse._();
  @$core.override
  PostEpisodeCommentResponse createEmptyInstance() =>
      PostEpisodeCommentResponse._();
  @$core.pragma('dart2js:noInline')
  static PostEpisodeCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<PostEpisodeCommentResponse>(
          PostEpisodeCommentResponse.$_createMessage);
  static PostEpisodeCommentResponse? _defaultInstance;

  /// The stored comment. Its awaiting_approval is what tells the author whether
  /// anyone else can read it yet.
  @$pb.TagNumber(1)
  MyEpisodeComment get comment => $_getN(0);
  @$pb.TagNumber(1)
  set comment(MyEpisodeComment value) => $_setField(1, value);
  @$pb.TagNumber(1)
  $core.bool hasComment() => $_has(0);
  @$pb.TagNumber(1)
  void clearComment() => $_clearField(1);
  @$pb.TagNumber(1)
  MyEpisodeComment ensureComment() => $_ensure(0);
}

class WithdrawEpisodeCommentRequest extends $pb.GeneratedMessage {
  factory WithdrawEpisodeCommentRequest({
    $0.TenantContext? tenant,
    $core.String? commentId,
  }) {
    final result = WithdrawEpisodeCommentRequest._();
    if (tenant != null) result.tenant = tenant;
    if (commentId != null) result.commentId = commentId;
    return result;
  }

  WithdrawEpisodeCommentRequest._();

  factory WithdrawEpisodeCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WithdrawEpisodeCommentRequest()..mergeFromBuffer(data, registry);
  factory WithdrawEpisodeCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WithdrawEpisodeCommentRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WithdrawEpisodeCommentRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: WithdrawEpisodeCommentRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aOS(3, _omitFieldNames ? '' : 'commentId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WithdrawEpisodeCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WithdrawEpisodeCommentRequest copyWith(
          void Function(WithdrawEpisodeCommentRequest) updates) =>
      super.copyWith(
              (message) => updates(message as WithdrawEpisodeCommentRequest))
          as WithdrawEpisodeCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use WithdrawEpisodeCommentRequest() / WithdrawEpisodeCommentRequest.new instead')
  static WithdrawEpisodeCommentRequest create() =>
      WithdrawEpisodeCommentRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      WithdrawEpisodeCommentRequest._();
  @$core.override
  WithdrawEpisodeCommentRequest createEmptyInstance() =>
      WithdrawEpisodeCommentRequest._();
  @$core.pragma('dart2js:noInline')
  static WithdrawEpisodeCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<WithdrawEpisodeCommentRequest>(
          WithdrawEpisodeCommentRequest.$_createMessage);
  static WithdrawEpisodeCommentRequest? _defaultInstance;

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

  @$pb.TagNumber(3)
  $core.String get commentId => $_getSZ(1);
  @$pb.TagNumber(3)
  set commentId($core.String value) => $_setString(1, value);
  @$pb.TagNumber(3)
  $core.bool hasCommentId() => $_has(1);
  @$pb.TagNumber(3)
  void clearCommentId() => $_clearField(3);
}

/// Deliberately empty. A withdrawn comment is gone from every reader-facing
/// response, so there is nothing left to return about it.
class WithdrawEpisodeCommentResponse extends $pb.GeneratedMessage {
  factory WithdrawEpisodeCommentResponse() =>
      WithdrawEpisodeCommentResponse._();

  WithdrawEpisodeCommentResponse._();

  factory WithdrawEpisodeCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WithdrawEpisodeCommentResponse()..mergeFromBuffer(data, registry);
  factory WithdrawEpisodeCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      WithdrawEpisodeCommentResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'WithdrawEpisodeCommentResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: WithdrawEpisodeCommentResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WithdrawEpisodeCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  WithdrawEpisodeCommentResponse copyWith(
          void Function(WithdrawEpisodeCommentResponse) updates) =>
      super.copyWith(
              (message) => updates(message as WithdrawEpisodeCommentResponse))
          as WithdrawEpisodeCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use WithdrawEpisodeCommentResponse() / WithdrawEpisodeCommentResponse.new instead')
  static WithdrawEpisodeCommentResponse create() =>
      WithdrawEpisodeCommentResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      WithdrawEpisodeCommentResponse._();
  @$core.override
  WithdrawEpisodeCommentResponse createEmptyInstance() =>
      WithdrawEpisodeCommentResponse._();
  @$core.pragma('dart2js:noInline')
  static WithdrawEpisodeCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<WithdrawEpisodeCommentResponse>(
          WithdrawEpisodeCommentResponse.$_createMessage);
  static WithdrawEpisodeCommentResponse? _defaultInstance;
}

class ReportEpisodeCommentRequest extends $pb.GeneratedMessage {
  factory ReportEpisodeCommentRequest({
    $0.TenantContext? tenant,
    CommentReportReason? reason,
    $core.String? note,
    $0.ClientSurface? surface,
    $core.String? commentId,
  }) {
    final result = ReportEpisodeCommentRequest._();
    if (tenant != null) result.tenant = tenant;
    if (reason != null) result.reason = reason;
    if (note != null) result.note = note;
    if (surface != null) result.surface = surface;
    if (commentId != null) result.commentId = commentId;
    return result;
  }

  ReportEpisodeCommentRequest._();

  factory ReportEpisodeCommentRequest.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReportEpisodeCommentRequest()..mergeFromBuffer(data, registry);
  factory ReportEpisodeCommentRequest.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReportEpisodeCommentRequest()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReportEpisodeCommentRequest',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ReportEpisodeCommentRequest.$_createMessage)
    ..aOM<$0.TenantContext>(1, _omitFieldNames ? '' : 'tenant',
        subBuilder: $0.TenantContext.$_createMessage)
    ..aE<CommentReportReason>(3, _omitFieldNames ? '' : 'reason',
        enumValues: CommentReportReason.values)
    ..aOS(4, _omitFieldNames ? '' : 'note')
    ..aE<$0.ClientSurface>(5, _omitFieldNames ? '' : 'surface',
        enumValues: $0.ClientSurface.values)
    ..aOS(6, _omitFieldNames ? '' : 'commentId')
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReportEpisodeCommentRequest clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReportEpisodeCommentRequest copyWith(
          void Function(ReportEpisodeCommentRequest) updates) =>
      super.copyWith(
              (message) => updates(message as ReportEpisodeCommentRequest))
          as ReportEpisodeCommentRequest;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ReportEpisodeCommentRequest() / ReportEpisodeCommentRequest.new instead')
  static ReportEpisodeCommentRequest create() =>
      ReportEpisodeCommentRequest._();
  static $pb.GeneratedMessage $_createMessage() =>
      ReportEpisodeCommentRequest._();
  @$core.override
  ReportEpisodeCommentRequest createEmptyInstance() =>
      ReportEpisodeCommentRequest._();
  @$core.pragma('dart2js:noInline')
  static ReportEpisodeCommentRequest getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReportEpisodeCommentRequest>(
          ReportEpisodeCommentRequest.$_createMessage);
  static ReportEpisodeCommentRequest? _defaultInstance;

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

  /// Required. UNSPECIFIED is invalid_argument: a report with no reason on it
  /// cannot be worked from.
  @$pb.TagNumber(3)
  CommentReportReason get reason => $_getN(1);
  @$pb.TagNumber(3)
  set reason(CommentReportReason value) => $_setField(3, value);
  @$pb.TagNumber(3)
  $core.bool hasReason() => $_has(1);
  @$pb.TagNumber(3)
  void clearReason() => $_clearField(3);

  /// Optional. At most 1000 Unicode code points once trimmed; a blank note is
  /// stored as no note at all.
  @$pb.TagNumber(4)
  $core.String get note => $_getSZ(2);
  @$pb.TagNumber(4)
  set note($core.String value) => $_setString(2, value);
  @$pb.TagNumber(4)
  $core.bool hasNote() => $_has(2);
  @$pb.TagNumber(4)
  void clearNote() => $_clearField(4);

  /// The client making the call. Unspecified is answered as the web storefront.
  @$pb.TagNumber(5)
  $0.ClientSurface get surface => $_getN(3);
  @$pb.TagNumber(5)
  set surface($0.ClientSurface value) => $_setField(5, value);
  @$pb.TagNumber(5)
  $core.bool hasSurface() => $_has(3);
  @$pb.TagNumber(5)
  void clearSurface() => $_clearField(5);

  @$pb.TagNumber(6)
  $core.String get commentId => $_getSZ(4);
  @$pb.TagNumber(6)
  set commentId($core.String value) => $_setString(4, value);
  @$pb.TagNumber(6)
  $core.bool hasCommentId() => $_has(4);
  @$pb.TagNumber(6)
  void clearCommentId() => $_clearField(6);
}

/// Deliberately empty. The reporter is told that their report was accepted and
/// nothing else: what a comment's report count is, and whether the threshold
/// moved it, would tell one reader what other readers have done about it.
class ReportEpisodeCommentResponse extends $pb.GeneratedMessage {
  factory ReportEpisodeCommentResponse() => ReportEpisodeCommentResponse._();

  ReportEpisodeCommentResponse._();

  factory ReportEpisodeCommentResponse.fromBuffer($core.List<$core.int> data,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReportEpisodeCommentResponse()..mergeFromBuffer(data, registry);
  factory ReportEpisodeCommentResponse.fromJson($core.String json,
          [$pb.ExtensionRegistry registry = $pb.ExtensionRegistry.EMPTY]) =>
      ReportEpisodeCommentResponse()..mergeFromJson(json, registry);

  static final $pb.BuilderInfo _i = $pb.BuilderInfo(
      _omitMessageNames ? '' : 'ReportEpisodeCommentResponse',
      package: const $pb.PackageName(_omitMessageNames ? '' : 'publira.v1'),
      createEmptyInstance: ReportEpisodeCommentResponse.$_createMessage)
    ..hasRequiredFields = false;

  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReportEpisodeCommentResponse clone() => deepCopy();
  @$core.Deprecated('See https://github.com/google/protobuf.dart/issues/998.')
  ReportEpisodeCommentResponse copyWith(
          void Function(ReportEpisodeCommentResponse) updates) =>
      super.copyWith(
              (message) => updates(message as ReportEpisodeCommentResponse))
          as ReportEpisodeCommentResponse;

  @$core.override
  $pb.BuilderInfo get info_ => _i;

  @$core.pragma('dart2js:noInline')
  @$core.Deprecated(
      'Use ReportEpisodeCommentResponse() / ReportEpisodeCommentResponse.new instead')
  static ReportEpisodeCommentResponse create() =>
      ReportEpisodeCommentResponse._();
  static $pb.GeneratedMessage $_createMessage() =>
      ReportEpisodeCommentResponse._();
  @$core.override
  ReportEpisodeCommentResponse createEmptyInstance() =>
      ReportEpisodeCommentResponse._();
  @$core.pragma('dart2js:noInline')
  static ReportEpisodeCommentResponse getDefault() => _defaultInstance ??=
      $pb.GeneratedMessage.$_defaultFor<ReportEpisodeCommentResponse>(
          ReportEpisodeCommentResponse.$_createMessage);
  static ReportEpisodeCommentResponse? _defaultInstance;
}

class CommentServiceApi {
  final $pb.RpcClient _client;

  CommentServiceApi(this._client);

  /// Lists the published comments on a currently public episode, newest first.
  ///
  /// Public: it takes no session, and its result is the same for every reader,
  /// which is what lets a storefront cache it. Every comment in another state
  /// reaches its author through ListMyEpisodeComments instead, so no reader's
  /// pending or removed comment can leak into a shared cache entry.
  $async.Future<ListEpisodeCommentsResponse> listEpisodeComments(
          $pb.ClientContext? ctx, ListEpisodeCommentsRequest request) =>
      _client.invoke<ListEpisodeCommentsResponse>(ctx, 'CommentService',
          'ListEpisodeComments', request, ListEpisodeCommentsResponse());

  /// Lists the caller's own comments on one episode that the public list omits,
  /// newest first.
  ///
  /// Session required. A comment staff removed is returned exactly as it was
  /// before the removal, because the author is never told about it.
  $async.Future<ListMyEpisodeCommentsResponse> listMyEpisodeComments(
          $pb.ClientContext? ctx, ListMyEpisodeCommentsRequest request) =>
      _client.invoke<ListMyEpisodeCommentsResponse>(ctx, 'CommentService',
          'ListMyEpisodeComments', request, ListMyEpisodeCommentsResponse());

  /// Posts one comment on a currently public episode as the authenticated
  /// reader.
  ///
  /// The tenant's comment mode decides the outcome: failed_precondition while
  /// commenting is disabled, an approved comment under immediate, and one
  /// awaiting approval under approval_required. A reader who cannot read the
  /// episode body gets permission_denied.
  $async.Future<PostEpisodeCommentResponse> postEpisodeComment(
          $pb.ClientContext? ctx, PostEpisodeCommentRequest request) =>
      _client.invoke<PostEpisodeCommentResponse>(ctx, 'CommentService',
          'PostEpisodeComment', request, PostEpisodeCommentResponse());

  /// Deletes one of the caller's own comments.
  ///
  /// It leaves every reader-facing response, the author's own included. The row
  /// survives for staff until the retention purge removes it, so a report or a
  /// dispute about a comment can still be investigated after its author took it
  /// down.
  $async.Future<WithdrawEpisodeCommentResponse> withdrawEpisodeComment(
          $pb.ClientContext? ctx, WithdrawEpisodeCommentRequest request) =>
      _client.invoke<WithdrawEpisodeCommentResponse>(ctx, 'CommentService',
          'WithdrawEpisodeComment', request, WithdrawEpisodeCommentResponse());

  /// Flags one published comment as breaking the rules, as the authenticated
  /// reader.
  ///
  /// Session required. It is idempotent per reader: a reader who has already
  /// reported this comment gets the same success, and their second submission
  /// adds nothing to the count the removal threshold reads.
  ///
  /// A comment the caller cannot see — never published, removed, withdrawn, or
  /// on an episode that is not public — is not_found, and their own comment is
  /// failed_precondition.
  $async.Future<ReportEpisodeCommentResponse> reportEpisodeComment(
          $pb.ClientContext? ctx, ReportEpisodeCommentRequest request) =>
      _client.invoke<ReportEpisodeCommentResponse>(ctx, 'CommentService',
          'ReportEpisodeComment', request, ReportEpisodeCommentResponse());
}

const $core.bool _omitFieldNames =
    $core.bool.fromEnvironment('protobuf.omit_field_names');
const $core.bool _omitMessageNames =
    $core.bool.fromEnvironment('protobuf.omit_message_names');
