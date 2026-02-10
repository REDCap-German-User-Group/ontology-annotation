/**
  * @typedef {Object} WatchHandle
  * @property {() => void} unwatch
  * @property {() => void} pause
  * @property {() => void} unpause
  * @property {() => boolean} isPaused
  */



/**
 * Singleton watcher factory for:
 * - delegated control edits inside tables (+ row add/remove)
 * - direct control edits
 * - optional monkey patch to catch programmatic updates
 */
const WatchTargets = (() => {
	/**
	 * @typedef {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} FormControlEl
	 * @typedef {HTMLTableElement|FormControlEl} WatchTarget
	 * @typedef {WatchTarget|Iterable<WatchTarget>} WatchTargets
	 *
	 * @typedef {"change"|"input"|"programmatic"} WatchEditEventType
	 *
	 * @typedef {Object} WatchEditEvent
	 * @property {"edit"} kind
	 * @property {WatchEditEventType} type
	 * @property {FormControlEl} el
	 * @property {string} value
	 * @property {Event} [event] Present for "change"/"input", absent for "programmatic"
	 * @property {HTMLTableElement} [table] Present when originating from a table watcher
	 *
	 * @typedef {Object} WatchRowsChangedEvent
	 * @property {"rows"} kind
	 * @property {HTMLTableElement} table
	 * @property {MutationRecord[]} mutations
	 *
	 * @typedef {WatchEditEvent|WatchRowsChangedEvent} WatchEvent
	 *
	 * @callback WatchOnEvent
	 * @param {WatchEvent} info
	 * @returns {void}
	 *
	 * @typedef {Object} WatchTargetsOptions
	 * @property {WatchOnEvent} onEvent
	 * @property {boolean} [fireOnInput=false]
	 * @property {string|string[]} [tableCellFilter]
	 * @property {boolean} [useCapture=true]
	 *
	 * @property {boolean} [patchProgrammatic=false]
	 *   Enable monkey patching to catch programmatic value changes without events.
	 *
	 * @property {boolean} [dispatchInputOnProgrammaticSet=false]
	 *   If true, also dispatch a bubbling "input" event after detecting a programmatic set
	 *   (mainly useful if other code relies on "input" events).
	 */

	// ---------------------------
	// Global singleton state
	// ---------------------------

	/** @type {number} */
	let nextId = 1;

	/** @type {Map<number, { onEvent: WatchOnEvent, paused: boolean, fireOnInput: boolean, tableFilterList: string[]|null, dispatchInputOnProgrammaticSet: boolean, patchProgrammatic: boolean }>} */
	const watchers = new Map();

	/** @type {WeakMap<FormControlEl, Set<number>>} */
	const controlIndex = new WeakMap();

	/** @type {WeakMap<HTMLTableElement, Set<number>>} */
	const tableIndex = new WeakMap();

	/** @type {number} */
	let patchRefCount = 0;

	/** @type {{ input?: PropertyDescriptor, textarea?: PropertyDescriptor, selectValue?: PropertyDescriptor, selectIndex?: PropertyDescriptor } | null} */
	let originalDescs = null;

	// ---------------------------
	// Public API
	// ---------------------------

	/**
	 * Create a watcher for any mix of tables and/or form controls.
	 *
	 * @param {WatchTargets} targets
	 * @param {WatchTargetsOptions} opts
	 * @returns {WatchHandle}
	 */
	function watchTargets(targets, opts) {
		if (!opts || typeof opts.onEvent !== "function") {
			throw new TypeError("watchTargets: opts.onEvent must be a function");
		}

		const {
			onEvent,
			fireOnInput = false,
			tableCellFilter,
			useCapture = true,
			patchProgrammatic = false,
			dispatchInputOnProgrammaticSet = false,
		} = opts;

		/** @type {string[]|null} */
		const tableFilterList = normalizeSelectorList(tableCellFilter);

		const id = nextId++;

		watchers.set(id, {
			onEvent,
			paused: false,
			fireOnInput,
			tableFilterList,
			dispatchInputOnProgrammaticSet,
			patchProgrammatic,
		});

		if (patchProgrammatic) {
			ensurePatched();
			patchRefCount++;
		}

		/** @type {Array<() => void>} */
		const disposers = [];

		/** @type {Set<WatchTarget>} */
		const ownedTargets = new Set();

		for (const t of normalizeTargets(targets)) {
			ownedTargets.add(t);

			if (t instanceof HTMLTableElement) {
				// Index for programmatic routing
				addIndex(tableIndex, t, id);

				disposers.push(installTableWatchers(t, id, { useCapture }));
			} else if (isFormControl(t)) {
				// Index for programmatic routing
				addIndex(controlIndex, t, id);

				disposers.push(installControlWatchers(t, id, { useCapture }));
			}
		}

		/** @type {WatchHandle} */
		const handle = {
			unwatch() {
				// Remove DOM watchers
				for (const d of disposers) d();

				// Remove indices for programmatic routing
				for (const t of ownedTargets) {
					if (t instanceof HTMLTableElement) removeIndex(tableIndex, t, id);
					else if (isFormControl(t)) removeIndex(controlIndex, t, id);
				}

				// Remove watcher config
				const w = watchers.get(id);
				watchers.delete(id);

				// Potentially unpatch if refcount reaches 0
				if (w?.patchProgrammatic) {
					patchRefCount = Math.max(0, patchRefCount - 1);
					if (patchRefCount === 0) restoreOriginals();
				}
			},
			pause() {
				const w = watchers.get(id);
				if (w) w.paused = true;
			},
			unpause() {
				const w = watchers.get(id);
				if (w) w.paused = false;
			},
			isPaused() {
				return !!watchers.get(id)?.paused;
			},
		};

		return handle;
	}

	// ---------------------------
	// DOM installs per watcher instance
	// ---------------------------

	/**
	 * @param {HTMLTableElement} table
	 * @param {number} watcherId
	 * @param {{ useCapture: boolean }} cfg
	 * @returns {() => void}
	 */
	function installTableWatchers(table, watcherId, cfg) {
		const { useCapture } = cfg;

		/** @param {Event} e */
		function onDelegatedEdit(e) {
			const w = watchers.get(watcherId);
			if (!w || w.paused) return;

			if (e.type === "input" && !w.fireOnInput) return;

			const t = e.target;
			if (!isFormControl(t)) return;
			if (!table.contains(t)) return;

			if (w.tableFilterList && !matchesAnySelector(t, w.tableFilterList)) return;

			w.onEvent({
				kind: "edit",
				type: /** @type {"change"|"input"} */ (e.type),
				el: t,
				value: readControlValue(t),
				event: e,
				table,
			});
		}

		table.addEventListener("change", onDelegatedEdit, useCapture);
		if (watchers.get(watcherId)?.fireOnInput) {
			table.addEventListener("input", onDelegatedEdit, useCapture);
		}

		const rowObserver = new MutationObserver((mutations) => {
			const w = watchers.get(watcherId);
			if (!w || w.paused) return;

			for (const m of mutations) {
				if (m.type !== "childList") continue;
				if (affectsTR(m.addedNodes) || affectsTR(m.removedNodes)) {
					w.onEvent({ kind: "rows", table, mutations });
					break;
				}
			}
		});

		rowObserver.observe(table, { childList: true, subtree: true });

		return () => {
			table.removeEventListener("change", onDelegatedEdit, useCapture);
			table.removeEventListener("input", onDelegatedEdit, useCapture);
			rowObserver.disconnect();
		};
	}

	/**
	 * @param {FormControlEl} el
	 * @param {number} watcherId
	 * @param {{ useCapture: boolean }} cfg
	 * @returns {() => void}
	 */
	function installControlWatchers(el, watcherId, cfg) {
		const { useCapture } = cfg;

		/** @param {Event} e */
		function onEdit(e) {
			const w = watchers.get(watcherId);
			if (!w || w.paused) return;

			if (e.type === "input" && !w.fireOnInput) return;

			w.onEvent({
				kind: "edit",
				type: /** @type {"change"|"input"} */ (e.type),
				el,
				value: readControlValue(el),
				event: e,
			});
		}

		el.addEventListener("change", onEdit, useCapture);
		if (watchers.get(watcherId)?.fireOnInput) {
			el.addEventListener("input", onEdit, useCapture);
		}

		return () => {
			el.removeEventListener("change", onEdit, useCapture);
			el.removeEventListener("input", onEdit, useCapture);
		};
	}

	// ---------------------------
	// Monkey patching (global, refcounted)
	// ---------------------------

	function ensurePatched() {
		if (originalDescs) return;

		originalDescs = {};

		// Patch input/textarea value
		patchValueProperty(HTMLInputElement.prototype, "value", "input", originalDescs);
		patchValueProperty(HTMLTextAreaElement.prototype, "value", "textarea", originalDescs);

		// Patch select: both .value and .selectedIndex (covers common programmatic changes)
		patchValueProperty(HTMLSelectElement.prototype, "value", "selectValue", originalDescs);
		patchValueProperty(HTMLSelectElement.prototype, "selectedIndex", "selectIndex", originalDescs);

		// Patch setRangeText
		patchMethod(HTMLTextAreaElement.prototype, "setRangeText", "taSetRangeText");
		patchMethod(HTMLInputElement.prototype, "setRangeText", "inSetRangeText");
	}

	function restoreOriginals() {
		if (!originalDescs) return;

		restoreValueProperty(HTMLInputElement.prototype, "value", originalDescs.input);
		restoreValueProperty(HTMLTextAreaElement.prototype, "value", originalDescs.textarea);
		restoreValueProperty(HTMLSelectElement.prototype, "value", originalDescs.selectValue);
		restoreValueProperty(HTMLSelectElement.prototype, "selectedIndex", originalDescs.selectIndex);
		restoreMethod(HTMLTextAreaElement.prototype, "setRangeText", "taSetRangeText");
		restoreMethod(HTMLInputElement.prototype, "setRangeText", "inSetRangeText");

		originalDescs = null;
	}

	/**
	 * @param {object} proto
	 * @param {string} prop
	 * @param {"input"|"textarea"|"selectValue"|"selectIndex"} key
	 * @param {any} store
	 */
	function patchValueProperty(proto, prop, key, store) {
		const desc = Object.getOwnPropertyDescriptor(proto, prop);
		if (!desc || typeof desc.get !== "function" || typeof desc.set !== "function") return;

		store[key] = desc;

		Object.defineProperty(proto, prop, {
			configurable: true,
			enumerable: desc.enumerable,
			get: desc.get,
			set: function (v) {
				// @ts-ignore
				const self = this;

				const oldVal = desc.get.call(self);
				desc.set.call(self, v);
				const newVal = desc.get.call(self);

				if (oldVal === newVal) return;

				// Only route if this is a relevant element type
				if (!isFormControl(self)) return;

				routeProgrammaticSet(self);

				// Optional: also dispatch DOM input event (bubbling)
				// (only if at least one interested watcher requests it)
				maybeDispatchSyntheticInput(self);
			},
		});
	}

	function patchMethod(proto, name, storeKey) {
		const orig = proto[name];
		if (typeof orig !== "function") return;
		originalDescs[storeKey] = orig;
		proto[name] = function (...args) {
			const r = orig.apply(this, args);
			// route programmatic change
			if (isFormControl(this)) {
				routeProgrammaticSet(this);
				maybeDispatchSyntheticInput(this);
			}
			return r;
		};
	}

	/**
	 * @param {object} proto
	 * @param {string} prop
	 * @param {PropertyDescriptor|undefined} desc
	 */
	function restoreValueProperty(proto, prop, desc) {
		if (!desc) return;
		Object.defineProperty(proto, prop, desc);
	}

	function restoreMethod(proto, name, storeKey) {
		const orig = originalDescs?.[storeKey];
		if (orig) proto[name] = orig;
	}

	/**
	 * Notify all relevant watchers about a programmatic change to a control.
	 * This is the key bit that allows overlapping watchers without interfering.
	 *
	 * @param {FormControlEl} el
	 */
	function routeProgrammaticSet(el) {
		// 1) direct watchers on this control
		const direct = controlIndex.get(el);
		if (direct) {
			for (const id of direct) notifyProgrammatic(id, el, /*table*/ undefined);
		}

		// 2) table watchers: any ancestor table(s) that are watched
		for (const table of ancestorTables(el)) {
			const ids = tableIndex.get(table);
			if (!ids) continue;
			for (const id of ids) notifyProgrammatic(id, el, table);
		}
	}

	/**
	 * @param {number} watcherId
	 * @param {FormControlEl} el
	 * @param {HTMLTableElement|undefined} table
	 */
	function notifyProgrammatic(watcherId, el, table) {
		const w = watchers.get(watcherId);
		if (!w || w.paused || !w.patchProgrammatic) return;

		// If coming from a table watcher, apply that watcher's table filter
		if (table && w.tableFilterList && !matchesAnySelector(el, w.tableFilterList)) return;

		w.onEvent({
			kind: "edit",
			type: "programmatic",
			el,
			value: readControlValue(el),
			table,
		});
	}

	/**
	 * Dispatch "input" (bubbling) if any relevant watcher wants it.
	 * @param {FormControlEl} el
	 */
	function maybeDispatchSyntheticInput(el) {
		// Direct control watchers
		const directIds = controlIndex.get(el);
		if (directIds && anyWantsSyntheticInput(directIds)) {
			el.dispatchEvent(new Event("input", { bubbles: true }));
			return;
		}

		// Table watchers
		for (const table of ancestorTables(el)) {
			const tableIds = tableIndex.get(table);
			if (!tableIds) continue;
			if (anyWantsSyntheticInput(tableIds)) {
				el.dispatchEvent(new Event("input", { bubbles: true }));
				return;
			}
		}
	}

	/**
	 * @param {Set<number>} ids
	 * @returns {boolean}
	 */
	function anyWantsSyntheticInput(ids) {
		for (const id of ids) {
			const w = watchers.get(id);
			if (w && !w.paused && w.patchProgrammatic && w.dispatchInputOnProgrammaticSet) return true;
		}
		return false;
	}

	// ---------------------------
	// Helpers
	// ---------------------------

	/**
	 * @param {unknown} el
	 * @returns {el is FormControlEl}
	 */
	function isFormControl(el) {
		return el instanceof HTMLInputElement
			|| el instanceof HTMLTextAreaElement
			|| el instanceof HTMLSelectElement;
	}

	/**
	 * @param {WatchTargets} targets
	 * @returns {WatchTarget[]}
	 */
	function normalizeTargets(targets) {
		/** @type {WatchTarget[]} */
		const out = [];

		if (targets instanceof HTMLTableElement || isFormControl(targets)) {
			out.push(targets);
			return out;
		}

		if (targets && typeof targets[Symbol.iterator] === "function") {
			for (const t of targets) {
				if (t instanceof HTMLTableElement || isFormControl(t)) out.push(t);
			}
			return out;
		}

		throw new TypeError("watchTargets: targets must be an element or an iterable of elements");
	}

	/**
	 * @param {string|string[]|undefined} sel
	 * @returns {string[]|null}
	 */
	function normalizeSelectorList(sel) {
		if (sel == null) return null;
		if (Array.isArray(sel)) return sel.filter(s => typeof s === "string" && s.trim() !== "");
		if (typeof sel === "string" && sel.trim() !== "") return [sel];
		return null;
	}

	/**
	 * @param {FormControlEl} el
	 * @returns {string}
	 */
	function readControlValue(el) {
		return String(el.value ?? "");
	}

	/**
	 * @param {Element} el
	 * @param {string[]} selectors
	 * @returns {boolean}
	 */
	function matchesAnySelector(el, selectors) {
		for (const s of selectors) {
			try {
				if (el.matches(s)) return true;
			} catch {
				// ignore invalid selectors
			}
		}
		return false;
	}

	/**
	 * @param {NodeList} nodes
	 * @returns {boolean}
	 */
	function affectsTR(nodes) {
		for (const n of Array.from(nodes)) {
			if (!(n instanceof Element)) continue;
			if (n.matches("tr")) return true;
			if (n.querySelector("tr")) return true;
		}
		return false;
	}

	/**
	 * Iterate all ancestor tables (closest first).
	 * @param {Element} el
	 * @returns {HTMLTableElement[]}
	 */
	function ancestorTables(el) {
		/** @type {HTMLTableElement[]} */
		const tables = [];
		let cur = el;

		while (cur) {
			const t = cur.closest("table");
			if (!(t instanceof HTMLTableElement)) break;

			tables.push(t);

			// move above this table to find outer tables (nested tables case)
			cur = t.parentElement || null;
		}
		return tables;
	}

	/**
	 * @template {WeakKey} K
	 * @param {WeakMap<K, Set<number>>} map
	 * @param {K} key
	 * @param {number} id
	 */
	function addIndex(map, key, id) {
		let s = map.get(key);
		if (!s) { s = new Set(); map.set(key, s); }
		s.add(id);
	}

	/**
	 * @template {WeakKey} K
	 * @param {WeakMap<K, Set<number>>} map
	 * @param {K} key
	 * @param {number} id
	 */
	function removeIndex(map, key, id) {
		const s = map.get(key);
		if (!s) return;
		s.delete(id);
		if (s.size === 0) map.delete(key);
	}

	return { watch: watchTargets };
})();

// ---------------------------
// Example usage
// ---------------------------

// const handle = WatchDog.watch([
//   document.querySelector("#t1"),
//   document.querySelector("#someInput"),
// ], {
//   fireOnInput: false,
//   tableCellFilter: [".watch-me", "input[name^=x_]"],
//   patchProgrammatic: true,
//   dispatchInputOnProgrammaticSet: false,
//   onEvent(ev) {
//     if (ev.kind === "rows") console.log("rows changed", ev.table);
//     else console.log("edit", ev.type, ev.el, ev.value, ev.table);
//   }
// });
//
// handle.pause();
// handle.unpause();
// console.log(handle.isPaused());
// handle.unwatch();
