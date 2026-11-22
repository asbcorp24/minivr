# MiniVR Native Android

Нативный Android-клиент. **WebView не используется**. Рендерер — OpenGL ES 2.0, интерфейс — Android Views, сервер — JSON API `/api/mobile.php`.

## Сборка
Откройте каталог `android-native` в Android Studio (JDK 17, SDK 35). Выполните Build → Build APK(s). APK: `app/build/outputs/apk/debug/app-debug.apk`.

В `app/build.gradle.kts` задайте `API_BASE` (HTTPS адрес вашего MiniVR). После обновления сервера PHP endpoint `/api/mobile.php` отдаёт опубликованные панорамы и экскурсии.

## Текущая стадия
Первый рабочий каркас: получение каталога, загрузка текстуры и GPU-отрисовка сферической панорамы, управление пальцем, переключение гироскопа. Не реализованы пока: полноценный VR/Cardboard с оптической коррекцией, эффекты и depth-параллакс, тайловые изображения, hotspots и аудиогид, офлайн-кэш. Для полного паритета с сайтом их нужно переносить отдельными модулями, не подменяя WebView.
