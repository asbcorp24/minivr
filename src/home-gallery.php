<?php
declare(strict_types=1);

/** Bound, server-side pagination for the two public homepage galleries. */
function homeGalleryPage(PDO $db, string $kind, mixed $requested): array {
    if (!in_array($kind, ['tours', 'materials'], true)) {
        throw new InvalidArgumentException('Unknown homepage gallery');
    }

    $perPage = $kind === 'tours' ? 6 : 12;
    $countSql = $kind === 'tours'
        ? 'SELECT COUNT(*) FROM tours WHERE published=1'
        : 'SELECT COUNT(*) FROM panoramas WHERE published=1';
    $total = (int)$db->query($countSql)->fetchColumn();
    $pages = max(1, (int)ceil($total / $perPage));
    $valid = filter_var($requested, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    $page = min($pages, $valid === false ? 1 : $valid);
    $offset = ($page - 1) * $perPage;

    $sql = $kind === 'tours'
        ? 'SELECT t.*,(SELECT COUNT(*) FROM tour_scenes s WHERE s.tour_id=t.id) scene_count,'
          .'(SELECT COALESCE(p.preview,p.image) FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id '
          .'WHERE s.tour_id=t.id ORDER BY s.sort_order,s.id LIMIT 1) fallback_cover '
          .'FROM tours t WHERE t.published=1 ORDER BY t.id DESC LIMIT :count OFFSET :offset'
        : 'SELECT id,title,description,image,projection,stereo FROM panoramas '
          .'WHERE published=1 ORDER BY id DESC LIMIT :count OFFSET :offset';
    $query = $db->prepare($sql);
    $query->bindValue(':count', $perPage, PDO::PARAM_INT);
    $query->bindValue(':offset', $offset, PDO::PARAM_INT);
    $query->execute();

    $visible = array_values(array_unique(array_merge(
        [1, $pages], range(max(1, $page - 2), min($pages, $page + 2))
    )));
    sort($visible, SORT_NUMERIC);

    return [
        'items' => $query->fetchAll(),
        'page' => $page,
        'pages' => $pages,
        'perPage' => $perPage,
        'offset' => $offset,
        'total' => $total,
        'visible' => $visible,
    ];
}

/** Preserve the other gallery's page and jump to the relevant section. */
function homeGalleryPageUrl(string $kind, int $page, int $tourPage, int $materialsPage): string {
    $params = [];
    $tours = $kind === 'tours' ? $page : $tourPage;
    $materials = $kind === 'materials' ? $page : $materialsPage;
    if ($tours > 1) $params['tours_page'] = $tours;
    if ($materials > 1) $params['materials_page'] = $materials;
    $query = $params ? '?'.http_build_query($params, '', '&', PHP_QUERY_RFC3986) : '';
    return '/'.$query.'#'.($kind === 'tours' ? 'tours' : 'panoramas');
}
