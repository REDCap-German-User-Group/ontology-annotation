<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use stdClass;
use Throwable;

// --- Check project context -------------------------------------------------

if (!defined('PROJECT_ID')) {
	json_fail(403, 'Must be called in a project context.');
}

/** @var OntologiesMadeEasyExternalModule $module */

$module->initProject(PROJECT_ID);
$module->initConfig();

// --- Parse search request body ---------------------------------------------

$req = read_json_body();

$_POST;

$q = isset($req['q']) && is_string($req['q']) ? trim($req['q']) : '';
if ($q === '') json_fail(400, 'Missing query string q.');
$rid = $req['rid'] ?? null;
if (!is_int($rid)) json_fail(400, 'Missing or invalid rid (must be an integer).');

// source_ids: optional
$sourceIds = [];
if (isset($req['source_ids'])) {
	if (!is_array($req['source_ids'])) json_fail(400, 'source_ids must be an array.');
	foreach ($req['source_ids'] as $sid) {
		if (is_string($sid) && $sid !== '') $sourceIds[] = $sid;
	}
	$sourceIds = array_values(array_unique($sourceIds));
}

// --- Build cache and registry ----------------------------------------------

$cache = $module->getCache();
if ($cache == null) {
	json_fail(500, 'Cache is not available. Please contact your REDCap administrator.');
}

// Effective sources for this project
$sources_map = $module->buildSourceRegistry(PROJECT_ID)['map'];

// If client didn't specify, search all effective sources
if (count($sourceIds) === 0) {
	$sourceIds = array_keys($sources_map);
}

$results = [];
$errors = [];
$stats = [];

// --- Dispatch search -------------------------------------------------------

foreach ($sourceIds as $sid) {
	if (!isset($sources_map[$sid])) {
		$errors[$sid] = 'Unknown or not permitted source.';
		continue;
	}

	$src = $sources_map[$sid];

	// Expected fields in your src descriptor:
	// - doc_id (int)
	// - kind (string) (optional if all are fhir for now)
	$docId = (int)($src['doc_id'] ?? 0);
	if ($docId <= 0) {
		$errors[$sid] = 'Invalid source version.';
		continue;
	}

	$indexKey = 'idx:' . $sid . ':' . $docId;
	$payload = $cache->getPayload($indexKey);
	if ($payload === null) {
		$errors[$sid] = 'Index missing (not built yet).';
		continue;
	}

	// Real implementation later: search within payload
	try {
		$results[$sid] = search_local_index(
			$payload,
			$q,
			$module->getMinSearchLength(),
			20
		);
	} catch (Throwable $e) {
		$errors[$sid] = 'Search failed: ' . $e->getMessage();
	}
}

if (empty($errors)) $errors = (object)[];
if (empty($stats))  $stats  = (object)[];

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
	'rid' => $rid,
	'results' => $results,
	'errors' => $errors,
	'stats' => $stats,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);


#region Search / Search Helpers

function json_fail(int $code, string $message): void
{
	http_response_code($code);
	header('Content-Type: application/json; charset=utf-8');
	echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
	exit;
}

function read_json_body(): array
{
	$raw = file_get_contents('php://input');
	if ($raw === false) return [];
	// Remove CSRF token
	$pos = mb_strpos($raw, '&redcap_csrf_token');
	if ($pos !== false) $raw = trim(mb_substr($raw, 0, $pos));
	if ($raw === '') return [];
	$data = json_decode($raw, true);
	return is_array($data) ? $data : [];
}

/**
 * Stub search: replace this with your real index search.
 * Must return an array of result objects.
 */
function search_local_index(array $indexPayload, string $q, int $minChars = 2, int $limitPerSource = 20): array
{
	$q = trim($q);
	if (mb_strlen($q) < $minChars) return [];

	$needle = mb_strtolower($q);
	$needle = preg_replace('/\s+/u', ' ', $needle) ?? $needle;
	$needle = trim($needle);

	$entries = $indexPayload['entries'] ?? [];
	if (!is_array($entries)) return [];

	$hits = [];
	foreach ($entries as $e) {
		if (!is_array($e)) continue;

		$hay = (string)($e['_q'] ?? '');
		if ($hay === '') continue;

		$pos = mb_strpos($hay, $needle);
		if ($pos === false) continue;

		// crude score: earlier match slightly higher; exact code/display boosts
		$score = 1.0;
		$code = (string)($e['code'] ?? '');
		$disp = (string)($e['display'] ?? '');
		if (mb_strtolower($code) === $needle) $score += 2.0;
		if (mb_strtolower($disp) === $needle) $score += 1.0;
		$score += max(0.0, 0.5 - min(0.5, $pos / 200.0));

		$hit = [
			'system' => (string)$e['system'],
			'code' => (string)$e['code'],
			'display' => (string)($e['display'] ?? ''),
			'score' => $score,
		];

		// type is optional: only include if present in index
		if (isset($e['type']) && is_array($e['type'])) {
			$hit['type'] = $e['type'];
		}

		$hits[] = $hit;
	}

	usort($hits, fn($a, $b) => ($b['score'] <=> $a['score']));
	if ($limitPerSource > 0) $hits = array_slice($hits, 0, $limitPerSource);

	return $hits;
}


#endregion
