import java.util.Base64
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/** `KEY=VALUE` pairs Flutter passed as `--dart-define`, keyed by name. */
fun dartDefines(): Map<String, String> {
    val encoded = project.findProperty("dart-defines") as String? ?: return emptyMap()
    if (encoded.isBlank()) {
        return emptyMap()
    }
    return encoded.split(",").mapNotNull { item ->
        val decoded =
            runCatching {
                String(Base64.getDecoder().decode(item), Charsets.UTF_8)
            }.getOrNull() ?: return@mapNotNull null
        val separator = decoded.indexOf('=')
        if (separator <= 0) {
            null
        } else {
            decoded.substring(0, separator) to decoded.substring(separator + 1)
        }
    }.toMap()
}

val mobileDir: File = rootDir.parentFile

/**
 * The app's identity, generated from an app manifest by
 * `scripts/app_manifest.dart --generate` into the directory
 * PUBLIRA_MOBILE_GENERATED_DIR names, else `mobile/.generated/`.
 */
val app: Properties = run {
    val generatedDir =
        providers.environmentVariable("PUBLIRA_MOBILE_GENERATED_DIR").orNull
            ?.takeIf { it.isNotEmpty() }
            ?.let { mobileDir.resolve(it) }
            ?: mobileDir.resolve(".generated")
    val file = generatedDir.resolve("app.properties")
    if (!file.isFile) {
        throw GradleException(
            "$file does not exist. Generate it from an app manifest, in mobile/: " +
                "dart run scripts/app_manifest.dart --generate [<manifest>]",
        )
    }
    Properties().apply { file.reader(Charsets.UTF_8).use { load(it) } }
}

/**
 * The upload key a production release is signed with, which the environment
 * names so that neither the key nor its passwords reach a tracked file. A
 * relative keystore path is read from `mobile/`.
 */
val uploadKeyVariables =
    listOf(
        "PUBLIRA_ANDROID_KEYSTORE",
        "PUBLIRA_ANDROID_KEYSTORE_PASSWORD",
        "PUBLIRA_ANDROID_KEY_ALIAS",
        "PUBLIRA_ANDROID_KEY_PASSWORD",
    )
val uploadKey: Map<String, String> =
    uploadKeyVariables.mapNotNull { name ->
        providers.environmentVariable(name).orNull?.takeIf { it.isNotEmpty() }?.let { name to it }
    }.toMap()
val uploadKeystore: File? = uploadKey["PUBLIRA_ANDROID_KEYSTORE"]?.let { mobileDir.resolve(it) }

fun appValue(key: String): String =
    app.getProperty("publira.$key")
        ?: throw GradleException("the generated app configuration has no publira.$key")

/**
 * [value] as an Android string resource reads it back: an ASCII character
 * other than a letter or digit could be markup, a quote, or a reference
 * prefix, so each is written as a `\u` escape.
 */
fun stringResource(value: String): String =
    value.map { c ->
        if (c.code < 0x80 && !c.isLetterOrDigit()) "\\u%04x".format(c.code) else c.toString()
    }.joinToString("")

android {
    // The source namespace is Publira's own; the application ID the app is
    // published under is the tenant's.
    namespace = "dev.publira.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        manifestPlaceholders["tenantHost"] = appValue("tenantHost")
        applicationId = appValue("applicationId")
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Each flavor's launcher name is a resValue from the manifest's app.name.
    buildFeatures {
        resValues = true
    }

    signingConfigs {
        if (uploadKey.keys == uploadKeyVariables.toSet()) {
            create("upload") {
                storeFile = uploadKeystore
                storePassword = uploadKey.getValue("PUBLIRA_ANDROID_KEYSTORE_PASSWORD")
                keyAlias = uploadKey.getValue("PUBLIRA_ANDROID_KEY_ALIAS")
                keyPassword = uploadKey.getValue("PUBLIRA_ANDROID_KEY_PASSWORD")
            }
        }
    }

    flavorDimensions += "environment"

    productFlavors {
        create("dev") {
            dimension = "environment"
            applicationIdSuffix = ".dev"
            signingConfig = signingConfigs.getByName("debug")
            resValue("string", "app_name", stringResource("${appValue("appName")} Dev"))
        }
        create("production") {
            dimension = "environment"
            resValue("string", "app_name", stringResource(appValue("appName")))
            // The debug build type keeps its own debug signing, which takes
            // precedence over a flavor's; a release without the upload key is
            // refused below.
            signingConfig = signingConfigs.findByName("upload") ?: signingConfigs.getByName("debug")
        }
    }
}

// A store binary is pinned to one tenant: the App Links it declares and the
// tenant the app asks the API about have to be the same, or the tenant's links
// stay in the browser. The task graph also holds the production packaging an
// aggregate such as `assemble` runs, which the requested task names do not.
gradle.taskGraph.whenReady {
    val productionBuild = allTasks.any {
        it.project == project && Regex("^(package|bundle)Production").containsMatchIn(it.name)
    }
    require(!productionBuild || dartDefines()["PUBLIRA_TENANT_HOST"] == appValue("tenantHost")) {
        "Production builds require --dart-define=PUBLIRA_TENANT_HOST=" +
            "${appValue("tenantHost")}, the tenant.host of the app manifest"
    }

    // Google Play refuses a binary signed with the debug keys.
    val productionRelease = allTasks.any {
        it.project == project && Regex("^(package|bundle)ProductionRelease").containsMatchIn(it.name)
    }
    if (productionRelease) {
        val missing = uploadKeyVariables.filterNot(uploadKey::containsKey)
        require(missing.isEmpty()) {
            "Production release builds are signed with the tenant's upload key; export " +
                missing.joinToString(", ")
        }
        require(uploadKeystore!!.isFile) {
            "PUBLIRA_ANDROID_KEYSTORE names $uploadKeystore, which is not a file"
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
