<?php
/** Shared public player. Include near closing body tag. */
$miniVrTracks=db()->query("SELECT title,artist,file_path FROM music_tracks WHERE is_active=1 ORDER BY sort_order,id")->fetchAll();
if($miniVrTracks): ?>
<style>
#music-player{position:fixed;z-index:1000;right:12px;bottom:12px;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:9px 12px;background:#071824ee;border:1px solid #36738d;border-radius:16px;color:white;box-shadow:0 12px 36px #0009;font:13px system-ui;backdrop-filter:blur(12px)}
#music-player button{background:#153849;border:1px solid #43849d;border-radius:50%;width:34px;height:34px;color:white;cursor:pointer;flex-shrink:0}
#music-player .music-toggle{background:#00a9ce;color:#00141d}
#music-player .music-meta{display:flex;flex-direction:column;min-width:0;max-width:145px;overflow:hidden}
#music-player .music-title,#music-player .music-artist{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#music-player .music-artist{color:#9fc2ce}
body:has(#viewer) #music-player{top:58px;bottom:auto;right:12px;z-index:15}
body:has(#viewer).cardboard #music-player,body:has(#viewer).xr-presenting #music-player{display:none!important}
@media(max-width:600px){body:has(#viewer) #music-player{top:48px;right:8px;padding:5px 8px;gap:5px;max-width:calc(100vw - 16px);border-radius:12px}body:has(#viewer) #music-player button{width:29px;height:29px}body:has(#viewer) #music-player .music-meta{max-width:105px}}
body.music-player-hidden #music-player{display:none}
</style>
<div id="music-player" aria-label="Музыкальный плеер">
<button class="music-prev" aria-label="Предыдущий трек">❮</button>
<button class="music-toggle" aria-label="Воспроизвести">▶</button>
<button class="music-next" aria-label="Следующий трек">❯</button>
<div class="music-meta"><strong class="music-title"></strong><small class="music-artist"></small></div>
<button class="music-minimize" aria-label="Свернуть плеер">−</button>
<audio id="music-audio" preload="metadata"></audio>
</div>
<script type="application/json" id="music-tracks-data"><?=json_encode($miniVrTracks,JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)?></script>
<script src="/assets/music-player.js?v=<?=filemtime(__DIR__.'/assets/music-player.js')?>" defer></script>
<?php endif; ?>
