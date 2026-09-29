import 'dart:async';

import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_repository.dart';

/// The tenant a widget test builds the app for.
const fixtureTenantBrand = TenantBrand(name: 'Seed Tenant');

/// [TenantBrandRepository] that answers with [brand], or as an API that could
/// not be reached when it is `null`.
///
/// [gate] holds the answer back until a test completes it, so the copy the
/// device kept can be observed before the API replaces it.
class FakeTenantBrandRepository implements TenantBrandRepository {
  FakeTenantBrandRepository({this.brand = fixtureTenantBrand, this.gate});

  TenantBrand? brand;
  Completer<void>? gate;
  var reads = 0;

  @override
  Future<TenantBrand?> read() async {
    reads++;
    await gate?.future;
    return brand;
  }
}
