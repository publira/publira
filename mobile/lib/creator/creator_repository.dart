/// @docImport 'package:publira/creator/creator_failure.dart';
library;

import 'package:flutter/widgets.dart';
import 'package:publira/models/my_creator.dart';

/// The most rows one `CreatorService` page answers.
const myCreatorPageLimitMax = 100;

/// The reader's half of `publira.v1.CreatorService`: the pages of the Authors
/// their account is linked to, and the tenant setting that turns them on.
abstract class CreatorRepository {
  /// Whether the tenant shows a linked reader their Authors' pages, as
  /// `GetTenantResponse.creator_pages_enabled` says. While it does not, every
  /// other call here is refused, so none is made.
  ///
  /// Throws [CreatorFailure] on a transport or unexpected server error.
  Future<bool> pagesEnabled();

  /// The Authors the signed-in account is linked to, oldest link first, and
  /// whether the tenant shows them their sales. Throws [CreatorFailure].
  Future<MyCreators> listMyCreators();

  /// The figures of the Author [creatorId] (a [MyCreator.id]) over the
  /// tenant's last 28 whole days, with one page of their episodes, titled in
  /// [locale].
  ///
  /// [token] is the opaque cursor from a previous page, empty for the first
  /// one. Throws [CreatorFailure].
  Future<MyCreatorStats> stats({
    required String creatorId,
    required String locale,
    String token = '',
  });

  /// One page of the Author's closed months, newest first. Refused with
  /// [CreatorFailureKind.unavailable] while the tenant does not show sales.
  /// Throws [CreatorFailure].
  Future<MyCreatorStatementPage> listStatements({
    required String creatorId,
    String token = '',
  });

  /// The Author's part of the closed month [period] (`YYYY-MM`) and one page
  /// of their lines in it, [limit] at most, the API's default page when
  /// `null`. Refused as [listStatements] is. Throws [CreatorFailure].
  Future<MyCreatorStatementDetail> statement({
    required String creatorId,
    required String period,
    String token = '',
    int? limit,
  });
}

/// Looks up the [CreatorRepository] installed by [CreatorScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no screen then leads to an
/// Author's pages.
class CreatorScope extends InheritedWidget {
  const CreatorScope({super.key, this.repository, required super.child});

  final CreatorRepository? repository;

  static CreatorRepository? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<CreatorScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(CreatorScope oldWidget) =>
      repository != oldWidget.repository;
}
