import 'package:flutter/widgets.dart';
import 'package:publira/offline/offline_library.dart';
import 'package:publira/tenant/tenant_brand.dart';
import 'package:publira/tenant/tenant_brand_repository.dart';

/// The tenant's brand for this run: the copy the device kept first, then
/// whatever the API answers.
class TenantBrandController extends ChangeNotifier {
  TenantBrandController({
    required this._repository,
    required this.tenantHost,
    this.library,
    this.logoRequestHeaders = const {},
  });

  final TenantBrandRepository _repository;

  /// The tenant this build points at, which the saved brand has to match.
  final String tenantHost;

  /// Where the last answer is kept, so a launch without a network is branded.
  final OfflineLibrary? library;

  /// Headers the logo is fetched with. They name the tenant this build points
  /// at rather than anything the API said, so the saved copy does not keep
  /// them.
  final Map<String, String> logoRequestHeaders;

  TenantBrand? _brand;

  /// `null` until either the device or the API has answered.
  TenantBrand? get brand => _brand;

  Future<void> start() async {
    final saved = await library?.readTenantBrand(tenantHost);
    if (saved != null) {
      _set(saved);
    }
    final fresh = await _repository.read();
    if (fresh == null) {
      return;
    }
    _set(fresh);
    await library?.writeTenantBrand(tenantHost, fresh);
  }

  void _set(TenantBrand brand) {
    _brand = brand;
    notifyListeners();
  }
}

/// Looks up the tenant's brand and rebuilds its dependents when it arrives.
///
/// Absent in a widget test that builds the app with no tenant, where screens
/// show no name and no logo.
class TenantBrandScope extends InheritedNotifier<TenantBrandController> {
  const TenantBrandScope({
    super.key,
    required TenantBrandController? controller,
    required super.child,
  }) : super(notifier: controller);

  static TenantBrandController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<TenantBrandScope>()?.notifier;
}
