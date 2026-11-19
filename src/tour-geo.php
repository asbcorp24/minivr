<?php
declare(strict_types=1);

/** @return array{0: ?float, 1: ?float} */
function parseTourGeoCoordinates(string $latitude, string $longitude): array
{
    $latitude = trim($latitude);
    $longitude = trim($longitude);
    if ($latitude === '' && $longitude === '') {
        return [null, null];
    }
    if ($latitude === '' || $longitude === '' || !is_numeric($latitude) || !is_numeric($longitude)) {
        throw new RuntimeException('Укажите обе координаты точки: широту и долготу.');
    }
    $lat = (float) $latitude;
    $lng = (float) $longitude;
    if (!is_finite($lat) || !is_finite($lng) || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
        throw new RuntimeException('Широта должна быть от −90 до 90, долгота — от −180 до 180.');
    }
    return [$lat, $lng];
}
