# Keep OkHttp/okio quiet under R8. The app itself is small; nothing else needed.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
