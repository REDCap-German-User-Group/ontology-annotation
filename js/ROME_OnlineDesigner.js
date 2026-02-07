// Ontology Made Easy EM - Online Designer Integration

// TODOs
// - [ ] Scrap the whole Ontology table as is and replace with a DataTable and a backend structure*
// - [ ] Instead of the search field, require manual search trigger and display results in a popover,
//       which displays searches in internal and any external ontologies as they come in. Use a 
//       DataTable for this, that can be searched and filtered further.
// - [ ] Add a config option/filter to limit searching to selected ontologies (from those configured in
//       the module settings).
// - [ ] Add a schema validator (such as https://github.com/ajv-validator/ajv) to the module
// - [ ] Allow the client to restrict search results to certain code systems (relevant for FhirQuestionnaire stuff). A list is already available.
// - [ ] Cleanup of module logs and unused src_ settings



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
	const designerState = {};

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
				designerState.$dlg = $(ob);
				designerState.isMatrix = ob.id == 'addMatrixPopup';
				try {
					updateEditFieldUI();
				}
				catch (e) {
					console.error(e);
				}
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

	//#region Help

	/**
	 * Shows a help dialog in response to the "Learn about using Ontology Annotations"
	 */
	function showFieldHelp() {
		if (!designerState.fieldHelpContent) {
			JSMO.ajax('get-fieldhelp').then(response => {
				designerState.fieldHelpContent = response;
				showFieldHelp();
			}).catch(err => {
				error(err);
			});
		}
		else {
			log('Showing field help');
			simpleDialog(designerState.fieldHelpContent, config.moduleDisplayName);
		}
	}

	//#endregion

	//#region Edit Field UI

	function updateEditFieldUI() {
		if (designerState.$dlg.find('.rome-edit-field-ui-container').length == 0) {
			addEditFieldUI();
		}
		log('Updating Edit Field UI');
		// Exclusion checkbox
		let excluded = false;
		if (designerState.isMatrix) {
			const matrixGroupName = '' + designerState.$dlg.find('#grid_name').val();
			excluded = config.matrixGroupsExcluded.includes(matrixGroupName);
		}
		else {
			const fieldName = '' + designerState.$dlg.find('input[name="field_name"]').val();
			excluded = config.fieldsExcluded.includes(fieldName);
		}
		setExcludedCheckboxState(excluded);
		designerState.$dlg.find('input[name="rome-em-fieldedit-search"]').val('');
		updateAnnotationTable();
		// Disable search when there are errors and add error indicator
		if (config.errors?.length ?? 0 > 0) {
			designerState.$dlg.find('#rome-search-bar :input').prop('disabled', true);
			showErrorBadge(config.errors.join('\n'));
		}
	}

	function isExcludedCheckboxChecked() {
		return designerState.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked') == true;
	}

	function setExcludedCheckboxState(state) {
		designerState.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked', state);
		$('input[name="rome-em-fieldedit-exclude"]').val(state ? '1' : '0');
	}


	function addEditFieldUI() {
		if (designerState.$dlg.find('.rome-edit-field-ui-container').length > 0) return;
		let $ui;
		if (designerState.isMatrix) {
			log('Adding Edit Matrix UI');
			$ui = $($('#rome-em-fieldedit-ui-template').html());
		}
		else {
			log('Adding Edit Field UI');
			$ui = $('<tr><td colspan="2"></td></tr>');
			$ui.find('td').append($($('#rome-em-fieldedit-ui-template').html()));
		}

		//#region Setup event handlers

		// Track changes to the choices
		const $enum = designerState.isMatrix
			? designerState.$dlg.find('textarea[name="element_enum_matrix"]')
			: designerState.$dlg.find('textarea[name="element_enum"]');
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
			if (val !== designerState.enum) {
				const fieldType = getFieldType();
				if (['select', 'radio', 'checkbox'].includes(fieldType)) {
					setEnum(val);
				}
			}
		}
		// Track changes of the field type and set enum
		designerState.$dlg.find('select[name="field_type"]').on('change', () => {
			designerState.fieldType = getFieldType();
			log('Field type changed:', designerState.fieldType);
			if (designerState.fieldType == 'yesno' || designerState.fieldType == 'truefalse') {
				const val = $('#div_element_' + designerState.fieldType + '_enum div').last().html().trim().replace('<br>', '\n');
				setEnum(val);
			}
			else if (['select', 'radio', 'checkbox'].includes(designerState.fieldType)) {
				trackEnumChange($enum.val());
			}
			else {
				setEnum('');
			}
		}).trigger('change');
		// Init and track "Do not annotate this field/matrix"
		$ui.find('.rome-em-fieldedit-exclude').each(function () {
			const $this = $(this);
			const id = 'rome-em-fieldedit-exclude-' + (designerState.isMatrix ? 'matrix' : 'field');
			if ($this.is('input')) {
				$this.attr('id', id);
				$this.on('change', function () {
					const checked = $(this).prop('checked');
					if (!designerState.isMatrix) {
						// Store exclusion
						designerState.$dlg.find('[name="rome-em-fieldedit-exclude"]').val(checked ? 1 : 0);
					}
					log('Do not annotate is ' + (checked ? 'checked' : 'not checked'));
					if (checked) performExclusionCheck();
				});
			}
			else if ($this.is('label')) {
				$this.attr('for', id);
			}
		});
		// // Init auto completion
		// const $searchInput = $ui.find('input[name="rome-em-fieldedit-search"]');
		// const $searchSpinner = $ui.find('.rome-edit-field-ui-spinner');
		// const throttledSearch = throttle(function (request, response) {
		// 	const payload = {
		// 		"term": request.term,
		// 		"data.isMatrix": data.isMatrix,
		// 		"name": data.isMatrix ? data.$dlg.find('input[name="grid_name"]').val() : data.$dlg.find('input[name="field_name"]').val(),
		// 		// TODO - maybe need add value from target dropdown, in case this affect what we do here
		// 	};
		// 	$searchSpinner.addClass('busy');
		// 	log('Search request:', payload);
		// 	JSMO.ajax('search', payload)
		// 		.then(searchResult => {
		// 			log('Search result:', searchResult);
		// 			response(searchResult);
		// 		})
		// 		.catch(err => error(err))
		// 		.finally(() => $searchSpinner.removeClass('busy'));
		// }, 500, { leading: false, trailing: true });
		// $searchInput.autocomplete({
		// 	source: throttledSearch,
		// 	minLength: 2,
		// 	delay: 0,
		// 	open: function (event, ui) {
		// 		// For some reason, the z-index of the parent dialog keeps shifting up
		// 		const z = '' + (Number.parseInt(data.$dlg.parents('[role="dialog"]').css('z-index') ?? '199') + 1);
		// 		const action = ('' + $searchInput.val()).length == 0 ? 'hide' : 'show';
		// 		$('.ui-autocomplete, .ui-menu-item').css('z-index', z)[action]();
		// 	},
		// 	focus: function (event, ui) {
		// 		return false;
		// 	},
		// 	select: function (event, ui) {
		// 		log('Autosuggest selected:', ui);

		// 		if (ui.item.value !== '') {
		// 			$searchInput.val(ui.item.label);
		// 			document.getElementById("rome-add-button").onclick = function () {
		// 				updateOntologyActionTag(ui.item);
		// 			};
		// 		}
		// 		return false;
		// 	}
		// })
		// 	.data('ui-autocomplete')._renderItem = function (ul, item) {
		// 		return $("<li></li>")
		// 			.data("item", item)
		// 			.append("<a>" + item.display + "</a>")
		// 			.appendTo(ul);
		// 	};

		//#endregion

		if (designerState.isMatrix) {
			// Matrix-specific adjustments
			// Insert at end of the dialog
			designerState.$dlg.append($ui);
		}
		else {
			// Single-field-specific adjustments
			// Mirror visibility of the Action Tags / Field Annotation DIV
			const actiontagsDIV = document.getElementById('div_field_annotation')
				?? document.createElement('div');
			const observer = new MutationObserver(() => {
				const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
				$ui.css('display', actiontagsVisible ? 'table-row' : 'none');
			});
			observer.observe(actiontagsDIV, { attributes: true, attributeFilter: ['style'] });
			// Initial sync
			const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
			$ui.css('display', actiontagsVisible ? 'table-row' : 'none');
			// Add a hidden field to transfer exclusion
			designerState.$dlg.find('#addFieldForm').prepend('<input type="hidden" name="rome-em-fieldedit-exclude" value="0">');
			// Initial sync from the action tag
			updateAnnotationTable()
			// Insert the UI as a new table row
			designerState.$dlg.find('#quesTextDiv > table > tbody').append($ui);
		}

		initializeSearchInput('input[name="rome-em-fieldedit-search"]');
	}


	//#endregion

	function performExclusionCheck() {
		const misc = [];
		designerState.$dlg.find(designerState.isMatrix ? '[name="addFieldMatrixRow-annotation"]' : '[name="field_annotation"]').each(function () {
			misc.push($(this).val() ?? '');
		});
		if (misc.join(' ').includes(config.atName)) {
			simpleDialog(JSMO.tt(designerState.isMatrix ? 'fieldedit_15' : 'fieldedit_14', config.atName), JSMO.tt('fieldedit_13'));
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
		if (designerState.enum !== val) {
			designerState.enum = val;
			if (designerState.enum != '') {
				log('Enum changed:', designerState.enum);
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
		const selector = designerState.isMatrix ? "TODO" : '#field_annotation';
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
		if (designerState.isMatrix) {
			$('td.addFieldMatrixRowVar input').each(function () {
				const fieldName = `${$(this).val()}`.trim();
				if (fieldName !== '') {
					fieldNames.push(fieldName);
				}
			});

		}
		else {
			fieldNames.push(designerState.$dlg.find('input#field_name').val() ?? '??');
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
		if (designerState.enum) {
			for (const line of designerState.enum?.split("\n")) {
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

	//#region Error Handling

	function showErrorBadge(errorMessage) {
		if (errorMessage) {
			designerState.$dlg.find('#rome-edit-field-error')
				.css('display', 'block')
				.attr('data-bs-tooltip', 'hover')
				.attr('title', errorMessage)
				.tooltip('enable');
		}
		else {
			designerState.$dlg.find('#rome-edit-field-error')
				.css('display', 'none')
				.tooltip('disable');
		}
	}

	//#endregion

	//#region Search Implementation

	const searchState = {
		rid: 0,
		term: '',
		lastTerm: '',
		lastTermCompleted: false, // true if last term was completed by the server

		resultsBySource: {},
		items: [],                // flattened items shown in dropdown

		pending: {},              // for future polling (unused for now)
		pollTimer: null,
		xhr: null,
		debounceTimer: null,
		refreshing: false,        // used later for polling refresh
		errorRaised: false,

		cache: new Map()          // cacheKey(term, sourceSet) -> snapshot
	};

	function showSpinner(state) {
		const $searchSpinner = designerState.$dlg.find('.rome-edit-field-ui-spinner');
		$searchSpinner[state ? 'addClass' : 'removeClass']('busy');
		designerState.$input[state ? 'addClass' : 'removeClass']('is-searching');
	}

	function initializeSearchInput(selector) {

		designerState.$input = designerState.$dlg.find(selector);

		designerState.$input.autocomplete({
			minLength: 2,
			delay: 0, // we debounce manually
			source: function (request, responseCb) {
				const term = (request.term || '').trim();
				if (term.length < 2) {
					responseCb([]);
					return;
				}

				// Refresh path (used later for polling)
				if (searchState.refreshing && term === searchState.term) {
					responseCb(searchState.items); return;
				}

				// Check cache first (term + desired source set)
				const desiredSourceIds = getDesiredSourceIds();
				const ck = makeCacheKey(term, desiredSourceIds);
				if (searchState.cache.has(ck)) {
					const snap = searchState.cache.get(ck);

					searchState.term = term;
					searchState.resultsBySource = snap.resultsBySource || {};
					searchState.items = snap.items || flattenResults(searchState.resultsBySource);
					searchState.pending = snap.pending || {};
					searchState.lastTermCompleted = !!snap.completed;

					responseCb(searchState.items);

					// If incomplete, re-issue search for missing sources
					if (!snap.completed) {
						const missing = desiredSourceIds.filter(
							sid => !(sid in searchState.resultsBySource) && !(sid in searchState.pending)
						);
						if (missing.length) {
							// We don't want to wipe cached results; see startSearch opts below
							queueSearchMissing(term, missing);
						}
						else if (Object.keys(searchState.pending).length) {
							// No missing, just pending -> resume polling
							searchState.rid += 1;
							schedulePoll(searchState.rid);
						}
					}
					return;
				}

				// If autocomplete is re-triggering with the same term (arrow keys, focus, etc.),
				// do NOT re-query server. Serve cached items (even if empty).
				if (term === searchState.term && searchState.lastTermCompleted) {
					responseCb(searchState.items);
					return;
				}

				// If we get here, we need to query the server.
				queueSearch(term, responseCb);
			}
		})
			.data('ui-autocomplete')._renderItem = function (ul, item) {
				const sys = shortSystem(item.hit.system);
				const code = item.hit.code ? ` [${item.hit.code}]` : '';

				return $('<li>')
					.append($('<div>').text(`${sys}: ${item.label}${code}`))
					.appendTo(ul);
			};

		designerState.$input.on('autocompleteselect', function (e, ui) {
			if (searchState.debounceTimer) {
				clearTimeout(searchState.debounceTimer);
				searchState.debounceTimer = null;
			}
			const h = ui.item.hit;
			setSelectedAnnotation({
				sourceId: ui.item.sourceId,
				system: h.system,
				code: h.code,
				display: h.display,
				type: h.type || null
			});
		});
	}

	function setSelectedAnnotation(annotation) {
		// Dummy
		log('Selected annotation:', annotation);
	}

	/**
	 * Maps known code systems to a short name
	 * TODO: This should be configurable (server side)
	 * @param {string} system 
	 * @returns {string}
	 */
	function shortSystem(system) {
		if (!system) return 'CODE';
		if (system.includes('snomed')) return 'SNOMEDCT';
		if (system.includes('loinc')) return 'LOINC';
		return system;
	}

	function queueSearch(term, responseCb) {
		if (searchState.debounceTimer) {
			clearTimeout(searchState.debounceTimer);
		}

		searchState.debounceTimer = setTimeout(() => {
			startSearch(term, responseCb);
		}, 200);
	}

	function queueSearchMissing(term, sourceIds) {
		// Reuse the same debounce timer
		if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);

		searchState.debounceTimer = setTimeout(() => {
			startSearch(term, null, { sourceIds, merge: true });
		}, 50);
	}

	function startSearch(term, responseCb, opts) {
		opts = opts || {};
		const sourceIds = Array.isArray(opts.sourceIds) ? opts.sourceIds : null; // null => all
		const merge = !!opts.merge;

		if (term.length < 2) {
			stopSearch();
			if (typeof responseCb === 'function') responseCb([]);
			return;
		}
		showErrorBadge(false);

		// new query identity
		searchState.rid += 1;
		searchState.term = term;
		if (!merge) {
			searchState.resultsBySource = {};
			searchState.items = [];
			searchState.lastTermCompleted = false;
			searchState.pending = {};
			searchState.lastTermCompleted = false;
		}
		else {
			// Merging into existing cached results.
			if (!searchState.pending || typeof searchState.pending !== 'object') searchState.pending = {};
			if (!searchState.resultsBySource || typeof searchState.resultsBySource !== 'object') searchState.resultsBySource = {};
			// Drop pending for the sources we are about to re-issue (server will give fresh tokens)
			if (sourceIds) {
				for (const sid of sourceIds) delete searchState.pending[sid];
			}
		}

		// Abort previous request
		if (searchState.xhr) {
			searchState.xhr.abort();
			searchState.xhr = null;
		}

		showSpinner(true);

		const rid = searchState.rid;

		const payload = { rid, q: term };
		if (sourceIds && sourceIds.length) payload.source_ids = sourceIds;

		searchState.xhr = $.ajax({
			url: config.searchEndpoint,
			method: 'POST',
			contentType: 'application/json; charset=utf-8',
			dataType: 'json',
			data: JSON.stringify(payload)
		})
			.done(resp => {
				log('Search - received response', resp);
				if (!resp || resp.rid !== searchState.rid) return;

				const newResults = resp.results || {};
				const newPending = resp.pending || {};

				if (merge) {
					mergeIntoResultsBySource(newResults); // NEW helper; see below

					// merge pending for requested sources (server returns exactly requested keys)
					if (sourceIds) {
						for (const sid of sourceIds) {
							if (newPending[sid]) searchState.pending[sid] = newPending[sid];
							else delete searchState.pending[sid]; // just in case
						}
					} else {
						// merge mode without sourceIds shouldn't happen; but handle anyway
						searchState.pending = { ...searchState.pending, ...newPending };
					}
				} else {
					searchState.resultsBySource = newResults;
					searchState.pending = newPending;
				}

				searchState.items = flattenResults(searchState.resultsBySource);

				const desired = getDesiredSourceIds();
				const ck = makeCacheKey(term, desired);
				const completed =
					desired.every(sid => (sid in searchState.resultsBySource)) &&
					Object.keys(searchState.pending).length === 0;

				searchState.lastTermCompleted = completed;

				searchState.cache.set(ck, {
					resultsBySource: searchState.resultsBySource,
					pending: searchState.pending,
					completed,
					items: searchState.items
				});

				if (typeof responseCb === 'function') {
					responseCb(searchState.items);
				} else {
					// refresh dropdown in-place (merge path)
					designerState.$input.autocomplete('search', term);
				}

				if (Object.keys(searchState.pending).length) {
					schedulePoll(searchState.rid);
				} else {
					showSpinner(false);
					if (searchState.errorRaised) searchState.errorRaised = false;
				}
			})
			.fail((xhr, status) => {
				let error = 'Unknown error';
				if (xhr && xhr.responseJSON && xhr.responseJSON.error) {
					error = xhr.responseJSON.error;
				}
				log(`Search - failed (${status})`, error);
				if (status === 'abort') return;

				if (!merge) {
					searchState.resultsBySource = {};
					searchState.items = [];
					searchState.pending = {};
					searchState.lastTermCompleted = true;
					if (typeof responseCb === 'function') responseCb([]);
				}
				else {
					// Merge failure: keep whatever we had (cached results still valid)
					designerState.$input.autocomplete('search', term);
				}
				showSpinner(false);
				// Report error
				searchState.errorRaised = true;
				showErrorBadge(`Search could not be performed. The server reported this error: ${error}`);
			})
			.always(() => {
				searchState.xhr = null;
			});
	}

	function schedulePoll(rid) {
		if (searchState.pollTimer) clearTimeout(searchState.pollTimer);

		let wait = 300;
		for (const p of Object.values(searchState.pending)) {
			if (p && typeof p.after_ms === 'number') wait = Math.min(wait, p.after_ms);
		}
		searchState.pollTimer = setTimeout(() => poll(rid), wait);
	}

	function poll(rid) {
		if (rid !== searchState.rid) return;
		if (!Object.keys(searchState.pending).length) return;

		const pendingMap = {};
		for (const [src, p] of Object.entries(searchState.pending)) pendingMap[src] = p.token;

		$.ajax({
			url: config.pollEndpoint,
			method: 'POST',
			contentType: 'application/json; charset=utf-8',
			dataType: 'json',
			data: JSON.stringify({ rid, pending: pendingMap })
		})
			.done(resp => {
				if (!resp || resp.rid !== searchState.rid) return;

				// Errors? We show the error indicator with a generic "See console" and output 
				// details to the console.
				if (Object.keys(resp.errors || {}).length) {
					showErrorBadge('Some errors were reported. See console for details.');
					console.error('Error polling for search results:', resp.errors);
				}

				// Merge results into state
				mergeIntoResultsBySource(resp.results || {});
				searchState.items = flattenResults(searchState.resultsBySource);

				// Update pending
				searchState.pending = resp.pending || {};

				const desired = getDesiredSourceIds();
				const ck = makeCacheKey(searchState.term, desired);
				const completed =
					desired.every(sid => (sid in searchState.resultsBySource)) &&
					Object.keys(searchState.pending).length === 0;

				searchState.cache.set(ck, {
					resultsBySource: searchState.resultsBySource,
					pending: searchState.pending,
					completed,
					items: searchState.items
				});

				designerState.$input.autocomplete('search', searchState.term);

				if (Object.keys(searchState.pending).length) {
					schedulePoll(rid);
				} else {
					searchState.lastTermCompleted = true;
					showSpinner(false);
				}
			})
			.fail((xhr, status) => {
				if (status === 'abort') return;
				// stop polling but keep whatever we have
				searchState.pending = {};
				showSpinner(false);
				// optional: set error badge
			});
	}

	function mergeIntoResultsBySource(newResultsBySource) {
		if (!newResultsBySource || typeof newResultsBySource !== 'object') return;

		for (const [sourceId, newHits] of Object.entries(newResultsBySource)) {
			if (!Array.isArray(newHits)) continue;

			const oldHits = Array.isArray(searchState.resultsBySource[sourceId])
				? searchState.resultsBySource[sourceId]
				: [];

			if (!oldHits.length) {
				searchState.resultsBySource[sourceId] = newHits.slice();
				continue;
			}

			const seen = new Set();
			for (const h of oldHits) {
				const k = hitKey(h);
				if (k) seen.add(k);
			}

			for (const h of newHits) {
				const k = hitKey(h);
				if (!k || seen.has(k)) continue;
				seen.add(k);
				oldHits.push(h);
			}

			searchState.resultsBySource[sourceId] = oldHits;
		}
	}

	function hitKey(h) {
		if (!h || typeof h !== 'object') return '';
		const system = (h.system || '').trim();
		const code = (h.code || '').trim();
		if (!system || !code) return '';
		return system + '|' + code;
	}

	function flattenResults(resultsBySource) {
		const out = [];

		for (const [sourceId, hits] of Object.entries(resultsBySource)) {
			if (!Array.isArray(hits)) continue;

			for (const h of hits) {
				out.push({
					label: h.display || h.code || '(no label)',
					value: h.display || h.code || '',
					hit: h,
					sourceId
				});
			}
		}

		// stable sort: score desc, otherwise insertion order
		out.sort((a, b) => (b.hit.score || 0) - (a.hit.score || 0));
		return out;
	}

	function stopSearch() {
		if (searchState.xhr) {
			searchState.xhr.abort();
			searchState.xhr = null;
		}
		if (searchState.pollTimer) {
			clearTimeout(searchState.pollTimer);
			searchState.pollTimer = null;
		}
		searchState.pending = {};
		searchState.resultsBySource = {};
		searchState.items = [];
		showSpinner(false);
		showErrorBadge(false);
	}

	function sourceSetKey(sourceIds) {
		// Sort a copy in order not to change the original
		const sortedCopy = sourceIds.slice().sort();
		return sortedCopy.join('|');
	}

	function makeCacheKey(term, sourceIds) {
		return `${term}::${sourceSetKey(sourceIds)}`;
	}

	function getDesiredSourceIds() {
		// TODO: later: return subset chosen in UI
		return config.sources.map(s => s.id);
	}

	//#endregion


})();
