import 'package:publira/contact/contact_failure.dart';
import 'package:publira/contact/contact_repository.dart';

/// One message [FakeContactRepository.submit] was called with.
typedef SentContactMessage = ({
  String replyToEmail,
  String subject,
  String body,
});

/// [ContactRepository] that answers from what a test sets on it.
class FakeContactRepository implements ContactRepository {
  FakeContactRepository({this.failure});

  /// Thrown by [submit], standing in for an API that refuses the message.
  ContactFailure? failure;

  /// Every message the form sent, in order, including the refused ones.
  final sent = <SentContactMessage>[];

  @override
  Future<void> submit({
    required String replyToEmail,
    required String subject,
    required String body,
  }) async {
    sent.add((replyToEmail: replyToEmail, subject: subject, body: body));
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
  }
}
