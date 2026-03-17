<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use stdClass;
use Throwable;

// Check project context
if (!defined('PROJECT_ID')) {
	json_fail(403, 'Must be called in a project context.');
}

/** @var OntologiesMadeEasyExternalModule $module */

$module->initProject(PROJECT_ID);
$module->initConfig();

#region Request Parsing and Checks

$req = read_json_body();

// Check request id
$rid = $req['rid'] ?? null;
if (!is_int($rid)) json_fail(400, 'Missing or invalid rid (must be an integer).');
$requested_pending = $req['pending'] ?? [];

// Init cache
$cache = $module->getCache();
if ($cache == null) {
	json_fail(500, 'Cache is not available. Please contact your REDCap administrator.');
}

// Get remote sources
$source_registry = $module->buildSourceRegistry(PROJECT_ID, 'remote');
$sources = $source_registry['map'];


#endregion

#region Batch pending jobs by type

// Note: We batch jobs by type to let the type's implementation to decide how to 
// handle multiple pending jobs of the same type.
// They might prefer to send a unified request and then split the response back up.
// Others might dispatch only the first and further defer the rest.


$supported_kinds = [
	'bioportal',
	'snowstorm',
];
$jobs_by_kind = [];
$requested_pending_ok = [];

foreach ($requested_pending as $sid => $token) {
	$cacheKey = 'job:' . $token;
	$job = $cache->getPayload($cacheKey);
	if (!is_array($job) || !empty($job['done'])) {
		continue; // expired or invalid, or done
	}
	// Add cache key and token to job for later use
	$job['cache_key'] = $cacheKey;
	$job['token'] = $token;

	// Request IDs must match
	if (($job['rid'] ?? null) !== $rid) {
		continue;
	}
	// The source must exist
	if (!isset($sources[$job['sid']])) {
		continue;
	}
	$source = $sources[$job['sid']];
	$kind = $source['kind'] ?? null;
	// Check that type is supported
	if (!in_array($kind, $supported_kinds, true)) {
		continue;
	}
	$jobs_by_kind[$kind][] = $job;
	$requested_pending_ok[$sid] = $token;
}


#endregion

#region Process jobs

$results = [];
$pending = [];
$errors = [];
// Add an error for any pending request that could not be assigned
foreach ($requested_pending as $sid => $_) {
	if (!array_key_exists($sid, $requested_pending_ok)) {
		$errors[$sid] = [
			'rid' => $rid,
			'error' => 'job_not_found',
		];
	}
}
$limitPerSource = $module->getMaxSearchResultsPerSource();

// Process of jobs is done in two steps: 
// 1. We check the cache and serve cached results for pending jobs
// 2. We process jobs that are not yet cached, bug only one. The rest will remain pending

// Search cached results, and add non-cached jobs to pending_by_kind
$pending_by_kind = [];
foreach ($jobs_by_kind as $kind => $jobs) {
	foreach ($jobs as $job) {
		$sid = $job['sid'];
		$source = $sources[$sid];
		if ($source['meta']['from_system']) {
			$source['meta'] = $module->getSourceByKey($source['meta']['system_source_id']);
		}
		try {
			$result = $module->searchCached($cache, $job['q'], $source);
			if ($result === null) {
				// Job is not cached, add to pending
				$pending_by_kind[$kind][] = $job;
			}
			else {
				// Add result
				$results[$sid] = $result;
				// Mark jobs as done
				$cache->setPayload($job['cache_key'], ['done' => true], 5, []);
			}
		}
		catch (Throwable $e) {
			$errors[$sid] = $e->getMessage();
			// We do not care about the job if it failed beyond reporting the error
		}
	}
}

// Process pending jobs that will require an actual search
// We do this based on assumption that some kinds are faster than others
// and thus we process Snowstorm before BioPortal.
// Later, we may parallelize this or let the client decide on priority.
do {
	// Snowstorm
	if (isset($pending_by_kind['snowstorm'])) {
		// Get first job
		$job = $pending_by_kind['snowstorm'][0];
		unset($pending_by_kind['snowstorm'][0]);
		// Process
		$sid = $job['sid'];
		$source = $sources[$sid];
		if ($source['meta']['from_system']) {
			$source['meta'] = $module->getSourceByKey($source['meta']['system_source_id']);
		}
		try {
			$results[$sid] = $module->searchSnowstorm($cache, $job['q'], $source, $limitPerSource);
			// Mark jobs as done
			$cache->setPayload($job['cache_key'], ['done' => true],  5, []);
		}
		catch (Throwable $e) {
			$errors[$sid] = $e->getMessage();
			// We do not care about the job if it failed beyond reporting the error
		}
		break; // out of do-while
	}
	// BioPortal
	if (isset($pending_by_kind['bioportal'])) {
		// Get first job
		$job = $pending_by_kind['bioportal'][0];
		unset($pending_by_kind['bioportal'][0]);
		// Process
		$sid = $job['sid'];
		$source = $sources[$sid];
		if ($source['meta']['from_system']) {
			$source['meta'] = $module->getSourceByKey($source['meta']['system_source_id']);
		}
		try {
			$results[$sid] = $module->searchBioPortal($cache, $job['q'], $source, $limitPerSource);
			// Mark jobs as done
			$cache->setPayload($job['cache_key'], ['done' => true], 5, []);
		}
		catch (Throwable $e) {
			$errors[$sid] = $e->getMessage();
			// We do not care about the job if it failed beyond reporting the error
		}
		break; // out of do-while
	}
}
while (false);

// Add all remaining as pending
foreach ($pending_by_kind as $kind => $jobs) {
	foreach ($jobs as $job) {
		$pending[$job['sid']] = [
			'token' => $job['token'],
			'after_ms' => 20, // can be more or less immediate
		];
	}
}

// Send response
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
	'rid' => $rid,
	'results' => $results,
	'pending' => $pending,
	'errors' => $errors ?: new stdClass(),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);


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