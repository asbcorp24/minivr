# MiniVR shared AI model storage

All downloadable AI model definitions live in `src/ai-models.php`. The registry is the single source of truth for model IDs, versions, licenses, runtimes, purposes, and exact files required by each model.

## Storage layout

Each model is stored under `public/models/{model-id}/`.

The installer writes a `minivr-manifest.json` after every required file has passed size validation. Model IDs are validated and file paths are registry-controlled; request parameters cannot choose arbitrary paths or download URLs.

## Admin

Open `/admin/models.php` to see all registered models, install or repair missing files, inspect file sizes, and remove a model.

## Read-only API

- `GET /api/models.php` — lists every registered model and its installation status.
- `GET /api/models.php?id={model-id}` — returns metadata and model path only when all required files are present; responds with HTTP 409 otherwise.

## Adding a model

Add an entry to `miniVrAiModelRegistry()` in `src/ai-models.php`:

- stable lowercase `id`;
- user-facing name and purpose;
- provider, pinned revision, license and runtime;
- tags describing the tools that use it;
- `files` map with relative path, pinned source URL and acceptable min/max file size.

No new admin page, installer, storage layout or status endpoint is needed. The model consumer should request its model by ID from `/api/models.php`, then configure its runtime to load from `/models/`.

## Browser cache

Transformers.js browser caching is enabled by the current depth editor integration. Browser cache is separate from the server's canonical model copy and can be evicted by browser storage policies. Server files remain the source of truth.

## Validation

Run `php tests/ai-model-registry.php`.

This validates registry metadata and safe file manifest paths without downloading model weights.
