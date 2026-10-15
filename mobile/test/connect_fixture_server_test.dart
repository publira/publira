import 'package:fixnum/fixnum.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:publira/api/gen/publira/types/v1/types.pb.dart' as pb;
import 'package:publira/api/gen/publira/v1/catalog.pb.dart' as pb;

import 'support/connect_fixture_server.dart';

/// A field number no message here declares.
const _undeclaredField = 999;

/// [request] as [ConnectFixtureServer] records it.
RecordedRequest _recorded(pb.ListPublishedSeriesRequest request) =>
    RecordedRequest(
      path: '/rpc/publira.v1.CatalogService/ListPublishedSeries',
      headers: const {'content-type': ConnectFixtureServer.protoContentType},
      body: request.writeToBuffer(),
    );

void main() {
  group('RecordedRequest.decode', () {
    test('reads a request the proto describes', () {
      final sent = pb.ListPublishedSeriesRequest(
        tenant: pb.TenantContext(tenantId: 'tenant-1'),
        limit: 20,
      );

      expect(_recorded(sent).decode(pb.ListPublishedSeriesRequest()), sent);
    });

    test('refuses a field the request does not define', () {
      final sent = pb.ListPublishedSeriesRequest(limit: 20)
        ..unknownFields.mergeVarintField(_undeclaredField, Int64.ONE);

      expect(
        () => _recorded(sent).decode(pb.ListPublishedSeriesRequest()),
        throwsFormatException,
      );
    });

    test('refuses a field a nested message does not define', () {
      final sent = pb.ListPublishedSeriesRequest(
        tenant: pb.TenantContext(tenantId: 'tenant-1')
          ..unknownFields.mergeVarintField(_undeclaredField, Int64.ONE),
      );

      expect(
        () => _recorded(sent).decode(pb.ListPublishedSeriesRequest()),
        throwsFormatException,
      );
    });
  });
}
