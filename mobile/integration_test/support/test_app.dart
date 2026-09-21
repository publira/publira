import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../test/support/pump_until.dart';

/// [testWidgets] for a test that drives the app, so that the images its
/// frames load are finished within it and fail it rather than another one.
///
/// The engine runs a frame in the zone its frame callbacks were set from,
/// which is the first test that pumped one; a request a later test's frame
/// starts would otherwise report its failure there. Setting the callbacks
/// again from this test's zone keeps that work in the test that caused it.
///
/// The test ends only once the image cache has nothing pending: the app is
/// unmounted after the body, and a reader closes its image client on the way
/// out, cancelling any request it still has in flight.
void testApp(String description, WidgetTesterCallback callback) {
  testWidgets(description, (tester) async {
    final dispatcher = tester.binding.platformDispatcher;
    dispatcher
      ..onBeginFrame = dispatcher.onBeginFrame
      ..onDrawFrame = dispatcher.onDrawFrame;
    imageCache.clear();

    await callback(tester);

    // Two idle frames rather than one: a page that has just arrived can have
    // the next one resolved on the frame after it.
    var idleFrames = 0;
    await pumpUntilTrue(
      tester,
      () {
        idleFrames = imageCache.pendingImageCount == 0 ? idleFrames + 1 : 0;
        return idleFrames >= 2;
      },
      description: 'the images the test loaded to finish',
      // Longer than EpisodeImageClient's own timeout, so a request that hangs
      // fails as that timeout rather than as this wait.
      timeout: const Duration(seconds: 30),
    );
  });
}
