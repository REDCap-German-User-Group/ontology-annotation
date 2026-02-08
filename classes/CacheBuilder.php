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
