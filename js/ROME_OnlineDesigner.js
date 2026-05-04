// ROME: REDCap Ontologies Made Easy EM - Online Designer Integration

// TODOs
// - [ ] Add a config option/filter to limit searching to selected ontologies (from those configured in
//       the module settings).
// - [ ] Add a schema validator (such as https://github.com/ajv-validator/ajv) to the module
// - [ ] Allow the client to restrict search results to certain code systems (relevant for FhirQuestionnaire stuff). A list is already available.

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
		showFieldHelp: showHelp
	};
	// @ts-ignore
	window[NS_PREFIX + EM_NAME] = EM;

	/** 
	 * Configuration data supplied from the server 
	 * @type {ROMEOnlineDesignerConfig}
	*/
	let config;
	/** @type {JavascriptModuleObject} */
	let JSMO;


	/** @type {OntologyAnnotationParser} */
	let ontologyParser;


	/** Flag used to signal that the intercepted save operations should proceed */
	const SAVE_SKIP_SENTINEL_KEY = '__romeSkipMissingChoicePrompt';

	/**
	 * Implements the public init method.
	 * @param {ROMEOnlineDesignerConfig} config_data
	 * @param {JavascriptModuleObject} jsmo
	 */
	function initialize(config_data, jsmo) {

		config = config_data;
		JSMO = jsmo;

		// Configure the logger
		LOGGER.configure({ active: config.debug, name: 'ROME', version: config.version });

		// Configure the ontology parser
		ontologyParser = createOntologyAnnotationParser({
			tag: config.atName,
			getMinAnnotation: getMinimalOntologyAnnotation
		});

		// Hooks
		$(function() {
			ensureFieldSaveHook();
			ensureMatrixSaveHook();
			ensureFitDialogHook(); // <- Main entry point for UI injection.
		});
		addAjaxHooks();

		log('Initialization complete.', config);
	}

	//#endregion

	//#region Help

	/**
	 * Shows a help dialog in response to the "Learn about using Ontology Annotations"
	 */
	function showHelp() {
		if (!odState.helpContent) {
			JSMO.ajax('get-fieldhelp').then(response => {
				odState.helpContent = response;
				showHelp();
			}).catch(err => {
				error(err);
			});
		}
		else {
			log('Showing help dialog');
			simpleDialog(odState.helpContent, config.moduleDisplayName);
		}
	}

	//#endregion Help

	/**
	 * Refreshes the dialog-level ROME UI whenever REDCap opens/refits the editor dialog.
	 * Initializes draft state from action tags and re-renders targets/table controls.
	 * @returns {void}
	 */
	function injectAnnotationsEditor() {
		if (odState.$dlg?.find('.rome-edit-field-ui-container').length == 0) {
			initAnnotationEditor();
			log('UI initialized.', odState);
		}
		setInitialExcludedCheckboxState();
		resetSearchState();
		buildTargetOptions();
		initInfoPopover();
		initAnnotationState();
		
		setTimeout(() => {
			requestAnimationFrame(() => {
				refitDialog();
			});
		}, 10);
		// Disable search when there are errors and add error indicator
		if (config.errors?.length ?? 0 > 0) {
			odState.$editor?.find('#rome-search-bar :input').prop('disabled', true);
			showSearchErrorBadge(config.errors.join('\n'));
		}
	}

	function refitDialog() {
		try {
			const winh = $(window).height() ?? 500;
			odState.$dlg?.dialog('option', 'height', winh - 20);
			odState.$dlg?.dialog('option', 'position', { my: 'center', at: 'center', of: window });
		} 
		catch (e) {
			// Ignored 
		}
	}

	/**
	 * Returns whether the "exclude from annotation" checkbox is currently enabled.
	 * @returns {boolean}
	 */
	function isExcludedCheckboxChecked() {
		const checked = odState.$dlg?.find('input.rome-em-exclude').prop('checked');
		return checked;
	}

	/**
	 * Determines the inital exclusion state and sets it in the UI
	 */
	function setInitialExcludedCheckboxState() {
		let enabled = true;
		if (odState.editType == 'matrix') {
			const matrixGroupName = '' + odState.$dlg?.find('#grid_name').val();
			enabled = !config.matrixGroupsExcluded.includes(matrixGroupName);
		}
		else {
			const fieldName = '' + odState.$dlg?.find('input[name="field_name"]').val();
			enabled = !config.fieldsExcluded.includes(fieldName);
		}
		updateExcludedCheckboxStateAndHiddenInput(enabled);
	}

	/**
	 * Updates the enabled state and the state of the excluded checkbox and the hidden field.
	 * @param {boolean} enabled
	 */
	function updateExcludedCheckboxStateAndHiddenInput(enabled) {
		odState.enabled = enabled;
		odState.$dlg?.find('input.rome-em-exclude').prop('checked', !enabled);
		$('input[name="rome-em-exclude"]').val(enabled ? '0' : '1');
	}

	/**
	 * Updates the excluded hidden field before saving.
	 */
	function updateExcludedCheckboxHiddenInput() {
		const exclude = odState.$dlg?.find('input.rome-em-exclude').prop('checked');
		$('input[name="rome-em-exclude"]').val(exclude ? '1' : '0');
	}


	/**
	 * Inserts the ROME UI surface into the active REDCap dialog and wires handlers.
	 */
	function initAnnotationEditor() {
		const editorHtml = $('#rome-em-fieldedit-ui-template').html().replaceAll('\n', '');
		const $editor = $(editorHtml);
		odState.$editor = $editor;
		odState.$add = $editor.find('#rome-add-button');
		odState.$info = $editor.find('#rome-add-selection-info');
		odState.$error = $editor.find('#rome-search-error');
		odState.$search = $editor.find('input[name=rome-em-fieldedit-search]');
		odState.$searchSpinner = $editor.find('.rome-edit-field-ui-spinner');

		if (odState.editType == 'matrix') {
			$editor.find('.rome-em-exclude-field').remove();
			// Insert at end of the dialog
			odState.$dlg?.append($editor);
		}
		else {
			$editor.find('.rome-em-exclude-matrix').remove();
			// Single-field-specific adjustments
			// Mirror visibility of the Action Tags / Field Annotation DIV
			// TODO - extract the mutation observer setup into a hook and call 
			// helper hide/show functions
			const actiontagsDIV = document.getElementById('div_field_annotation')
				?? document.createElement('div');
			const observer = new MutationObserver(() => {
				const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
				$editor.css('display', actiontagsVisible ? 'block' : 'none');
			});
			observer.observe(actiontagsDIV, { attributes: true, attributeFilter: ['style'] });
			// Initial sync
			const actiontagsVisible = window.getComputedStyle(actiontagsDIV).display !== 'none';
			$editor.css('display', actiontagsVisible ? 'block' : 'none');
			// Add a hidden field to transfer exclusion
			odState.$dlg?.find('#addFieldForm').prepend(
				'<input type="hidden" name="rome-em-exclude" value="0">'
			);

			// Initial sync from the action tag
			// updateAnnotationTable(); // TODO - Check

			// Insert the UI as a new table row
			const $tr = $('<tr><td colspan="2"></td></tr>');
			$tr.find('td').append($editor);
			odState.$dlg?.find('#quesTextDiv > table > tbody').append($tr);
		}

		initSearchInput();
		initUserChangeWatcher();
		initDatatable();

		// Table events
		odState.$dlg?.find('.rome-edit-field-ui-list').off('change').off('click')
		.on('change', '.rome-row-target', dispatchTableEvent)
		.on('click', '.rome-row-delete', dispatchTableEvent);
		// Add new annotation event
		odState.$add.off('click').on('click', function () {
			addAnnotationRow();
		});
	}




	/**
	 * @param {Event} event 
	 */
	function dispatchTableEvent(event) {

		if (event.target === null) return;
		// Get row, then find the DataTable entry for the row
		const $tr = $(event.target).closest('tr');
		const rowIndex = odState.dtInstance?.row($tr).index();
		const row = odState.rows[rowIndex];

		const action = event.type === 'change' ? 'assign-taget' : 'delete-row';
		if (action === 'assign-taget') {
			const newTarget = `${$(event.target).val()}`;
			assignRowToTarget(row, newTarget);
		}
		else {
			deleteAnnotationRow(row);
		}
	}

	/**
	 * 
	 * @param {ROME_AnnotationRow} row 
	 * @param {string} newTarget 
	 */
	function assignRowToTarget(row, newTarget) {
		log('Assigned row', row, 'to new target: "' + newTarget + '"', odState);
		if (newTarget.startsWith('field:')) {
			const targetName = newTarget.substring(6);
			row.targetType = 'field';
			row.targetName = targetName;
		}
		else if (newTarget === 'unit') {
			row.targetType = 'unit';
			row.targetName = '';
		}
		else if (newTarget.startsWith('choice:')) {
			const code = newTarget.substring(7);
			row.targetType = 'choice';
			row.targetName = code;
		}
		redrawAnnotationsTable();
		setAnnotations();
	}

	/**
	 * 
	 * @param {ROME_AnnotationRow} row 
	 */
	function deleteAnnotationRow(row) {
		log('Deleting row', row);
		odState.rows.splice(odState.rows.indexOf(row), 1);
		redrawAnnotationsTable();
		setAnnotations();
	}


	function addAnnotationRow() {
		if (!odState.selected) return;
		const target = `${odState.$dlg?.find('#rome-field-choice').val() ?? ''}`;
		if (target === '') return;
		const targetType = target === 'unit' ? 'unit' : (target.startsWith('choice:') ? 'choice' : 'field');
		const targetName = targetType === 'unit' ? '' : (targetType === 'choice' ? target.substring(7) : target.substring(6));
		const coding = {
			system: odState.selected.system,
			code: odState.selected.code,
			display: odState.selected.display
		}
		odState.rows.push({
			annotation: coding,
			targetType: targetType,
			targetName: targetName
		});
		setAnnotations();
		initAnnotationState();
		log('Adding annotation row', coding);
	}
	

	/**
	 * Persists the current annotation rows to the respective textarea(s) as JSON action tag(s).
	 * @param {boolean} removeNonExistentChoices When true, non-existent choices will be removed
	 */
	function setAnnotations(removeNonExistentChoices = false) {
		getWatcher()?.pause();
		// Build unit and choice stub
		const stub = getMinimalOntologyAnnotation();
		// Unit annotation(s)
		odState.rows.filter(r => r.targetType === 'unit').forEach(r => {
			stub.dataElement.unit?.coding.push(r.annotation);
		});
		if (stub.dataElement.unit?.coding.length === 0) {
			delete stub.dataElement.unit;
		}
		else {
			if (stub.dataElement.unit) {
				stub.dataElement.unit.text = stub.dataElement.unit.coding[0].display ?? '';
			}
		}
		// Choice annotations
		for (const code of Object.keys(odState.choiceLabelMap)) {
			stub.dataElement.valueCodingMap[code] = { coding: [] };
		}
		odState.rows.filter(r => r.targetType === 'choice').forEach(r => {
			if (!odState.choiceLabelMap[r.targetName]) {
				if (removeNonExistentChoices) return;
				if(!stub.dataElement.valueCodingMap[r.targetName]) {
					stub.dataElement.valueCodingMap[r.targetName] = { coding: [] };
				}
			}
			stub.dataElement.valueCodingMap[r.targetName].coding.push(r.annotation);
		});
		for (const code of Object.keys(stub.dataElement.valueCodingMap)) {
			if (stub.dataElement.valueCodingMap[code].coding.length === 0) {
				delete stub.dataElement.valueCodingMap[code];
			}
		}
		// Field annotations
		const selector = odState.editType === 'field' ? '#field_annotation' : 'textarea[name=addFieldMatrixRow-annotation]';
		odState.$dlg?.find(selector).each(function () {
			const $annotation = $(this);
			const rowId = odState.editType === 'field' ? '' : ensureMatrixRowId($annotation.closest('tr'));
			odState.rows
				.filter(r => r.targetType === 'field' && r.targetName === rowId)
				.forEach(r => {
					stub.dataElement.coding.push(r.annotation);
				});
			const isEmpty = (stub.dataElement.coding.length === 0 && Object.keys(stub.dataElement.valueCodingMap).length === 0);
			if (stub.dataElement.coding.length === 0) {
				delete stub.dataElement.coding;
			}
			if (Object.keys(stub.dataElement.valueCodingMap).length === 0) {
				delete stub.dataElement.valueCodingMap;
			}
			const jsonString = isEmpty ? '' : `${config.atName}=${JSON.stringify(stub, null, 2)}`;
			const prevParsed = odState.parseResults[rowId] ?? null;
			if (prevParsed.start === -1) {
				// Append to end - but we need to determine if we should add newlines (max 2, considering any already present)
				let delim = '';
				if (prevParsed.originalText !== '') {
					if (prevParsed.originalText.endsWith('\n\n')) delim = '';
					else if (prevParsed.originalText.endsWith('\n')) delim = '\n';
					else delim = '\n\n';
				}
				$annotation.val(prevParsed.originalText + delim + jsonString);
			}
			else {
				// Replace part from start to end with new string, preserving any text before or after
				const newVal = prevParsed.originalText.substring(0, prevParsed.start) + jsonString + prevParsed.originalText.substring(prevParsed.end);
				$annotation.val(newVal.trimEnd());
			}
			// Clear codings for next iteration
			stub.dataElement.coding = [];
		});
		getWatcher()?.resume();
		initAnnotationState();
		log('Updating annotations with current state.', odState);
	}

	//#region DataTable Rendering

	/**
	 * Initializes the DataTable instance for annotation display and manipulation.
	 */
	function initDatatable() {
		const $table = odState.$dlg?.find('#rome-annotation-table');
		odState.dtInstance = $table.DataTable({
			autoWidth: true,
			data: odState.rows,
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
						return renderTargetColumn(row);
					}
				},
				{
					data: null,
					orderable: false,
					searchable: false,
					render: (_data, _type, row) => renderActionColumn(row)
				}
			],
			language: {
				emptyTable: JSMO.tt('fieldedit_07')
			},
			paging: odState.dtAdvancedUiEnabled,
			searching: odState.dtAdvancedUiEnabled,
			info: odState.dtAdvancedUiEnabled,
			lengthChange: false,
			pageLength: 10,
			order: [[3, 'asc']],
			createdRow: (rowEl, rowData) => {
				$(rowEl).data('rome-entry', rowData);
			}
		});
	}

	/**
	 * Renders System column cell content.
	 * @param {ROME_AnnotationRow} row
	 * @returns {string}
	 */
	function renderSystemColumn(row) {
		return escapeHTML(row.annotation?.system || '?');
	}

	/**
	 * Renders Code column cell content, with known-system external link when available.
	 * @param {ROME_AnnotationRow} row
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
	 * @param {ROME_AnnotationRow} row
	 * @returns {string}
	 */
	function renderDisplayColumn(row) {
		return escapeHTML(row.annotation?.display || '');
	}

	/**
	 * Renders Target column select control for one row.
	 * @param {ROME_AnnotationRow} row
	 * @returns {string}
	 */
	function renderTargetColumn(row) {

		const rowTarget = getRowTargetValue(row);
		const isMissingTarget = odState.targetOptions.some(t => t.value === rowTarget) === false;
		const rowTargets = odState.targetOptions.slice();
		if (isMissingTarget) {
			const display = `Missing target: ${row.targetType === 'field'
					? `Field: ${row.targetName}`
					: (row.targetType === 'choice' ? `Choice [${row.targetName}]` : 'Unit')}`;
			rowTargets.unshift({
				rowId: '',
				value: rowTarget,
				display: display,
				targetType: row.targetType
			});
		}
		return `<select class="form-select form-select-xs rome-row-target ${isMissingTarget ? 'target-missing' : ''}">
			${rowTargets.map(target => `<option value="${escapeHTML(target.value)}" ${target.value === rowTarget ? 'selected' : ''}>${escapeHTML(target.display)}</option>`).join('')}
		</select>`;
	}

	function getRowTargetValue(row) {
		if (row.targetType === 'field') {
			return `field:${row.targetName}`;
		}
		if (row.targetType === 'unit') {
			return 'unit';
		}
		if (row.targetType === 'choice') {
			return `choice:${row.targetName}`;
		}
		return '';
	}

	/**
	 * Builds stable sort key for target column.
	 * @param {ROME_AnnotationRow} row
	 * @returns {string}
	 */
	function getTargetSortKey(row) {
		if (row.targetType === 'field') {
			return 'a:' + (odState.rowIdFieldMap[row.targetName] ?? row.targetName ?? '?');
		}
		if (row.targetType === 'unit') {
			return 'b:';
		}
		if (row.targetType === 'choice') {
			return 'c:' + (odState.choiceLabelMap[row.targetName]?.pos || '0');
		}
		return 'z:';
	}

	/**
	 * Renders Action column controls for one row.
	 * @param {ROME_AnnotationRow} row
	 * @returns {string}
	 */
	function renderActionColumn(row) {
		const warningIcon = (odState.showUnitWarning && row.targetType === 'unit')
			? '<span class="rome-target-warning text-warning rome-unit-row-warning ms-2" title="Unit targets are unusual for this field type."><i class="fa-solid fa-triangle-exclamation"></i></span>'
			: '';
		return `<button type="button" class="btn btn-xs btn-link text-danger p-0 rome-row-delete" title="Delete annotation"><i class="fa fa-trash"></i></button>${warningIcon}`;
	}

	/**
	 * Redraws the annotation DataTable.
	 */
	function redrawAnnotationsTable() {
		odState.dtInstance.clear().rows.add(odState.rows).draw();
	}

	//#endregion DataTable Rendering



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




	/** @type {ROME_OnlineDesignerState} */
	const odState = {
		editType: 'field',
		fieldType: '',
		parseResults: {},
		rows: [],
		fieldWatcher: null,
		matrixWatcher: null,
		enabled: true, // TODO - set this based on the exclusion state
		dtInstance: null,
		dtAdvancedUiEnabled: false,
		selected: null,
		$dlg: null,
		$editor: null,
		$add: null,
		$error: null,
		$info: null,
		$search: null,
		$searchSpinner: null,
		helpContent: null,
		minItemsForSelect2: 7,
		targetOptions: [],
		choiceLabelMap: {},
		rowIdFieldMap: {},
		showUnitWarning: false,
	}


	/**
	 * Sets the current edit type based on the dialog object.
	 * @param {HTMLElement} dialogObj 
	 */
	function setEditType(dialogObj) {
		odState.editType = dialogObj.id == 'addMatrixPopup' ? 'matrix' : 'field'
		odState.fieldType = odState.editType === 'field' ? String($('#field_type').val() ?? '') : 'matrix';
		odState.$dlg = $(dialogObj);
	}

	/**
	 * Initializes user change watchers for field name (matrix only), 
	 * field annotation, and choices. Watchers are attached once only.
	 */
	function initUserChangeWatcher() {
		const elements = [];
		const filters = [];
		const watcher = odState.editType === 'field' ? 'fieldWatcher' : 'matrixWatcher';
		if (odState.editType === 'field' && odState.fieldWatcher == null) {
			// Annotation
			elements.push(document.getElementById('field_annotation'));
			// Choices
			elements.push(document.getElementById('element_enum'));
			// Field type
			elements.push(document.getElementById('field_type'));
		}
		else if (odState.editType === 'matrix' && odState.matrixWatcher == null) {
			// Table of matrix fields (including field names and annotations)
			elements.push(document.querySelector('table.addFieldMatrixRowParent'));
			// Choices
			elements.push(document.getElementById('element_enum_matrix'));
			elements.push(document.getElementById('section_header_matrix'));
			filters.push(
				'input[name^=addFieldMatrixRow-varname_]',
				'textarea[name=addFieldMatrixRow-annotation]',
				'textarea[name=element_enum_matrix]',
			);
		}
		if (elements.length > 0) {
			// @ts-ignore
			odState[watcher] = WatchTargets.watch(elements, {
				onEvent: (info) => {
					if (info.kind === 'edit') {
						const $el = $(info.el);
						if ($el.is('.field_name_matrix')) {
							// Field name changed
							buildTargetOptions();
						}
						else if ($el.is('.field_annotation_matrix, #field_annotation')) {
							// Annotations changed
							initAnnotationState();
							refreshAnnotationRows();
						}
						else if ($el.is('#element_enum_matrix, #element_enum')) {
							// Enum changed
							buildTargetOptions();
							updateAnnotationTargetsDropdown();
							refreshAnnotationRows();
						}
						else if ($el.is('#field_type')) {
							// Field type changed
							buildTargetOptions();
							odState.fieldType = String($el.val() ?? '');
						}
					}
					else if (info.kind === 'rows') {
						// Rows added or removed
						refreshAnnotationRows();
					}
				},
				tableCellFilter: filters,
				fireOnInput: false,
				patchProgrammatic: true
			});
		}
	}

	function getWatcher() {
		return odState.editType === 'field' ? odState.fieldWatcher : odState.matrixWatcher;
	}


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
	 * Ensures ontology annotation JSON is normalized for draft-state operations.
	 * @param {OntologyAnnotationJSON|Object} raw
	 * @returns {OntologyAnnotationJSON}
	 */
	function normalizeAnnotation(raw) {
		/** @type {OntologyAnnotationJSON} */
		const annotation = (raw && typeof raw === 'object' && !Array.isArray(raw))
			? /** @type {OntologyAnnotationJSON} */ (raw)
			: getMinimalOntologyAnnotation();
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
		return annotation;
	}

	/**
	 * Initializes annotation draft state from currently rendered REDCap annotation input(s).
	 * @returns {void}
	 */
	function initAnnotationState() {
		odState.parseResults = {};
		odState.rows = [];
		if (odState.editType === 'matrix') {
			initAnnotationStateFromMatrix();
		}
		else {
			initAnnotationStateFromSingleField();
		}
	}

	/**
	 * Initializes annotation draft state from the field annotation 
	 * @returns {void}
	 */
	function initAnnotationStateFromSingleField() {
		const result = getOntologyAnnotation();
		if (result.error) {
			odState.parseResults = {};
			setJsonIssueOverlay(result.errorMessage);
		}
		else {
			odState.parseResults[result.rowId] = result;
			setJsonIssueOverlay(false);
		}
		refreshAnnotationRows();
	}

	/**
	 * Initializes matrix draft state by reading each matrix row annotation textarea.
	 * @returns {void}
	 */
	function initAnnotationStateFromMatrix() {
		getMatrixRows().forEach(($row) => {
			const rowId = ensureMatrixRowId($row);
			const fieldName = `${$row.find('.field_name_matrix:first').val() ?? ''}`.trim();
			const result = getOntologyAnnotation(rowId);
			odState.parseResults[rowId] = result;
		});
		for (const rowId in odState.parseResults) {
			const result = odState.parseResults[rowId];
			if (result.error) {
				odState.parseResults = {};
				setJsonIssueOverlay(result.errorMessage);
				break;
			}
		}
		refreshAnnotationRows();
	}


	function initInfoPopover() {
		odState.$info.popover({
			trigger: 'click hover focus',
			customClass: 'rome-annotation-popover',
			html: true,
			sanitize: false,
			container: odState.$dlg?.get(0),
			content: () => getSelectedAnnotationPopoverHtml(),
			title: 'Annotation to be added',
			placement: 'top'
		});
	}

	function refreshAnnotationRows() {
		const rowIds = Object.keys(odState.parseResults);
		/** @type {ROME_AnnotationRow[]} */
		const rows = [];
		for (const rowId of rowIds) {
			const annotations = normalizeAnnotation(
				odState.parseResults[rowId].json
			).dataElement;
			for (const coding of annotations?.coding ?? []) {
				if (checkCodingUnique(rows, coding, 'field')) {
					rows.push({
						targetType: 'field',
						targetName: rowId,
						annotation: coding,
					});
				}
			}
			for (const coding of annotations.unit?.coding ?? []) {
				if (checkCodingUnique(rows, coding, 'unit')) {
					rows.push({
						targetType: 'unit',
						targetName: null,
						annotation: coding,
					});
				}
			}
			for (const code in annotations?.valueCodingMap ?? {}) {
				const codings = annotations.valueCodingMap[code]?.coding ?? [];
				for (const coding of codings) {
					if (checkCodingUnique(rows, coding, 'choice')) {
						rows.push({
							targetType: 'choice',
							targetName: code,
							annotation: coding,
						});
					}
				}
			}
		}
		odState.rows = rows;
		odState.dtInstance.clear().rows.add(rows).draw();
	}

	/**
	 * 
	 * @param {ROME_AnnotationRow[]} rows 
	 * @param {OntologyAnnotationCoding} coding 
	 * @param {'field'|'unit'|'choice'} targetType
	 */
	function checkCodingUnique(rows, coding, targetType) {
		return !rows.some(r => r.targetType === targetType && r.annotation?.system === coding?.system && r.annotation?.code === coding?.code);
	}

	/**
	 * Gets all matrix row elements from the currently open matrix dialog.
	 * @returns {JQuery<HTMLElement>[]}
	 */
	function getMatrixRows() {
		/** @type {JQuery<HTMLElement>[]} */
		const rows = [];
		odState.$dlg?.find('.addFieldMatrixRowParent .addFieldMatrixRow').each(function () {
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
	 * Parses ontology annotation from one matrix-row textarea.
	 * @param {JQuery<HTMLElement>} $row
	 * @returns {OntologyAnnotationParseResult}
	 */
	function parseRowAnnotation($row) {
		const value = `${$row.find('textarea[name="addFieldMatrixRow-annotation"]').first().val() ?? ''}`;
		return ontologyParser.parse(value);
	}





	/**
	 * Ensures current UI draft can be saved and blocks submit if ONTOLOGY JSON is invalid.
	 * @returns {boolean}
	 */
	function validateBeforeSave(onProceedAfterMissingChoiceWarning = null, skipMissingChoicePrompt = false) {

		// TODO: Reimplement warning for missing choice targets and other issues
		setAnnotations();

		return true;

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
	 * Displays a blocking confirmation dialog for missing choice targets.
	 * @param {number} count
	 * @param {null|(() => void)} onProceed
	 * @returns {void}
	 */
	function showMissingChoiceSaveDialog(count, onProceed = null) {
		odState.$dlg?.find('.rome-missing-choice-save-dialog').remove();
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

	//#region Add Hooks

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
			updateExcludedCheckboxHiddenInput();
			return existing.apply(self, args);
		};
		wrapped.__romeWrapped = true;
		window['addEditFieldSave'] = wrapped;
	}

	/**
	 * Hooks into the fitDialog function tp know when to inject the annotation editor UI.
 	 * @returns {void}
	 */
	function ensureFitDialogHook() {
		const existing = window['fitDialog'];
		if (typeof existing !== 'function') return;
		if (existing['__romeWrapped'] === true) return;
		const wrapped = function () {
			const self = this;
			const args = Array.from(arguments);

			const ob = args[0];
			if (ob && ob['id'] && ['div_add_field', 'addMatrixPopup'].includes(ob.id)) {
				odState.$dlg = $(ob);
				if (ob.id === 'addMatrixPopup') {
					odState.editType = 'matrix';
					odState.fieldType = String($('#field_type_matrix').val() ?? '');
				}
				else {
					odState.editType = 'field';
					odState.fieldType = String($('#field_type').val() ?? '');
				}
				try {
					injectAnnotationsEditor();
				}
				catch (e) {
					// In case of error, we remove the editor and log to console
					if (odState.$editor != null) odState.$editor.remove();
					console.error('Error initializing ROME Online Designer UI:', e);
				}
			}
			return existing.apply(self, args);
		};
		wrapped.__romeWrapped = true;
		window['fitDialog'] = wrapped;
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
		wrapped.__romeWrapped = true;
		window['matrixGroupSave'] = wrapped;
	}

	/**
	 * Adds global AJAX prefilters to hook into Design edit and render calls for 
	 * matrix and field dialogs.
	 */
	function addAjaxHooks() {
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
	}

	//#endregion Add Hooks

	//#region Action Tag Parser and Annotation Accessor

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
			 * @param {string} rowId
			 * @param {string} text
			 * @returns {OntologyAnnotationParseResult}
			 */
			parse(rowId, text) {
				/** @type {OntologyAnnotationParseResult} */
				const result = {
					rowId: rowId,
					// IMPORTANT: Do NOT run schema validation on the minimal annotation
					json: getMinAnnotation(),
					usedFallback: true,
					numTags: 0,
					error: false,
					errorMessage: '',
					warnings: [],
					text: '',
					start: -1,
					end: -1,
					originalText: text,
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

	/**
	 * Gets the contents of an element and extracts the ontology JSON.
	 * @param {string} [rowId] - When editing matrix groups, the row id to get the annotations from.
	 * @returns {OntologyAnnotationParseResult}
	 */
	function getOntologyAnnotation(rowId = '') {
		let $el;
		if (odState.editType === 'matrix') {
			$el = odState.$dlg.find(`tr[data-rome-row-id="${rowId}"] .field_annotation_matrix`);
		} else {
			$el = $('#field_annotation');
		}
		let content = '';
		if ($el.is('input, textarea')) {
			content = String($el.val() ?? '');
		} else {
			content = $el.text();
		}
		const result = ontologyParser.parse(rowId, content);
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
		return obj;
	}

	//#endregion Action Tag Parser and Annotation Accessor




	/**
	 * Gets the current field type.
	 * @returns {string}
	 */
	function getFieldType() {
		if (odState.editType === 'matrix') {
			return odState.$dlg.find('select#field_type_matrix').val()?.toString() ?? '';
		}
		return $('select#field_type').val()?.toString() ?? '';
	}

	//#region Target Selection

	/**
	 * Renders add-target options and contextual warnings.
	 * @returns {void}
	 */
	function updateAnnotationTargetsDropdown() {
		const $target = odState.$dlg.find('#rome-field-choice');
		const previous = `${$target.val() ?? ''}`;
		$target.html(odState.targetOptions.map(opt => {
			const val = escapeHTML(opt.value);
			const label = escapeHTML(opt.display);
			return `<option value="${val}">${label}</option>`;
		}).join(''));
		if (odState.targetOptions.some(opt => opt.value === previous)) {
			$target.val(previous);
		}
		applySelect2ToTargetSelects($target);
	}

	/**
	 * Builds add-target dropdown options for current dialog mode.
	 */
	function buildTargetOptions() {
		/** @type {ROME_TargetOption[]} */
		const options = [];
		const choiceLabelMap = {};
		const rowIdFieldMap = {};
		if (odState.editType === 'matrix') {
			// Fields
			odState.$dlg.find('input.field_name_matrix').each(function() {
				const fieldName = ($(this).val() ?? '').toString().trim();
				if (fieldName === '') return;
				const rowId = ensureMatrixRowId($(this).closest('tr'));
				rowIdFieldMap[rowId] = fieldName;
				options.push({
					rowId: rowId,
					value: `field:${rowId}`,
					display: `Field - ${fieldName}`,
					targetType: 'field'
				});
			});
			// Choices
			let pos = 0;
			for (const choice of getChoiceOptions()) {
				pos++;
				options.push({
					rowId: '',
					value: `choice:${choice.code}`,
					display: `[${choice.code}] - ${choice.label}`,
					targetType: 'choice'
				});
				choiceLabelMap[choice.code] = {
					label: choice.label,
					pos: pos
				};
			}
			// Unit
			options.push({ rowId: '', value: 'unit', display: 'Unit', targetType: 'unit' });
		}
		else {
			// Field
			options.push({ rowId: '', value: 'field:', display: 'Field', targetType: 'field' });
			// Choices
			let pos = 0;
			for (const choice of getChoiceOptions()) {
				pos++;
				options.push({ 
					rowId: '',
					value: `choice:${choice.code}`,
					display: `[${choice.code}] - ${choice.label}`,
					targetType: 'choice'
				});
				choiceLabelMap[choice.code] = { 
					label: choice.label,
					pos: pos
				};
			}
			// Unit
			options.push({ rowId: '', value: 'unit', display: 'Unit', targetType: 'unit' });
		}
		odState.targetOptions = options;
		odState.choiceLabelMap = choiceLabelMap;
		odState.rowIdFieldMap = rowIdFieldMap;
		log('Build target options:', options, choiceLabelMap)
		setShowUnitWarning();
		updateAnnotationTargetsDropdown();
		redrawAnnotationsTable();
	}

	/**
	 * Checks if setting a unit annotations is sensible for the current field type/validation.
	 */
	function setShowUnitWarning() {
		const fieldType = getFieldType();
		const valType = `${odState.$dlg.find('#val_type, #val_type_matrix').first().val() ?? ''}`.toLowerCase();
		if (['radio', 'select', 'checkbox'].includes(fieldType)) {
			const nonNumericChoice = Object.keys(odState.choiceLabelMap).some(code => {
				return code && !/^[-+]?\d+(\.\d+)?$/.test(code.trim());
			});
			odState.showUnitWarning = nonNumericChoice;
			return;
		}
		const nonNumericValidators = ['email', 'alpha_only', 'letters_only', 'zipcode', 'phone'];
		odState.showUnitWarning = nonNumericValidators.includes(valType);
	}

	/**
	 * Returns parsed choice code/label options from current enum text.
	 * @returns {{code:string, label:string}[]}
	 */
	function getChoiceOptions() {
		let enumText = '';
		if (odState.editType === 'field') {
			if (odState.fieldType === 'truefalse') {
				enumText = config.fixedEnums.truefalse;
			}
			else if (odState.fieldType === 'yesno') {
				enumText = config.fixedEnums.yesno;
			}
			else {
				enumText = String($('#element_enum').val() ?? '');
			}
		}
		else {
			enumText = String($('#element_enum_matrix').val() ?? '');
		}
		const out = [];
		for (const line of enumText.split('\n')) {
			if (!line.trim()) continue;
			const [codeRaw, labelRaw] = line.split(',', 2);
			const code = `${codeRaw || ''}`.trim();
			if (code === '') continue;
			out.push({ code, label: `${labelRaw || code}`.trim() || code });
		}
		return out;
	}

	//#endregion Target Selection


	/**
	 * Returns rows that target missing choice codes.
	 * @returns {ROME_AnnotationRow[]}
	 */
	function getMissingChoiceTargetRows() {
		return []; // TODO
	}


	/**
	 * Returns the preferred Select2 dropdown parent for current dialog context.
	 * @returns {JQuery<HTMLElement>|undefined}
	 */
	function getSelect2DropdownParent() {
		const $dialog = odState.$dlg?.closest('[role="dialog"]');
		if ($dialog && $dialog.length > 0) return $dialog;
		return odState.$dlg;
	}

	/**
	 * Applies select2 enhancement to one or more target select elements when available.
	 * @param {JQuery<HTMLElement>} $selects
	 * @returns {void}
	 */
	function applySelect2ToTargetSelects($selects) {
		if (!$selects || $selects.length === 0) return;
		if (typeof $.fn.select2 !== 'function') return;
		const threshold = Number.parseInt(`${odState.minItemsForSelect2 ?? 7}`, 10);
		const minItems = Number.isFinite(threshold) && threshold > 0 ? threshold : 7;
		const effectiveCount = odState.targetOptions.length;
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



	//#region Error Handling

	/**
	 * Shows or hides the search-error badge next to the search bar.
	 * @param {string|false} errorMessage
	 */
	function showSearchErrorBadge(errorMessage) {
		if (errorMessage) {
			odState.$error
			.css('display', 'block')
			.attr('data-bs-tooltip', 'hover')
			.attr('title', errorMessage);
			const tt = new bootstrap.Tooltip(odState.$error.get(0));
			tt.enable();
		}
		else {
			odState.$error
			.css('display', 'none');
			const tt = new bootstrap.Tooltip(odState.$error.get(0));
			tt.dispose();
		}
	}

	/**
	 * Shows or hides the JSON error overlay that blocks search/table controls.
	 * @param {string|false} errorMessage
	 */
	function setJsonIssueOverlay(errorMessage) {
		const $overlay = odState.$editor.find('.rome-json-error-overlay');
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
		odState.$searchSpinner[state ? 'addClass' : 'removeClass']('busy');
		odState.$search[state ? 'addClass' : 'removeClass']('is-searching');
	}

	/**
	 * Toggles a visual marker when the latest returned search result set is empty.
	 * @param {boolean} state
	 */
	function showNoResultsState(state) {
		odState.$search[state ? 'addClass' : 'removeClass']('is-no-results');
	}


	/**
	 * Initializes autocomplete search input for ontology lookup.
	 */
	function initSearchInput() {
		// Init safely if this input already had an autocomplete instance.
		if (odState.$search.data('ui-autocomplete')) {
			odState.$search.autocomplete('destroy');
		}
		odState.$search.off('.ROME_autocomplete');

		function raiseAutocompleteMenu() {
			const ac = odState.$search.data('ui-autocomplete');
			const $menu = ac?.menu?.element;
			if (!$menu || $menu.length === 0) return;

			const baseZ = Number.parseInt(
				odState.$dlg.closest('[role="dialog"]').css('z-index') ?? '199',
				10
			);
			const zIndex = Number.isFinite(baseZ) ? baseZ + 2 : 201;
			$menu.css('z-index', String(zIndex));
		}

		odState.$search.autocomplete({
			minLength: config.minSearchLength ?? 2,
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

		odState.$search.on('autocompleteselect.ROME_autocomplete', function (e, ui) {
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
		odState.$search.on('keydown keyup', function (event) {
			if (event.key === 'Enter') {
				// Let jQuery UI autocomplete handle Enter, but block REDCap's parent dialog handlers.
				event.stopPropagation();
				event.stopImmediatePropagation();
				return false;
			}
		});
		odState.$search.on('input.ROME_autocomplete', function () {
			if (odState.selected) {
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
		if (annotation) {
			log( 'Annotation has been selected:', odState);
		}
		else if (odState.selected) {
			log( 'Selected annotation has been cleared:', odState.selected);
		}
		odState.selected = annotation; 
		refreshAddButtonState();
	}

	/**
	 * Refreshes Add button state and details popover based on current selection state.
	 */
	function refreshAddButtonState() {
		const hasSelection = odState.selected !== null;
		odState.$add.prop('disabled', !hasSelection);
		odState.$info.css('display', hasSelection ? 'inline-block' : 'none');
		if (hasSelection) {
			// Set focus to the Add button
			setTimeout(() => odState.$add.trigger('focus'), 0);
		}
	}

	/**
	 * Builds selection details HTML shown in the add-selection popover.
	 * @returns {string}
	 */
	function getSelectedAnnotationPopoverHtml() {
		if (!odState.selected) return 'No selection made.';
		const source = (config.sources || []).find(s => s.id === odState.selected.sourceId);
		const sourceLabel = source?.label || odState.selected.sourceId || 'Unknown source';
		const system = odState.selected.system || '?';
		const code = odState.selected.code || '?';
		const display = odState.selected.display || '';
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
			odState.$search.autocomplete('search', term);
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
				showNoResultsState(searchState.items.length === 0 && searchState.lastTermCompleted);

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
		odState.$search?.val('');
		searchState.term = '';
		searchState.lastTerm = '';
		searchState.lastTermCompleted = false;
		searchState.debounceTimer = null;
		setSelectedAnnotation(null);
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

	//#endregion Search Implementation

})();
