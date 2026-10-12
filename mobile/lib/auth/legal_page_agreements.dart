import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:publira/auth/auth_controller.dart';
import 'package:publira/auth/auth_failure.dart';
import 'package:publira/auth/sign_up_requirements.dart';

/// The revised terms of service and privacy policy the signed-in reader has
/// still to agree to.
///
/// A Tenant admin can publish a version of either page that asks every reader
/// to agree again, and until a reader has, the API refuses most of what they
/// do. The router sends a reader who owes anything here to the agreement
/// screen before the rest of the app, so the list is read when a reader signs
/// in, when the app comes back to the front, and whenever the API refuses a
/// request for want of the agreement — which is how a version published while
/// the app is open reaches it.
class LegalPageAgreements extends ChangeNotifier {
  LegalPageAgreements({required this._auth});

  final AuthController _auth;

  List<LegalPage> _owed = const [];

  /// The locale the pages were last read in, which a check the API's refusal
  /// starts reads them in again. Empty reads the tenant's default locale.
  String _locale = '';

  /// Bumped by every read, by every recorded agreement, and by [forget], so
  /// a read that lands after a newer read, after an agreement, or after the
  /// reader it was read for has gone, is dropped.
  var _generation = 0;

  /// Bumped by [forget] alone, so an agreement recorded for a reader who has
  /// signed out since is dropped, while one that overlapped a read is not.
  var _reader = 0;

  /// The pages the reader owes, terms first, each in the version they are
  /// asked to agree to. Empty when they owe nothing, when nobody is signed
  /// in, and until the first read has answered.
  List<LegalPage> get owed => _owed;

  /// Reads what the signed-in reader owes, in [locale] when it is given and
  /// in the locale of the last read otherwise.
  ///
  /// A read that fails leaves what was known: an unreachable API is not an
  /// agreement, and a session the API refused signs the reader out, which
  /// [forget]s it.
  Future<void> check({String? locale}) async {
    if (locale != null) {
      _locale = locale;
    }
    final generation = ++_generation;
    final List<LegalPage> owed;
    try {
      owed = await _auth.readOwedLegalPages(locale: _locale);
    } on AuthFailure {
      return;
    }
    if (generation == _generation) {
      _set(owed);
    }
  }

  /// Records the reader's agreement to [pages], the versions they were
  /// shown, and answers whether that settles what they owe.
  ///
  /// `false` means a version was published since [pages] were read, or a
  /// page is no longer one the tenant asks about; [owed] then holds what the
  /// reader is to be asked instead.
  ///
  /// The answer stands over every read still in flight, even one started
  /// after the agreement was sent: such a read may have been answered from
  /// before the agreement was recorded, and would hold the reader on the
  /// agreement screen they have just left.
  ///
  /// Throws [AuthFailure] for a refusal of any other kind.
  Future<bool> agree(List<LegalPage> pages) async {
    final reader = _reader;
    final List<LegalPage> owed;
    try {
      owed = await _auth.agreeToLegalPages([
        for (final page in pages) page.versionId,
      ], locale: _locale);
    } on AuthFailure catch (failure) {
      if (failure.kind != AuthFailureKind.invalidInput) {
        rethrow;
      }
      await check();
      return false;
    }
    if (reader == _reader) {
      _generation++;
      _set(owed);
    }
    return owed.isEmpty;
  }

  /// The API refused a request because the reader owes an agreement, which
  /// they may have been asked for already; reading the pages again also
  /// catches a version published since.
  void reportRequired() {
    unawaited(check());
  }

  /// Drops what the reader who signed out owed, and any read still in flight
  /// for them.
  void forget() {
    _generation++;
    _reader++;
    _set(const []);
  }

  void _set(List<LegalPage> owed) {
    if (listEquals(owed, _owed)) {
      return;
    }
    _owed = List.unmodifiable(owed);
    notifyListeners();
  }
}

/// Looks up the app's [LegalPageAgreements] and rebuilds its dependents
/// whenever what the reader owes changes.
class LegalPageAgreementScope extends InheritedNotifier<LegalPageAgreements> {
  const LegalPageAgreementScope({
    super.key,
    required LegalPageAgreements? agreements,
    required super.child,
  }) : super(notifier: agreements);

  /// The app's agreements, `null` for a build without them, such as a widget
  /// test that does not exercise them.
  static LegalPageAgreements? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<LegalPageAgreementScope>()
      ?.notifier;

  /// [maybeOf] without making [context] depend on it, for the router's
  /// redirect, which the app runs again itself whenever the answer changes.
  static LegalPageAgreements? read(BuildContext context) => context
      .getInheritedWidgetOfExactType<LegalPageAgreementScope>()
      ?.notifier;
}
