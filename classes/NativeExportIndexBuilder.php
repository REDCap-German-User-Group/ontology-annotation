<?php

declare(strict_types=1);

namespace DE\RUB\OntologiesMadeEasyExternalModule;

require_once __DIR__ . '/RomeFhirExtensions.php';

use RuntimeException;
use stdClass;

/**
 * Native export Index Builder (v0).
 *
 * Extracts codings from:
 *  - dataElements.coding[] (Coding)
 *  - dataElements.valueCodingMap. (Coding)
 *  - dataElements.unit (Coding)
 *
 * Produces a flat payload:
 *  [
 *    'v' => 0,
 *    'entries' => [
 *      [
 *        'system' => string,
 *        'code' => string,
 *        'display' => string,
 *        'type' => [ 'native' => [...], 'mapped' => [...] ], // optional at query time
 *        '_q' => string, // pre-normalized search text (internal)
 *      ],
 *      ...
 *    ]
 *  ]
 *
 * Notes:
 *  - "type" is stored in the payload for future compatibility checks.
 *  - "mapped" is left empty for now.
 *  - No scoring/indexing here; v0 search scans entries.
 */

final class NativeExportIndexBuilder implements LocalSourceIndexBuilder
{
	public function supports(string $kind): bool
	{
		return $kind === 'native_rome';
	}

	public function buildFromDocId(int $docId, array $options = []): BuildResult
	{
		list($mimeType, $docName, $fileContent) = \REDCap::getFile($docId);

		return $this->buildFromJsonString($fileContent, $options);
	}

	public function buildFromJsonString(string $jsonString, array $options = []): BuildResult
	{
		$data = json_decode($jsonString, true);
		if (!is_array($data)) {
			throw new RuntimeException('Invalid JSON in ROME_Ontology_Annotations file.');
		}

		// resourceType should be "ROME_Ontology_Annotations"
		$rt = isset($data['resourceType']) ? (string)$data['resourceType'] : '';
		if ($rt !== '' && $rt !== 'ROME_Ontology_Annotations') {
			// TODO: Should we throw an exception here?
			// We can continue and do a best effort scan
		}

		$url = '';
		if (isset($data['url']) && is_string($data['url'])) {
			$url = trim($data['url']);
		}

		$title = '';
		if (isset($data['title']) && is_string($data['title'])) {
			$title = trim($data['title']);
		}

		$description = '';
		if (isset($data['description']) && is_string($data['description'])) {
			$description = trim($data['description']);
		}

		$entries = [];
		$items = $data['dataElements'] ?? [];
		if (is_array($items)) {
			$this->walkItems($items, $entries);
		}

		// Deduplicate by system|code|display (keeps payload smaller and search stable)
		$entries = $this->dedupeEntries($entries);

		$systemCounts = $this->countSystems($entries);

		$payload = [
			'v' => 0,
			'url' => $url,
			'title' => $title,
			'description' => $description,
			'system_counts' => $systemCounts,
			'entries' => $entries,
		];

		return new BuildResult('native_rome', count($entries), $payload);
	}

	/**
	 * Recursively walk ROME_Ontology_Annotations.dataElements[].
	 *
	 * @param array $items
	 * @param array $entries out
	 * @return void
	 */
	private function walkItems(array $items, array &$entries): void
	{
		foreach ($items as $item) {
			if (!is_array($item)) continue;

			$itemType = isset($item['type']) ? (string)$item['type'] : '';

			// A) dataElements.coding[] (Coding)
			if (isset($item['coding']) && is_array($item['coding'])) {
				foreach ($item['coding'] as $coding) {
					$e = $this->codingToEntry($coding, $itemType);
					if ($e !== null) {
						$entries[] = $e;
					}
				}
			}

			// B) dataElements.valueCodingMap[].coding (Coding)
			if (isset($item['valueCodingMap']) && is_array($item['valueCodingMap'])) {
				foreach ($item['valueCodingMap'] as $code => $vcm) {
					if (!is_array($vcm)) continue;
					if (isset($vcm['coding']) && is_array($vcm['coding'])) {
						foreach ($vcm['coding'] as $coding) {
							$e = $this->codingToEntry($coding, $itemType);
							if ($e !== null) {
								$entries[] = $e;
							}
						}
					}
				}
			}

			// C) dataElements.unit[].coding for unit annotations
			if (isset($item['unit']) && is_array($item['unit'])) {
				$unitCodings = $item['unit']['coding'] ?? [];
				foreach ($unitCodings as $coding) {
					$e = $this->codingToEntry($coding, $itemType);
					if ($e !== null) {
						$entries[] = $e;
					}
				}
			}
		}
	}

	/**
	 * Convert a Coding array into a normalized entry.
	 *
	 * @param mixed $coding
	 * @param string $itemType ROME_Ontology_Annotations dataElements.type
	 * @return array|null
	 */
	private function codingToEntry($coding, string $itemType): ?array
	{
		if (!is_array($coding)) return null;

		$system  = isset($coding['system']) ? trim((string)$coding['system']) : '';

		// Skip REDCap's own codes
		if ($system === ROME_FHIR_Extensions::ROME_REDCAP_CHOICE) {
			return null;
		}

		$code    = isset($coding['code']) ? trim((string)$coding['code']) : '';
		$display = isset($coding['display']) ? trim((string)$coding['display']) : '';

		if ($system === '' || $code === '') {
			// Require at least system+code
			return null;
		}

		// Pre-normalized search text (internal): code, display
		$q = $this->normalizeForSearch($code . ' ' . $display);

		// "type" is optional in response, but we can store it in index payload now.
		// mapped/native intentionally empty-ish for v0. Use stdClass to serialize as {} if you ever emit it.
		$type = [
			'mapped' => new stdClass(), // to be filled later
			'native' => [
				'format' => 'rome',
				'item_type' => $itemType,
			],
		];

		return [
			'system' => $system,
			'code' => $code,
			'display' => $display,
			'type' => $type,
			'_q' => $q,
		];
	}

	private function normalizeForSearch(string $s): string
	{
		$s = mb_strtolower($s);
		// crude whitespace normalization
		$s = preg_replace('/\s+/u', ' ', $s) ?? $s;
		return trim($s);
	}

	private function dedupeEntries(array $entries): array
	{
		$seen = [];
		$out = [];
		foreach ($entries as $e) {
			if (!is_array($e)) continue;
			$k = ($e['system'] ?? '') . "\n" .
				($e['code'] ?? '') . "\n" .
				($e['display'] ?? '');
			if (isset($seen[$k])) continue;
			$seen[$k] = true;
			$out[] = $e;
		}
		return $out;
	}

	private function countSystems(array $entries): array
	{
		$systemCounts = [];
		foreach ($entries as $e) {
			$sys = (string)($e['system'] ?? '');
			if ($sys === '') continue;
			$systemCounts[$sys] = ($systemCounts[$sys] ?? 0) + 1;
		}
		ksort($systemCounts, SORT_STRING);
		return $systemCounts;
	}
}
