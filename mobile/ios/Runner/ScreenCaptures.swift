import Flutter
import UIKit

/// Reports the screenshots the reader takes to Dart, one event each, while
/// Dart listens.
final class ScreenCaptures: NSObject, FlutterPlugin, FlutterStreamHandler {
  private var observer: NSObjectProtocol?

  static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterEventChannel(
      name: "dev.publira.app/screen_captures",
      binaryMessenger: registrar.messenger()
    )
    channel.setStreamHandler(ScreenCaptures())
  }

  func onListen(
    withArguments arguments: Any?,
    eventSink events: @escaping FlutterEventSink
  ) -> FlutterError? {
    stopObserving()
    observer = NotificationCenter.default.addObserver(
      forName: UIApplication.userDidTakeScreenshotNotification,
      object: nil,
      queue: .main
    ) { _ in
      events(nil)
    }
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    stopObserving()
    return nil
  }

  private func stopObserving() {
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    observer = nil
  }
}
