// Ontology Made Easy EM - Online Designer Integration


// TODOs
// - [ ] Scrap the whole Ontology table as is and replace with a DataTable and a backend structure*
// - [ ] Instead of the search field, require manual search trigger and display results in a popover,
//       which displays searches in internal and any external ontologies as they come in. Use a 
//       DataTable for this, that can be searched and filtered further.
// - [ ] Add a config option/filter to limit searching to selected ontologies (from those configured in
//       the module settings).
// - [ ] Add a schema validator (such as https://github.com/ajv-validator/ajv) to the module

// * Backend structure:
//   Array, each row represents one annotation. Store coordinates (i.e., field, choice, unit).
//   This will allow for easy manipulation; JSON can be generated from the array easily for both,
//   regular fields and matrix fields.

/// <reference types="jquery" />
/// <reference types="jqueryui" />
/// <reference path="../../../codebase/Resources/js/base.js" />
/// <reference path="./ROME.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />

// @ts-check
; (function () {

	//#region Init global object and define local variables

	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';
	const LOGGER = ConsoleDebugLogger.create().configure({
		name: EM_NAME,
		active: true,
		version: '??'
	});
	const { log, warn, error } = LOGGER;

	/** @type {ROMEOnlineDesignerPublic} */
	// @ts-ignore
	const EM = window[NS_PREFIX + EM_NAME] ?? {
		init: initialize,
		showFieldHelp: showFieldHelp
	};
	// @ts-ignore
	window[NS_PREFIX + EM_NAME] = EM;

	/** 
	 * Configuration data supplied from the server 
	 * @type {ROMEOnlineDesignerConfig}
	*/
	let config = {};
	/** @type {JavascriptModuleObject|null} */
	let JSMO = null;

	/** @type {OnlineDesignerState} */
	const data = {};

	/** @type {OntologyAnnotationParser} */
	let ontologyParser;

	/**
	 * Implements the public init method.
	 * @param {ROMEOnlineDesignerConfig=} config_data
	 * @param {JavascriptModuleObject=} jsmo
	 */
	function initialize(config_data, jsmo = null) {

		config = config_data;
		JSMO = jsmo;
		// Configure the logger
		LOGGER.configure({ active: config.debug, name: 'ROME Online Designer', version: config.version });
		// Configure the ontology parser
		ontologyParser = createOntologyAnnotationParser({
			tag: config.atName,
			getMinAnnotation: getMinimalOntologyAnnotation
		});

		//#region Hijack Hooks

		// Adds the edit field UI
		const orig_fitDialog = window['fitDialog'];
		window['fitDialog'] = function (ob) {
			orig_fitDialog(ob);
			if (ob && ob['id'] && ['div_add_field', 'addMatrixPopup'].includes(ob.id)) {
				data.$dlg = $(ob);
				data.isMatrix = ob.id == 'addMatrixPopup';
				updateEditFieldUI();
			}
		}

		//#endregion

		//#region AJAX Hooks

		$.ajaxPrefilter(function (options, originalOptions, jqXHR) {
			if (options.url?.includes('Design/edit_matrix.php')) {
				// Matrix saving
				const matrixGroupName = $('#grid_name').val();
				const exclude = isExcludedCheckboxChecked();
				const originalSuccess = options.success;
				options.success = function (data, textStatus, jqXHR) {
					saveMatrixFormExclusion(matrixGroupName, exclude);
					if (originalSuccess) {
						// @ts-ignore
						originalSuccess.call(this, data, textStatus, jqXHR);
					}
				}
			}
			else if (options.url?.includes('Design/online_designer_render_fields.php')) {
				// Design table reloading - get updated exclusion
				const originalSuccess = options.success
				options.success = function (data, textStatus, jqXHR) {
					JSMO.ajax('refresh-exclusions', config.form).then(function (response) {
						log('Updated config data:', response);
						config.fieldsExcluded = response.fieldsExcluded;
						config.matrixGroupsExcluded = response.matrixGroupsExcluded;
					}).finally(function () {
						if (originalSuccess) {
							// @ts-ignore
							originalSuccess.call(this, data, textStatus, jqXHR);
						}
					});
				}
			}
		});
		//#endregion

		log('Initialization complete.', config);
	}

	//#endregion

	/**
	 * Shows a help dialog in response to the "Learn about using Ontology Annotations"
	 */
	function showFieldHelp() {
		if (!data.fieldHelpContent) {
			JSMO.ajax('get-fieldhelp').then(response => {
				data.fieldHelpContent = response;
				showFieldHelp();
			}).catch(err => {
				error(err);
			});
		}
		else {
			log('Showing field help');
			simpleDialog(data.fieldHelpContent, config.moduleDisplayName);
		}
	}


	//#region Edit Field UI

	function updateEditFieldUI() {
		if (data.$dlg.find('.rome-edit-field-ui-container').length == 0) {
			addEditFieldUI();
		}
		log('Updating Edit Field UI');
		// Exclusion checkbox
		let excluded = false;
		if (data.isMatrix) {
			const matrixGroupName = '' + data.$dlg.find('#grid_name').val();
			excluded = config.matrixGroupsExcluded.includes(matrixGroupName);
		}
		else {
			const fieldName = '' + data.$dlg.find('input[name="field_name"]').val();
			excluded = config.fieldsExcluded.includes(fieldName);
		}
		setExcludedCheckboxState(excluded);
		data.$dlg.find('input[name="rome-em-fieldedit-search"]').val('');
		updateAnnotationTable();
	}

	function isExcludedCheckboxChecked() {
		return data.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked') == true;
	}

	function setExcludedCheckboxState(state) {
		data.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked', state);
		$('input[name="rome-em-fieldedit-exclude"]').val(state ? '1' : '0');		
	}


	function addEditFieldUI() {
		if (data.$dlg.find('.rome-edit-field-ui-container').length > 0) return;
		log('Adding Edit Field UI' + (data.isMatrix ? ' (matrix)' : ''));
		const $ui = $($('#rome-em-fieldedit-ui-template').html());

		//#region Setup event handlers

		// Track changes to the choices
		const $enum = data.isMatrix
			? data.$dlg.find('textarea[name="element_enum_matrix"]')
			: data.$dlg.find('textarea[name="element_enum"]');
		// Detect user input
		$enum[0].addEventListener('change', () => {
			trackEnumChange($enum.val());
		});
		// Detect programmatic changes by redefining .value
		const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
		Object.defineProperty($enum.get(0), 'value', {
			get() {
				// @ts-ignore
				return descriptor['get'].call(this);
			},
			set(newVal) {
				// @ts-ignore
				descriptor.set.call(this, newVal);
				trackEnumChange(newVal);
			}
		});
		// Keep track of changes
		function trackEnumChange(val) {
			if (val !== data.enum) {
				const fieldType = getFieldType();
				if (['select', 'radio', 'checkbox'].includes(fieldType)) {
					setEnum(val);
				}
			}
		}
		// Track changes of the field type and set enum
		data.$dlg.find('select[name="field_type"]').on('change', () => {
			data.fieldType = getFieldType();
			log('Field type changed:', data.fieldType);
			if (data.fieldType == 'yesno' || data.fieldType == 'truefalse') {
				const val = $('#div_element_' + data.fieldType + '_enum div').last().html().trim().replace('<br>', '\n');
				setEnum(val);
			}
			else if (['select', 'radio', 'checkbox'].includes(data.fieldType)) {
				trackEnumChange($enum.val());
			}
			else {
				setEnum('');
			}
		}).trigger('change');
		// Init and track "Do not annotate this field/matrix"
		$ui.find('.rome-em-fieldedit-exclude').each(function () {
			const $this = $(this);
			const id = 'rome-em-fieldedit-exclude-' + (data.isMatrix ? 'matrix' : 'field');
			if ($this.is('input')) {
				$this.attr('id', id);
				$this.on('change', function () {
					const checked = $(this).prop('checked');
					if (!data.isMatrix) {
						// Store exclusion
						data.$dlg.find('[name="rome-em-fieldedit-exclude"]').val(checked ? 1 : 0);
					}
					log('Do not annotate is ' + (checked ? 'checked' : 'not checked'));
					if (checked) performExclusionCheck();
				});
			}
			else if ($this.is('label')) {
				$this.attr('for', id);
			}
		});
		// Init auto completion
		const $searchInput = $ui.find('input[name="rome-em-fieldedit-search"]');
		const $searchSpinner = $ui.find('.rome-edit-field-ui-spinner');
		const throttledSearch = throttle(function (request, response) {
			const payload = {
				"term": request.term,
				"data.isMatrix": data.isMatrix,
				"name": data.isMatrix ? data.$dlg.find('input[name="grid_name"]').val() : data.$dlg.find('input[name="field_name"]').val(),
				// TODO - maybe need add value from target dropdown, in case this affect what we do here
			};
			$searchSpinner.addClass('busy');
			log('Search request:', payload);
			JSMO.ajax('search', payload)
				.then(searchResult => {
					log('Search result:', searchResult);
					response(searchResult);
				})
				.catch(err => error(err))
				.finally(() => $searchSpinner.removeClass('busy'));
		}, 500, { leading: false, trailing: true });
		$searchInput.autocomplete({
			source: throttledSearch,
			minLength: 2,
			delay: 0,
			open: function (event, ui) {
				// For some reason, the z-index of the parent dialog keeps shifting up
				const z = '' + (Number.parseInt(data.$dlg.parents('[role="dialog"]').css('z-index') ?? '199') + 1);
				const action = ('' + $searchInput.val()).length == 0 ? 'hide' : 'show';
				$('.ui-autocomplete, .ui-menu-item').css('z-index', z)[action]();
			},
			focus: function (event, ui) {
				return false;
			},
			select: function (event, ui) {
				log('Autosuggest selected:', ui);

				if (ui.item.value !== '') {
					$searchInput.val(ui.item.label);
					document.getElementById("rome-add-button").onclick = function () {
						updateOntologyActionTag(ui.item);
					};
				}
				return false;
			}
		})
			.data('ui-autocomplete')._renderItem = function (ul, item) {
				return $("<li></li>")
					.data("item", item)
					.append("<a>" + item.display + "</a>")
					.appendTo(ul);
			};

		//#endregion

		if (data.isMatrix) {
			// Insert at end of the dialog
			data.$dlg.append($ui);
		}
		else {
			// Mirror visibility of the Action Tags / Field Annotation DIV
			const actiontagsDIV = document.getElementById('div_field_annotation')
				?? document.createElement('div');
			const observer = new MutationObserver(() => {
				const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
				$ui.css('display', actiontagsVisible ? 'block' : 'none');
			});
			observer.observe(actiontagsDIV, { attributes: true, attributeFilter: ['style'] });
			// Initial sync
			const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
			$ui.css('display', actiontagsVisible ? 'block' : 'none');
			// Add a hidden field to transfer exclusion
			data.$dlg.find('#addFieldForm').prepend('<input type="hidden" name="rome-em-fieldedit-exclude" value="0">');
			// Insert after Action Tags / Field Annotation
			$ui.insertAfter(actiontagsDIV);
			// initial sync from the action tag
			updateAnnotationTable()
		}

	}


	//#endregion

	function performExclusionCheck() {
		const misc = [];
		data.$dlg.find(data.isMatrix ? '[name="addFieldMatrixRow-annotation"]' : '[name="field_annotation"]').each(function () {
			misc.push($(this).val() ?? '');
		});
		if (misc.join(' ').includes(config.atName)) {
			simpleDialog(JSMO.tt(data.isMatrix ? 'fieldedit_15' : 'fieldedit_14', config.atName), JSMO.tt('fieldedit_13'));
		}
	}

	function saveMatrixFormExclusion(matrixGroupName, exclude) {
		log('Saving exclusion for matrix group "' + matrixGroupName + '": ', exclude);
		JSMO.ajax('set-matrix-exclusion', {
			grid_name: matrixGroupName,
			exclude: exclude ? '1' : '0'
		});
		// Update config
		if (exclude) {
			if (!config.matrixGroupsExcluded.includes(matrixGroupName)) {
				config.matrixGroupsExcluded.push(matrixGroupName);
			}
		}
		else {
			config.matrixGroupsExcluded = config.matrixGroupsExcluded.filter(val => val != matrixGroupName);
		}
	}

	/**
	 * Gets the current field type
	 * @returns {string}
	 */
	function getFieldType() {
		return $('select#field_type').val()?.toString() ?? '';
	}

	/**
	 * Updates the enum value store
	 * @param {string} val 
	 */
	function setEnum(val) {
		if (data.enum !== val) {
			data.enum = val;
			if (data.enum != '') {
				log('Enum changed:', data.enum);
			}
			else {
				log('Enum cleared.');
			}
		}
		updateAnnotationTargetsDropdown();
	}

	//#region Update Ontology Action Tags and table

	function escapeHTML(str) { // probably exists as a utility function somewhere already?
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
			.replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}


	function updateOntologyActionTag(item) {
		let actionTagsArea = document.getElementById('field_annotation');
		let field = $("#rome-field-choice").val();
		let annotation = getOntologyAnnotationJsonObject() || {};
		let itemCode = JSON.parse(item.value).code
		if (annotation.dataElement) {
			if (field == "dataElement") {
				annotation.dataElement.coding = [... new Set((annotation.dataElement.coding || []).concat(itemCode))]; // append and remove duplicates
			} else {
				if (!annotation.dataElement.valueCodingMap) {
					annotation.dataElement.valueCodingMap = {}
				}
				if (!annotation.dataElement.valueCodingMap[field]) {
					annotation.dataElement.valueCodingMap[field] = { coding: [] }
				}
				annotation.dataElement.valueCodingMap[field].coding =
					[... new Set((annotation.dataElement.valueCodingMap[field].coding).concat(itemCode))]
			}
		} else {
			if (field == "dataElement") {
				annotation.dataElement = { coding: [JSON.parse(item.value).code] }
			} else {
				annotation.dataElement = { coding: [], valueCodingMap: {} }
				annotation.dataElement.valueCodingMap[field] = { coding: [JSON.parse(item.value).code] }
			}
		}
		if (actionTagsArea.value.indexOf("@ONTOLOGY='") == -1) {
			actionTagsArea.value += ` @ONTOLOGY='${JSON.stringify(annotation, null, 2)}'`
		} else {
			actionTagsArea.value = actionTagsArea.value
				.replace(/@ONTOLOGY='([^']*)'/,
					`@ONTOLOGY='${JSON.stringify(annotation, null, 2)}'`);
		}
		updateAnnotationTable()
	}

	function isAnnotationEmpty(annotation) {
		if (typeof annotation.dataElement !== 'object') return false;
		const hasCoding = annotation.dataElement.coding
			&& Array.isArray(annotation.dataElement.coding) 
			&& annotation.dataElement.coding.length > 0;
		const hasUnit = annotation.dataElement.unit
			&& annotation.dataElement.unit.coding
			&& Array.isArray(annotation.dataElement.unit.coding)
			&& annotation.dataElement.unit.coding.length > 0;
		const hasValueCodingMap = annotation.dataElement.valueCodingMap
			&& Object.keys(annotation.dataElement.valueCodingMap).length > 0;

		return !(hasCoding || hasUnit || hasValueCodingMap);
	}


	function updateActionTag(newvalue) {

		const $actionTagsArea = $('#field_annotation');
		const annotation = getOntologyAnnotation();
		const current = `${$actionTagsArea.val() ?? ''}`;

		const replacement = isAnnotationEmpty(newvalue) ? '' : `${config.atName}=${JSON.stringify(newvalue, null, 2)}`;

		if (annotation.usedFallback) {
			// Add new
			$actionTagsArea.val(
				`${current}\n${replacement}`
			);
		}
		else {
			// Replace by adding from 0 to annotation.start, new action tag, then rest from current after annotation.end
			$actionTagsArea.val(
				`${current.slice(0, annotation.start)}${replacement}${current.slice(annotation.end)}`
			)
		}
	}

	function deleteOntologyAnnotation(system, code, field) {
		let annotation = getOntologyAnnotationJsonObject();
		if (field == "dataElement") {
			let coding = annotation?.dataElement?.coding
			if (coding) {
				annotation.dataElement.coding = coding.filter(c => !(c.system == system && c.code == code))
			}
		} else {
			let valueCodingMap = annotation.dataElement?.valueCodingMap
			if (valueCodingMap && valueCodingMap[field] && valueCodingMap[field].coding) {
				let coding = valueCodingMap[field].coding
				annotation.dataElement.valueCodingMap[field].coding = coding.filter(c => !(c.system == system && c.code == code))
			}
		}
		updateActionTag(annotation)
		updateAnnotationTable()
	}




	/**
	 * Extracts the JSON value after "@ONTOLOGY\s*=\s*" from a larger string.
	 * Supports JSON objects `{...}` and arrays `[...]`.
	 *
	 * @param {string} text
	 * @param {string} tag 
	 * @returns {OntologyAnnotationJSON}
	 */
	function extractOntologyJson_DEPRECATED(text, tag = "@ONTOLOGY") {
		if (typeof text !== "string") return null;

		const tagIdx = text.indexOf(tag);
		if (tagIdx === -1) return null;

		let i = tagIdx + tag.length;
		while (i < text.length && /\s/.test(text[i])) i++;
		if (text[i] !== "=") return null;
		i++;
		while (i < text.length && /\s/.test(text[i])) i++;

		const start = i;
		const first = text[i];
		if (first !== "{" && first !== "[") return null;

		const stack = [];
		let inString = false;
		let escape = false;

		const isOpen = (c) => c === "{" || c === "[";
		const isClose = (c) => c === "}" || c === "]";
		const matches = (open, close) =>
			(open === "{" && close === "}") || (open === "[" && close === "]");

		for (; i < text.length; i++) {
			const ch = text[i];

			if (inString) {
				if (escape) escape = false;
				else if (ch === "\\") escape = true;
				else if (ch === '"') inString = false;
				continue;
			}

			if (ch === '"') { inString = true; continue; }

			if (isOpen(ch)) {
				stack.push(ch);
				continue;
			}
			if (isClose(ch)) {
				const open = stack.pop();
				if (!open || !matches(open, ch)) return null; // mismatched
				if (stack.length === 0) {
					const end = i + 1;
					const jsonText = text.slice(start, end);
					try {
						return { jsonText, value: JSON.parse(jsonText), start, end };
					} catch {
						return null;
					}
				}
			}
		}

		return null;
	}







	/**
	 * Create an ontology annotation parser with fixed options.
	 *
	 * @param {OntologyAnnotationParserOptions} options
	 * @returns {OntologyAnnotationParser}
	 */
	function createOntologyAnnotationParser(options) {
		if (!options || typeof options !== 'object') {
			throw new Error('createOntologyAnnotationParser: options object is required');
		}
		if (typeof options.tag !== 'string' || options.tag.length === 0) {
			throw new Error('createOntologyAnnotationParser: tag must be a non-empty string');
		}
		const tag = options.tag;
		const validate = (typeof options.validate === 'function') ? options.validate : null;

		if (typeof options.getMinAnnotation !== 'function') {
			throw new Error('createOntologyAnnotationParser: getMinimalOntologyAnnotation must be a function');
		}
		const getMinAnnotation = options.getMinAnnotation;

		return {
			/**
			 * Parse the LAST valid tag JSON object from the given text.
			 * @param {string} text
			 * @returns {OntologyAnnotationParseResult}
			 */
			parse(text) {
				/** @type {OntologyAnnotationParseResult} */
				const result = {
					// IMPORTANT: Do NOT run schema validation on the minimal annotation
					json: getMinAnnotation(),
					usedFallback: true,
					numTags: 0,
					error: false,
					errorMessage: '',
					warnings: [],
					text: '',
					start: -1,
					end: -1
				};

				if (typeof text !== 'string' || text.length === 0) return result;

				const lineStarts = computeLineStarts(text);

				let idx = 0;
				let lastValid = null; // { json, start, end, text }
				let lastFailure = null; // { line, message }

				while (true) {
					const tagIdx = text.indexOf(tag, idx);
					if (tagIdx === -1) break;

					result.numTags++;
					idx = tagIdx + tag.length;

					const attempt = parseOneTag(text, tagIdx, tag.length);
					if (attempt.ok) {
						lastValid = attempt.value;
					} else {
						const line = indexToLine(lineStarts, tagIdx);
						const message = ('reason' in attempt) ? attempt.reason : 'Unknown parse error';
						const warning = { line, message };
						result.warnings.push(warning);
						lastFailure = warning;
					}
				}

				if (result.numTags === 0) {
					// No tag => no annotation present
					return result;
				}

				if (lastValid != null) {
					result.json = lastValid.json;
					result.usedFallback = false;
					result.text = lastValid.text;
					result.start = lastValid.start;
					result.end = lastValid.end;
					return result;
				}

				// Tag(s) exist but none valid => hard error per spec
				result.error = true;
				result.errorMessage = lastFailure
					? `${tag} present but no valid JSON found. Last issue at line ${lastFailure.line}: ${lastFailure.message}`
					: `${tag} present but no valid JSON found.`;
				// text/start/end remain empty/-1
				return result;

				//#region Per-tag parse

				/**
				 * Attempt to parse one tag occurrence at tagIdx.
				 *
				 * Grammar:
				 *   TAG [ws] = [ws] { ...JSON object... }
				 *   TAG [ws] = [ws] '{ ...JSON object... }'
				 *   TAG [ws] = [ws] "{ ...JSON object... }"
				 *
				 * @param {string} s
				 * @param {number} tagIdx
				 * @param {number} tagLen
				 * @returns {ParseAttempt}
				 */
				function parseOneTag(s, tagIdx, tagLen) {
					let i = tagIdx + tagLen;

					while (i < s.length && isWS(s[i])) i++;

					if (i >= s.length || s[i] !== '=') {
						return { ok: false, reason: 'Missing "=" after tag' };
					}
					i++;

					while (i < s.length && isWS(s[i])) i++;

					if (i >= s.length) {
						return { ok: false, reason: 'JSON object missing after "=" (end of text)' };
					}

					// Optional quote wrapper around the JSON object
					let quote = null;
					if (s[i] === "'" || s[i] === '"') {
						quote = s[i];
						i++;
						while (i < s.length && isWS(s[i])) i++; // WS after quote is tolerated
					}

					if (i >= s.length || s[i] !== '{') {
						return { ok: false, reason: 'JSON object missing after "=" (expected "{")' };
					}

					const scan = scanJsonObject(s, i);
					if (!scan.ok) return { ok: false, reason: scan.reason };

					const jsonText = s.slice(scan.start, scan.end);

					// If it was quoted, require closing quote after the JSON
					if (quote) {
						let j = scan.end;
						while (j < s.length && isWS(s[j])) j++; // Allow whitespace between } and quote
						if (j >= s.length || s[j] !== quote) {
							return { ok: false, reason: `Missing closing ${quote} after JSON object` };
						}
						// IMPORTANT: end of “tag+json” should include the closing quote for replacement
						// We'll set end accordingly in step (2) below.
					}

					let parsed;
					try {
						parsed = JSON.parse(jsonText);
					} catch (e) {
						return { ok: false, reason: `JSON.parse failed: ${e && e.message ? e.message : String(e)}` };
					}

					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
						return { ok: false, reason: 'Parsed JSON is not an object' };
					}

					// IMPORTANT: Validator runs ONLY on parsed tag JSON, never on the minimal fallback
					if (validate) {
						const ok = validate(parsed);
						if (!ok) {
							const msg = formatValidatorErrors(validate.errors);
							return { ok: false, reason: `Schema validation failed: ${msg}` };
						}
					}

					const start = tagIdx;
					let end = scan.end; // end of JSON object
					if (quote) {
						let j = scan.end;
						while (j < s.length && isWS(s[j])) j++;
						// we already checked s[j] === quote above
						end = j + 1; // include closing quote
					}
					return {
						ok: true,
						value: {
							json: parsed,
							start,
							end,
							text: s.slice(start, end)
						}
					};
				}

				//#endregion
			}
		};

		//#region Helpers

		function scanJsonObject(s, start) {
			let depth = 0;
			let inString = false;
			let escape = false;

			for (let i = start; i < s.length; i++) {
				const ch = s[i];

				if (inString) {
					if (escape) escape = false;
					else if (ch === '\\') escape = true;
					else if (ch === '"') inString = false;
					continue;
				}

				if (ch === '"') {
					inString = true;
					continue;
				}

				if (ch === '{') depth++;
				else if (ch === '}') {
					depth--;
					if (depth < 0) return { ok: false, reason: 'Bracket mismatch: unexpected "}"' };
					if (depth === 0) return { ok: true, start, end: i + 1 };
				}
			}

			return { ok: false, reason: 'Bracket mismatch: unterminated JSON object (reached end of text)' };
		}

		function computeLineStarts(s) {
			const starts = [0];
			for (let i = 0; i < s.length; i++) {
				if (s[i] === '\n') starts.push(i + 1);
			}
			return starts;
		}

		function indexToLine(starts, pos) {
			let lo = 0, hi = starts.length - 1;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (starts[mid] <= pos) lo = mid + 1;
				else hi = mid - 1;
			}
			return Math.max(1, hi + 1);
		}

		function isWS(ch) {
			return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
		}

		function formatValidatorErrors(errors) {
			if (!Array.isArray(errors) || errors.length === 0) return 'Unknown validation error';
			return errors
				.slice(0, 3)
				.map(e => `${e.instancePath || '(root)'}: ${e.message || 'invalid'}`)
				.join('; ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '');
		}

		//#endregion
	}







	/**
	 * Gets the contents of an element and extracts the ontology JSON.
	 * @param {string} [field] - When editing matrix groups, the field name to get the annotations from.
	 * @returns {Object}
	 */
	function getOntologyAnnotationJsonObject(field = '') {
		const result = getOntologyAnnotation(field);
		return result.json;
	}

	/**
	 * Gets the contents of an element and extracts the ontology JSON.
	 * @param {string} [field] - When editing matrix groups, the field name to get the annotations from.
	 * @returns {Object}
	 */
	function getOntologyAnnotation(field = '') {
		const selector = data.isMatrix ? "TODO" : '#field_annotation';
		const $el = $(selector);
		let content = '';
		if ($el.is('input, textarea')) {
			content = String($el.val() ?? '');
		} else {
			content = $el.text();
		}
		const result = ontologyParser.parse(content);
		log(`Parsed content of ${selector}:`, result);
		return result;
	}

	function getMinimalOntologyAnnotation() {
		/** @type {OntologyAnnotationJSON} */
		const obj = JSON.parse(config.minimalAnnotation);
		obj.dataElement.type = getFieldType();
		return obj;
	}

	function getFieldNames() {
		const fieldNames = [];
		if (data.isMatrix) {
			$('td.addFieldMatrixRowVar input').each(function () {
				const fieldName = `${$(this).val()}`.trim();
				if (fieldName !== '') {
					fieldNames.push(fieldName);
				}
			});

		}
		else {
			fieldNames.push(data.$dlg.find('input#field_name').val() ?? '??');
		}
		return fieldNames;
	}

	function updateAnnotationTargetsDropdown() {
		// The target dropdown includes the field (or multiple fields in case of matrix groups)
		// as well as choices in case of radio/dropdown/checkbox fields
		// For any non-validated textbox field, a unit will be added
		const options = [];
		// Field(s)
		for (const fieldName of getFieldNames()) {
			options.push({
				type: 'dataElement',
				id: fieldName,
				label: fieldName
			});
		}
		// Choices
		
		let choices = [["dataElement", "Field"]];
		let choicesDict = { "dataElement": true };
		if (data.enum) {
			for (const line of data.enum?.split("\n")) {
				const [code, rest] = line.split(',', 2);
				choices.push([code, rest]);
				choicesDict[code] = true;
				options.push({
					type: 'choice',
					id: code,
					label: rest || '??'
				});
			}
		}

		$("#rome-field-choice").html(choices.map(c => `<option value="${c[0]}">${c[1]}</option>`).join(""))

		$(".rome-option-field").each(function (i, elem) {
			let selected = elem.dataset.romeSelected
			let system = elem.dataset.romeSystem
			let code = elem.dataset.romeCode
			let display = choices.length <= 1 ? 'display:"none"' : ''
			let choiceError = ""
			if (!choicesDict[selected]) {
				choiceError = `<option value="${selected}" style="background-color: red;">❓❓ ${selected} ❓❓</option>`
			}
			elem.innerHTML = `<select ${display} class="form-select form-select-xs" id="rome-selectfield-${i}">` + choiceError +
				choices.map(c => `<option value="${c[0]}" ${c[0] == selected ? 'selected' : ''}>${c[1]}</option>`).join("") +
				`</select>`
			$(elem).on('change', function (event) {
				event.stopImmediatePropagation()
				let annotation = getOntologyAnnotationJsonObject()
				if (!annotation.dataElement) {
					annotation.dataElement = { "coding": [] }
				}
				if (!annotation.dataElement.valueCodingMap) {
					annotation.dataElement.valueCodingMap = {}
				}
				let items = annotation.dataElement.coding
				let valueCodingMap = annotation.dataElement.valueCodingMap
				let oldValue = selected
				let newValue = event.target.value
				console.log(`updating ${oldValue} to ${newValue} // ` + JSON.stringify(valueCodingMap, null, 2))

				if (oldValue == "dataElement") {
					annotation.dataElement.coding = items.filter(value => (!((value.system == system) && (value.code == code))))
					if (!valueCodingMap[newValue]?.coding) {
						valueCodingMap[newValue] = { "coding": [] }
					}
					valueCodingMap[newValue].coding = [... new Set((valueCodingMap[newValue].coding).concat({ "code": code, "system": system }))]
				} else if (newValue == "dataElement") {
					valueCodingMap[oldValue].coding = valueCodingMap[oldValue].coding.filter(value => (!((value.system == system) && (value.code == code))))
					annotation.dataElement.coding = [... new Set((items).concat({ "code": code, "system": system }))]
				} else {
					if (!valueCodingMap[newValue]) {
						valueCodingMap[newValue] = { "coding": [] }
					}
					valueCodingMap[newValue].coding = [... new Set((valueCodingMap[newValue].coding).concat({ "code": code, "system": system }))]
					valueCodingMap[oldValue].coding = valueCodingMap[oldValue].coding.filter(value => (!((value.system == system) && (value.code == code))))
				}
				annotation.dataElement.valueCodingMap = valueCodingMap
				updateActionTag(annotation)
			})

		})
	}

	/**
	 * Updates the annotation table using the ONTOLOGY action tag's JSON
	 * @returns 
	 */
	function updateAnnotationTable() {
		if (isExcludedCheckboxChecked()) return; 
		const annotation = getOntologyAnnotationJsonObject();
		let items = annotation.dataElement?.coding
		let valueCodingMap = annotation.dataElement?.valueCodingMap
		let values = []
		if (valueCodingMap) {
			for (const [key, value] of Object.entries(valueCodingMap)) {
				console.log("xUAT: Coding key " + key);
				(value.coding || []).forEach(c => values = values.concat({ field: key, ...c }))
			}
		}
		if (items.length == 0 && values.length == 0) {
			$(".rome-edit-field-ui-list").hide()
			$(".rome-edit-field-ui-list-empty").show()
			return;
		}
		$(".rome-edit-field-ui-list-empty").hide()
		let knownLinks = {
			"http://snomed.info/sct": "https://bioportal.bioontology.org/ontologies/SNOMEDCT?p=classes&conceptid=",
			"http://loinc.org": "https://loinc.org/"
		}
		let html = `<div id="rome-table-options-comment"></div><table style="margin-top: 12px">
                  <thead>
                    <tr><th>Ontology</th><th>Code</th><th>Display</th><th>Element</th><th>Action</th></tr>
                  </thead>
                  <tbody>` +
			items.map((item, i) => `<tr>` +
				[item.system,
				(knownLinks[item.system] ? `<a target="_blank" href="${knownLinks[item.system]}${item.code}">${item.code}</a>` : item.code),
				item.display].map((s) => `<td style="padding-right: 10px">${s ? s : '<i>?</i>'}</td>`).join("") +
				`<td><span class="rome-option-field" data-rome-selected="dataElement" id="rome-option-field-${i}"><i>Field</i></span></td><td><span id="rome-delete-${i}"><i class="fa fa-trash"></i></span></td>
                  </tr>`).join("") +
			values.map((item, i) => `<tr>` +
				[item.system,
				(knownLinks[item.system] ? `<a target="_blank" href="${knownLinks[item.system]}${item.code}">${item.code}</a>` : item.code),
				item.display].map((s) => `<td style="padding-right: 10px">${s}</td>`).join("") +
				`<td><span class="rome-option-field" id="rome-option-field-${items.length + i}" data-rome-system="${item.system}" data-rome-code="${item.code}" data-rome-selected="${item.field}"></span></b></td><td><span id="rome-delete-field-${i}"><i class="fa fa-trash"></i></span></td>
                  </tr>`).join("") +

			`</tbody>
       </table>`
		$(".rome-edit-field-ui-list").html(html).show()
		items.forEach((item, i) => $(`#rome-delete-${i}`).on('click', () => deleteOntologyAnnotation(item.system, item.code, 'dataElement')))
		values.forEach((item, i) => $(`#rome-delete-field-${i}`).on('click', () => deleteOntologyAnnotation(item.system, item.code, item.field)))
	
		updateAnnotationTargetsDropdown();
	}

	//#endregion    





	/**
	 * The throttle implementation from underscore.js
	 * See https://stackoverflow.com/a/27078401
	 * @param {function} func 
	 * @param {Number} wait 
	 * @param {Object} options 
	 * @returns 
	 */

	function throttle(func, wait, options) {
		let context, args, result;
		let timeout = null;
		let previous = 0;
		if (!options) options = {};
		const later = function () {
			previous = options.leading === false ? 0 : Date.now();
			timeout = null;
			result = func.apply(context, args);
			if (!timeout) context = args = null;
		};
		return function () {
			const now = Date.now();
			if (!previous && options.leading === false) previous = now;
			const remaining = wait - (now - previous);
			context = this;
			args = arguments;
			if (remaining <= 0 || remaining > wait) {
				if (timeout) {
					clearTimeout(timeout);
					timeout = null;
				}
				previous = now;
				result = func.apply(context, args);
				if (!timeout) context = args = null;
			} else if (!timeout && options.trailing !== false) {
				timeout = setTimeout(later, remaining);
			}
			return result;
		};
	};


})();
