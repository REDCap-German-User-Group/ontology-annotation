<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use Exception;
use stdClass;
use Throwable;

// Check project context
if (!defined('PROJECT_ID')) {
	json_fail(403, 'Must be called in a project context.');
}

/** @var OntologiesMadeEasyExternalModule $module */

$module->initProject(PROJECT_ID);
$module->initConfig();

#region Parse search request body

$req = read_json_body();

// Check query is present
$q = isset($req['q']) && is_string($req['q']) ? trim($req['q']) : '';
if ($q === '') json_fail(400, 'Missing query string q.');
// Check query length
$qLen = mb_strlen($q);
$qMinLen = $module->getMinSearchLength();
if ($qLen < $qMinLen) json_fail(400, "Query string must be at least $qMinLen characters long.");
// Check request id
$rid = $req['rid'] ?? null;
if (!is_int($rid)) json_fail(400, 'Missing or invalid rid (must be an integer).');

// Parse source_ids: optional
$sourceIds = [];
if (isset($req['source_ids'])) {
	if (!is_array($req['source_ids'])) json_fail(400, 'source_ids must be an array.');
	foreach ($req['source_ids'] as $sid) {
		if (is_string($sid) && $sid !== '') $sourceIds[] = $sid;
	}
	$sourceIds = array_values(array_unique($sourceIds));
}

#endregion

# region Init cache and build registry

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


#endregion

#region Perform search in sources

$limitPerSource = $module->getMaxSearchResultsPerSource();
$results = [];
$pending = [];
$errors = [];
$stats = [];

foreach ($sourceIds as $sid) {
	if (!isset($sources_map[$sid])) {
		$errors[$sid] = 'Unknown or not permitted source.';
		continue;
	}

	$src = $sources_map[$sid];
	
	if ($src['deferred'] !== true) {
		try {
			performLocalSearch($q, $src, $cache, $limitPerSource, $results, $errors, $stats);
		}
		catch (Exception $e) {
			$errors[$sid] = 'Failed to perform search: ' . $e->getMessage();
		}
	}
	else {
		try {
			deferSearch($q, $rid, $sid, $cache, $pending);
		}
		catch (Exception $e) {
			$errors[$sid] = 'Failed to defer search: ' . $e->getMessage();
		}
	}
}

#endregion

// Send response to client

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
	'rid' => $rid,
	'results' => $results,
	'pending' => $pending,
	'errors' => $errors ?: new stdClass(),
	'stats' => $stats ?: new stdClass(),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

exit;

#region Local Search

function performLocalSearch($q, $src, $cache, $limit, &$results, &$errors, &$stats)
{
	$sid = $src['id'];
	// Local sources require a doc_id to be specified.
	$docId = (int)($src['doc_id'] ?? 0);
	if ($docId <= 0) {
		$errors[$sid] = 'Invalid source version.';
		return;
	}
	// Local sources must have been build (and therefor have a cached payload).
	$indexKey = 'idx:' . $sid . ':' . $docId;
	$payload = $cache->getPayload($indexKey);
	if ($payload === null) {
		$errors[$sid] = 'Index missing (not built yet).';
		return;
	}
	try {
		$results[$sid] = search_local_index($payload, $q, $limit);
	} catch (Throwable $e) {
		$errors[$sid] = 'Search failed: ' . $e->getMessage();
	}
}

function search_local_index(array $indexPayload, string $q, int $limitPerSource = 20): array
{
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

#region Deferred search

function deferSearch($q, $rid, $sid, $cache, &$pending) {
	// Create a deferred job token
	$token = bin2hex(random_bytes(16));

	// Store job descriptor in cache (short-lived)
	$cache->setPayload(
		'job:' . $token,
		[
			'rid' => $rid,
			'q' => $q,
			'sid' => $sid,
			'created_at' => time(),
		],
		300, // 5 min TTL
		[]
	);

	// Tell client this source is pending
	$pending[$sid] = [
		'token' => $token,
		'after_ms' => 300,
	];
}

#endregion

#region JSON Helpers

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


#endregion
