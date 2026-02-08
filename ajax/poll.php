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
$sources = $module->getConfiguredActiveRemoteSources(PROJECT_ID);

#endregion

#region Batch pending jobs by type

// Note: We batch jobs by type to let the type's implementation to decide how to 
// handle multiple pending jobs of the same type.
// They might, as in case of BioPortal, send a unified request and split the response back up.
// Others might dispatch only the first and further defer the rest.


$supported_types = [
	'bioportal',
];
$jobs_by_type = [];
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
	$meta = $source['meta'] ?? [];
	$type = $meta['type'] ?? null;
	// Check that type is supported
	if (!in_array($type, $supported_types, true)) {
		continue;
	}
	$jobs_by_type[$type][] = $job;
	$requested_pending_ok[] = $sid;
}


#endregion

#region Process jobs

$results = [];
$pending = [];
$errors = [];
// Add an error for any pending request that could not be assigned
foreach ($requested_pending as $sid => $_) {
	if (!in_array($sid, $requested_pending_ok, true)) {
		$errors[$sid] = [
			'rid' => $rid,
			'error' => 'job_not_found',
		];
	}
}
$limitPerSource = $module->getMaxSearchResultsPerSource();

foreach ($jobs_by_type as $type => $jobs) {

	if ($type === 'bioportal') {
		$q = $jobs[0]['q'];
		// Aggregate acronyms
		$acr_q_r_map = [];
		$acr_src_map = [];
		foreach ($jobs as $job) {
			$sid = $job['sid'];
			$source = $sources[$sid];
			$acr_q_r_map[$source['meta']['q_acronym']] = $source['meta']['r_acronym'];
			$acr_src_map[$source['meta']['q_acronym']] = $sid;
		}
		try {
			$bp = $module->getBioPortalApiDetails();
			$byAcr = $module->searchBioPortal(
				$cache,
				$bp,
				$acr_q_r_map,
				$q,
				$limitPerSource
			);
			// Untangle and assign to sources
			foreach ($acr_src_map as $acr => $sid) {
				$results[$sid] = $byAcr[$acr] ?? [];
			}
			// Mark jobs as done
			foreach ($jobs as $job) {
				$cache->setPayload($job['cache_key'], ['done' => true], 5, []);
			}
		} catch (Throwable $e) {
			foreach ($jobs as $job) {
				$sid = $job['sid'];
				$token = $job['token'];
				$errors[$sid] = $e->getMessage();
				$pending[$sid] = [
					'token' => $requested_pending[$sid],
					'after_ms' => 500,
				];
			}
		}
	}
}

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