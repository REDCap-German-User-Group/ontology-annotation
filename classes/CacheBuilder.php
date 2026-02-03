<?php

declare(strict_types=1);

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use Exception, Throwable;

/**
 * Local source build helpers for repeatable (system/project) local sources.
 *
 * Provides:
 *  - BuildResult value object
 *  - LocalSourceIndexBuilder interface
 *  - DummyIndexBuilder implementation (payload="TEST")
 *  - generateSourceId(): returns "src_<uuidhex>" + canonical UUID (with hyphens)
 *  - ensureBuiltAndMetadata(): build local index + write cache + update internal metadata JSON
 *
 * Intended usage:
 *  - Call ensureBuiltAndMetadata() from your system/project config save hook for each local source entry.
 *  - Only write internal metadata at the END of a successful build (invariant).
 *  - Update metadata title/description when overrides change even if doc_id is unchanged.
 *
 */

/**
 * Result of building a local source search index.
 */
final class BuildResult
{
	/** @var string Source kind (e.g. "fhir_questionnaire"). */
	public string $kind;

	/** @var int Number of searchable items produced by the builder. */
	public int $itemCount;

	/** @var array Payload to be stored in cache (optimized for later search). */
	public array $payload;

	/**
	 * @param string $kind
	 * @param int $itemCount
	 * @param array $payload
	 */
	public function __construct(string $kind, int $itemCount, array $payload)
	{
		$this->kind = $kind;
		$this->itemCount = $itemCount;
		$this->payload = $payload;
	}
}

/**
 * Builder interface for local sources (e.g. FHIR Questionnaire JSON).
 *
 * The builder is NOT responsible for resolving title/description overrides.
 * It only builds a searchable payload and returns item counts/stats.
 */
interface LocalSourceIndexBuilder
{
	/**
	 * Whether this builder supports the given kind.
	 *
	 * @param string $kind Source kind (e.g. "fhir_questionnaire").
	 * @return bool
	 */
	public function supports(string $kind): bool;

	/**
	 * Build a search payload from a REDCap doc_id (file storage id).
	 *
	 * @param int $docId REDCap doc_id (file storage id).
	 * @param array $options Builder-specific options (kept for forward compatibility).
	 * @return BuildResult
	 */
	public function buildFromDocId(int $docId, array $options = []): BuildResult;
}

/**
 * Dummy builder for initial wiring/tests.
 *
 * Produces a tiny payload with "TEST" and itemCount=1.
 */
final class DummyIndexBuilder implements LocalSourceIndexBuilder
{
	/**
	 * @inheritDoc
	 */
	public function supports(string $kind): bool
	{
		return $kind === 'fhir_questionnaire';
	}

	/**
	 * @inheritDoc
	 */
	public function buildFromDocId(int $docId, array $options = []): BuildResult
	{
		$payload = [
			'kind' => 'dummy',
			'doc_id' => $docId,
			'data' => 'TEST',
		];

		return new BuildResult('fhir_questionnaire', 1, $payload);
	}
}

/**
 * Generate a stable module source id and its canonical UUID.
 *
 * Returns:
 *  - id:   "src_<uuidhex>"  (uuid without hyphens)
 *  - uuid: canonical UUID v4 with hyphens
 *
 * @return array{id:string, uuid:string}
 * @throws Exception
 */
function generateSourceId(): array
{
	// UUID v4: 16 random bytes with version/variant bits set.
	$b = random_bytes(16);
	$b[6] = chr((ord($b[6]) & 0x0f) | 0x40); // version 4
	$b[8] = chr((ord($b[8]) & 0x3f) | 0x80); // variant RFC 4122

	$hex = bin2hex($b); // 32 hex chars

	$uuid = substr($hex, 0, 8) . '-' .
		substr($hex, 8, 4) . '-' .
		substr($hex, 12, 4) . '-' .
		substr($hex, 16, 4) . '-' .
		substr($hex, 20, 12);

	return [
		'id' => 'src_' . $hex,
		'uuid' => $uuid,
	];
}

/**
 * Ensure a local source is built and its internal metadata is in sync.
 *
 * Invariants:
 *  - internal metadata is only written/updated after successful build OR for pure label updates
 *  - cache entry is written before metadata is written when a build is required
 *
 * Metadata update rules:
 *  - If metadata missing OR doc_id changed: build + write cache + write metadata
 *  - Else if resolved title/description changed: update metadata only
 *
 * @param Cache $cache Cache instance (DB/file backend).
 * @param LocalSourceIndexBuilder[] $builders List of builders; first matching supports($kind) is used.
 * @param array $entry A single repeatable entry, containing at least:
 *   - 'doc_id' (int|string) or 'file' (int|string) depending on your config field key
 *   - 'active' (bool-ish) optional (caller can skip inactive)
 *   - 'title_override' (string|null) optional
 *   - 'description_override' (string|null) optional
 *   - 'internal_metadata' (string|null) JSON string (hidden field)
 * @param array $opts Options:
 *   - 'kind' => string (default 'fhir_questionnaire')
 *   - 'doc_id_key' => string (default 'file') which key holds doc_id in $entry
 *   - 'meta_key' => string (default 'internal_metadata')
 *   - 'resolved_title' => string|null (if null, computed from overrides + fallback)
 *   - 'resolved_description' => string|null
 *   - 'fallback_title' => string (default 'Untitled')
 *   - 'fallback_description' => string (default '')
 *   - 'cache_ttl' => int (default 0 = no expiry)
 * @return array{
 *   updated_entry: array,
 *   meta: array|null,
 *   built: bool,
 *   warnings: string[],
 *   errors: string[]
 * }
 */
function ensureBuiltAndMetadata(
	Cache $cache,
	array $builders,
	array $entry,
	array $opts = []
): array {
	$warnings = [];
	$errors = [];
	$built = false;

	$kind = (string)($opts['kind'] ?? 'fhir_questionnaire');
	$docIdKey = (string)($opts['doc_id_key'] ?? 'file');
	$metaKey = (string)($opts['meta_key'] ?? 'internal_metadata');

	$fallbackTitle = (string)($opts['fallback_title'] ?? 'Untitled');
	$fallbackDesc = (string)($opts['fallback_description'] ?? '');
	$ttl = (int)($opts['cache_ttl'] ?? 0);

	$docIdRaw = $entry[$docIdKey] ?? null;
	$docId = is_numeric($docIdRaw) ? (int)$docIdRaw : 0;
	if ($docId <= 0) {
		$errors[] = "Missing or invalid doc_id in entry key '{$docIdKey}'.";
		return [
			'updated_entry' => $entry,
			'meta' => null,
			'built' => false,
			'warnings' => $warnings,
			'errors' => $errors,
		];
	}

	$resolvedTitle = $opts['resolved_title'] ?? null;
	$resolvedDesc  = $opts['resolved_description'] ?? null;

	if (!is_string($resolvedTitle) || trim($resolvedTitle) === '') {
		$t = $entry['title_override'] ?? '';
		$t = is_string($t) ? trim($t) : '';
		$resolvedTitle = ($t !== '') ? $t : $fallbackTitle;
	}
	if (!is_string($resolvedDesc)) {
		$d = $entry['description_override'] ?? '';
		$d = is_string($d) ? trim($d) : '';
		$resolvedDesc = ($d !== '') ? $d : $fallbackDesc;
	}

	$metaJson = $entry[$metaKey] ?? '';
	$meta = null;
	if (is_string($metaJson) && trim($metaJson) !== '') {
		$tmp = json_decode($metaJson, true);
		if (is_array($tmp)) $meta = $tmp;
	}

	$metaId = is_array($meta) ? (string)($meta['id'] ?? '') : '';
	$metaUuid = is_array($meta) ? (string)($meta['uuid'] ?? '') : '';
	$metaDocId = is_array($meta) ? (int)($meta['doc_id'] ?? 0) : 0;

	// Determine if we need to build.
	$needsBuild = ($meta === null) || ($metaId === '') || ($metaDocId !== $docId);

	// Select builder.
	$builder = null;
	foreach ($builders as $b) {
		if ($b instanceof LocalSourceIndexBuilder && $b->supports($kind)) {
			$builder = $b;
			break;
		}
	}
	if ($builder === null) {
		$errors[] = "No builder available for kind '{$kind}'.";
		return [
			'updated_entry' => $entry,
			'meta' => $meta,
			'built' => false,
			'warnings' => $warnings,
			'errors' => $errors,
		];
	}

	// If build is required and no stable id exists yet, generate one at build start.
	if ($needsBuild && ($metaId === '' || $metaUuid === '')) {
		try {
			$ids = generateSourceId();
			$metaId = $ids['id'];
			$metaUuid = $ids['uuid'];
		} catch (Exception $e) {
			$errors[] = "Failed to generate source id: " . $e->getMessage();
			return [
				'updated_entry' => $entry,
				'meta' => $meta,
				'built' => false,
				'warnings' => $warnings,
				'errors' => $errors,
			];
		}
	}

	// If metadata exists and doc_id unchanged, but labels changed -> metadata-only update.
	$labelsChanged = false;
	if (!$needsBuild && is_array($meta)) {
		$oldTitle = (string)($meta['title'] ?? '');
		$oldDesc  = (string)($meta['description'] ?? '');
		if ($oldTitle !== $resolvedTitle || $oldDesc !== $resolvedDesc) {
			$labelsChanged = true;
		}
	}

	// Build if required.
	if ($needsBuild) {
		try {
			$result = $builder->buildFromDocId($docId, [
				// reserved for future use
			]);

			// Cache key: versioned by doc_id.
			// Format: idx:<src_id>:<doc_id>
			$cacheKey = "idx:" . $metaId . ":" . $docId;

			// Store payload. TTL=0 means "never expires" (safe due to doc_id versioning).
			$cache->setPayload($cacheKey, $result->payload, $ttl, [
				'kind' => $result->kind,
				'id' => $metaId,
				'uuid' => $metaUuid,
				'doc_id' => $docId,
			]);

			$built = true;

			$meta = [
				'v' => 1,
				'id' => $metaId,
				'uuid' => $metaUuid,
				'doc_id' => $docId,
				'kind' => $result->kind,
				'title' => $resolvedTitle,
				'description' => $resolvedDesc,
				'item_count' => (int)$result->itemCount,
				'built_at' => date('c'),
			];

			if ((int)$result->itemCount === 0) {
				$warnings[] = "Source '{$resolvedTitle}' produced 0 searchable items. Check the source file or remove/replace it.";
			}
		} catch (Throwable $e) {
			$errors[] = "Build failed for '{$resolvedTitle}': " . $e->getMessage();
			return [
				'updated_entry' => $entry,
				'meta' => $meta,
				'built' => false,
				'warnings' => $warnings,
				'errors' => $errors,
			];
		}
	} elseif ($labelsChanged) {
		// Metadata-only update.
		$meta['title'] = $resolvedTitle;
		$meta['description'] = $resolvedDesc;
		$meta['v'] = (int)($meta['v'] ?? 1);

		// Preserve item_count/built_at as-is (they describe the built artifact).
		if (isset($meta['item_count']) && (int)$meta['item_count'] === 0) {
			$warnings[] = "Source '{$resolvedTitle}' has 0 searchable items. Check the source file or remove/replace it.";
		}
	} else {
		// No build, no label changes; still add warning if item_count==0.
		if (is_array($meta) && (int)($meta['item_count'] ?? 0) === 0) {
			$warnings[] = "Source '{$resolvedTitle}' has 0 searchable items. Check the source file or remove/replace it.";
		}
	}

	// Write back metadata JSON into entry (caller persists settings).
	if (is_array($meta)) {
		$entry[$metaKey] = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		if ($entry[$metaKey] === false) {
			// Should be rare; keep old metaJson if encoding fails.
			$entry[$metaKey] = $metaJson;
			$errors[] = "Failed to encode internal metadata JSON for '{$resolvedTitle}'.";
		}
	}

	return [
		'updated_entry' => $entry,
		'meta' => $meta,
		'built' => $built,
		'warnings' => $warnings,
		'errors' => $errors,
	];
}
