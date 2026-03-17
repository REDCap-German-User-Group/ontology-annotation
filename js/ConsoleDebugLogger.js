// js/ConsoleDebugLogger.js
// Copyright (c) 2026 Dr. Günther Rezniczek

/**
 * A console method name supported by this logger.
 * @typedef {'log'|'info'|'warn'|'error'} LogLevel
 */

/**
 * Source-location info parsed from a stack trace.
 * @typedef {Object} StackInfo
 * @property {string} link  Full clickable-ish location `url:line:col`
 * @property {string} url   Script URL / path
 * @property {number} line  1-based line number
 * @property {number} col   1-based column number
 */

/**
 * @typedef {Object} InternalLoggerState
 * @property {boolean} active
 * @property {string} name
 * @property {string} version
 * @property {string} promptPrefix
 */

/**
 * Logger configuration.
 * @typedef {Object} ConsoleDebugLoggerConfig
 * @property {boolean} [active] Enable/disable logging output
 * @property {string}  [name]   Prefix label (default: "DEBUG")
 * @property {string}  [version] Optional suffix (e.g. "v1.2.3")
 */

/**
 * Lazy log thunk. Must return an array of console arguments.
 *
 * @callback LazyArgsThunk
 * @returns {any[]}
 */

/**
 * The logger instance factory
 * @typedef {Object} ConsoleDebugLoggerFactory
 * @property {( cfg?:ConsoleDebugLoggerConfig ) => ConsoleDebugLoggerInstance} create 
 *   Creates a new logger instance.
 */

/**
 * The logger instance returned by `ConsoleDebugLogger.create()`.
 * @typedef {Object} ConsoleDebugLoggerInstance
 * @property {( ...args:any[]) => void} log 
 *   Logs a message to the console.
 * @property {( ...args:any[]) => void} info 
 *   Logs an info message to the console.
 * @property {( ...args:any[]) => void} warn 
 *   Logs a warning message to the console.
 * @property {( ...args:any[]) => void} error 
 *   Logs an error message to the console.
 * @property {( thunk:LazyArgsThunk ) => void} logLazy 
 * 	 Logs a message to the console lazily.
 * @property {( thunk:LazyArgsThunk ) => void} infoLazy 
 * 	 Logs an info message to the console lazily.
 * @property {( thunk:LazyArgsThunk ) => void} warnLazy 
 * 	 Logs a warning message to the console lazily.
 * @property {( thunk:LazyArgsThunk ) => void} errorLazy 
 * 	 Logs an error message to the console lazily.
 * @property {( cfg?:ConsoleDebugLoggerConfig ) => ConsoleDebugLoggerInstance} configure Configures the logger instance.
 */


/**
 * Simple debug logger with optional activation.
 *
 * Notes:
 *   - In Chrome/Chromium, stack trimming uses Error.captureStackTrace with a wrapper cutoff so the
 *     reported line points to the caller of logger.log/info/warn/error.
 *   - In Firefox, a correct line number is extracted from the stack trace (link may open the file instead of jumping).
 * 
 * @example
 * // 1) Create + configure (fluent)
 * const logger = ConsoleDebugLogger.create({ name: 'My Feature', version: '1.2.3', active: true });
 * logger.log('Hello', { some: 'data' });
 * @example
 * // 2) Or configure later
 * const logger2 = ConsoleDebugLogger.create();
 * logger2.configure({ name: 'My Feature', active: true });
 * logger2.info('Configured later');
 * @example
 * // 3) Destructure methods if you prefer
 * const { log, warn, error } = logger;
 * log('Init...', someData);
 * @example
 * // 4) Lazy logging (thunk evaluated only when the logger is active)
 * logger.logLazy(() => ['Computed:', expensiveComputation()]);
 *
 * @type {ConsoleDebugLoggerFactory}
 */
const ConsoleDebugLogger = {
	/**
	 * Create a new logger instance.
	 * @param {ConsoleDebugLoggerConfig} [cfg]
	 * @returns {ConsoleDebugLoggerInstance}
	 */
	create(cfg = {}) {
		/** @type {InternalLoggerState} */
		const config = { active: false, name: 'DEBUG', version: '', promptPrefix: '' };

		/** @type {RegExp[]} */
		const skipPatterns = [
			/\/ConsoleDebugLogger(\.m?js)?\b/i
		];

		/** @type {ConsoleDebugLoggerInstance} */
		const instance = {
			// Regular variants
			log: (...args) => logMode('log', args, instance.log),
			info: (...args) => logMode('info', args, instance.info),
			warn: (...args) => logMode('warn', args, instance.warn),
			error: (...args) => logMode('error', args, instance.error),
			// Lazy variants
			logLazy: (fn) => logModeLazy('log', fn, instance.logLazy),
			infoLazy: (fn) => logModeLazy('info', fn, instance.infoLazy),
			warnLazy: (fn) => logModeLazy('warn', fn, instance.warnLazy),
			errorLazy: (fn) => logModeLazy('error', fn, instance.errorLazy),
			// Configuration
			configure: (cfg) => configureLogger(cfg)
		};

		/**
		 * Capture a stack trace and return the first relevant frame outside the logger.
		 *
		 * @param {Function} cutoffFn
		 *   Function used as cutoff for `Error.captureStackTrace` (Chrome/Chromium).
		 * @returns {StackInfo|null}
		 */
		function infoFromStack(cutoffFn) {
			const err = {};
			const hasCapture = typeof Error.captureStackTrace === 'function';

			if (hasCapture) {
				// Chrome
				Error.captureStackTrace(err, typeof cutoffFn === 'function' ? cutoffFn : infoFromStack);
			}
			else {
				// Other browsers
				try {
					throw new Error();
				}
				catch (e) {
					err.stack = e.stack || '';
				}
			}
			const lines = String(err.stack || '').split('\n');
			for (const rawLine of lines) {
				const line = rawLine.trim();
				// Skip "Error" and empty lines
				if (line === '' || line === 'Error' || line.startsWith('Error:')) continue;
				// Firefox format: "func@url:line:col"
				// Chrome format: "at func (url:line:col)" or "at url:line:col"
				// We'll try to extract "url:line:col"
				const m =
					line.match(/@(.+?):(\d+):(\d+)$/) ||     // Firefox
					line.match(/\((.+?):(\d+):(\d+)\)$/) ||  // Chrome (with parens)
					line.match(/at\s+(.+?):(\d+):(\d+)$/);   // Chrome (no parens)

				if (!m) continue;

				const url = m[1];
				// Skip logger/internal frames by pattern (when captureStackTrace is not available)
				if (!hasCapture && skipPatterns.some(re => re.test(url))) continue;

				const lineNo = Number(m[2]);
				const colNo = Number(m[3]);
				const link = `${m[1]}:${lineNo}:${colNo}`;
				return { link, url, line: lineNo, col: colNo };
			}
			return null;
		}

		/**
		* Core log implementation.
		*
		* @param {LogLevel} mode Console method to use.
		* @param {any[]} args Arguments to pass to the console.
		* @param {Function} cutoffFn
		*   Function used as cutoff for stack trimming (usually the public wrapper method).
		* @param {boolean} [force=false]
		*   If true, log even when logger is inactive (used for warnings related to use of the logger).
		* @returns {void}
		*/
		function logMode(mode, args, cutoffFn, force = false) {
			if (!config.active && !force) return;

			// Get stack info to point to the correct place of logging
			const info = infoFromStack(cutoffFn);
			const prompt = `${force ? '[ConsoleDebugLogger] ' : ''}${config.promptPrefix} [${info?.line ?? '??'}]`;
			// Log
			if (typeof console === 'undefined') return;
			if (typeof console[mode] !== 'function') {
				if (mode === 'log') return;
				mode = 'log';
			}
			const output = console[mode];
			if (info) output.call(console, prompt, ...args, '\n', info.link);
			else output.call(console, prompt, ...args);
		}

		/**
		 * Lazy logging variant. The thunk is only evaluated when logging is active.
		 *
		 * @param {LogLevel} mode
		 * @param {LazyArgsThunk} thunk
		 * @param {Function} cutoffFn
		 * @returns {void}
		 */
		function logModeLazy(mode, thunk, cutoffFn) {
			if (!config.active) return;

			let args;
			try {
				args = thunk();
			} catch (e) {
				logMode('warn', ['Lazy logger thunk threw:', e], cutoffFn, true);
				return;
			}
			if (!Array.isArray(args)) {
				logMode('warn', [`Lazy logger thunk must return an array`], cutoffFn, true);
				return;
			}
			logMode(mode, args, cutoffFn);
		}

		/**
		 * Configure logger instance.
		 *
		 * @param {ConsoleDebugLoggerConfig} [cfg]
		 * @returns {ConsoleDebugLoggerInstance}
		 */
		function configureLogger(cfg = {}) {
			if (typeof cfg.name === 'string') config.name = cfg.name;
			if (typeof cfg.active === 'boolean') config.active = cfg.active;
			if (typeof cfg.version === 'string') config.version = cfg.version;
			// Preconstruct prompt prefix
			const parts = [config.name, config.version].filter(Boolean);
			config.promptPrefix = parts.length ? parts.join(' ') : 'DEBUG';
			return instance;
		}

		return configureLogger(cfg);
	}
};