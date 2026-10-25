# MiniVR

Небольшая self-hosted платформа для просмотра VR-фотографий и создания виртуальных экскурсий.

## Возможности

- плоские изображения: Mono / Stereo SBS / Top-Bottom;
- панорамы 180° и 360°: Mono / SBS / Top-Bottom;
- desktop, mobile, Google Cardboard и WebXR-гарнитуры;
- VR HUD и управление взглядом (gaze);
- WebXR-контроллеры;
- экскурсии из нескольких сцен;
- визуальная расстановка hotspots;
- SQLite;
- локальный Three.js — CDN и внешний интернет для JS-библиотек не требуются.

## Требования

- PHP 8.2+;
- расширения PHP: PDO и SQLite/PDO_SQLite;
- веб-сервер Nginx или Apache;
- HTTPS для полноценной работы WebXR и датчиков браузера;
- право записи PHP-процесса в `data/` и `public/uploads/`.

Корень сайта (Document Root) должен указывать на каталог **`public/`**, а не на корень репозитория. Это не даёт веб-серверу напрямую раздавать `config.php`, SQLite и исходники из `src/`.

## Установка на Timeweb Cloud + FASTPANEL

1. Создайте сайт/домен в FASTPANEL.
2. Выберите PHP 8.2 или новее и PHP-FPM. В документации Timeweb для FASTPANEL режим PHP-FPM описан как Nginx + PHP-FPM; при нём правила `.htaccess` не используются.
3. Клонируйте проект, например:

```bash
cd /var/www
git clone https://github.com/asbcorp24/minivr.git
cd minivr
```

Если FASTPANEL создала другую директорию сайта, клонируйте проект туда либо укажите фактический путь в настройках сайта.

4. В настройках сайта установите корневую директорию сайта на:

```text
/путь/к/minivr/public
```

5. Проверьте SQLite:

```bash
php -m | grep -Ei 'sqlite|pdo'
```

На Ubuntu/Debian при отсутствии SQLite:

```bash
sudo apt update
sudo apt install php8.2-sqlite3
sudo systemctl restart php8.2-fpm
```

Если FASTPANEL использует другую версию PHP, замените `8.2` на фактическую.

6. Создайте каталоги и выдайте права PHP-процессу:

```bash
cd /путь/к/minivr
mkdir -p data public/uploads
sudo chown -R www-data:www-data data public/uploads
sudo chmod -R 775 data public/uploads
```

Имя пользователя PHP-FPM в панели может отличаться от `www-data`. В таком случае используйте пользователя сайта из FASTPANEL.

7. Измените логин и пароль администратора в `config.php` **до публикации сайта**:

```php
const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'СЛОЖНЫЙ-ПАРОЛЬ';
```

Текущий пароль `change-me-now` предназначен только для первоначального запуска.

8. Подключите домен и включите SSL/HTTPS. Для WebXR HTTPS фактически обязателен в обычном браузерном использовании.

9. Откройте:

```text
https://ВАШ-ДОМЕН/
https://ВАШ-ДОМЕН/admin/
```

SQLite-файл `data/minivr.sqlite` создастся автоматически при первом обращении.

## Установка на чистый VPS Timeweb Cloud (Ubuntu + Nginx)

Установите пакеты:

```bash
sudo apt update
sudo apt install -y nginx git php8.2-fpm php8.2-cli php8.2-sqlite3
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/asbcorp24/minivr.git
sudo chown -R $USER:www-data /var/www/minivr
cd /var/www/minivr
mkdir -p data public/uploads
sudo chown -R www-data:www-data data public/uploads
sudo chmod -R 775 data public/uploads
```

Пример Nginx:

```nginx
server {
    listen 80;
    server_name vr.example.ru;

    root /var/www/minivr/public;
    index index.php;

    client_max_body_size 200M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.2-fpm.sock;
    }

    location ~ /\. {
        deny all;
    }
}
```

Активируйте сайт:

```bash
sudo ln -s /etc/nginx/sites-available/minivr /etc/nginx/sites-enabled/minivr
sudo nginx -t
sudo systemctl reload nginx
```

После этого настройте DNS домена на IP сервера и выпустите SSL-сертификат. Для загрузки больших SBS/360-фотографий увеличьте также `upload_max_filesize` и `post_max_size` в конфигурации используемого PHP-FPM, например до 200M.

## Обновление

```bash
cd /путь/к/minivr
git pull
```

База и загруженные изображения не находятся в Git, поэтому обычный `git pull` их не удаляет. Перед серьёзными обновлениями всё равно рекомендуется резервировать:

```text
data/minivr.sqlite
public/uploads/
```

## Первый запуск

1. Войдите в `/admin/`.
2. Загрузите VR-материалы и укажите формат: Flat / 180 / 360 и Mono / SBS / TB.
3. Создайте экскурсию.
4. Добавьте сцены и назначьте стартовую.
5. В разделе Hotspots расставьте переходы между сценами.
6. Проверьте экскурсию на desktop.
7. Проверьте Cardboard на телефоне через HTTPS.
8. Для Quest/Pico используйте кнопку VR в совместимом WebXR-браузере.

## Структура

```text
config.php              конфигурация
src/db.php              SQLite и автоматические миграции
data/                   SQLite (не коммитится)
public/                  Document Root
public/admin/            админка
public/assets/           CSS/JS и локальные vendor-библиотеки
public/uploads/          загруженные изображения (не коммитятся)
```
