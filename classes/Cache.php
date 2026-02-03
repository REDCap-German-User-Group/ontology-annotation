<?php

declare(strict_types=1);

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use RuntimeException;

/**
 * Unified cache layer with pluggable backends:
 *  - ModuleLogCacheBackend: stores cache entries in redcap_external_modules_log (instance-wide; project_id IS NULL)
 *  - FileCacheBackend: stores cache entries as files in a stable, dedicated directory (NOT REDCap temp)
 *
 * Design goals:
 *  - Same API regardless of backend
 *  - Append-only writes (DB backend) for low contention
 *  - Best-effort dogpile protection via short "lock" entries
 *  - TTL-based expiration for remote caches; versioned keys for "forever" local indexes (e.g. idx:<sid>:<fileId>)
 *
 * Requirements / assumptions:
 *  - You provide a global helper function: query(string $sql, array $params): mysqli_result|bool
 *    which supports '?' placeholders including LIMIT ?.
 *  - mysqli_fetch_assoc() is available (standard PHP mysqli).
 */

/**
 * TTL helper utilities.
 */
final class CacheTtl
{
	/**
	 * Convert minutes to seconds.
	 * @param int $m Minutes.
	 * @return int Seconds.
	 */
	public static function minutes(int $m): int
	{
		return max(0, $m) * 60;
	}

	/**
	 * Convert hours to seconds.
	 * @param int $h Hours.
	 * @return int Seconds.
	 */
	public static function hours(int $h): int
	{
		return max(0, $h) * 3600;
	}

	/**
	 * Convert days to seconds.
	 * @param int $d Days.
	 * @return int Seconds.
	 */
	public static function days(int $d): int
	{
		return max(0, $d) * 86400;
	}

	/**
	 * Convert years to seconds (approx).
	 * @param int $y Years.
	 * @return int Seconds.
	 */
	public static function years(int $y): int
	{
		return max(0, $y) * 31536000;
	}
}

/**
 * Cache key builder.
 *
 * IMPORTANT:
 * - Never allow raw user input to become the cache key.
 * - Use stable normalized query + normalized params + hashed key material.
 *
 * Key conventions used by this file:
 * - Remote search cache: r:<sid>:<hash>
 * - Local immutable index: idx:<sid>:<fileId>
 * - Locks: lock:<key>
 */
final class CacheKey
{
	/**
	 * Build a cache key for remote search results.
	 *
	 * @param int    $sid       Source id (configurable).
	 * @param string $qNorm     Normalized query (trimmed, lowercase, collapsed whitespace, etc.).
	 * @param array  $paramsNorm Normalized parameters (ontology, lang, limit, filters...). Must be deterministic.
	 * @return string Cache key like "r:12:8f3a..."
	 */
	public static function remote(int $sid, string $qNorm, array $paramsNorm): string
	{
		$paramsNorm = self::normalizeParams($paramsNorm);
		$paramsJson = json_encode($paramsNorm, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		$paramsHash = substr(sha1($paramsJson === false ? '{}' : $paramsJson), 0, 24);

		// Version prefix ("v1") allows global invalidation by bumping it.
		$h = substr(sha1("v1|sid=$sid|q=$qNorm|p=$paramsHash"), 0, 24);
		return "r:$sid:$h";
	}

	/**
	 * Build a cache key for a local prebuilt index that is versioned by fileId.
	 * This is effectively "forever", because replacing the source yields a new fileId.
	 *
	 * @param int $sid    Source id.
	 * @param int $fileId Integer id in REDCap file storage.
	 * @return string Cache key like "idx:src_{uuidhex}:18422"
	 */
	public static function localIndex(int $sid, int $fileId): string
	{
		return "idx:$sid:$fileId";
	}

	/**
	 * Wrap any cache key to create a lock key.
	 *
	 * @param string $key Cache key.
	 * @return string Lock key like "lock:r:12:..."
	 */
	public static function lock(string $key): string
	{
		return "lock:$key";
	}

	/**
	 * Recursively normalize arrays so JSON encoding is stable (sorted keys).
	 *
	 * @param array $params Input parameters.
	 * @return array Normalized parameters.
	 */
	private static function normalizeParams(array $params): array
	{
		ksort($params);
		foreach ($params as $k => $v) {
			if (is_array($v)) $params[$k] = self::normalizeParams($v);
		}
		return $params;
	}
}

/**
 * Backend interface for the cache store.
 *
 * All backends store and return "envelopes" (associative arrays) like:
 * [
 *   'v' => 1,
 *   'expires' => 1700000123, // unix timestamp; 0 means "never expires"
 *   'payload' => [...],      // array
 *   'meta' => [...]          // optional
 * ]
 */
interface CacheBackend
{
	/**
	 * Get an envelope for a key, or null if not found.
	 * Backends should not enforce expiry; Cache::getPayload enforces expiry uniformly.
	 *
	 * @param string $key Cache key.
	 * @return array|null Envelope array or null.
	 */
	public function getEnvelope(string $key): ?array;

	/**
	 * Store an envelope for a key.
	 *
	 * @param string $key Cache key.
	 * @param array $envelope Envelope array (will be JSON-encoded by backend).
	 * @return void
	 */
	public function setEnvelope(string $key, array $envelope): void;

	/**
	 * Best-effort lock acquisition to prevent dogpiling.
	 * Should be short-lived and safe even if the process dies (lease expires).
	 *
	 * @param string $lockKey  Lock key (usually CacheKey::lock($key)).
	 * @param int    $leaseSec Lease duration in seconds.
	 * @return bool True if lock acquired.
	 */
	public function acquireLock(string $lockKey, int $leaseSec): bool;

	/**
	 * Release a lock if the backend supports it. For append-only log locks, this can be a no-op.
	 *
	 * @param string $lockKey Lock key.
	 * @return void
	 */
	public function releaseLock(string $lockKey): void;

	/**
	 * Prune old cache artifacts according to policy.
	 * Policy is backend-specific but should accept:
	 *  - 'lock'   => age seconds for lock artifacts
	 *  - 'remote' => age seconds for remote cache artifacts
	 *  - 'index'  => age seconds for local index artifacts
	 *  - 'batch'  => max rows/files to delete per category
	 *
	 * @param array $policy Prune policy.
	 * @return void
	 */
	public function prune(array $policy): void;
}

/**
 * Main cache API.
 *
 * Provides:
 * - getPayload(): returns payload array or null if missing/expired
 * - setPayload(): store payload with TTL
 * - rememberPayload(): get-or-build with best-effort lock; returns payload or ['__pending'=>true]
 */
final class Cache
{
	/**
	 * @var CacheBackend
	 */
	private CacheBackend $backend;

	/**
	 * @param CacheBackend $backend Backend implementation.
	 */
	public function __construct(CacheBackend $backend)
	{
		$this->backend = $backend;
	}

	/**
	 * Check if a rememberPayload() result signals "pending" (someone else is building).
	 *
	 * @param mixed $payload Return value from rememberPayload().
	 * @return bool True if pending sentinel.
	 */
	public static function isPending($payload): bool
	{
		return is_array($payload) && !empty($payload['__pending']);
	}

	/**
	 * Get the payload for a key, enforcing expiry.
	 *
	 * @param string $key Cache key.
	 * @return array|null Payload array or null if missing/expired/invalid.
	 */
	public function getPayload(string $key): ?array
	{
		$env = $this->backend->getEnvelope($key);
		if ($env === null) return null;

		$expires = (int)($env['expires'] ?? 0);
		if ($expires > 0 && $expires < time()) return null;

		$payload = $env['payload'] ?? null;
		return is_array($payload) ? $payload : null;
	}

	/**
	 * Store a payload with TTL.
	 *
	 * TTL semantics:
	 * - ttlSec > 0: expires at (now + ttlSec)
	 * - ttlSec == 0: never expires (use with versioned keys like idx:<sid>:<fileId>)
	 *
	 * @param string $key Cache key.
	 * @param array  $payload Payload data (must be array).
	 * @param int    $ttlSec TTL seconds (0 = no expiry).
	 * @param array  $meta Optional metadata to include in envelope.
	 * @return void
	 */
	public function setPayload(string $key, array $payload, int $ttlSec, array $meta = []): void
	{
		$ttlSec = max(0, $ttlSec);

		$env = [
			'v' => 1,
			'expires' => $ttlSec === 0 ? 0 : (time() + $ttlSec),
			'payload' => $payload,
		];
		if (!empty($meta)) $env['meta'] = $meta;

		$this->backend->setEnvelope($key, $env);
	}

	/**
	 * Get payload if cached; otherwise attempt to lock, build, and store.
	 *
	 * If the lock cannot be acquired, returns ['__pending' => true] so the caller can
	 * respond "pending" and let the client poll (or just try again later).
	 *
	 * @param string   $key Cache key.
	 * @param int      $ttlSec TTL seconds for stored payload (0 = no expiry).
	 * @param callable $builder Function that builds payload; must return array on success.
	 * @param array    $meta Optional metadata.
	 * @param int      $lockLeaseSec Lock lease seconds (best-effort).
	 * @return array Payload array OR pending sentinel array.
	 */
	public function rememberPayload(
		string $key,
		int $ttlSec,
		callable $builder,
		array $meta = [],
		int $lockLeaseSec = 5
	) {
		$hit = $this->getPayload($key);
		if ($hit !== null) return $hit;

		$lockKey = CacheKey::lock($key);
		if (!$this->backend->acquireLock($lockKey, $lockLeaseSec)) {
			return ['__pending' => true];
		}

		try {
			$payload = $builder();
			if (!is_array($payload)) return ['__pending' => true];

			$this->setPayload($key, $payload, $ttlSec, $meta);
			return $payload;
		} finally {
			$this->backend->releaseLock($lockKey);
		}
	}

	/**
	 * Prune cache artifacts based on policy.
	 *
	 * Intended to be run from cron (e.g., hourly).
	 *
	 * @param array $policy Policy (see CacheBackend::prune()).
	 * @return void
	 */
	public function prune(array $policy): void
	{
		$this->backend->prune($policy);
	}
}

/**
 * DB backend that stores cache entries in redcap_external_modules_log.
 *
 * Uses:
 * - external_module_id = $emId
 * - project_id IS NULL (instance-wide)
 * - record = cache key (indexed)
 * - message = JSON envelope (MEDIUMTEXT)
 *
 * Writes are append-only. Reads always take latest entry by ORDER BY log_id DESC LIMIT 1.
 */
final class ModuleLogCacheBackend implements CacheBackend
{
	/**
	 * @var int External module id.
	 */
	private int $emId;

	/**
	 * @var string Identifier used in lock acquisition to detect "ownership".
	 */
	private string $ownerId;

	/**
	 * @param int $externalModuleId External module id.
	 */
	public function __construct(int $externalModuleId)
	{
		$this->emId = $externalModuleId;
		$this->ownerId = 'pid:' . getmypid();
	}

	/**
	 * @inheritDoc
	 */
	public function getEnvelope(string $key): ?array
	{
		$row = $this->selectLatest($key);
		if (!$row) return null;

		$env = json_decode($row['message'], true);
		return is_array($env) ? $env : null;
	}

	/**
	 * @inheritDoc
	 */
	public function setEnvelope(string $key, array $envelope): void
	{
		$msg = json_encode($envelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		if ($msg === false) return;

		$sql = <<<SQL
			INSERT INTO redcap_external_modules_log
				(`timestamp`, `ui_id`, `ip`, `external_module_id`, `project_id`, `record`, `message`)
			VALUES
				(NOW(), NULL, NULL, ?, NULL, ?, ?)
		SQL;
		db_query($sql, [$this->emId, $key, $msg]);
	}

	/**
	 * @inheritDoc
	 */
	public function acquireLock(string $lockKey, int $leaseSec): bool
	{
		$leaseSec = max(1, min(60, $leaseSec));
		$now = time();

		// Check latest lock record.
		$row = $this->selectLatest($lockKey);
		if ($row) {
			$msg = json_decode($row['message'], true);
			if (is_array($msg)) {
				$leaseUntil = (int)($msg['lease_until'] ?? 0);
				$by = (string)($msg['by'] ?? '');
				if ($leaseUntil > $now && $by !== $this->ownerId) {
					return false;
				}
			}
		}

		// Append our lock row.
		$lockMsg = json_encode([
			'v' => 1,
			'lease_until' => $now + $leaseSec,
			'by' => $this->ownerId
		], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

		if ($lockMsg === false) return false;

		$sql = <<<SQL
			INSERT INTO redcap_external_modules_log
				(`timestamp`, `ui_id`, `ip`, `external_module_id`, `project_id`, `record`, `message`)
			VALUES
				(NOW(), NULL, NULL, ?, NULL, ?, ?)
		SQL;
		db_query($sql, [$this->emId, $lockKey, $lockMsg]);

		// Confirm we won: latest lock should be ours (latest-row-wins).
		// Optional tiny yield can reduce race frequency under extreme concurrency:
		// usleep(1000);

		$row2 = $this->selectLatest($lockKey);
		if (!$row2) return false;

		$msg2 = json_decode($row2['message'], true);
		if (!is_array($msg2)) return false;

		return (($msg2['by'] ?? '') === $this->ownerId) && ((int)($msg2['lease_until'] ?? 0) > $now);
	}

	/**
	 * @inheritDoc
	 */
	public function releaseLock(string $lockKey): void
	{
		// Append-only lock design: no release needed; lease expires and cron prunes old lock rows.
	}

	/**
	 * @inheritDoc
	 */
	public function prune(array $policy): void
	{
		$batch = (int)($policy['batch'] ?? 20000);
		$batch = max(1, min(50000, $batch));

		$lockAge   = max(60, (int)($policy['lock'] ?? 3600));
		$remoteAge = max(60, (int)($policy['remote'] ?? 3 * 86400));
		$indexAge  = max(60, (int)($policy['index'] ?? 180 * 86400));

		$this->deleteByPrefixAndAge('lock:%', $lockAge, $batch);
		$this->deleteByPrefixAndAge('r:%', $remoteAge, $batch);
		$this->deleteByPrefixAndAge('idx:%', $indexAge, $batch);
	}

	/**
	 * Fetch latest row for a record key.
	 *
	 * @param string $record Record key.
	 * @return array|null Row with at least ['message'=>...], or null.
	 */
	private function selectLatest(string $record): ?array
	{
		$sql = <<<SQL
			SELECT log_id, message, `timestamp`
			FROM redcap_external_modules_log
			WHERE external_module_id = ?
			AND project_id IS NULL
			AND record = ?
			ORDER BY log_id DESC
			LIMIT 1
		SQL;
		$res = db_query($sql, [$this->emId, $record]);
		if (!$res) return null;

		$row = mysqli_fetch_assoc($res);
		return $row ?: null;
	}

	/**
	 * Delete rows matching a record prefix older than a given age.
	 *
	 * @param string $like Record LIKE pattern (e.g. 'r:%').
	 * @param int    $ageSec Delete entries older than now-ageSec.
	 * @param int    $limit Batch size.
	 * @return void
	 */
	private function deleteByPrefixAndAge(string $like, int $ageSec, int $limit): void
	{
		$ageSec = max(60, $ageSec);
		$limit  = max(1, $limit);

		$sql = <<<SQL
			DELETE FROM redcap_external_modules_log
			WHERE external_module_id = ?
				AND project_id IS NULL
				AND record LIKE ?
				AND `timestamp` < DATE_SUB(NOW(), INTERVAL ? SECOND)
			LIMIT ?
		SQL;
		db_query($sql, [$this->emId, $like, $ageSec, $limit]);
	}
}

/**
 * File backend that stores cache envelopes in a dedicated, stable directory.
 *
 * WARNING:
 * - Do NOT use REDCap's temp directory if it is periodically cleared.
 * - Use a dedicated path outside REDCap temp (Option A).
 *
 * Storage layout (simple and safe):
 * - <dir>/<prefix>_<sha1(key)>.json
 * - Locks: <dir>/lock_<sha1(lockKey)>.lock held via flock() (non-blocking).
 *
 * Pruning uses filemtime() and patterns; this is fine for a dedicated cache directory.
 */
final class FileCacheBackend implements CacheBackend
{
	/**
	 * @var string Cache directory path.
	 */
	private string $dir;

	/**
	 * @param string $dir Directory for cache files. Must be writable.
	 */
	public function __construct(string $dir)
	{
		$this->dir = rtrim($dir, DIRECTORY_SEPARATOR);
		if (!is_dir($this->dir)) @mkdir($this->dir, 0770, true);
	}

	/**
	 * @inheritDoc
	 */
	public function getEnvelope(string $key): ?array
	{
		$path = $this->pathFor($key);
		if (!is_file($path)) return null;

		$raw = @file_get_contents($path);
		if ($raw === false) return null;

		$env = json_decode($raw, true);
		return is_array($env) ? $env : null;
	}

	/**
	 * @inheritDoc
	 */
	public function setEnvelope(string $key, array $envelope): void
	{
		$path = $this->pathFor($key);
		$tmp  = $path . '.' . getmypid() . '.tmp';

		$raw = json_encode($envelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
		if ($raw === false) return;

		@file_put_contents($tmp, $raw, LOCK_EX);
		@rename($tmp, $path);
	}

	/**
	 * @inheritDoc
	 */
	public function acquireLock(string $lockKey, int $leaseSec): bool
	{
		$leaseSec = max(1, min(60, $leaseSec));

		$lp = $this->lockPathFor($lockKey);
		$fh = @fopen($lp, 'c');
		if (!$fh) return false;

		if (!flock($fh, LOCK_EX | LOCK_NB)) {
			fclose($fh);
			return false;
		}

		// Store lease info for debugging (not required for correctness).
		$data = json_encode(['lease_until' => time() + $leaseSec, 'by' => 'pid:' . getmypid()]);
		@ftruncate($fh, 0);
		@fwrite($fh, $data === false ? '' : $data);
		@fflush($fh);

		// Keep handle open so lock remains held.
		$GLOBALS['__FILE_CACHE_LOCKS'][$lockKey] = $fh;
		return true;
	}

	/**
	 * @inheritDoc
	 */
	public function releaseLock(string $lockKey): void
	{
		$fh = $GLOBALS['__FILE_CACHE_LOCKS'][$lockKey] ?? null;
		if ($fh) {
			@flock($fh, LOCK_UN);
			@fclose($fh);
			unset($GLOBALS['__FILE_CACHE_LOCKS'][$lockKey]);
		}
	}

	/**
	 * @inheritDoc
	 */
	public function prune(array $policy): void
	{
		$batch = (int)($policy['batch'] ?? 20000);
		$batch = max(1, min(50000, $batch));

		$lockAge   = max(60, (int)($policy['lock'] ?? 3600));
		$remoteAge = max(60, (int)($policy['remote'] ?? 3 * 86400));
		$indexAge  = max(60, (int)($policy['index'] ?? 180 * 86400));

		$this->pruneByGlobAndAge('lock_*.lock', $lockAge, $batch);
		$this->pruneByGlobAndAge('r_*.json', $remoteAge, $batch);
		$this->pruneByGlobAndAge('idx_*.json', $indexAge, $batch);
	}

	/**
	 * Prune files matching glob pattern older than age.
	 *
	 * @param string $pattern Glob pattern relative to cache dir.
	 * @param int    $ageSec Delete files older than now-ageSec.
	 * @param int    $limit Batch size.
	 * @return void
	 */
	private function pruneByGlobAndAge(string $pattern, int $ageSec, int $limit): void
	{
		$cutoff = time() - $ageSec;
		$files = glob($this->dir . DIRECTORY_SEPARATOR . $pattern) ?: [];
		$n = 0;

		foreach ($files as $f) {
			if ($n >= $limit) break;
			$mt = @filemtime($f);
			if ($mt !== false && $mt < $cutoff) {
				@unlink($f);
				$n++;
			}
		}
	}

	/**
	 * Determine filename prefix for key type.
	 *
	 * @param string $key Cache key.
	 * @return string Prefix ("r", "idx", "lock", "x").
	 */
	private function prefixFor(string $key): string
	{
		if (str_starts_with($key, 'r:')) return 'r';
		if (str_starts_with($key, 'idx:')) return 'idx';
		if (str_starts_with($key, 'lock:')) return 'lock';
		return 'x';
	}

	/**
	 * Compute path for an envelope file.
	 *
	 * @param string $key Cache key.
	 * @return string Absolute path to cache JSON file.
	 */
	private function pathFor(string $key): string
	{
		$p = $this->prefixFor($key);
		return $this->dir . DIRECTORY_SEPARATOR . $p . '_' . sha1($key) . '.json';
	}

	/**
	 * Compute path for a lock file.
	 *
	 * @param string $lockKey Lock key.
	 * @return string Absolute path to lock file.
	 */
	private function lockPathFor(string $lockKey): string
	{
		return $this->dir . DIRECTORY_SEPARATOR . 'lock_' . sha1($lockKey) . '.lock';
	}
}

/**
 * Factory to build a Cache instance based on module settings.
 *
 * Suggested module system settings:
 * - cache_backend: "module_log" (default) or "file"
 * - file_cache_dir: only needed for file backend
 */
final class CacheFactory
{
	/**
	 * Create cache from settings.
	 *
	 * @param string $backend "module_log" or "file".
	 * @param int    $emId External module id (required for module_log backend).
	 * @param string|null $fileDir Cache directory if backend="file".
	 * @return Cache Cache instance.
	 */
	public static function create(string $backend, int $emId, string|null $fileDir = null): Cache
	{
		$backend = $backend ?: 'module_log';

		if ($backend === 'file') {
			$fileDir = trim($fileDir ?? '');
			if ($fileDir !== '') {
				return new Cache(new FileCacheBackend($fileDir));
			}
			// If file backend requested but not configured, fall back to module_log.
		}

		if ($emId <= 0) {
			throw new RuntimeException('CacheFactory: invalid emId');
		}
		return new Cache(new ModuleLogCacheBackend($emId));
	}
}
