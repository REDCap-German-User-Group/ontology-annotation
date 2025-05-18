// Ontology Made Easy EM
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
			addEditFieldUI($dlg, ob.id == 'addMatrixPopup');
		}
	}

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
		simpleDialog(data.fieldHelpContent, config.moduleDisplayName);
	}
}


//#region Edit Field UI

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
			return descriptor['get'].call(this);
		},
		set(newVal) {
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
	
        // const throttledUISearch = throttle(performUISearch, 200, { leading: false })
        // $('input[data-mlm-config="ui-search"]').on('input change keyup paste click search', function(e) {
        //     const val = ($(e.target).val() ?? '').toString().toLowerCase()
        //     if (val == '') {
        //         performUISearch()
        //     }
        //     else {
        //         throttledUISearch()
        //     }
        // })

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
		// Insert after Action Tags / Field Annotation
		$ui.insertAfter(actiontagsDIV);
	}
	


}


//#endregion

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