plugins {
 id("com.android.application")
 id("org.jetbrains.kotlin.android")
}
android {
 namespace = "ru.specdpo.minivr"
 compileSdk = 35
 defaultConfig {
  applicationId = "ru.specdpo.minivr"
  minSdk = 26
  targetSdk = 35
  versionCode = 1
  versionName = "0.1.0"
  buildConfigField("String","API_BASE","\"https://vr.specdpo.ru\"")
 }
 buildFeatures { buildConfig = true }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
}
