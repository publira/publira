import 'package:flutter/widgets.dart';

/// The reader's half of `publira.v1.ContactService`.
abstract class ContactRepository {
  /// Sends one message to the tenant's staff, who answer at [replyToEmail].
  ///
  /// A signed-in reader's session goes along, so staff can tell a question
  /// about an account from one about the site; a guest sends without one.
  /// An empty [subject] is no subject. Throws [ContactFailure].
  Future<void> submit({
    required String replyToEmail,
    required String subject,
    required String body,
  });
}

/// Looks up the [ContactRepository] installed by [ContactScope].
///
/// It is absent in a widget test that builds the app without one, so
/// [maybeOf] answers `null` rather than asserting: no screen then leads to the
/// contact form.
class ContactScope extends InheritedWidget {
  const ContactScope({super.key, this.repository, required super.child});

  final ContactRepository? repository;

  static ContactRepository? maybeOf(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<ContactScope>();
    return scope?.repository;
  }

  @override
  bool updateShouldNotify(ContactScope oldWidget) =>
      repository != oldWidget.repository;
}
