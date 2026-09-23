import 'package:publira/content_views/content_view_repository.dart';

/// [ContentViewRepository] that keeps every view it is asked to record.
class FakeContentViewRepository implements ContentViewRepository {
  FakeContentViewRepository({this.failure});

  /// Thrown by every [record] once the view is kept, standing in for an API
  /// that could not be reached.
  Object? failure;

  /// The views recorded so far, in order, as `kind:publicId`.
  final recorded = <String>[];

  @override
  Future<void> record(ContentViewKind kind, String publicId) async {
    recorded.add('${kind.name}:$publicId');
    final failure = this.failure;
    if (failure != null) {
      throw failure;
    }
  }
}
