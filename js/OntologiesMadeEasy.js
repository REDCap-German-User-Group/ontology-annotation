// Ontology Made Easy EM

/// <reference types="jquery" />
/// <reference types="jqueryui" />

// @ts-check
;(function() {

//#region Init global object and define local variables

const EM_NAME = 'ROME';
const NS_PREFIX = 'DE_RUB_';

// @ts-ignore
const EM = window[NS_PREFIX + EM_NAME] ?? {
	init: initialize,
	showFieldHelp: showFieldHelp
};
// @ts-ignore
window[NS_PREFIX + EM_NAME] = EM;

/** Configuration data supplied from the server */
let config = {};

const data = {};

//#endregion

/**
 * Implements the public init method.
 * @param {object} config_data 
 * @param {object} jsmo
 */
function initialize(config_data, jsmo = null) {
	config = config_data;
	config.JSMO = jsmo;
	log('Initialzing ...', config);
	
	//#region Hijack Hooks

	// Adds the edit field UI
	const orig_fitDialog = window['fitDialog'];
	window['fitDialog'] = function(ob) {
		orig_fitDialog(ob);
		if (ob && ob['id'] && ['div_add_field', 'addMatrixPopup'].includes(ob.id)) {
			const $dlg = $(ob);
			updateEditFieldUI($dlg, ob.id == 'addMatrixPopup');
		}
	}

	//#endregion

	//#region AJAX Hooks

	$.ajaxPrefilter(function(options, originalOptions, jqXHR) {
		if (options.url?.includes('Design/edit_matrix.php')) {
			// Matrix saving
			const matrixGroupName = $('#grid_name').val();
			const exclude = $('#rome-em-fieldedit-exclude-matrix').prop('checked');
			const originalSuccess = options.success;
			options.success = function(data, textStatus, jqXHR) {
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
			options.success = function(data, textStatus, jqXHR) {
				config.JSMO.ajax('refresh-exclusions', config.form).then(function(response) {
					log('Updated config data:', response);
					config.fieldsExcluded = response.fieldsExcluded;
					config.matrixGroupsExcluded = response.matrixGroupsExcluded;
				}).finally(function() {
					if (originalSuccess) {
						// @ts-ignore
						originalSuccess.call(this, data, textStatus, jqXHR);
					}
				});
			}
		}
	});
	//#endregion
}

function showFieldHelp() {
	if (!data.fieldHelpContent) {
		config.JSMO.ajax('get-fieldhelp').then(response => {
			data.fieldHelpContent = response;
			showFieldHelp();
		}).catch(err => {
			error(err);
		});
	}
	else {
		log('Showing field help');
		// @ts-ignore REDCap base.js
		simpleDialog(data.fieldHelpContent, config.moduleDisplayName);
	}
}


//#region Edit Field UI

function updateEditFieldUI($dlg, isMatrix) {
	if ($dlg.find('.rome-edit-field-ui-container').length == 0) {
		addEditFieldUI($dlg, isMatrix);
	}
	log('Updating Edit Field UI');
	// Exclusion checkbox
	let excluded = false;
	if (isMatrix) {
		const matrixGroupName = '' + $dlg.find('#grid_name').val();
		excluded = config.matrixGroupsExcluded.includes(matrixGroupName);
	}
	else {
		const fieldName = '' + $dlg.find('input[name="field_name"]').val();
		excluded = config.fieldsExcluded.includes(fieldName);
	}
	$dlg.find('input.rome-em-fieldedit-exclude').prop('checked', excluded);
	$dlg.find('input[name="rome-em-fieldedit-search"]').val("");
}

function addEditFieldUI($dlg, isMatrix) {
	if ($dlg.find('.rome-edit-field-ui-container').length > 0) return;
	log('Adding Edit Field UI' + (isMatrix ? ' (matrix)' : ''));
	const $ui = $($('#rome-em-fieldedit-ui-template').html());
	
	//#region Setup event handlers
	
	// Track changes to the choices
	const $enum = isMatrix 
		? $dlg.find('textarea[name="element_enum_matrix"]')
		: $dlg.find('textarea[name="element_enum"]');
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
			if (['select','radio','checkbox'].includes(fieldType)) {
				setEnum(val);
			}
		}
	}
	// Track changes of the field type and set enum
	$dlg.find('select[name="field_type"]').on('change', () => {
		data.fieldType = getFieldType();
		log('Field type changed:', data.fieldType);
		if (data.fieldType == 'yesno' || data.fieldType == 'truefalse') {
			const val = $('#div_element_'+data.fieldType+'_enum div').last().html().trim().replace('<br>', '\n');
			setEnum(val);
		}
		else if (['select','radio','checkbox'].includes(data.fieldType)) {
			trackEnumChange($enum.val());
		}
		else {
			setEnum('');
		}
	}).trigger('change');
	// Init and track "Do not annotate this field/matrix"
	$ui.find('.rome-em-fieldedit-exclude').each(function() {
		const $this = $(this);
		const id = 'rome-em-fieldedit-exclude-' + (isMatrix ? 'matrix' : 'field');
		if ($this.is('input')) {
			$this.attr('id', id);
			$this.on('change', function() {
				const checked = $(this).prop('checked');
				if (!isMatrix) {
					// Store exclusion
					$dlg.find('[name="rome-em-fieldedit-exclude"]').val(checked ? 1 : 0);
				}
				log('Do not annotate is ' + (checked ? 'checked' : 'not checked'));
				if (checked) performExclusionCheck($dlg, isMatrix);
			});
		}
		else if ($this.is('label')) {
			$this.attr('for', id);
		}
	});
	// Init auto completion
	const $searchInput = $ui.find('input[name="rome-em-fieldedit-search"]');
	const $searchSpinner = $ui.find('.rome-edit-field-ui-spinner');
	$searchInput.autocomplete({
		source: function(request, response) {
			const payload = {
				"term": request.term,
				"isMatrix": isMatrix,
				"name": isMatrix ? $dlg.find('input[name="grid_name"]').val() : $dlg.find('input[name="field_name"]').val(),
				// TODO - maybe need add value from target dropdown, in case this affect what we do here
			};
			$searchSpinner.addClass('busy');
			config.JSMO.ajax('search', payload)
				.then(searchResult => {
					log('Search result:', searchResult);
					response(searchResult);
				})
				.catch(err => error(err))
				.finally(() => $searchSpinner.removeClass('busy'));
		},
		minLength: 2,
		delay: 0,
		open: function(event, ui) {
			// For some reason, the z-index of the parent dialog keeps shifting up
			const z = '' + (Number.parseInt($dlg.parents('[role="dialog"]').css('z-index') ?? '199') + 1);
			const action = ('' + $searchInput.val()).length == 0 ? 'hide' : 'show';
			$('.ui-autocomplete, .ui-menu-item').css('z-index', z)[action]();
		},
		focus: function(event, ui) {
			return false;
		},
		select: function(event, ui) {
		        log('Autosuggest selected:', ui);
		        
			if (ui.item.value !== '') {
			    $searchInput.val(ui.item.label);
			    document.getElementById("rome-add-button").onclick=function() {
		               updateOntologyActionTag(ui.item);
		            };
			}
			return false;
		}
	})
	.data('ui-autocomplete')._renderItem = function(ul, item) {
		return $("<li></li>")
			.data("item", item)
			.append("<a>"+item.display+"</a>")
			.appendTo(ul);
	};

	//#endregion

	if (isMatrix) {
		// Insert at end of the dialog
		$dlg.append($ui);
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
		$dlg.find('#addFieldForm').prepend('<input type="hidden" name="rome-em-fieldedit-exclude" value="0">');
		// Insert after Action Tags / Field Annotation
		$ui.insertAfter(actiontagsDIV);
	}

}


//#endregion

function performExclusionCheck($dlg, isMatrix) {
	const misc = [];
	$dlg.find(isMatrix ? '[name="addFieldMatrixRow-annotation"]' : '[name="field_annotation"]').each(function() {
		misc.push($(this).val() ?? '');
	});
	if (misc.join(' ').includes(config.atName)) {
		// @ts-ignore REDCap base.js
		simpleDialog(config.JSMO.tt(isMatrix ? 'fieldedit_15' : 'fieldedit_14', config.atName), config.JSMO.tt('fieldedit_13'));
	}
}

function saveMatrixFormExclusion(matrixGroupName, exclude) {
	log('Saving exclusion for matrix group "' + matrixGroupName + '": ', exclude);
	config.JSMO.ajax('set-matrix-exclusion', {
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
		log('Enum updated:', data.enum);
	}
}

//#region Update Ontology Action Tag

function updateOntologyActionTag(item) {
    let actionTagsArea = document.getElementById('field_annotation');
    let actionTags = actionTagsArea.value;
    if  (actionTags.indexOf("@ONTOLOGY='") == -1) {
	actionTagsArea.value = `@ONTOLOGY='${item.value}'`;
    } else {
	let codings = JSON.parse(actionTags.match(/@ONTOLOGY='([^']*)'/)[1] || "[]");
	codings = [... new Set(codings.concat(JSON.parse(item.value)))]; // append and remove duplicates
	actionTagsArea.value = actionTags
	    .replace(/@ONTOLOGY='([^']*)'/,
		     `@ONTOLOGY='${JSON.stringify(codings)}'`);
    }
}

//#endregion    

    

    
//#region Debug Logging

/**
 * Logs a message to the console when in debug mode
 */
function log() {
	if (!config.debug) return;
	var ln = '??';
	try {
		var line = ((new Error).stack ?? '').split('\n')[2];
		var parts = line.split(':');
		ln = parts[parts.length - 2];
	}
	catch(err) { }
	log_print(ln, 'log', arguments);
}
/**
 * Logs a warning to the console when in debug mode
 */
function warn() {
	if (!config.debug) return;
	var ln = '??';
	try {
		var line = ((new Error).stack ?? '').split('\n')[2];
		var parts = line.split(':');
		ln = parts[parts.length - 2];
	}
	catch(err) { }
	log_print(ln, 'warn', arguments);
}

/**
 * Logs an error to the console when in debug mode
 */
function error() {
	var ln = '??';
	try {
		var line = ((new Error).stack ?? '').split('\n')[2];
		var parts = line.split(':');
		ln = parts[parts.length - 2];
	}
	catch(err) { }
	log_print(ln, 'error', arguments);;
}

/**
 * Prints to the console
 * @param {string} ln Line number where log was called from
 * @param {'log'|'warn'|'error'} mode
 * @param {IArguments} args
 */
function log_print(ln, mode, args) {
	var prompt = EM_NAME + ' ' + config.version + ' [' + ln + ']';
	switch(args.length) {
		case 1:
			console[mode](prompt, args[0]);
			break;
		case 2:
			console[mode](prompt, args[0], args[1]);
			break;
		case 3:
			console[mode](prompt, args[0], args[1], args[2]);
			break;
		case 4:
			console[mode](prompt, args[0], args[1], args[2], args[3]);
			break;
		case 5:
			console[mode](prompt, args[0], args[1], args[2], args[3], args[4]);
			break;
		case 6:
			console[mode](prompt, args[0], args[1], args[2], args[3], args[4], args[5]);
			break;
		default:
			console[mode](prompt, args);
			break;
	}
}

//#endregion

})();
