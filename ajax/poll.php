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
$cache = $module->getCache();
if ($cache == null) {
	json_fail(500, 'Cache is not available. Please contact your REDCap administrator.');
}

// --- Parse poll request body -----------------------------------------------

$req = read_json_body();

$rid = (int)($req['rid'] ?? 0);
$pendingReq = $req['pending'] ?? [];

$results = [];
$pending = [];
$errors = [];

foreach ($pendingReq as $srcKey => $token) {
	$cacheKey = 'job:' . $token;
	$job = $cache->getPayload($cacheKey);
	if (!is_array($job) || !empty($job['done'])) {
		continue; // expired or invalid, or done
	}

	// sanity check
	if (($job['rid'] ?? null) !== $rid) {
		continue;
	}

	$acr = $job['acronym'];
	$q   = $job['q'];

	try {
		$bp = $module->getBioPortalApiDetails();
		$byAcr = $module->searchBioPortal($cache, $bp, [$acr], $q, 20);

		$results[$srcKey] = $byAcr[$acr] ?? [];

		// Mark job as done
		$cache->setPayload($cacheKey, ['done' => true], 5, ['kind' => 'bioportal_job_done']);
	} catch (Throwable $e) {
		$errors[$srcKey] = $e->getMessage();
		$pending[$srcKey] = [
			'token' => $token,
			'after_ms' => 500,
		];
	}
}

header('Content-Type: application/json; charset=utf-8');
echo json_encode([
	'rid' => $rid,
	'results' => $results,
	'pending' => $pending,
	'errors' => $errors ?: new stdClass(),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);





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
