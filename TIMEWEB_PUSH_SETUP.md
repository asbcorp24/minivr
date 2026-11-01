# MiniVR — Web Push на виртуальном Timeweb

## Требования
- HTTPS, PHP 8.2+ (с OpenSSL), SSH, Composer, Crontab.
- Корень проекта содержит `public/`, `src/`, `scripts/`. DocumentRoot должен указывать на `public/`.
- Уведомления работают только после согласия пользователя. На iOS требуется установка PWA на экран «Домой».

## 1. Загрузка файлов
Разместите обновлённый MiniVR на хостинге. В панели Timeweb откройте **Сайты → Мои сайты**, убедитесь, что домен обслуживает папка `public` и SSL активен.

## 2. Composer
По SSH перейдите в корень проекта:
```sh
cd ~/ВАША_ПАПКА_ПРОЕКТА
/opt/php82/bin/php -v
composer require minishlink/web-push
```
Если команда composer использует другую версию PHP, запустите Composer через нужный интерпретатор, используя путь к composer.phar, который есть на сервере. Папка `vendor` должна лежать рядом с `src`.

## 3. VAPID
```sh
/opt/php82/bin/php -r 'require "vendor/autoload.php"; print_r(\Minishlink\WebPush\VAPID::createVapidKeys());'
```
Создайте файл `config/push-secrets.php` по образцу `config/push-secrets.example.php` и подставьте publicKey, privateKey и subject вида `mailto:admin@example.com`. **Не размещайте приватный ключ в `public/` и не добавляйте файл с секретами в Git.**

> Важно: до полной интеграции серверный endpoint `public/push.php` может использовать getenv() для publicKey; требуется поддержка `src/push-config.php` и в веб-обработчике, и в CLI. Проверяйте ответ `https://домен/push.php` — publicKey не должен быть пустым.

## 4. Cron
Панель Timeweb → **Crontab → Добавить задачу**:
- Название: MiniVR Push
- Интерпретатор: **Сценарий PHP 8.2** (или версия сайта)
- Путь до файла: выберите `scripts/process-push-queue.php` в файловом менеджере.
- Расписание: экспертное; минуты `*/5`, остальные поля `*`.
- Укажите email для отчётов об ошибках.

В Timeweb путь в поле «Путь до файла» задаётся **относительно домашней директории**, например `/minivr/scripts/process-push-queue.php`, а не `/home/u/.../minivr/scripts/...`.

## 5. Проверка
1. Откройте `https://домен/push.php` и проверьте publicKey.
2. Установите MiniVR на Android и разрешите уведомления.
3. Проверьте, что подписка сохранилась в SQLite.
4. Опубликуйте новую панораму.
5. Выполните из SSH `/opt/php82/bin/php scripts/process-push-queue.php` и проверьте получение Push.
6. Проверьте отчёты Crontab.

## Ограничения текущей интеграции
Существующий `scripts/send-panorama-push.php <id>` отправляет Push вручную. Скрипт `scripts/process-push-queue.php` обрабатывает очередь, но для автоматической постановки публикаций требуется вызвать `minivrQueuePanorama(db(), $panoramaId)` после **первой публикации** в `public/admin/panorama.php`. До подключения этого вызова Cron не сможет обнаруживать новые публикации самостоятельно.

Документация Timeweb: https://timeweb.com/ru/docs/virtualnyj-hosting/planirovshchik-zadanij-cron/
