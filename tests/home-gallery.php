<?php
/** Run with: php tests/home-gallery.php (requires PDO SQLite). */
require_once __DIR__.'/../src/home-gallery.php';
require_once __DIR__.'/../src/panorama-thumbnails.php';

function verify(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$db->exec('CREATE TABLE panoramas (id INTEGER PRIMARY KEY, title TEXT, description TEXT, image TEXT, preview TEXT, projection TEXT, stereo TEXT, published INTEGER)');
$db->exec('CREATE TABLE tours (id INTEGER PRIMARY KEY, title TEXT, description TEXT, cover TEXT, published INTEGER)');
$db->exec('CREATE TABLE tour_scenes (id INTEGER PRIMARY KEY, tour_id INTEGER, panorama_id INTEGER, sort_order INTEGER)');
for ($i=1; $i<=15; $i++) {
    $published=$i===15?0:1;
    $db->prepare('INSERT INTO panoramas VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([$i,'Панорама '.$i,'','/uploads/test.jpg',null,'360','mono',$published]);
}
for ($i=1; $i<=9; $i++) {
    $db->prepare('INSERT INTO tours VALUES (?, ?, ?, ?, ?)')->execute([$i,'Экскурсия '.$i,'',null,$i===9?0:1]);
}

$materials1=homeGalleryPage($db,'materials',1);
$materials2=homeGalleryPage($db,'materials',2);
verify($materials1['total']===14 && count($materials1['items'])===12, 'Only published materials on first page');
verify($materials2['page']===2 && count($materials2['items'])===2, 'Last material page size');
verify((int)$materials1['items'][0]['id']===14 && (int)$materials2['items'][0]['id']===2, 'Newest-first order');
verify(homeGalleryPage($db,'materials',99)['page']===2, 'Out-of-range page clamps to last');
verify(homeGalleryPage($db,'materials','bad')['page']===1, 'Invalid page clamps to first');

$tours1=homeGalleryPage($db,'tours',1);
$tours2=homeGalleryPage($db,'tours',2);
verify($tours1['total']===8 && count($tours1['items'])===6, 'Tour page size');
verify($tours2['page']===2 && count($tours2['items'])===2, 'Tour last page');
verify((int)$tours1['items'][0]['id']===8, 'Tour order');

$url=homeGalleryPageUrl('tours',2,1,2);
verify($url==='/?tours_page=2&materials_page=2#tours', 'Tour link preserves materials page');
$url=homeGalleryPageUrl('materials',1,2,2);
verify($url==='/?tours_page=2#panoramas', 'Materials link preserves tours page');

$galleryType='tours';$gallery=$tours2;$toursGallery=$tours2;$materialsGallery=$materials2;
ob_start();require __DIR__.'/../src/home-gallery-view.php';$html=ob_get_clean();
verify(substr_count($html,'class="tour-card')===2, 'Tour fragment has two cards');
verify(str_contains($html,'data-gallery-results') && str_contains($html,'data-gallery-page'), 'Fragment has async hooks');

echo "Home gallery pagination passed\n";
