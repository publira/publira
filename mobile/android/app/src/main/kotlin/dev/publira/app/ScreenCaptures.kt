package dev.publira.app

import android.annotation.TargetApi
import android.app.Activity
import android.os.Build
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.EventChannel

/**
 * Reports the screenshots taken of [activity] to Dart, one event each.
 *
 * Only Android 14 and later have a signal for it, and older versions never
 * emit. The callback is registered while Dart listens and the activity is
 * started, which is the window Android delivers it in.
 */
class ScreenCaptures(private val activity: Activity) : EventChannel.StreamHandler {
    private var sink: EventChannel.EventSink? = null
    private var started = false
    private var registration: Registration? = null

    fun attach(messenger: BinaryMessenger) {
        EventChannel(messenger, "dev.publira.app/screen_captures").setStreamHandler(this)
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
        sink = events
        update()
    }

    override fun onCancel(arguments: Any?) {
        sink = null
        update()
    }

    fun onStart() {
        started = true
        update()
    }

    fun onStop() {
        started = false
        update()
    }

    private fun update() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return
        }
        val wanted = started && sink != null
        val current = registration
        if (wanted && current == null) {
            registration = Registration(activity) { sink?.success(null) }
        } else if (!wanted && current != null) {
            current.unregister()
            registration = null
        }
    }

    /** Kept apart so the API 34 types are loaded only on a device that has them. */
    @TargetApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
    private class Registration(private val activity: Activity, onCapture: () -> Unit) {
        private val callback = Activity.ScreenCaptureCallback { onCapture() }

        init {
            activity.registerScreenCaptureCallback(activity.mainExecutor, callback)
        }

        fun unregister() {
            activity.unregisterScreenCaptureCallback(callback)
        }
    }
}
