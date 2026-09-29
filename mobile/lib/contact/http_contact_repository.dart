import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';
import 'package:publira/api/tenant_resolver.dart';
import 'package:publira/contact/contact_failure.dart';
import 'package:publira/contact/contact_repository.dart';

/// [ContactRepository] backed by `publira.v1.ContactService`.
class HttpContactRepository implements ContactRepository {
  const HttpContactRepository({required this._client, required this._tenants});

  static const _submitProcedure =
      '/publira.v1.ContactService/SubmitContactMessage';

  final ConnectClient _client;
  final TenantResolver _tenants;

  @override
  Future<void> submit({
    required String replyToEmail,
    required String subject,
    required String body,
  }) async {
    try {
      final tenantId = await _tenants.resolve();
      // The client attaches whatever session it holds. A token the API no
      // longer accepts sends the message as a guest's rather than refusing it.
      await _client.unary(_submitProcedure, {
        'tenant': {'tenantId': tenantId},
        'replyToEmail': replyToEmail,
        if (subject.isNotEmpty) 'subject': subject,
        'body': body,
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      throw _toFailure(error);
    }
  }

  ContactFailure _toFailure(ConnectException error) {
    if (error.isUnavailable) {
      return ContactFailure(ContactFailureKind.network, message: error.message);
    }
    return switch (error.code) {
      'invalid_argument' => ContactFailure(
        ContactFailureKind.invalid,
        message: error.message,
      ),
      'resource_exhausted' => ContactFailure(
        ContactFailureKind.rateLimited,
        message: error.message,
      ),
      _ => ContactFailure(
        ContactFailureKind.unexpected,
        message: error.message,
      ),
    };
  }
}
