import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:publira/api/connect_client.dart';
import 'package:publira/api/connect_exception.dart';

/// Fails naming why a live run has nothing to read: an API the device cannot
/// reach, or one that answers without the seed tenant or its series.
///
/// Every live test waits on a read over the network, so without this a run
/// that has neither reports one timeout per test, each naming whatever widget
/// that test happened to wait for. The message carries the transport error as
/// the device saw it, which the app itself turns into a retry prompt.
Future<void> expectLiveSeed({
  required String baseUrl,
  required String tenantHost,
  required String seriesPublicId,
}) async {
  final httpClient = http.Client();
  final client = ConnectClient(baseUrl: baseUrl, httpClient: httpClient);
  try {
    final String tenantId;
    try {
      final body = await client.unary(
        '/publira.v1.DomainService/GetTenantByDomain',
        {
          'domains': [tenantHost],
        },
      );
      final rawTenantId = body['tenantId'];
      tenantId = rawTenantId is String ? rawTenantId : '';
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        fail(
          'The live API at $baseUrl answered, but has no tenant for the '
          'host "$tenantHost": the seed tenant is missing ($error)',
        );
      }
      fail('The live API at $baseUrl did not serve the device: $error');
    }
    if (tenantId.isEmpty) {
      fail(
        'The live API at $baseUrl answered GetTenantByDomain for '
        '"$tenantHost" without a tenant id: the seed tenant is missing',
      );
    }

    try {
      await client.unary('/publira.v1.CatalogService/GetSeriesDetail', {
        'publicId': seriesPublicId,
        'tenant': {'tenantId': tenantId},
      }, tenantId: tenantId);
    } on ConnectException catch (error) {
      if (error.isNotFound) {
        fail(
          'The live API at $baseUrl answered, but the seed tenant has no '
          'series $seriesPublicId: the seed rows are missing ($error)',
        );
      }
      fail('The live API at $baseUrl did not serve the device: $error');
    }
  } finally {
    httpClient.close();
  }
}
