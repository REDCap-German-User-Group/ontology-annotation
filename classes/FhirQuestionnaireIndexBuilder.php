<?php

declare(strict_types=1);

namespace DE\RUB\OntologiesMadeEasyExternalModule;

require_once __DIR__ . '/RomeFhirExtensions.php';

use RuntimeException;
use stdClass;

/**
 * FHIR Questionnaire Index Builder (v0).
 *
 * Extracts codings from:
 *  - item.code[] (Coding)
 *  - item.answerOption[].valueCoding (Coding)
 *  - item.extension[].valueCoding for Questionnaire unit annotations
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

final class FhirQuestionnaireIndexBuilder implements LocalSourceIndexBuilder
{
	public function supports(string $kind): bool
	{
		return $kind === 'fhir_questionnaire';
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
			throw new RuntimeException('Invalid JSON in Questionnaire file.');
		}

		// resourceType should be "Questionnaire"
		$rt = isset($data['resourceType']) ? (string)$data['resourceType'] : '';
		if ($rt !== '' && $rt !== 'Questionnaire') {
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
		$items = $data['item'] ?? [];
		if (is_array($items)) {
			$this->walkItems($items, $entries, []);
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

		return new BuildResult('fhir_questionnaire', count($entries), $payload);
	}

	/**
	 * Recursively walk Questionnaire.item[].
	 *
	 * @param array $items
	 * @param array $entries out
	 * @param array $path linkId path (internal only; not exposed to client)
	 * @return void
	 */
	private function walkItems(array $items, array &$entries, array $path): void
	{
		foreach ($items as $item) {
			if (!is_array($item)) continue;

			$linkId = isset($item['linkId']) ? (string)$item['linkId'] : '';
			$nextPath = $path;
			if ($linkId !== '') $nextPath[] = $linkId;

			$itemType = isset($item['type']) ? (string)$item['type'] : '';

			// A) item.code[] (Coding)
			if (isset($item['code']) && is_array($item['code'])) {
				foreach ($item['code'] as $coding) {
					$e = $this->codingToEntry($coding, $itemType, 'field');
					if ($e !== null) {
						$entries[] = $e;
					}
				}
			}

			// B) item.answerOption[].valueCoding (Coding)
			if (isset($item['answerOption']) && is_array($item['answerOption'])) {
				foreach ($item['answerOption'] as $ao) {
					if (!is_array($ao)) continue;
					if (isset($ao['valueCoding'])) {
						$e = $this->codingToEntry($ao['valueCoding'], $itemType, 'choice', $this->getChoiceTargetName($ao));
						if ($e !== null) {
							$entries[] = $e;
						}
					}
				}
			}

			// C) item.extension[].valueCoding for unit annotations
			if (isset($item['extension']) && is_array($item['extension'])) {
				foreach ($item['extension'] as $extension) {
					$e = $this->extensionToUnitEntry($extension, $itemType);
					if ($e !== null) {
						$entries[] = $e;
					}
				}
			}

			// Recurse into nested items
			if (isset($item['item']) && is_array($item['item'])) {
				$this->walkItems($item['item'], $entries, $nextPath);
			}
		}
	}

	/**
	 * Convert a FHIR Coding array into a normalized entry.
	 *
	 * @param mixed $coding
	 * @param string $itemType FHIR Questionnaire item.type
	 * @param string $target ROME target type: field, choice, or unit
	 * @param string $targetName Optional native target identifier
	 * @return array|null
	 */
	private function codingToEntry($coding, string $itemType, string $target, string $targetName = ''): ?array
	{
		if (!is_array($coding)) return null;

		$system  = isset($coding['system']) ? trim((string)$coding['system']) : '';
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
				'format' => 'fhir',
				'item_type' => $itemType,
				'target' => $target,
			],
		];
		if ($targetName !== '') {
			$type['native']['target_name'] = $targetName;
		}

		return [
			'system' => $system,
			'code' => $code,
			'display' => $display,
			'type' => $type,
			'_q' => $q,
		];
	}

	private function extensionToUnitEntry($extension, string $itemType): ?array
	{
		if (!is_array($extension)) return null;
		$url = isset($extension['url']) ? (string)$extension['url'] : '';
		if (!in_array($url, [RomeFhirExtensions::QUESTIONNAIRE_UNIT, RomeFhirExtensions::ROME_QUESTIONNAIRE_UNIT], true)) {
			return null;
		}
		return $this->codingToEntry($extension['valueCoding'] ?? null, $itemType, 'unit');
	}

	private function getChoiceTargetName(array $answerOption): string
	{
		if (empty($answerOption['extension']) || !is_array($answerOption['extension'])) return '';
		foreach ($answerOption['extension'] as $extension) {
			if (!is_array($extension)) continue;
			if (($extension['url'] ?? '') !== RomeFhirExtensions::ROME_REDCAP_CHOICE) continue;
			if (empty($extension['extension']) || !is_array($extension['extension'])) continue;
			foreach ($extension['extension'] as $part) {
				if (!is_array($part)) continue;
				if (($part['url'] ?? '') === 'code' && isset($part['valueString'])) {
					return (string)$part['valueString'];
				}
			}
		}
		return '';
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
			$native = $e['type']['native'] ?? [];
			$k = ($e['system'] ?? '') . "\n" .
				($e['code'] ?? '') . "\n" .
				($e['display'] ?? '') . "\n" .
				($native['target'] ?? '') . "\n" .
				($native['target_name'] ?? '');
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
