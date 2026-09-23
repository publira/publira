package dev.publira.app

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    private val screenCaptures = ScreenCaptures(this)

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        screenCaptures.attach(flutterEngine.dartExecutor.binaryMessenger)
    }

    override fun onStart() {
        super.onStart()
        screenCaptures.onStart()
    }

    override fun onStop() {
        screenCaptures.onStop()
        super.onStop()
    }
}
