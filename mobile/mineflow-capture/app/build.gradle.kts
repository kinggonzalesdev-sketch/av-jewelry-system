import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/*
 * Build-time configuration. Values resolve in this order:
 *   1. local.properties  (gitignored — the correct place for per-machine overrides)
 *   2. an environment variable of the same name (CI)
 *   3. the committed default below
 *
 * All three keys here are PUBLIC by design: the Vercel URL, the Supabase project
 * URL, and the Supabase *anon/publishable* key (safe to ship in a client app —
 * it is NOT the service-role key and grants nothing beyond RLS-scoped access).
 * No password and no service-role key is ever placed in the build or the app.
 */
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun cfg(key: String, default: String): String =
    (localProps.getProperty(key) ?: System.getenv(key) ?: default).trim()

/** Short git commit at build time — baked into BuildConfig.BUILD_COMMIT so the server heartbeat
 *  can prove which APK build is on the phone. Best-effort: "local" when git is unavailable. */
fun gitCommit(): String = try {
    val p = ProcessBuilder("git", "rev-parse", "--short=7", "HEAD")
        .directory(rootProject.projectDir)
        .redirectErrorStream(true)
        .start()
    val out = p.inputStream.bufferedReader().use { it.readText() }.trim()
    p.waitFor()
    if (p.exitValue() == 0 && out.isNotEmpty()) out else "local"
} catch (e: Exception) {
    "local"
}

android {
    namespace = "com.mineflow.capture"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.mineflow.capture"
        minSdk = 26
        targetSdk = 34
        versionCode = 18
        versionName = "1.0.17"

        // The MineFlow backend the app talks to — the SAME production system as web.
        buildConfigField(
            "String", "API_BASE_URL",
            "\"${cfg("MINEFLOW_API_BASE_URL", "https://av-jewelry.vercel.app")}\"",
        )
        // Supabase Auth (sign-in) — the SAME production project as web (eqfddwxsmzzojuasffjx).
        buildConfigField(
            "String", "SUPABASE_URL",
            "\"${cfg("SUPABASE_URL", "https://eqfddwxsmzzojuasffjx.supabase.co")}\"",
        )
        // Publishable anon key for project eqfddwxsmzzojuasffjx. Safe to ship; overridable
        // via local.properties (SUPABASE_ANON_KEY=...). This is NOT the service-role key.
        buildConfigField(
            "String", "SUPABASE_ANON_KEY",
            "\"${cfg(
                "SUPABASE_ANON_KEY",
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxZmRkd3hzbXp6b2p1YXNmZmp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzAyMTAsImV4cCI6MjA5OTcwNjIxMH0.RKWjPS9GpWditcllrMeid5KF3kXVZroEfUBWQm73QAI",
            )}\"",
        )
        // Short git commit at build time — the heartbeat reports it so the server can identify
        // exactly which APK build is on the phone. Overridable via BUILD_COMMIT in local.properties.
        buildConfigField("String", "BUILD_COMMIT", "\"${cfg("BUILD_COMMIT", gitCommit())}\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    // Encrypted token storage (Android Keystore-backed).
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    // Networking. org.json ships with Android, so no JSON dependency is needed.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // On-device text recognition (OCR) for auto-reading the pinned comment in a capture
    // — the customer's Facebook name + the mined item. Bundled + offline; no data leaves
    // the phone during recognition.
    implementation("com.google.mlkit:text-recognition:16.0.1")

    // Pure-JVM unit tests for the pinned-comment selection logic (no device needed).
    testImplementation("junit:junit:4.13.2")
    // Android's bundled org.json is a non-functional STUB under JVM unit tests; the real
    // implementation on the TEST classpath lets us unit-test JSON-shaped logic (the rate sync).
    testImplementation("org.json:json:20231013")
}
