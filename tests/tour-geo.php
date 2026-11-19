<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/tour-geo.php';

function expectGeo(array $expected, string $lat, string $lng): void
{
    if (parseTourGeoCoordinates($lat, $lng) !== $expected) {
        throw new RuntimeException('Unexpected coordinates');
    }
}

expectGeo([null, null], '', ' ');
expectGeo([55.7558, 37.6173], '55.7558', '37.6173');
expectGeo([0.0, 0.0], '0', '0');
expectGeo([-90.0, 180.0], '-90', '180');

foreach ([['91', '0'], ['0', '-181'], ['1', ''], ['', '1'], ['nan', '1'], ['5', 'infinity']] as [$lat, $lng]) {
    try {
        parseTourGeoCoordinates($lat, $lng);
        throw new RuntimeException('Invalid coordinates accepted: ' . $lat . ', ' . $lng);
    } catch (RuntimeException $error) {
        if (str_starts_with($error->getMessage(), 'Invalid coordinates accepted')) {
            throw $error;
        }
    }
}

echo "Tour scene coordinate validation passed\n";
