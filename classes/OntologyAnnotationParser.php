<?php

declare(strict_types=1);

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use InvalidArgumentException;

/**
 * Implementation of the ontology annotation parser with fixed options.
 *
 * Options:
 * - 'tag' (string, required): marker, e.g. "@ONTOLOGY"
 * - 'getMinAnnotation' (callable, required): returns minimal/fallback annotation array
 * - 'validate' (callable|null, optional): function(array $obj): bool, may expose ->errors or ['errors']
 *
 * Returns an object with method parse(string $text): array
 *
 * Parse result array keys:
 * - json (array)            Parsed JSON object (assoc array) OR minimal fallback
 * - usedFallback (bool)     True if fallback was used
 * - numTags (int)           Number of tag occurrences found
 * - error (bool)            True only if tag(s) exist but none have valid JSON
 * - errorMessage (string)   Error message if error=true
 * - warnings (array)        List of ['line' => int, 'message' => string]
 * - text (string)           Exact substring from tag start to end of JSON (incl. optional closing quote)
 * - start (int)             0-based start offset of text in input, -1 if none
 * - end (int)               0-based end offset (exclusive), -1 if none
 */
final class OntologyAnnotationParser
{
	private string $tag;
	private $getMinAnnotation;
	private $validate;




	public function __construct(array $options)
	{
		if (!isset($options['tag']) || !is_string($options['tag']) || $options['tag'] === '') {
			throw new InvalidArgumentException('createOntologyAnnotationParser: tag must be a non-empty string');
		}
		if (!isset($options['getMinAnnotation']) || !is_callable($options['getMinAnnotation'])) {
			throw new InvalidArgumentException('createOntologyAnnotationParser: getMinimalOntologyAnnotation must be a function');
		}

		$this->tag = $options['tag'];
		$this->getMinAnnotation = $options['getMinAnnotation'];
		$this->validate = (isset($options['validate']) && is_callable($options['validate'])) ? $options['validate'] : null;
	}

	public function parse(string $text): array
	{
		$result = [
			'json' => ($this->getMinAnnotation)(),
			'usedFallback' => true,
			'numTags' => 0,
			'error' => false,
			'errorMessage' => '',
			'warnings' => [],
			'text' => '',
			'start' => -1,
			'end' => -1,
		];

		if ($text === '') return $result;

		$lineStarts = self::computeLineStarts($text);

		$idx = 0;
		$lastValid = null;     // ['json'=>array,'start'=>int,'end'=>int,'text'=>string]
		$lastFailure = null;   // ['line'=>int,'message'=>string]

		while (true) {
			$tagIdx = strpos($text, $this->tag, $idx);
			if ($tagIdx === false) break;

			$result['numTags']++;
			$idx = $tagIdx + strlen($this->tag);

			$attempt = $this->parseOneTag($text, (int)$tagIdx, strlen($this->tag));
			if ($attempt['ok']) {
				$lastValid = $attempt['value'];
			} else {
				$line = self::indexToLine($lineStarts, (int)$tagIdx);
				$message = isset($attempt['reason']) ? $attempt['reason'] : 'Unknown parse error';
				$warning = ['line' => $line, 'message' => $message];
				$result['warnings'][] = $warning;
				$lastFailure = $warning;
			}
		}

		if ($result['numTags'] === 0) {
			return $result; // no annotation present
		}

		if ($lastValid !== null) {
			$result['json'] = $lastValid['json'];
			$result['usedFallback'] = false;
			$result['text'] = $lastValid['text'];
			$result['start'] = $lastValid['start'];
			$result['end'] = $lastValid['end'];
			return $result;
		}

		$result['error'] = true;
		if ($lastFailure) {
			$result['errorMessage'] = $this->tag . ' present but no valid JSON found. Last issue at line ' .
				$lastFailure['line'] . ': ' . $lastFailure['message'];
		} else {
			$result['errorMessage'] = $this->tag . ' present but no valid JSON found.';
		}
		return $result;
	}

	private function parseOneTag(string $s, int $tagIdx, int $tagLen): array
	{
		$len = strlen($s);
		$i = $tagIdx + $tagLen;

		// TAG [ws]
		while ($i < $len && self::isWS($s[$i])) $i++;

		// =
		if ($i >= $len || $s[$i] !== '=') {
			return ['ok' => false, 'reason' => 'Missing "=" after tag'];
		}
		$i++;

		// [ws]
		while ($i < $len && self::isWS($s[$i])) $i++;

		if ($i >= $len) {
			return ['ok' => false, 'reason' => 'JSON object missing after "=" (end of text)'];
		}

		// Optional quote wrapper
		$quote = null;
		if ($s[$i] === "'" || $s[$i] === '"') {
			$quote = $s[$i];
			$i++;
			while ($i < $len && self::isWS($s[$i])) $i++; // tolerate ws after quote
		}

		if ($i >= $len || $s[$i] !== '{') {
			return ['ok' => false, 'reason' => 'JSON object missing after "=" (expected "{")'];
		}

		$scan = self::scanJsonObject($s, $i);
		if (!$scan['ok']) {
			return ['ok' => false, 'reason' => $scan['reason']];
		}

		$jsonText = substr($s, $scan['start'], $scan['end'] - $scan['start']);

		// If quoted, require closing quote after JSON
		$end = (int)$scan['end']; // end of JSON object by default
		if ($quote !== null) {
			$j = $end;
			while ($j < $len && self::isWS($s[$j])) $j++;
			if ($j >= $len || $s[$j] !== $quote) {
				return ['ok' => false, 'reason' => 'Missing closing ' . $quote . ' after JSON object'];
			}
			$end = $j + 1; // include closing quote
		}

		// JSON parse
		$parsed = json_decode($jsonText, true);
		if (json_last_error() !== JSON_ERROR_NONE) {
			return ['ok' => false, 'reason' => 'JSON.parse failed: ' . json_last_error_msg()];
		}
		if (!is_array($parsed)) {
			return ['ok' => false, 'reason' => 'Parsed JSON is not an object'];
		}

		// Optional schema validation (only on parsed tag JSON)
		if ($this->validate) {
			$ok = ($this->validate)($parsed);
			if (!$ok) {
				$errors = null;

				// Support validators that expose errors as property or array key
				if (is_object($this->validate) && property_exists($this->validate, 'errors')) {
					$errors = $this->validate->errors;
				} elseif (is_array($this->validate) && isset($this->validate['errors'])) {
					$errors = $this->validate['errors'];
				} elseif (is_object($this->validate) && method_exists($this->validate, 'getErrors')) {
					$errors = $this->validate->getErrors();
				}

				$msg = self::formatValidatorErrors($errors);
				return ['ok' => false, 'reason' => 'Schema validation failed: ' . $msg];
			}
		}

		$start = $tagIdx;

		return [
			'ok' => true,
			'value' => [
				'json' => $parsed,
				'start' => $start,
				'end' => $end,
				'text' => substr($s, $start, $end - $start),
			],
		];
	}

	private static function isWS(string $ch): bool
	{
		return $ch === ' ' || $ch === "\t" || $ch === "\n" || $ch === "\r" || $ch === "\f" || $ch === "\v";
	}

	private static function computeLineStarts(string $s): array
	{
		$starts = [0];
		$len = strlen($s);
		for ($i = 0; $i < $len; $i++) {
			if ($s[$i] === "\n") $starts[] = $i + 1;
		}
		return $starts;
	}

	private static function indexToLine(array $starts, int $pos): int
	{
		$lo = 0;
		$hi = count($starts) - 1;
		while ($lo <= $hi) {
			$mid = ($lo + $hi) >> 1;
			if ($starts[$mid] <= $pos) $lo = $mid + 1;
			else $hi = $mid - 1;
		}
		return max(1, $hi + 1);
	}

	private static function formatValidatorErrors($errors): string
	{
		if (!is_array($errors) || count($errors) === 0) return 'Unknown validation error';
		$slice = array_slice($errors, 0, 3);
		$parts = [];
		foreach ($slice as $e) {
			$instancePath = '(root)';
			$message = 'invalid';

			if (is_array($e)) {
				if (isset($e['instancePath']) && $e['instancePath'] !== '') $instancePath = (string)$e['instancePath'];
				elseif (isset($e['dataPath']) && $e['dataPath'] !== '') $instancePath = (string)$e['dataPath']; // some validators
				if (isset($e['message']) && $e['message'] !== '') $message = (string)$e['message'];
			} elseif (is_object($e)) {
				if (isset($e->instancePath) && $e->instancePath !== '') $instancePath = (string)$e->instancePath;
				if (isset($e->message) && $e->message !== '') $message = (string)$e->message;
			}

			$parts[] = $instancePath . ': ' . $message;
		}
		$more = count($errors) > 3 ? ' (+' . (count($errors) - 3) . ' more)' : '';
		return implode('; ', $parts) . $more;
	}

	private static function scanJsonObject(string $s, int $start): array
	{
		$depth = 0;
		$inString = false;
		$escape = false;

		$len = strlen($s);
		for ($i = $start; $i < $len; $i++) {
			$ch = $s[$i];

			if ($inString) {
				if ($escape) {
					$escape = false;
				} elseif ($ch === '\\') {
					$escape = true;
				} elseif ($ch === '"') {
					$inString = false;
				}
				continue;
			}

			if ($ch === '"') {
				$inString = true;
				continue;
			}

			if ($ch === '{') {
				$depth++;
			} elseif ($ch === '}') {
				$depth--;
				if ($depth < 0) return ['ok' => false, 'reason' => 'Bracket mismatch: unexpected "}"'];
				if ($depth === 0) return ['ok' => true, 'start' => $start, 'end' => $i + 1];
			}
		}

		return ['ok' => false, 'reason' => 'Bracket mismatch: unterminated JSON object (reached end of text)'];
	}
}
