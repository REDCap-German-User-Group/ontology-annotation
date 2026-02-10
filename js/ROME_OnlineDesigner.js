// Ontology Made Easy EM - Online Designer Integration

// TODOs
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
/// <reference path="../typedefs/ROME.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />
/// <reference path="./WatchTargets.js" />

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
	const designerState = {
		minItemsForSelect2: 7
	};

	/** @type {OntologyAnnotationParser} */
	let ontologyParser;

	/**
	 * Mutable in-dialog annotation draft state for single-field editing.
	 * @type {AnnotationDraftState}
	 */
	const annotationDraftState = {
		base: null,
		current: null,
		lastParseResult: null,
		dirty: false,
		parseStatus: 'valid',
		parseErrorMessage: '',
		manualMode: false,
		lastSyncedTextarea: ''
	};

	/**
	 * Mutable in-dialog annotation draft state for matrix editing.
	 * @type {MatrixDraftState}
	 */
	const matrixDraftState = {
		rows: {},
		rowOrder: [],
		observer: null
	};

	/**
	 * Current search selection used by the Add button flow.
	 * @type {AnnotationSelectionState}
	 */
	const selectionState = {
		selected: null
	};

	/**
	 * DataTable integration state for the annotation grid.
	 * @type {AnnotationTableState}
	 */
	const annotationTableState = {
		dt: null,
		advancedUiEnabled: false
	};

	/** @type {number|null} */
	let manualImportTimer = null;

	const SAVE_SKIP_SENTINEL_KEY = '__romeSkipMissingChoicePrompt';

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
		ensureFieldSaveHook();
		ensureMatrixSaveHook();

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
				const matrixGroupName = String($('#grid_name').val());
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

	/**
	 * Refreshes the dialog-level ROME UI whenever REDCap opens/refits the editor dialog.
	 * Initializes draft state from action tags and re-renders targets/table controls.
	 * @returns {void}
	 */
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
		initializeAnnotationDraftState();
		setSelectedAnnotation(null);
		updateAnnotationTable();
		// Disable search when there are errors and add error indicator
		if (config.errors?.length ?? 0 > 0) {
			designerState.$dlg.find('#rome-search-bar :input').prop('disabled', true);
			showSearchErrorBadge(config.errors.join('\n'));
		}
		resetSearchState();
		log('Search state has been reset.', searchState);
		initUserChangeWatcher();
	}

	/**
	 * Returns whether the "exclude from annotation" checkbox is currently enabled.
	 * @returns {boolean}
	 */
	function isExcludedCheckboxChecked() {
		return designerState.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked') == true;
	}

	/**
	 * Updates exclusion checkbox state in UI and hidden submit field.
	 * @param {boolean} state
	 * @returns {void}
	 */
	function setExcludedCheckboxState(state) {
		designerState.$dlg.find('input.rome-em-fieldedit-exclude').prop('checked', state);
		$('input[name="rome-em-fieldedit-exclude"]').val(state ? '1' : '0');
	}


	/**
	 * Inserts the ROME UI surface into the active REDCap dialog and wires handlers.
	 * @returns {void}
	 */
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
			trackEnumChange(String($enum.val()));
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
		/**
		 * Tracks choice/enumeration text changes and updates target dropdown state when relevant.
		 * @param {string} val
		 * @returns {void}
		 */
		function trackEnumChange(val) {
			if (val !== designerState.enum) {
				const fieldType = getFieldType();
				if (['select', 'radio', 'checkbox'].includes(fieldType)) {
					setEnum(val);
				}
			}
		}
		// Track changes of the field type and set enum
		designerState.$dlg.find('select[name="field_type"], select#field_type_matrix, select#field_type').on('change', () => {
			designerState.fieldType = getFieldType();
			log('Field type changed:', designerState.fieldType);
			if (designerState.fieldType == 'yesno' || designerState.fieldType == 'truefalse') {
				const val = $('#div_element_' + designerState.fieldType + '_enum div').last().html().trim().replace('<br>', '\n');
				setEnum(val);
			}
			else if (['select', 'radio', 'checkbox'].includes(designerState.fieldType)) {
				trackEnumChange(String($enum.val()));
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
		initializeAddButton();
		setupManualAnnotationHooks();
		setupSaveValidationHooks();
		ensureMatrixSaveHook();
		if (designerState.isMatrix) {
			setupMatrixLifecycleHandlers();
		}
	}


	//#endregion

	//#region Dialog Exclusion State

	/**
	 * Shows an informational warning when exclusion is enabled while ontology tags exist.
	 * @returns {void}
	 */
	function performExclusionCheck() {
		const misc = [];
		designerState.$dlg.find(designerState.isMatrix ? '[name="addFieldMatrixRow-annotation"]' : '[name="field_annotation"]').each(function () {
			misc.push($(this).val() ?? '');
		});
		if (misc.join(' ').includes(config.atName)) {
			simpleDialog(JSMO.tt(designerState.isMatrix ? 'fieldedit_15' : 'fieldedit_14', config.atName), JSMO.tt('fieldedit_13'));
		}
	}

	/**
	 * Persists matrix exclusion status via module AJAX and updates cached UI config.
	 * @param {string} matrixGroupName
	 * @param {boolean} exclude
	 * @returns {void}
	 */
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

	//#endregion

	//#region Revised Annotation Handling


	/** @type {ROME_OnlineDesignerState} */
	const odState = {
		editType: 'field',
		rows: [],
		watcher: null,
	}


	/**
	 * Initializes user change watchers for field name (matrix only), field annotation, and choices
	 */
	function initUserChangeWatcher() {
		const elements = [];
		const filters = [];
		const patchProgrammatic = false && odState.editType === 'field';
		if (odState.editType === 'field') {
			// Annotation
			elements.push(document.getElementById('field_annotation'));
			// Choices
			elements.push(document.getElementById('element_enum'));
		}
		else if (odState.editType === 'matrix') {
			// Table of matrix fields (including field names and annotations)
			elements.push(document.querySelector('table.addFieldMatrixRowParent'));
			// Choices
			elements.push(document.getElementById('element_enum_matrix'));
			filters.push(
				'input[name^=addFieldMatrixRow-varname_]', 
				'textarea[name=addFieldMatrixRow-annotation]'
			);
		}
		odState.watcher = WatchTargets.watch(elements, {
			onEvent: (info) => {
				// TODO - add some useful work and remove the logging
				log('WatchDog:', info);
			},
			tableCellFilter: filters,
			fireOnInput: false,
			patchProgrammatic: patchProgrammatic
		});
		log('Installed change watcher', odState);
	}

	/**
	 * Extracts the annotation content from the respective textarea elements, indexed by field name.
	 * @returns {Map<string,string>}
	 */
	function getAnnotationContent() {
		const contentMap = new Map();
		if (odState.editType === 'field') {
			const content = String($('#field_annotation').val() ?? '');
			contentMap.set('field', content); // for field edit, the fieldname is hardcoded to 'field'
		}
		else if (odState.editType === 'matrix') {
			$('tr.addFieldMatrixRow').each(function () {
				const $tr = $(this);
				const fieldName = String($tr.find('td.addFieldMatrixRowVar input').val() ?? '').trim();
				// Only bother when field name has been set
				if (fieldName === '') return;
				const content = String($tr.find('td.addFieldMatrixRowFieldAnnotation textarea').val() ?? '');
				contentMap.set(fieldName, content);
			});
		}
		return contentMap;
	}

	/**
	 * Parses ontology annotations from the field annotation
	 * @param {string} annotationText 
	 * @returns {OntologyAnnotationJSON}
	 */
	function parseOntologiesFromActionTag(annotationText) {

		// TODO - reuse existing; hardcode something for now
		const annotations = 
		{
			dataElement: {
				coding: [
					{
						system: 'Test System',
						code: 'TEST',
						display: 'Just for testing'
					}
				]
			}
		}
		return annotations;
	}


	//#region Annotation Draft and Table Engine

	//#region Serialization and Draft Normalization

	/**
	 * Escapes text for safe HTML rendering.
	 * @param {string} str
	 * @returns {string}
	 */
	function escapeHTML(str) {
		return String(str)
			.replace(/&/g, '&amp;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
			.replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	/**
	 * Creates a deep clone of annotation JSON for independent base/current snapshots.
	 * @param {OntologyAnnotationJSON|Object} annotation
	 * @returns {OntologyAnnotationJSON}
	 */
	function cloneAnnotation(annotation) {
		return JSON.parse(JSON.stringify(annotation || getMinimalOntologyAnnotation()));
	}

	/**
	 * Ensures ontology annotation JSON is normalized for draft-state operations.
	 * @param {OntologyAnnotationJSON|Object} raw
	 * @returns {OntologyAnnotationJSON}
	 */
	function normalizeAnnotation(raw) {
		/** @type {OntologyAnnotationJSON} */
		const annotation = (raw && typeof raw === 'object' && !Array.isArray(raw))
			? /** @type {OntologyAnnotationJSON} */ (raw)
			: cloneAnnotation(getMinimalOntologyAnnotation());
		if (!annotation.dataElement || typeof annotation.dataElement !== 'object') {
			annotation.dataElement = getMinimalOntologyAnnotation().dataElement;
		}
		if (!Array.isArray(annotation.dataElement.coding)) {
			annotation.dataElement.coding = [];
		}
		if (!annotation.dataElement.valueCodingMap || typeof annotation.dataElement.valueCodingMap !== 'object') {
			annotation.dataElement.valueCodingMap = {};
		}
		for (const [choiceCode, entry] of Object.entries(annotation.dataElement.valueCodingMap)) {
			if (!entry || typeof entry !== 'object') {
				annotation.dataElement.valueCodingMap[choiceCode] = { coding: [] };
				continue;
			}
			if (!Array.isArray(entry.coding)) {
				entry.coding = [];
			}
		}
		if (!annotation.dataElement.unit || typeof annotation.dataElement.unit !== 'object') {
			annotation.dataElement.unit = { coding: [] };
		}
		if (!Array.isArray(annotation.dataElement.unit.coding)) {
			annotation.dataElement.unit.coding = [];
		}
		annotation.dataElement.type = getFieldType();
		return annotation;
	}

	/**
	 * Returns true when an annotation has no dataElement coding, no unit coding, and no choice coding.
	 * @param {OntologyAnnotationJSON|Object} annotation
	 * @returns {boolean}
	 */
	function isAnnotationEmpty(annotation) {
		if (!annotation || typeof annotation !== 'object' || typeof annotation.dataElement !== 'object') return true;
		const hasCoding = Array.isArray(annotation.dataElement.coding) && annotation.dataElement.coding.length > 0;
		const hasUnit = Array.isArray(annotation.dataElement.unit?.coding) && annotation.dataElement.unit.coding.length > 0;
		const hasValueCodingMap = annotation.dataElement.valueCodingMap
			&& Object.values(annotation.dataElement.valueCodingMap).some(val => Array.isArray(val?.coding) && val.coding.length > 0);
		return !(hasCoding || hasUnit || hasValueCodingMap);
	}

	/**
	 * Initializes annotation draft state from currently rendered REDCap annotation input(s).
	 * @returns {void}
	 */
	function initializeAnnotationDraftState() {
		if (designerState.isMatrix) {
			initializeMatrixDraftState();
			return;
		}
		const result = getOntologyAnnotation();
		annotationDraftState.lastParseResult = result;
		annotationDraftState.base = normalizeAnnotation(cloneAnnotation(result.json));
		annotationDraftState.current = normalizeAnnotation(cloneAnnotation(result.json));
		annotationDraftState.dirty = false;
		annotationDraftState.parseStatus = result.error ? 'invalid' : 'valid';
		annotationDraftState.parseErrorMessage = result.error ? result.errorMessage : '';
		annotationDraftState.manualMode = false;
		annotationDraftState.lastSyncedTextarea = `${designerState.$dlg.find('#field_annotation').val() ?? ''}`;
		setJsonIssueOverlay(result.error ? result.errorMessage : false);
		log('Initialized single-field draft state:', annotationDraftState);
	}

	/**
	 * Initializes matrix draft state by reading each matrix row annotation textarea.
	 * @returns {void}
	 */
	function initializeMatrixDraftState() {
		matrixDraftState.rows = {};
		matrixDraftState.rowOrder = [];
		getMatrixRows().forEach(($row) => {
			const rowId = ensureMatrixRowId($row);
			const varName = getMatrixRowVarName($row);
			const parse = parseRowAnnotation($row);
			matrixDraftState.rows[rowId] = {
				rowId,
				varName,
				parseStatus: parse.error ? 'invalid' : 'valid',
				parseErrorMessage: parse.error ? parse.errorMessage : '',
				base: normalizeAnnotation(cloneAnnotation(parse.json)),
				current: normalizeAnnotation(cloneAnnotation(parse.json)),
				dirty: false
			};
			matrixDraftState.rowOrder.push(rowId);
		});
		refreshJsonOverlayFromMatrixState();
		log('Initialized matrix draft state:', matrixDraftState);
	}

	/**
	 * Refreshes JSON error overlay for matrix mode based on invalid row parse states.
	 * @returns {void}
	 */
	function refreshJsonOverlayFromMatrixState() {
		const invalidRow = Object.values(matrixDraftState.rows).find((row) => row.parseStatus === 'invalid');
		if (!invalidRow) {
			setJsonIssueOverlay(false);
			return;
		}
		setJsonIssueOverlay(`Row "${invalidRow.varName || invalidRow.rowId}" has invalid ontology JSON: ${invalidRow.parseErrorMessage}`);
	}

	/**
	 * Gets all matrix row elements from the currently open matrix dialog.
	 * @returns {JQuery<HTMLElement>[]}
	 */
	function getMatrixRows() {
		const rows = [];
		designerState.$dlg.find('.addFieldMatrixRowParent .addFieldMatrixRow').each(function () {
			rows.push($(this));
		});
		return rows;
	}

	/**
	 * Returns the stable client-side row identifier for a matrix row and creates one if missing.
	 * @param {JQuery<HTMLElement>} $row
	 * @returns {string}
	 */
	function ensureMatrixRowId($row) {
		let rowId = `${$row.attr('data-rome-row-id') ?? ''}`.trim();
		if (rowId === '') {
			rowId = `row_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
			$row.attr('data-rome-row-id', rowId);
		}
		return rowId;
	}

	/**
	 * Returns the current variable name for a matrix row.
	 * @param {JQuery<HTMLElement>} $row
	 * @returns {string}
	 */
	function getMatrixRowVarName($row) {
		return `${$row.find('.field_name_matrix:first').val() ?? ''}`.trim();
	}

	/**
	 * Parses ontology annotation from one matrix-row textarea.
	 * @param {JQuery<HTMLElement>} $row
	 * @returns {OntologyAnnotationParseResult}
	 */
	function parseRowAnnotation($row) {
		const value = `${$row.find('textarea[name="addFieldMatrixRow-annotation"]').first().val() ?? ''}`;
		return ontologyParser.parse(value);
	}

	/**
	 * Returns the currently active single-field draft annotation.
	 * @returns {OntologyAnnotationJSON}
	 */
	function getSingleDraftAnnotation() {
		if (!annotationDraftState.current) {
			annotationDraftState.current = normalizeAnnotation(getMinimalOntologyAnnotation());
		}
		return annotationDraftState.current;
	}

	/**
	 * Generates a serialized ONTOLOGY action-tag string for a normalized annotation object.
	 * @param {OntologyAnnotationJSON} annotation
	 * @returns {string}
	 */
	function buildOntologyTag(annotation) {
		const pruned = pruneAnnotationForActionTag(annotation);
		return `${config.atName}=${JSON.stringify(pruned, null, 2)}`;
	}

	/**
	 * Ensures there is at least one blank line between existing text and appended ontology tag.
	 * @param {string} text
	 * @param {string} tag
	 * @returns {string}
	 */
	function appendTagWithBlankLine(text, tag) {
		if (!tag) return text;
		const trimmed = text.replace(/\s+$/, '');
		if (trimmed.length === 0) return tag;
		return `${trimmed}\n\n${tag}`;
	}

	/**
	 * Removes a single trailing blank line (if present) after ontology tag removal.
	 * @param {string} text
	 * @returns {string}
	 */
	function trimTrailingEmptyLine(text) {
		return text.replace(/\n\s*\n$/, '\n').replace(/\n$/, '');
	}

	/**
	 * Produces a trimmed annotation payload for the ONTOLOGY action tag.
	 * Always removes `dataElement.text` and `dataElement.type` and drops empty containers.
	 * @param {OntologyAnnotationJSON} annotation
	 * @returns {Object}
	 */
	function pruneAnnotationForActionTag(annotation) {
		const normalized = normalizeAnnotation(cloneAnnotation(annotation));
		/** @type {any} */
		const out = { dataElement: {} };

		const coding = Array.isArray(normalized.dataElement.coding)
			? normalized.dataElement.coding.filter(c => c && c.system && c.code)
			: [];
		if (coding.length > 0) {
			out.dataElement.coding = coding;
		}

		const unitCoding = Array.isArray(normalized.dataElement.unit?.coding)
			? normalized.dataElement.unit.coding.filter(c => c && c.system && c.code)
			: [];
		if (unitCoding.length > 0) {
			out.dataElement.unit = { coding: unitCoding };
		}

		const valueCodingMap = {};
		for (const [choiceCode, bucket] of Object.entries(normalized.dataElement.valueCodingMap || {})) {
			const items = Array.isArray(bucket?.coding)
				? bucket.coding.filter(c => c && c.system && c.code)
				: [];
			if (items.length > 0) {
				valueCodingMap[choiceCode] = { coding: items };
			}
		}
		if (Object.keys(valueCodingMap).length > 0) {
			out.dataElement.valueCodingMap = valueCodingMap;
		}

		return out;
	}

	/**
	 * Applies the current single-field draft to `#field_annotation`.
	 * @param {boolean=} force
	 * @returns {void}
	 */
	function syncSingleDraftToTextarea(force = false) {
		const $area = designerState.$dlg.find('#field_annotation');
		if ($area.length === 0) return;
		const currentText = `${$area.val() ?? ''}`;
		if (!force && !annotationDraftState.dirty && currentText === annotationDraftState.lastSyncedTextarea) return;
		const annotation = normalizeAnnotation(getSingleDraftAnnotation());
		const parse = ontologyParser.parse(currentText);
		let next = currentText;
		const replacement = isAnnotationEmpty(annotation) ? '' : buildOntologyTag(annotation);
		if (parse.usedFallback) {
			next = replacement ? appendTagWithBlankLine(currentText, replacement) : currentText;
		} else {
			next = `${currentText.slice(0, parse.start)}${replacement}${currentText.slice(parse.end)}`;
			if (!replacement) {
				next = trimTrailingEmptyLine(next);
			}
		}
		$area.val(next);
		annotationDraftState.lastSyncedTextarea = next;
		annotationDraftState.dirty = false;
	}

	/**
	 * Applies all matrix drafts to row-level annotation textareas.
	 * @returns {void}
	 */
	function syncAllMatrixDraftsToTextareas() {
		getMatrixRows().forEach(($row) => {
			const rowId = ensureMatrixRowId($row);
			const rowState = matrixDraftState.rows[rowId];
			if (!rowState) return;
			const $area = $row.find('textarea[name="addFieldMatrixRow-annotation"]').first();
			const currentText = `${$area.val() ?? ''}`;
			const parse = ontologyParser.parse(currentText);
			const replacement = isAnnotationEmpty(rowState.current) ? '' : buildOntologyTag(rowState.current);
			let next = currentText;
			if (parse.usedFallback) {
				next = replacement ? appendTagWithBlankLine(currentText, replacement) : currentText;
			} else {
				next = `${currentText.slice(0, parse.start)}${replacement}${currentText.slice(parse.end)}`;
				if (!replacement) {
					next = trimTrailingEmptyLine(next);
				}
			}
			$area.val(next);
			rowState.dirty = false;
		});
	}

	/**
	 * Reads manual edits from single-field annotation textarea and refreshes draft state.
	 * @returns {boolean} true when parse/import succeeded
	 */
	function importSingleDraftFromTextarea() {
		const parse = getOntologyAnnotation();
		if (parse.error) {
			annotationDraftState.parseStatus = 'invalid';
			annotationDraftState.parseErrorMessage = parse.errorMessage;
			setJsonIssueOverlay(parse.errorMessage);
			return false;
		}
		annotationDraftState.parseStatus = 'valid';
		annotationDraftState.parseErrorMessage = '';
		annotationDraftState.lastParseResult = parse;
		annotationDraftState.current = normalizeAnnotation(cloneAnnotation(parse.json));
		annotationDraftState.base = normalizeAnnotation(cloneAnnotation(parse.json));
		annotationDraftState.dirty = false;
		annotationDraftState.lastSyncedTextarea = `${designerState.$dlg.find('#field_annotation').val() ?? ''}`;
		setJsonIssueOverlay(false);
		log('Updated internal annotation state from manual textarea edit:', annotationDraftState);
		updateAnnotationTable();
		return true;
	}

	/**
	 * Parses and imports a manual matrix-row annotation edit into row draft state.
	 * @param {JQuery<HTMLElement>} $row
	 * @returns {boolean} true when parse/import succeeded
	 */
	function importMatrixRowDraftFromTextarea($row) {
		const rowId = ensureMatrixRowId($row);
		const rowState = matrixDraftState.rows[rowId];
		if (!rowState) return false;
		const parse = parseRowAnnotation($row);
		if (parse.error) {
			rowState.parseStatus = 'invalid';
			rowState.parseErrorMessage = parse.errorMessage;
			refreshJsonOverlayFromMatrixState();
			return false;
		}
		rowState.parseStatus = 'valid';
		rowState.parseErrorMessage = '';
		rowState.current = normalizeAnnotation(cloneAnnotation(parse.json));
		rowState.base = normalizeAnnotation(cloneAnnotation(parse.json));
		rowState.dirty = false;
		refreshJsonOverlayFromMatrixState();
		log('Updated internal matrix row annotation state:', rowState);
		updateAnnotationTable();
		return true;
	}

	/**
	 * Ensures current UI draft can be saved and blocks submit if ONTOLOGY JSON is invalid.
	 * @returns {boolean}
	 */
	function validateBeforeSave(onProceedAfterMissingChoiceWarning = null, skipMissingChoicePrompt = false) {
		if (designerState.isMatrix) {
			syncAllMatrixDraftsToTextareas();
			const invalidRows = [];
			getMatrixRows().forEach(($row) => {
				const rowId = ensureMatrixRowId($row);
				const rowState = matrixDraftState.rows[rowId];
				if (!rowState) return;
				const parse = parseRowAnnotation($row);
				if (parse.error) {
					invalidRows.push({ rowId, rowName: rowState.varName || rowId, message: parse.errorMessage });
				}
			});
			if (invalidRows.length > 0) {
				log('Blocked matrix save due to invalid rows:', invalidRows);
				showInvalidSaveDialog(
					`Cannot save matrix. ${invalidRows.length} row(s) contain invalid ontology JSON.`,
					() => syncAllMatrixDraftsToTextareas()
				);
				return false;
			}
			return maybeWarnMissingChoiceTargetsOnSave(onProceedAfterMissingChoiceWarning, skipMissingChoicePrompt);
		}
		syncSingleDraftToTextarea(true);
		const parse = getOntologyAnnotation();
		if (parse.error) {
			log('Blocked field save due to invalid ontology JSON:', parse.errorMessage);
			showInvalidSaveDialog(
				`Cannot save field. ${parse.errorMessage}`,
				() => syncSingleDraftToTextarea(true)
			);
			return false;
		}
		return maybeWarnMissingChoiceTargetsOnSave(onProceedAfterMissingChoiceWarning, skipMissingChoicePrompt);
	}

	/**
	 * Warns and blocks save when annotations are still mapped to missing choice targets.
	 * Save can continue only after explicit user acknowledgement.
	 * @param {null|(() => void)} onProceedAfterWarning
	 * @returns {boolean}
	 */
	function maybeWarnMissingChoiceTargetsOnSave(onProceedAfterWarning = null, skipMissingChoicePrompt = false) {
		if (skipMissingChoicePrompt) return true;
		const missing = getMissingChoiceTargetRows();
		if (missing.length === 0) return true;
		log('Save warning: missing choice targets detected.', missing);
		showMissingChoiceSaveDialog(missing.length, onProceedAfterWarning || null);
		return false;
	}

	/**
	 * Removes choice-target mappings whose choice code is no longer present in current enum.
	 * @returns {number} number of removed choice buckets
	 */
	function removeMissingChoiceTargetsFromDraft() {
		const validCodes = new Set(getChoiceOptions().map(c => c.code));
		let removed = 0;

		/**
		 * @param {OntologyAnnotationJSON} annotation
		 * @returns {number}
		 */
		const pruneAnnotation = (annotation) => {
			let localRemoved = 0;
			const normalized = normalizeAnnotation(annotation);
			for (const code of Object.keys(normalized.dataElement.valueCodingMap || {})) {
				if (!validCodes.has(code)) {
					delete normalized.dataElement.valueCodingMap[code];
					localRemoved++;
				}
			}
			return localRemoved;
		};

		if (designerState.isMatrix) {
			for (const rowId of matrixDraftState.rowOrder) {
				const rowState = matrixDraftState.rows[rowId];
				if (!rowState) continue;
				const rowRemoved = pruneAnnotation(rowState.current);
				if (rowRemoved > 0) {
					rowState.dirty = true;
				}
				removed += rowRemoved;
			}
			if (removed > 0) {
				syncAllMatrixDraftsToTextareas();
			}
		} else {
			const annotation = getSingleDraftAnnotation();
			removed = pruneAnnotation(annotation);
			if (removed > 0) {
				annotationDraftState.dirty = true;
				syncSingleDraftToTextarea(true);
			}
		}

		if (removed > 0) {
			log('Removed missing choice-target mappings before save:', removed);
			updateAnnotationTable();
		}
		return removed;
	}

	/**
	 * Displays a blocking confirmation dialog for missing choice targets.
	 * @param {number} count
	 * @param {null|(() => void)} onProceed
	 * @returns {void}
	 */
	function showMissingChoiceSaveDialog(count, onProceed = null) {
		designerState.$dlg.find('.rome-missing-choice-save-dialog').remove();
		const $dlg = $('<div></div>')
			.addClass('rome-missing-choice-save-dialog')
			.html(
				`${count} annotation(s) target choice values that no longer exist.<br><br>` +
				`Any untargeted choice annotations may be lost when saving.<br><br>` +
				`How do you want to proceed?`
			)
			.dialog({
				modal: true,
				title: 'Warning: Missing Choice Targets',
				width: 520,
				open: function () {
					const $widget = $(this).dialog('widget');
					const $buttons = $widget.find('.ui-dialog-buttonpane button');
					$buttons.eq(0).addClass('rome-cancel-save-button');
					$buttons.eq(1).addClass('rome-save-remove-button');
					$buttons.eq(2).addClass('rome-save-keep-button');
				},
				close: function () {
					$(this).dialog('destroy').remove();
				},
				buttons: [
					{
						text: 'Cancel',
						click: function () {
							$(this).dialog('close');
						}
					},
					{
						text: 'Save and remove',
						click: function () {
							removeMissingChoiceTargetsFromDraft();
							$(this).dialog('close');
							if (typeof onProceed === 'function') {
								onProceed();
							}
						}
					},
					{
						text: 'Save and keep',
						click: function () {
							$(this).dialog('close');
							if (typeof onProceed === 'function') {
								onProceed();
							}
						}
					}
				]
			});
		log('Displayed blocking missing-choice warning dialog.', { count, hasProceed: typeof onProceed === 'function' });
	}

	/**
	 * Shows invalid-save dialog with options to continue manual editing or revert to valid draft state.
	 * @param {string} message
	 * @param {() => void} onRevert
	 * @returns {void}
	 */
	function showInvalidSaveDialog(message, onRevert) {
		const dialogId = `rome-invalid-${Date.now()}`;
		const content = `
			<div id="${dialogId}" class="rome-invalid-dialog">
				<p>${escapeHTML(message)}</p>
				<p>You can fix the JSON manually, or revert to the current in-memory annotation state.</p>
				<div class="d-flex gap-2 justify-content-end">
					<button type="button" class="btn btn-xs btn-defaultrc rome-invalid-fix">Fix manually</button>
					<button type="button" class="btn btn-xs btn-rcgreen rome-invalid-revert">Revert to draft</button>
				</div>
			</div>`;
		simpleDialog(content, 'Invalid ontology annotation');
		$(document).off(`click.${dialogId}`);
		$(document).on(`click.${dialogId}`, `#${dialogId} .rome-invalid-revert`, function () {
			onRevert();
			setJsonIssueOverlay(false);
			$(`#${dialogId}`).closest('.ui-dialog-content').dialog('close');
			$(document).off(`click.${dialogId}`);
		});
		$(document).on(`click.${dialogId}`, `#${dialogId} .rome-invalid-fix`, function () {
			$(`#${dialogId}`).closest('.ui-dialog-content').dialog('close');
			$(document).off(`click.${dialogId}`);
		});
	}

	/**
	 * Initializes single-field textarea and matrix row textareas for manual-edit synchronization.
	 * @returns {void}
	 */
	function setupManualAnnotationHooks() {
		if (!designerState.isMatrix) {
			const $area = designerState.$dlg.find('#field_annotation');
			$area.off('.rome-manual');
			$area.on('focus.rome-manual click.rome-manual', function () {
				annotationDraftState.manualMode = true;
				syncSingleDraftToTextarea(true);
				log('Entered manual annotation editing mode.');
			});
			$area.on('input.rome-manual', function () {
				if (manualImportTimer) {
					window.clearTimeout(manualImportTimer);
				}
				manualImportTimer = window.setTimeout(() => {
					importSingleDraftFromTextarea();
				}, 250);
			});
			$area.on('blur.rome-manual change.rome-manual', function () {
				importSingleDraftFromTextarea();
			});
			return;
		}
		designerState.$dlg.off('blur.rome-row-manual', 'textarea[name="addFieldMatrixRow-annotation"]');
		designerState.$dlg.on('blur.rome-row-manual change.rome-row-manual', 'textarea[name="addFieldMatrixRow-annotation"]', function () {
			importMatrixRowDraftFromTextarea($(this).closest('.addFieldMatrixRow'));
		});
	}

	/**
	 * Wires save validation for both single-field and matrix edit paths.
	 * @returns {void}
	 */
	function setupSaveValidationHooks() {
		if (!designerState.isMatrix) {
			ensureFieldSaveHook();
		}
	}

	/**
	 * Ensures REDCap single-field save entrypoint is wrapped with validation logic.
	 * @returns {void}
	 */
	function ensureFieldSaveHook() {
		const existing = window['addEditFieldSave'];
		if (typeof existing !== 'function') return;
		if (existing.__romeWrapped === true) return;
		const wrapped = function () {
			const self = this;
			const args = Array.from(arguments);
			let skipMissingChoicePrompt = false;
			const last = args[args.length - 1];
			if (last && typeof last === 'object' && last[SAVE_SKIP_SENTINEL_KEY] === true) {
				skipMissingChoicePrompt = true;
				args.pop();
			}
			if (!validateBeforeSave(() => {
				window.setTimeout(() => {
					window['addEditFieldSave'].apply(self, [...args, { [SAVE_SKIP_SENTINEL_KEY]: true }]);
				}, 0);
			}, skipMissingChoicePrompt)) return false;
			return existing.apply(self, args);
		};
		// @ts-ignore
		wrapped.__romeWrapped = true;
		window['addEditFieldSave'] = wrapped;
	}

	/**
	 * Ensures matrix save calls are wrapped with validation and sync logic once per page.
	 * @returns {void}
	 */
	function ensureMatrixSaveHook() {
		const existing = window['matrixGroupSave'];
		if (typeof existing !== 'function') return;
		if (existing.__romeWrapped === true) return;
		const wrapped = function () {
			const self = this;
			const args = Array.from(arguments);
			let skipMissingChoicePrompt = false;
			const last = args[args.length - 1];
			if (last && typeof last === 'object' && last[SAVE_SKIP_SENTINEL_KEY] === true) {
				skipMissingChoicePrompt = true;
				args.pop();
			}
			if (!validateBeforeSave(() => {
				window.setTimeout(() => {
					window['matrixGroupSave'].apply(self, [...args, { [SAVE_SKIP_SENTINEL_KEY]: true }]);
				}, 0);
			}, skipMissingChoicePrompt)) return false;
			return existing.apply(self, args);
		};
		// @ts-ignore
		wrapped.__romeWrapped = true;
		window['matrixGroupSave'] = wrapped;
	}

	/**
	 * Sets up matrix row add/remove/rename observers and keeps draft state synchronized.
	 * @returns {void}
	 */
	function setupMatrixLifecycleHandlers() {
		getMatrixRows().forEach(($row) => {
			const rowId = ensureMatrixRowId($row);
			if (!matrixDraftState.rows[rowId]) {
				const parse = parseRowAnnotation($row);
				matrixDraftState.rows[rowId] = {
					rowId,
					varName: getMatrixRowVarName($row),
					parseStatus: parse.error ? 'invalid' : 'valid',
					parseErrorMessage: parse.error ? parse.errorMessage : '',
					base: normalizeAnnotation(cloneAnnotation(parse.json)),
					current: normalizeAnnotation(cloneAnnotation(parse.json)),
					dirty: false
				};
				matrixDraftState.rowOrder.push(rowId);
			}
		});
		designerState.$dlg.off('input.rome-row-name change.rome-row-name', '.field_name_matrix');
		designerState.$dlg.on('input.rome-row-name change.rome-row-name', '.field_name_matrix', function () {
			const $row = $(this).closest('.addFieldMatrixRow');
			const rowId = ensureMatrixRowId($row);
			if (matrixDraftState.rows[rowId]) {
				matrixDraftState.rows[rowId].varName = getMatrixRowVarName($row);
			}
			updateAnnotationTargetsDropdown();
			updateAnnotationTable();
		});
		if (matrixDraftState.observer) {
			matrixDraftState.observer.disconnect();
		}
		const parent = designerState.$dlg.find('.addFieldMatrixRowParent').get(0);
		if (!parent) return;
		matrixDraftState.observer = new MutationObserver(() => {
			const activeIds = new Set();
			getMatrixRows().forEach(($row) => {
				const rowId = ensureMatrixRowId($row);
				activeIds.add(rowId);
				if (!matrixDraftState.rows[rowId]) {
					const parse = parseRowAnnotation($row);
					matrixDraftState.rows[rowId] = {
						rowId,
						varName: getMatrixRowVarName($row),
						parseStatus: parse.error ? 'invalid' : 'valid',
						parseErrorMessage: parse.error ? parse.errorMessage : '',
						base: normalizeAnnotation(cloneAnnotation(parse.json)),
						current: normalizeAnnotation(cloneAnnotation(parse.json)),
						dirty: false
					};
				}
			});
			for (const rowId of Object.keys(matrixDraftState.rows)) {
				if (!activeIds.has(rowId)) {
					delete matrixDraftState.rows[rowId];
				}
			}
			matrixDraftState.rowOrder = getMatrixRows().map($row => ensureMatrixRowId($row));
			updateAnnotationTargetsDropdown();
			updateAnnotationTable();
		});
		matrixDraftState.observer.observe(parent, { childList: true, subtree: true });
	}

	/**
	 * Initializes Add button + popover indicator behavior.
	 * @returns {void}
	 */
	function initializeAddButton() {
		const $button = designerState.$dlg.find('#rome-add-button');
		const $indicator = designerState.$dlg.find('#rome-add-selection-info');
		$button.off('click.rome-add').on('click.rome-add', function () {
			addSelectedAnnotationToDraft();
		});
		if ($indicator.length > 0) {
			if (typeof $indicator.popover === 'function') {
				log('Initializing Bootstrap popover for add-selection indicator.');
				$indicator.popover({
					trigger: 'click hover focus',
					html: true,
					sanitize: false,
					container: designerState.$dlg.get(0),
					content: 'No annotation selected.'
				});
			}
			$indicator.off('click.rome-indicator-fallback').on('click.rome-indicator-fallback', function () {
				const selected = selectionState.selected;
				if (!selected) return;
				if (typeof $indicator.popover !== 'function') {
					log('Bootstrap popover unavailable, showing fallback dialog for selected annotation.');
					simpleDialog(getSelectedAnnotationPopoverHtml(selected), 'Selected annotation');
				}
			});
		}
		refreshAddButtonState();
	}

	/**
	 * Applies currently selected search result to the selected target in draft state.
	 * @returns {void}
	 */
	function addSelectedAnnotationToDraft() {
		if (!selectionState.selected) return;
		log('Add clicked with selected annotation:', selectionState.selected);
		const target = `${designerState.$dlg.find('#rome-field-choice').val() ?? 'field'}`;
		const coding = {
			system: selectionState.selected.system,
			code: selectionState.selected.code,
			display: selectionState.selected.display
		};
		addCodingToTarget(target, coding);
		setSelectedAnnotation(null);
		updateAnnotationTable();
		log('Add completed. Current state:', designerState.isMatrix ? matrixDraftState : annotationDraftState);
	}

	/**
	 * Resolves matrix row ids for a given field variable name.
	 * @param {string} fieldName
	 * @returns {string[]}
	 */
	function getMatrixRowIdsByFieldName(fieldName) {
		const target = `${fieldName || ''}`.trim();
		if (!target) return [];
		const rowIds = [];
		for (const rowId of matrixDraftState.rowOrder) {
			const row = matrixDraftState.rows[rowId];
			if (!row) continue;
			const name = `${row.varName || rowId}`.trim();
			if (name === target) rowIds.push(rowId);
		}
		return rowIds;
	}

	/**
	 * Adds one coding object to the specified target in draft state (deduplicated by system+code).
	 * @param {string} target
	 * @param {{system:string, code:string, display?:string}} coding
	 * @returns {void}
	 */
	function addCodingToTarget(target, coding) {
		log('Adding coding to target:', { target, coding, isMatrix: designerState.isMatrix });
		if (designerState.isMatrix) {
			const parts = target.split(':');
			const targetType = parts[0];
			if (targetType === 'unit' && parts.length === 1) {
				for (const rowId of matrixDraftState.rowOrder) {
					const rowState = matrixDraftState.rows[rowId];
					if (!rowState) continue;
					addCodingToAnnotation(rowState.current, 'unit', '', coding);
					rowState.dirty = true;
				}
				// Keep matrix row annotation textareas in sync with UI edits.
				syncAllMatrixDraftsToTextareas();
				return;
			}
			if (targetType === 'choice' && parts.length === 2) {
				const choiceCode = parts[1] || '';
				for (const rowId of matrixDraftState.rowOrder) {
					const rowState = matrixDraftState.rows[rowId];
					if (!rowState) continue;
					addCodingToAnnotation(rowState.current, 'choice', choiceCode, coding);
					rowState.dirty = true;
				}
				// Keep matrix row annotation textareas in sync with UI edits.
				syncAllMatrixDraftsToTextareas();
				return;
			}
			if (targetType === 'field') {
				const fieldName = parts.slice(1).join(':');
				const rowIds = getMatrixRowIdsByFieldName(fieldName);
				for (const rowId of rowIds) {
					const rowState = matrixDraftState.rows[rowId];
					if (!rowState?.current) continue;
					addCodingToAnnotation(rowState.current, 'field', '', coding);
					rowState.dirty = true;
					log('Updated matrix row draft after add:', rowState);
				}
				syncAllMatrixDraftsToTextareas();
				return;
			}
			const rowId = parts[1] || '';
			const rowState = matrixDraftState.rows[rowId];
			if (!rowState) return;
			addCodingToAnnotation(rowState.current, targetType, parts.slice(2).join(':'), coding);
			rowState.dirty = true;
			log('Updated matrix row draft after add:', rowState);
			// Keep matrix row annotation textareas in sync with UI edits.
			syncAllMatrixDraftsToTextareas();
			return;
		}
		const annotation = getSingleDraftAnnotation();
		const parts = target.split(':');
		const targetType = parts[0];
		addCodingToAnnotation(annotation, targetType, parts.slice(1).join(':'), coding);
		annotationDraftState.dirty = true;
		log('Updated single-field draft after add:', annotationDraftState.current);
		// Keep action-tags textarea synchronized with UI edits.
		syncSingleDraftToTextarea(true);
	}

	/**
	 * Adds coding to one annotation object at field/unit/choice coordinates.
	 * @param {OntologyAnnotationJSON} annotation
	 * @param {string} targetType
	 * @param {string} targetId
	 * @param {{system:string, code:string, display?:string}} coding
	 * @returns {void}
	 */
	function addCodingToAnnotation(annotation, targetType, targetId, coding) {
		const normalized = normalizeAnnotation(annotation);
		if (targetType === 'field') {
			normalized.dataElement.coding = upsertCoding(normalized.dataElement.coding, coding);
		} else if (targetType === 'unit') {
			normalized.dataElement.unit.coding = upsertCoding(normalized.dataElement.unit.coding, coding);
		} else {
			const choiceCode = targetId;
			if (!normalized.dataElement.valueCodingMap[choiceCode]) {
				normalized.dataElement.valueCodingMap[choiceCode] = { coding: [] };
			}
			normalized.dataElement.valueCodingMap[choiceCode].coding =
				upsertCoding(normalized.dataElement.valueCodingMap[choiceCode].coding, coding);
		}
	}

	/**
	 * Inserts one coding object unless a matching system+code already exists.
	 * @param {Array<{system:string, code:string, display?:string}>} arr
	 * @param {{system:string, code:string, display?:string}} coding
	 * @returns {Array<{system:string, code:string, display?:string}>}
	 */
	function upsertCoding(arr, coding) {
		const list = Array.isArray(arr) ? arr.slice() : [];
		if (!list.some(x => x.system === coding.system && x.code === coding.code)) {
			list.push({ system: coding.system, code: coding.code, display: coding.display || '' });
		}
		return list;
	}

	/**
	 * Removes one coding entry from draft state by table entry without UI refresh.
	 * @param {AnnotationTableEntry|null|undefined} row
	 * @returns {void}
	 */
	function removeAnnotationEntryFromDraft(row) {
		if (!row) return;
		const coding = row.annotation;
		if (designerState.isMatrix) {
			let rowIds = [];
			if (row.kind === 'field') {
				rowIds = getMatrixRowIdsByFieldName(row.fieldName);
			} else {
				rowIds = matrixDraftState.rowOrder.slice();
			}
			for (const rowId of rowIds) {
				const rowState = matrixDraftState.rows[rowId];
				const annotation = rowState?.current;
				if (!annotation) continue;
				removeCodingFromAnnotation(annotation, row.kind, row.choiceCode, coding.system, coding.code);
				rowState.dirty = true;
			}
			syncAllMatrixDraftsToTextareas();
		} else {
			const annotation = getSingleDraftAnnotation();
			if (!annotation) return;
			removeCodingFromAnnotation(annotation, row.kind, row.choiceCode, coding.system, coding.code);
			annotationDraftState.dirty = true;
			syncSingleDraftToTextarea(true);
		}
	}

	/**
	 * Removes one coding entry from draft state by table entry.
	 * @param {AnnotationTableEntry|null|undefined} row
	 * @returns {void}
	 */
	function deleteAnnotationRow(row) {
		log('Delete requested for table row:', row);
		removeAnnotationEntryFromDraft(row);
		updateAnnotationTable();
		log('Delete completed. Current state:', designerState.isMatrix ? matrixDraftState : annotationDraftState);
	}

	/**
	 * Reassigns one coding row to a new target location in draft state.
	 * @param {AnnotationTableEntry|null|undefined} row
	 * @param {string} newTarget
	 * @returns {void}
	 */
	function reassignAnnotationRow(row, newTarget) {
		log('Reassign requested:', { row, newTarget });
		if (!row) return;
		const coding = row.annotation;
		removeAnnotationEntryFromDraft(row);
		addCodingToTarget(newTarget, {
			system: coding.system,
			code: coding.code,
			display: coding.display
		});
		updateAnnotationTable();
		log('Reassign completed. Current state:', designerState.isMatrix ? matrixDraftState : annotationDraftState);
	}

	/**
	 * Removes one coding object from an annotation object at field/unit/choice coordinates.
	 * @param {OntologyAnnotationJSON} annotation
	 * @param {string} targetType
	 * @param {string} choiceCode
	 * @param {string} system
	 * @param {string} code
	 * @returns {void}
	 */
	function removeCodingFromAnnotation(annotation, targetType, choiceCode, system, code) {
		const normalized = normalizeAnnotation(annotation);
		const removeMatch = (arr) => (Array.isArray(arr) ? arr.filter(c => !(c.system === system && c.code === code)) : []);
		if (targetType === 'field') {
			normalized.dataElement.coding = removeMatch(normalized.dataElement.coding);
			return;
		}
		if (targetType === 'unit') {
			normalized.dataElement.unit.coding = removeMatch(normalized.dataElement.unit.coding);
			return;
		}
		const bucket = normalized.dataElement.valueCodingMap[choiceCode];
		if (!bucket || !Array.isArray(bucket.coding)) return;
		bucket.coding = removeMatch(bucket.coding);
		if (bucket.coding.length === 0) {
			delete normalized.dataElement.valueCodingMap[choiceCode];
		}
	}

	//#endregion

	//#region Parser and Annotation Access

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

		/**
		 * Scans text from opening `{` to matching `}` while respecting string escapes.
		 * @param {string} s
		 * @param {number} start
		 * @returns {{ok:boolean, start?:number, end?:number, reason?:string}}
		 */
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

		/**
		 * Computes an index of line-start offsets for fast index-to-line conversion.
		 * @param {string} s
		 * @returns {number[]}
		 */
		function computeLineStarts(s) {
			const starts = [0];
			for (let i = 0; i < s.length; i++) {
				if (s[i] === '\n') starts.push(i + 1);
			}
			return starts;
		}

		/**
		 * Converts absolute character index to 1-based line number.
		 * @param {number[]} starts
		 * @param {number} pos
		 * @returns {number}
		 */
		function indexToLine(starts, pos) {
			let lo = 0, hi = starts.length - 1;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (starts[mid] <= pos) lo = mid + 1;
				else hi = mid - 1;
			}
			return Math.max(1, hi + 1);
		}

		/**
		 * Tests whether one character is treated as parser whitespace.
		 * @param {string} ch
		 * @returns {boolean}
		 */
		function isWS(ch) {
			return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
		}

		/**
		 * Formats validator errors into a compact human-readable sentence.
		 * @param {any[]} errors
		 * @returns {string}
		 */
		function formatValidatorErrors(errors) {
			if (!Array.isArray(errors) || errors.length === 0) return 'Unknown validation error';
			return errors
				.slice(0, 3)
				.map(e => `${e.instancePath || '(root)'}: ${e.message || 'invalid'}`)
				.join('; ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '');
		}

		//#endregion
	}

	//#endregion

	//#region Annotation Accessors

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
		let $el;
		if (designerState.isMatrix) {
			if (field) {
				$el = designerState.$dlg.find(`input[name="addFieldMatrixRow-varname_${field}"]`)
					.closest('.addFieldMatrixRow')
					.find('textarea[name="addFieldMatrixRow-annotation"]')
					.first();
			} else {
				$el = designerState.$dlg.find('textarea[name="addFieldMatrixRow-annotation"]').first();
			}
		} else {
			$el = $('#field_annotation');
		}
		let content = '';
		if ($el.is('input, textarea')) {
			content = String($el.val() ?? '');
		} else {
			content = $el.text();
		}
		const result = ontologyParser.parse(content);
		log('Parsed annotation text:', result);
		return result;
	}

	/**
	 * Creates a minimal ontology annotation object and stamps current field type.
	 * @returns {OntologyAnnotationJSON}
	 */
	function getMinimalOntologyAnnotation() {
		/** @type {OntologyAnnotationJSON} */
		const obj = JSON.parse(config.minimalAnnotation);
		obj.dataElement.type = getFieldType();
		return obj;
	}

	/**
	 * Returns current field names in context (single-field or all matrix row vars).
	 * @returns {string[]}
	 */
	function getFieldNames() {
		const fieldNames = [];
		if (designerState.isMatrix) {
			designerState.$dlg.find('input.field_name_matrix').each(function () {
				const fieldName = `${$(this).val()}`.trim();
				if (fieldName !== '') {
					fieldNames.push(fieldName);
				}
			});

		}
		else {
			fieldNames.push(String(designerState.$dlg.find('input#field_name').val() ?? '??'));
		}
		return fieldNames;
	}

	//#endregion

	//#region Target Selection and Table Rendering

	/**
	 * Gets the current field type.
	 * @returns {string}
	 */
	function getFieldType() {
		if (designerState.isMatrix) {
			return designerState.$dlg.find('select#field_type_matrix').val()?.toString() ?? '';
		}
		return $('select#field_type').val()?.toString() ?? '';
	}

	/**
	 * Updates the enum value store.
	 * @param {string} val
	 * @returns {void}
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
		updateAnnotationTable();
	}

	/**
	 * Renders add-target options and contextual warnings.
	 * @returns {void}
	 */
	function updateAnnotationTargetsDropdown() {
		const $target = designerState.$dlg.find('#rome-field-choice');
		const previous = `${$target.val() ?? ''}`;
		const options = buildTargetOptions();
		$target.html(options.map(opt => `<option value="${escapeHTML(opt.value)}">${escapeHTML(opt.label)}</option>`).join(''));
		if (options.some(opt => opt.value === previous)) {
			$target.val(previous);
		}
		applySelect2ToTargetSelects($target);
	}

	/**
	 * Returns true when Unit target appears unusual for the current REDCap field constraints.
	 * @returns {boolean}
	 */
	function shouldShowUnitWarning() {
		const fieldType = getFieldType();
		const valType = `${designerState.$dlg.find('#val_type, #val_type_matrix').first().val() ?? ''}`.toLowerCase();
		if (['radio', 'select', 'checkbox'].includes(fieldType)) {
			const nonNumericChoice = (designerState.enum || '').split('\n').some(line => {
				const [code] = line.split(',', 1);
				return code && !/^[-+]?\d+(\.\d+)?$/.test(code.trim());
			});
			return nonNumericChoice;
		}
		const nonNumericValidators = ['email', 'alpha_only', 'letters_only', 'zipcode', 'phone'];
		return nonNumericValidators.includes(valType);
	}

	/**
	 * Builds add-target dropdown options for current dialog mode.
	 * @returns {{value:string, label:string}[]}
	 */
	function buildTargetOptions() {
		const options = [];
		if (designerState.isMatrix) {
			const fields = matrixDraftState.rowOrder
				.map(rowId => ({ rowId, row: matrixDraftState.rows[rowId] }))
				.filter(x => !!x.row)
				.sort((a, b) => {
					const aLabel = `${a.row.varName || a.rowId}`.toLowerCase();
					const bLabel = `${b.row.varName || b.rowId}`.toLowerCase();
					return aLabel.localeCompare(bLabel);
				});
			for (const { rowId, row } of fields) {
				const rowLabel = `${row.varName || rowId}`.trim();
				options.push({ value: `field:${rowLabel}`, label: `Field - ${rowLabel}` });
			}
			options.push({ value: 'unit', label: 'Unit' });
			for (const choice of getChoiceOptions()) {
				options.push({ value: `choice:${choice.code}`, label: `${choice.code}: ${choice.label}` });
			}
			return options;
		}
		options.push({ value: 'field', label: 'Field' });
		options.push({ value: 'unit', label: 'Unit' });
		for (const choice of getChoiceOptions()) {
			options.push({ value: `choice:${choice.code}`, label: `${choice.code}: ${choice.label}` });
		}
		return options;
	}

	/**
	 * Returns canonical target option count used for Select2 search-threshold decisions.
	 * Ignores row-local "missing target" fallback options.
	 * @returns {number}
	 */
	function getTargetOptionCountForThreshold() {
		return buildTargetOptions().length;
	}

	/**
	 * Returns parsed choice code/label options from current enum text.
	 * @returns {{code:string, label:string}[]}
	 */
	function getChoiceOptions() {
		const out = [];
		for (const line of (designerState.enum || '').split('\n')) {
			if (!line.trim()) continue;
			const [codeRaw, labelRaw] = line.split(',', 2);
			const code = `${codeRaw || ''}`.trim();
			if (!code) continue;
			out.push({ code, label: `${labelRaw || code}`.trim() || code });
		}
		return out;
	}

	/**
	 * Builds a map from choice code to choice label for the current enum.
	 * @returns {Object<string?,string>}
	 */
	function getChoiceLabelMap() {
		const map = {};
		for (const choice of getChoiceOptions()) {
			map[choice.code] = choice.label;
		}
		return map;
	}

	/**
	 * Returns choice order metadata used for Target-column lexical sort keys.
	 * @returns {{positions: Object<string, number>, width: number}}
	 */
	function getChoiceOrderMeta() {
		const positions = {};
		const choices = getChoiceOptions();
		for (let i = 0; i < choices.length; i++) {
			positions[choices[i].code] = i;
		}
		const width = String(Math.max(1, choices.length)).length;
		return { positions, width };
	}

	/**
	 * Returns rows that target missing choice codes.
	 * @returns {AnnotationTableEntry[]}
	 */
	function getMissingChoiceTargetRows() {
		return buildAnnotationTableEntries().filter(r => r.kind === 'choice' && r.choicePosition < 0);
	}

	/**
	 * Builds stable sort key for target column.
	 * @param {AnnotationTableEntry} row
	 * @returns {string}
	 */
	function getTargetSortKey(row) {
		return row.sortBy || 'Z';
	}

	/**
	 * Flattens current draft annotation(s) into table rows for DataTables.
	 * Treats field edit as matrix n=1 and aggregates unit/choice codings globally.
	 * @returns {AnnotationTableEntry[]}
	 */
	function buildAnnotationTableEntries() {
		/** @type {AnnotationTableEntry[]} */
		const rows = [];
		const choiceOrderMeta = getChoiceOrderMeta();
		const makeCodingKey = (coding) =>
			`${`${coding.system || ''}`.trim()}|${`${coding.code || ''}`.trim()}|${`${coding.display || ''}`.trim().toLowerCase()}`;
		const makeAnnotation = (coding) => ({
			system: `${coding.system || ''}`,
			code: `${coding.code || ''}`,
			display: `${coding.display || ''}`
		});
		const makeSortBy = (kind, fieldName = '', choiceCode = '', choicePosition = -1) => {
			if (kind === 'field') return `A_${`${fieldName || ''}`.toLowerCase()}`;
			if (kind === 'unit') return 'B';
			if (choicePosition >= 0) {
				return `C_${String(choicePosition + 1).padStart(choiceOrderMeta.width, '0')}`;
			}
			return `D_${`${choiceCode || ''}`.toLowerCase()}`;
		};
		const appendFieldRows = (annotation, fieldName) => {
			const normalized = normalizeAnnotation(annotation);
			for (const coding of normalized.dataElement.coding || []) {
				rows.push({
					kind: 'field',
					fieldName: `${fieldName || ''}`,
					choiceCode: '',
					choicePosition: -1,
					sortBy: makeSortBy('field', fieldName),
					annotation: makeAnnotation(coding)
				});
			}
		};
		/** @type {Map<string, {system:string, code:string, display:string}>} */
		const unitMap = new Map();
		/** @type {Map<string, Map<string, {system:string, code:string, display:string}>>} */
		const choiceMaps = new Map();
		if (designerState.isMatrix) {
			for (const rowId of matrixDraftState.rowOrder) {
				const row = matrixDraftState.rows[rowId];
				if (!row?.current) continue;
				const fieldName = `${row.varName || rowId}`.trim();
				appendFieldRows(row.current, fieldName);
				const normalized = normalizeAnnotation(row.current);
				for (const coding of normalized.dataElement.unit?.coding || []) {
					unitMap.set(makeCodingKey(coding), makeAnnotation(coding));
				}
				for (const [choiceCode, bucket] of Object.entries(normalized.dataElement.valueCodingMap || {})) {
					if (!choiceMaps.has(choiceCode)) {
						choiceMaps.set(choiceCode, new Map());
					}
					for (const coding of bucket.coding || []) {
						choiceMaps.get(choiceCode).set(makeCodingKey(coding), makeAnnotation(coding));
					}
				}
			}
		} else {
			const normalized = normalizeAnnotation(getSingleDraftAnnotation());
			const fieldName = `${getFieldNames()[0] || 'field'}`.trim();
			appendFieldRows(normalized, fieldName);
			for (const coding of normalized.dataElement.unit?.coding || []) {
				unitMap.set(makeCodingKey(coding), makeAnnotation(coding));
			}
			for (const [choiceCode, bucket] of Object.entries(normalized.dataElement.valueCodingMap || {})) {
				if (!choiceMaps.has(choiceCode)) {
					choiceMaps.set(choiceCode, new Map());
				}
				for (const coding of bucket.coding || []) {
					choiceMaps.get(choiceCode).set(makeCodingKey(coding), makeAnnotation(coding));
				}
			}
		}
		for (const annotation of unitMap.values()) {
			rows.push({
				kind: 'unit',
				fieldName: '',
				choiceCode: '',
				choicePosition: -1,
				sortBy: makeSortBy('unit'),
				annotation
			});
		}
		for (const [choiceCode, codingMap] of choiceMaps.entries()) {
			const pos = choiceOrderMeta.positions[choiceCode];
			const choicePosition = typeof pos === 'number' ? pos : -1;
			for (const annotation of codingMap.values()) {
				rows.push({
					kind: 'choice',
					fieldName: '',
					choiceCode,
					choicePosition,
					sortBy: makeSortBy('choice', '', choiceCode, choicePosition),
					annotation
				});
			}
		}
		return rows;
	}

	/**
	 * Renders System column cell content.
	 * @param {AnnotationTableEntry} row
	 * @returns {string}
	 */
	function renderSystemColumn(row) {
		return escapeHTML(row.annotation?.system || '?');
	}

	/**
	 * Renders Code column cell content, with known-system external link when available.
	 * @param {AnnotationTableEntry} row
	 * @returns {string}
	 */
	function renderCodeColumn(row) {
		const system = row.annotation?.system || '';
		const code = row.annotation?.code || '';
		if (config.knownLinks?.[system]) {
			return `<a target="_blank" href="${escapeHTML(config.knownLinks[system] + code)}">${escapeHTML(code || '?')}</a>`;
		}
		return escapeHTML(code || '?');
	}

	/**
	 * Renders Display column cell content.
	 * @param {AnnotationTableEntry} row
	 * @returns {string}
	 */
	function renderDisplayColumn(row) {
		return escapeHTML(row.annotation?.display || '');
	}

	/**
	 * Renders Target column select control for one row.
	 * @param {AnnotationTableEntry} row
	 * @param {{value:string,label:string}[]} targets
	 * @param {Set<string>} currentChoiceCodes
	 * @param {Object<string?,string>} choiceLabelMap
	 * @returns {string}
	 */
	function renderTargetColumn(row, targets, currentChoiceCodes, choiceLabelMap) {
		const targetValue = row.kind === 'field'
			? (designerState.isMatrix ? `field:${row.fieldName}` : 'field')
			: (row.kind === 'unit' ? 'unit' : `choice:${row.choiceCode}`);
		const targetLabel = row.kind === 'field'
			? `Field - ${row.fieldName}`
			: (row.kind === 'unit' ? 'Unit' : `Choice - ${choiceLabelMap[row.choiceCode] || row.choiceCode}`);
		const isMissingTarget = row.kind === 'choice' && !currentChoiceCodes.has(row.choiceCode);
		const rowTargets = targets.slice();
		if (!rowTargets.some(t => t.value === targetValue)) {
			rowTargets.unshift({
				value: targetValue,
				label: `Missing target: ${targetLabel}`
			});
		}
		return `<select class="form-select form-select-xs rome-row-target ${isMissingTarget ? 'target-missing' : ''}">
			${rowTargets.map(target => `<option value="${escapeHTML(target.value)}" ${target.value === targetValue ? 'selected' : ''}>${escapeHTML(target.label)}</option>`).join('')}
		</select>`;
	}

	/**
	 * Renders Action column controls for one row.
	 * @param {AnnotationTableEntry} row
	 * @param {boolean} showUnitWarning
	 * @returns {string}
	 */
	function renderActionColumn(row, showUnitWarning) {
		const warningIcon = (showUnitWarning && row.kind === 'unit')
			? '<span class="rome-target-warning text-warning rome-unit-row-warning ms-2" title="Unit targets are unusual for this field type."><i class="fa-solid fa-triangle-exclamation"></i></span>'
			: '';
		return `<button type="button" class="btn btn-xs btn-link text-danger p-0 rome-row-delete" title="Delete annotation"><i class="fa fa-trash"></i></button>${warningIcon}`;
	}

	/**
	 * Initializes tooltips for unit warning icons inside annotation table.
	 * @param {JQuery<HTMLElement>} $container
	 * @returns {void}
	 */
	function initUnitWarningTooltips($container) {
		if (typeof bootstrap === 'undefined' || !bootstrap?.Tooltip) return;
		$container.find('.rome-unit-row-warning').each(function () {
			new bootstrap.Tooltip(this, {
				trigger: 'hover',
				container: designerState.$dlg.get(0)
			});
		});
	}

	/**
	 * Resolves row data from a table control using DataTables row data first.
	 * @param {HTMLElement} control
	 * @returns {AnnotationTableEntry|null}
	 */
	function resolveRowDataFromTableControl(control) {
		const $tr = $(control).closest('tr');
		if (annotationTableState.dt && $tr.length > 0) {
			const dtRow = annotationTableState.dt.row($tr);
			const rowData = dtRow?.data();
			if (rowData) return rowData;
		}
		const controlEntry = $(control).data('rome-entry');
		if (controlEntry) return controlEntry;
		const rowEntry = $tr.data('rome-entry');
		return rowEntry || null;
	}

	/**
	 * Re-renders current annotation table as DataTables grid with inline target reassignment.
	 * @returns {void}
	 */
	function updateAnnotationTable() {
		if (isExcludedCheckboxChecked()) return;
		updateAnnotationTargetsDropdown();
		const rows = buildAnnotationTableEntries();
		const $wrapper = designerState.$dlg.find('.rome-edit-field-ui-list');
		const $empty = designerState.$dlg.find('.rome-edit-field-ui-list-empty');
		if (annotationTableState.dt) {
			annotationTableState.dt.destroy();
			annotationTableState.dt = null;
		}
		if (rows.length === 0) {
			$wrapper.hide();
			$empty.show();
			return;
		}
		$empty.hide();
		const showAdvanced = rows.length >= 10;
		annotationTableState.advancedUiEnabled = showAdvanced;
		$wrapper.html(`
			<table id="rome-annotation-table" class="table table-sm table-striped align-middle">
				<thead>
					<tr><th>System</th><th>Code</th><th>Display</th><th>Target</th><th>Action</th></tr>
				</thead>
				<tbody></tbody>
			</table>
		`).show();
		const $table = $wrapper.find('#rome-annotation-table');
		const targets = buildTargetOptions();
		const choiceLabelMap = getChoiceLabelMap();
		const currentChoiceCodes = new Set(Object.keys(choiceLabelMap));
		const showUnitWarning = shouldShowUnitWarning();
		if ($.fn.DataTable) {
			annotationTableState.dt = $table.DataTable({
				data: rows,
				columns: [
					{
						data: null,
						render: (_data, _type, row) => renderSystemColumn(row)
					},
					{
						data: null,
						render: (_data, _type, row) => renderCodeColumn(row)
					},
					{
						data: null,
						render: (_data, _type, row) => renderDisplayColumn(row)
					},
					{
						data: null,
						render: (_data, type, row) => {
							if (type === 'sort' || type === 'type') {
								return getTargetSortKey(row);
							}
							return renderTargetColumn(row, targets, currentChoiceCodes, choiceLabelMap);
						}
					},
					{
						data: null,
						orderable: false,
						searchable: false,
						render: (_data, _type, row) => renderActionColumn(row, showUnitWarning)
					}
				],
				paging: showAdvanced,
				searching: showAdvanced,
				info: showAdvanced,
				lengthChange: false,
				pageLength: 10,
				order: [[3, 'asc']],
				createdRow: (rowEl, rowData) => {
					$(rowEl).data('rome-entry', rowData);
				}
			});
			$table.off('draw.dt.romeTableEnhancements').on('draw.dt.romeTableEnhancements', function () {
				applySelect2ToTargetSelects($(this).find('.rome-row-target'));
				$(this).find('.rome-row-target, .rome-row-delete').each(function () {
					const entry = $(this).closest('tr').data('rome-entry');
					if (entry) $(this).data('rome-entry', entry);
				});
				initUnitWarningTooltips($wrapper);
			});
		} else {
			annotationTableState.dt = null;
			const $tbody = $table.find('tbody');
			for (const row of rows) {
				const $tr = $(`
					<tr>
						<td>${renderSystemColumn(row)}</td>
						<td>${renderCodeColumn(row)}</td>
						<td>${renderDisplayColumn(row)}</td>
						<td data-order="${escapeHTML(getTargetSortKey(row))}">${renderTargetColumn(row, targets, currentChoiceCodes, choiceLabelMap)}</td>
						<td>${renderActionColumn(row, showUnitWarning)}</td>
					</tr>
				`);
				$tr.data('rome-entry', row);
				$tr.find('.rome-row-target, .rome-row-delete').data('rome-entry', row);
				$tbody.append($tr);
			}
		}
		applySelect2ToTargetSelects($wrapper.find('.rome-row-target'));
		initUnitWarningTooltips($wrapper);
		$wrapper.off('click.rome-table', '.rome-row-delete');
		$wrapper.on('click.rome-table', '.rome-row-delete', function () {
			const row = resolveRowDataFromTableControl(this);
			if (!row) return;
			deleteAnnotationRow(row);
		});
		$wrapper.off('change.rome-table', '.rome-row-target');
		$wrapper.on('change.rome-table', '.rome-row-target', function () {
			const value = `${$(this).val() ?? ''}`;
			const row = resolveRowDataFromTableControl(this);
			if (!row) return;
			reassignAnnotationRow(row, value);
		});
		log('Rendered annotation table rows:', rows.length, 'advancedUI:', showAdvanced);
		log('Updated internal annotation table state:', annotationTableState);
	}

	/**
	 * Returns the preferred Select2 dropdown parent for current dialog context.
	 * @returns {JQuery<HTMLElement>|undefined}
	 */
	function getSelect2DropdownParent() {
		const $dialog = designerState.$dlg?.closest('[role="dialog"]');
		if ($dialog && $dialog.length > 0) return $dialog;
		return designerState.$dlg;
	}

	/**
	 * Applies select2 enhancement to one or more target select elements when available.
	 * @param {JQuery<HTMLElement>} $selects
	 * @returns {void}
	 */
	function applySelect2ToTargetSelects($selects) {
		if (!$selects || $selects.length === 0) return;
		if (typeof $.fn.select2 !== 'function') return;
		const threshold = Number.parseInt(`${designerState.minItemsForSelect2 ?? 7}`, 10);
		const minItems = Number.isFinite(threshold) && threshold > 0 ? threshold : 7;
		const effectiveCount = getTargetOptionCountForThreshold();
		const showSearch = effectiveCount > minItems;
		$selects.each(function () {
			const $el = $(this);
			const syncMissingClass = () => {
				const $container = $el.next('.select2-container');
				if ($container.length === 0) return;
				$container.toggleClass('target-missing', $el.hasClass('target-missing'));
			};
			if ($el.hasClass('select2-hidden-accessible')) {
				$el.select2('destroy');
			}
			$el.select2({
				width: 'resolve',
				dropdownParent: getSelect2DropdownParent(),
				minimumResultsForSearch: showSearch ? 0 : Infinity
			});
			syncMissingClass();
		});
	}

	//#endregion

	//#endregion





	//#region Error Handling

	/**
	 * Shows or hides the search-error badge next to the search bar.
	 * @param {string|false} errorMessage
	 * @returns {void}
	 */
	function showSearchErrorBadge(errorMessage) {
		if (errorMessage) {
			designerState.$dlg.find('#rome-search-errors')
				.css('display', 'block')
				.attr('data-bs-tooltip', 'hover')
				.attr('title', errorMessage)
				.tooltip('enable');
		}
		else {
			designerState.$dlg.find('#rome-search-errors')
				.css('display', 'none')
				.tooltip('disable');
		}
	}

	/**
	 * Shows or hides the JSON error overlay that blocks search/table controls.
	 * @param {string|false} errorMessage
	 * @returns {void}
	 */
	function setJsonIssueOverlay(errorMessage) {
		const $overlay = designerState.$dlg.find('.rome-json-error-overlay');
		if ($overlay.length === 0) return;
		if (errorMessage) {
			$overlay.find('.rome-json-error-overlay-message').text(errorMessage);
			$overlay.show();
		} else {
			$overlay.hide();
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

	/**
	 * Toggles search spinner and visual busy state on search input.
	 * @param {boolean} state
	 * @returns {void}
	 */
	function showSpinner(state) {
		const $searchSpinner = designerState.$dlg.find('.rome-edit-field-ui-spinner');
		$searchSpinner[state ? 'addClass' : 'removeClass']('busy');
		designerState.$input[state ? 'addClass' : 'removeClass']('is-searching');
	}

	/**
	 * Toggles a visual marker when the latest returned search result set is empty.
	 * @param {boolean} state
	 * @returns {void}
	 */
	function showNoResultsState(state) {
		designerState.$input[state ? 'addClass' : 'removeClass']('is-no-results');
	}

	/**
	 * Initializes autocomplete search input for ontology lookup.
	 * @param {string} selector
	 * @returns {void}
	 */
	function initializeSearchInput(selector) {

		designerState.$input = designerState.$dlg.find(selector);
		// Re-init safely if this input already had an autocomplete instance.
		if (designerState.$input.data('ui-autocomplete')) {
			designerState.$input.autocomplete('destroy');
		}
		designerState.$input.off('.romeAutocomplete');

		function raiseAutocompleteMenu() {
			const ac = designerState.$input.data('ui-autocomplete');
			const $menu = ac?.menu?.element;
			if (!$menu || $menu.length === 0) return;

			const baseZ = Number.parseInt(
				designerState.$dlg.closest('[role="dialog"]').css('z-index') ?? '199',
				10
			);
			const zIndex = Number.isFinite(baseZ) ? baseZ + 2 : 201;
			$menu.css('z-index', String(zIndex));
		}

		designerState.$input.autocomplete({
			minLength: 2,
			delay: 0, // we debounce manually
			appendTo: 'body',
			open: function () {
				raiseAutocompleteMenu();
			},
			source: function (request, responseCb) {
				const term = (request.term || '').trim();
				if (term.length < 2) {
					showNoResultsState(false);
					responseCb([]);
					return;
				}

				// Refresh path (used later for polling)
				if (searchState.refreshing && term === searchState.term) {
					showNoResultsState(searchState.items.length === 0);
					responseCb(searchState.items); return;
				}

				// Check cache first (term + desired source set)
				const desiredSourceIds = getDesiredSourceIds();
				const ck = makeCacheKey(term, desiredSourceIds);
				if (searchState.cache.has(ck)) {
					const snap = searchState.cache.get(ck);

					searchState.term = term;
					searchState.resultsBySource = snap.resultsBySource || {};
					searchState.items = snap.items || flattenResults(searchState.resultsBySource, term);
					searchState.pending = {}; // <-- never resume pending from cache
					searchState.lastTermCompleted = !!snap.completed;

					showNoResultsState(searchState.items.length === 0);
					responseCb(searchState.items);

					// If incomplete, re-issue search for missing sources
					if (!snap.completed) {
						const missing = desiredSourceIds.filter(sid => !(sid in searchState.resultsBySource));
						if (missing.length) {
							// We don't want to wipe cached results; see startSearch opts below
							queueSearchMissing(term, missing);
						}
					}
					return;
				}

				// If autocomplete is re-triggering with the same term (arrow keys, focus, etc.),
				// do NOT re-query server. Serve cached items (even if empty).
				if (term === searchState.term && searchState.lastTermCompleted) {
					showNoResultsState(searchState.items.length === 0);
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

				const safeCode = escapeHtml(code); // code contains brackets etc.
				const safeSys = escapeHtml(sys);

				return $('<li>')
					.append(
						$('<div>').html(`${safeSys}: ${item.labelHtml}${safeCode}`)
					)
					.appendTo(ul);
			};

		designerState.$input.on('autocompleteselect.romeAutocomplete', function (e, ui) {
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
		designerState.$input.on('keydown.romeAutocomplete', function (event) {
			if (event.key === 'Enter') {
				// Let jQuery UI autocomplete handle Enter, but block REDCap's parent dialog handlers.
				event.stopPropagation();
			}
		});
		designerState.$input.on('input.romeAutocomplete', function () {
			if (selectionState.selected) {
				setSelectedAnnotation(null);
			}
		});
	}

	/**
	 * Sets current selected search annotation and refreshes Add UI affordances.
	 * @param {SelectedAnnotationHit|null} annotation
	 * @returns {void}
	 */
	function setSelectedAnnotation(annotation) {
		selectionState.selected = annotation;
		log('Selected annotation:', annotation);
		refreshAddButtonState();
		if (annotation) {
			const $addButton = designerState.$dlg.find('#rome-add-button');
			if ($addButton.length > 0 && !$addButton.prop('disabled')) {
				window.setTimeout(() => $addButton.trigger('focus'), 0);
			}
		}
	}

	/**
	 * Refreshes Add button state and details popover based on current selection state.
	 * @returns {void}
	 */
	function refreshAddButtonState() {
		const $button = designerState.$dlg.find('#rome-add-button');
		const $indicator = designerState.$dlg.find('#rome-add-selection-info');
		const hasSelection = !!selectionState.selected;
		log('Refreshing Add button state. hasSelection=', hasSelection);
		$button.prop('disabled', !hasSelection);
		$indicator.css('display', hasSelection ? 'inline-block' : 'none');
		if ($indicator.length === 0) return;
		const html = hasSelection ? getSelectedAnnotationPopoverHtml(selectionState.selected) : 'No annotation selected.';
		$indicator.attr('data-bs-content', html).attr('data-content', html).attr('title', hasSelection ? 'Selected annotation' : 'No selection');
		if (typeof $indicator.popover === 'function') {
			try {
				$indicator.popover('dispose');
			} catch (ignored) {
				// ignore
			}
			$indicator.popover({
				trigger: 'click hover focus',
				html: true,
				sanitize: false,
				container: designerState.$dlg.get(0),
				content: html,
				title: hasSelection ? 'Selected annotation' : 'No selection'
			});
		}
	}

	/**
	 * Builds selection details HTML shown in the add-selection popover.
	 * @param {SelectedAnnotationHit} annotation
	 * @returns {string}
	 */
	function getSelectedAnnotationPopoverHtml(annotation) {
		const source = (config.sources || []).find(s => s.id === annotation.sourceId);
		const sourceLabel = source?.label || annotation.sourceId || 'Unknown source';
		const system = annotation.system || '?';
		const code = annotation.code || '?';
		const display = annotation.display || '';
		const linkPrefix = config.knownLinks?.[system] || '';
		const linkHtml = linkPrefix
			? `<a target="_blank" href="${escapeHTML(linkPrefix + code)}">Open in browser</a>`
			: '<span class="text-muted">No external link known for this system.</span>';
		return `
			<div class="rome-add-popover">
				<div><b>Source:</b> ${escapeHTML(sourceLabel)}</div>
				<div><b>System:</b> ${escapeHTML(system)}</div>
				<div><b>Code:</b> ${escapeHTML(code)}</div>
				<div><b>Display:</b> ${escapeHTML(display || '(none)')}</div>
				<div>${linkHtml}</div>
			</div>
		`;
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

	/**
	 * Queues a debounced search request for autocomplete.
	 * @param {string} term
	 * @param {(items: any[]) => void} responseCb
	 * @returns {void}
	 */
	function queueSearch(term, responseCb) {
		if (searchState.debounceTimer) {
			clearTimeout(searchState.debounceTimer);
		}

		searchState.debounceTimer = setTimeout(() => {
			startSearch(term, responseCb);
		}, 200);
	}

	/**
	 * Queues a partial refresh search for missing sources only.
	 * @param {string} term
	 * @param {string[]} sourceIds
	 * @returns {void}
	 */
	function queueSearchMissing(term, sourceIds) {
		// Reuse the same debounce timer
		if (searchState.debounceTimer) clearTimeout(searchState.debounceTimer);

		searchState.debounceTimer = setTimeout(() => {
			startSearch(term, null, { sourceIds, merge: true });
		}, 50);
	}

	/**
	 * Refreshes autocomplete dropdown with latest in-memory search items.
	 * @param {string} term
	 * @returns {void}
	 */
	function refreshDropdown(term) {
		searchState.refreshing = true;
		try {
			designerState.$input.autocomplete('search', term);
		} finally {
			searchState.refreshing = false;
		}
	}

	/**
	 * Executes search request and merges response into search state.
	 * @param {string} term
	 * @param {(items: any[]) => void|null} responseCb
	 * @param {{sourceIds?: string[], merge?: boolean}=} opts
	 * @returns {void}
	 */
	function startSearch(term, responseCb, opts) {
		opts = opts || {};
		const sourceIds = Array.isArray(opts.sourceIds) ? opts.sourceIds : null; // null => all
		const merge = !!opts.merge;

		if (term.length < 2) {
			stopSearch();
			if (typeof responseCb === 'function') responseCb([]);
			return;
		}
		showNoResultsState(false);
		showSearchErrorBadge(false);

		// new query identity
		searchState.rid += 1;
		searchState.term = term;
		if (!merge) {
			searchState.resultsBySource = {};
			searchState.items = [];
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

				searchState.items = flattenResults(searchState.resultsBySource, searchState.term);

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
				showNoResultsState(searchState.items.length === 0);

				if (typeof responseCb === 'function') {
					responseCb(searchState.items);
				} else {
					// Refresh dropdown in-place (merge path)
					refreshDropdown(term);
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
					refreshDropdown(term);
				}
				showSpinner(false);
				// Report error
				searchState.errorRaised = true;
				showSearchErrorBadge(`Search could not be performed. The server reported this error: ${error}`);
			})
			.always(() => {
				searchState.xhr = null;
			});
	}

	/**
	 * Schedules follow-up poll for deferred source results.
	 * @param {number} rid
	 * @returns {void}
	 */
	function schedulePoll(rid) {
		if (searchState.pollTimer) clearTimeout(searchState.pollTimer);

		let wait = 300;
		for (const p of Object.values(searchState.pending)) {
			if (p && typeof p.after_ms === 'number') wait = Math.min(wait, p.after_ms);
		}
		searchState.pollTimer = setTimeout(() => poll(rid), wait);
	}

	/**
	 * Polls deferred search jobs and merges newly completed results.
	 * @param {number} rid
	 * @returns {void}
	 */
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
					showSearchErrorBadge('Some errors were reported. See console for details.');
					console.error('Error polling for search results:', resp.errors);
				}

				// Merge results into state
				mergeIntoResultsBySource(resp.results || {});
				searchState.items = flattenResults(searchState.resultsBySource, searchState.term);

				// Update pending
				searchState.pending = resp.pending || {};

				const desired = getDesiredSourceIds();
				const ck = makeCacheKey(searchState.term, desired);
				const completed =
					desired.every(sid => (sid in searchState.resultsBySource)) &&
					Object.keys(searchState.pending).length === 0;

				searchState.cache.set(ck, {
					resultsBySource: searchState.resultsBySource,
					completed,
					items: searchState.items
				});

				refreshDropdown(searchState.term);

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

	/**
	 * Merges incremental search hits into existing per-source result buckets.
	 * @param {Object<string, any[]>} newResultsBySource
	 * @returns {void}
	 */
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

	/**
	 * Builds de-duplication key for ontology hit objects.
	 * @param {any} h
	 * @returns {string}
	 */
	function hitKey(h) {
		if (!h || typeof h !== 'object') return '';
		const system = (h.system || '').trim();
		const code = (h.code || '').trim();
		if (!system || !code) return '';
		return system + '|' + code;
	}

	/**
	 * Converts grouped source results into sorted autocomplete items.
	 * @param {Object<string, any[]>} resultsBySource
	 * @param {string} term
	 * @returns {any[]}
	 */
	function flattenResults(resultsBySource, term) {
		const out = [];

		for (const [sourceId, hits] of Object.entries(resultsBySource)) {
			if (!Array.isArray(hits)) continue;

			for (const h of hits) {
				const label = h.display || h.code || '(no label)';
				const value = h.display || h.code || '';

				out.push({
					label,
					labelHtml: highlightTermHtml(label, term),
					value,
					hit: h,
					sourceId
				});
			}
		}

		// Stable sort: score desc, otherwise insertion order
		out.sort((a, b) => (b.hit.score || 0) - (a.hit.score || 0));
		return out;
	}

	/**
	 * Escapes text for HTML-safe rendering.
	 * @param {string} s
	 * @returns {string}
	 */
	function escapeHtml(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	/**
	 * Escapes regular-expression metacharacters.
	 * @param {string} s
	 * @returns {string}
	 */
	function escapeRegExp(s) {
		return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/**
	 * Returns HTML with occurrences of term wrapped in <span class="rome-ac-hl">...</span>.
	 * Safe: escapes input first, then injects spans on the escaped string.
	 */
	/**
	 * Highlights search term occurrences in already escaped display text.
	 * @param {string} text
	 * @param {string} term
	 * @returns {string}
	 */
	function highlightTermHtml(text, term) {
		const t = (term || '').trim();
		if (!t) return escapeHtml(text);

		const escapedText = escapeHtml(text);
		const re = new RegExp(escapeRegExp(t), 'ig');
		return escapedText.replace(re, (m) => `<span class="rome-ac-hl">${m}</span>`);
	}

	/**
	 * Resets all active search jobs, timers, and error indicators.
	 * @returns {void}
	 */
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
		setSelectedAnnotation(null);
		showSpinner(false);
		showNoResultsState(false);
		showSearchErrorBadge(false);
	}

	function resetSearchState() {
		stopSearch();
		designerState.$dlg.find('input[name="rome-em-fieldedit-search"]').val('');
		searchState.term = '';
		searchState.lastTerm = '';
		searchState.lastTermCompleted = false;
		searchState.debounceTimer = null;
	}


	/**
	 * Produces stable cache-key fragment for chosen source id set.
	 * @param {string[]} sourceIds
	 * @returns {string}
	 */
	function sourceSetKey(sourceIds) {
		// Sort a copy in order not to change the original
		const sortedCopy = sourceIds.slice().sort();
		return sortedCopy.join('|');
	}

	/**
	 * Produces cache key for autocomplete snapshots.
	 * @param {string} term
	 * @param {string[]} sourceIds
	 * @returns {string}
	 */
	function makeCacheKey(term, sourceIds) {
		return `${term}::${sourceSetKey(sourceIds)}`;
	}

	/**
	 * Returns list of source ids currently enabled for search.
	 * @returns {string[]}
	 */
	function getDesiredSourceIds() {
		// TODO: later: return subset chosen in UI
		return (config.sources || []).map(s => s.id);
	}

	//#endregion


})();
