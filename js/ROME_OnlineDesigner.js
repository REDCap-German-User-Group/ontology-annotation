// Ontology Made Easy EM - Online Designer Integration

/// <reference types="jquery" />
/// <reference types="jqueryui" />
/// <reference path="./ROME.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />

// @ts-check
;(function() {

//#region Init global object and define local variables

const EM_NAME = 'ROME';
const NS_PREFIX = 'DE_RUB_';
const LOGGER = ConsoleDebugLogger.create().configure({
	name: EM_NAME,
	active: true,
	version: '??'
});
const { log, warn, error } = LOGGER;

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
 * @param {ROMEOnlineDesignerConfig=} config_data
 * @param {JavascriptModuleObject=} jsmo
 */
function initialize(config_data, jsmo = null) {
	config = config_data;
	config.JSMO = jsmo;
	LOGGER.configure({ active: config.debug, name: 'ROME Online Designer', version: config.version });

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
        updateAnnotationTable();
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
    	const throttledSearch = throttle(function(request, response) {
		const payload = {
			"term": request.term,
			"isMatrix": isMatrix,
			"name": isMatrix ? $dlg.find('input[name="grid_name"]').val() : $dlg.find('input[name="field_name"]').val(),
			// TODO - maybe need add value from target dropdown, in case this affect what we do here
		};
		$searchSpinner.addClass('busy');
		log('Search request:', payload);
		config.JSMO.ajax('search', payload)
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
                // initial sync from the action tag
	        updateAnnotationTable()
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
    updateFieldChoices()
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
    let annotation = getOntologyAnnotation() || {};
    let itemCode = JSON.parse(item.value).code
    if (annotation.dataElement) {
	if (field == "dataElement") {
	    annotation.dataElement.coding = [... new Set((annotation.dataElement.coding || []).concat(itemCode))]; // append and remove duplicates
	} else {
	    if (!annotation.dataElement.valueCodingMap) {
		annotation.dataElement.valueCodingMap = {}
	    }
	    if (!annotation.dataElement.valueCodingMap[field]) {
		annotation.dataElement.valueCodingMap[field] = {coding: []}
	    }
	    annotation.dataElement.valueCodingMap[field].coding =
		[... new Set((annotation.dataElement.valueCodingMap[field].coding).concat(itemCode))]
	}
    } else {
	if (field == "dataElement") {
	    annotation.dataElement = {coding: [JSON.parse(item.value).code]}
	} else {
	    annotation.dataElement = {coding: [], valueCodingMap: {}}
	    annotation.dataElement.valueCodingMap[field]= {coding: [JSON.parse(item.value).code]}
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
    updateFieldChoices()
}

function updateActionTag(newvalue) {
    let actionTagsArea = document.getElementById('field_annotation')
    actionTagsArea.value = actionTagsArea.value
	.replace(/@ONTOLOGY='([^']*)'/,
		 `@ONTOLOGY='${JSON.stringify(newvalue, null, 2)}'`)
}
    
function deleteOntologyAnnotation(system, code, field) {
    let annotation = getOntologyAnnotation();
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

function extractOntologyJSON(text) {
	const name = config.atName;
	const startIdx = text.indexOf(name);
	if (startIdx === -1) return null;

	const afterEquals = text.slice(startIdx + name.length);
	const eqMatch = afterEquals.match(/^\s*=\s*/);
	if (!eqMatch) return null;

	let jsonStart = startIdx + name.length + eqMatch[0].length;
	let braceCount = 0;
	let inString = false;
	let escapeNext = false;
	let endIdx = -1;

	for (let i = jsonStart; i < text.length; i++) {
		const char = text[i];

		if (inString) {
			if (escapeNext) {
				escapeNext = false;
			} else if (char === '\\') {
				escapeNext = true;
			} else if (char === '"') {
				inString = false;
			}
		} else {
			if (char === '"') {
				inString = true;
			} else if (char === '{') {
				if (braceCount === 0) jsonStart = i;
				braceCount++;
			} else if (char === '}') {
				braceCount--;
				if (braceCount === 0) {
					endIdx = i + 1;
					break;
				}
			}
		}
	}

	if (braceCount !== 0 || endIdx === -1) {
		console.error("Unbalanced braces in JSON");
		return null;
	}

	const jsonText = text.slice(jsonStart, endIdx);
	try {
		return JSON.parse(jsonText);
	} catch (e) {
	    console.error(`Failed to parse JSON (${jsonText}):`, e);
		return null;
	}
}

function getOntologyAnnotation() {
	const content = $('#field_annotation').val() ?? '';
	return extractOntologyJSON(content);
}
    

function updateFieldChoices() {
    let choices = [["dataElement", "Field"]];
    let choicesDict = {"dataElement": true}
    if (data.enum) {
	for(line of data.enum?.split("\n")) {
	    let code, rest;
	    [code, ...rest] = line.split(",")
	    if (rest) {
		rest = rest.join(",")
	    }
	    choices.push([code, rest])
	    choicesDict[code] = true
	}
    }
    $("#rome-field-choice").html(choices.map(c => `<option value="${c[0]}">${c[1]}</option>`).join(""))

    $(".rome-option-field").each(function(i, elem) {
	let selected = elem.dataset.romeSelected
	let system = elem.dataset.romeSystem
	let code = elem.dataset.romeCode
	let display = choices.length <= 1 ? 'display:"none"' : ''
	let choiceError=""
	if (!choicesDict[selected]) {
	    choiceError = `<option value="${selected}" style="background-color: red;">❓❓ ${selected} ❓❓</option>`
	}
	elem.innerHTML = `<select ${display} class="form-select" id="rome-selectfield-${i}">` + choiceError + 
		  choices.map(c => `<option value="${c[0]}" ${c[0] == selected ? 'selected' : ''}>${c[1]}</option>`).join("") +
	    `</select>`
	$(elem).on('change', function(event) {
	    event.stopImmediatePropagation()
	    let annotation = getOntologyAnnotation()
	    if (!annotation.dataElement) {
		annotation.dataElement = {"coding": []}
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
		    valueCodingMap[newValue]={"coding": []}
		}
		valueCodingMap[newValue].coding = [... new Set((valueCodingMap[newValue].coding).concat({"code": code, "system": system}))]
	    } else if (newValue == "dataElement") {
		valueCodingMap[oldValue].coding = valueCodingMap[oldValue].coding.filter(value => (!((value.system == system) && (value.code == code))))
		annotation.dataElement.coding = [... new Set((items).concat({"code": code, "system": system}))]
	    } else {
		if (!valueCodingMap[newValue]) {
		    valueCodingMap[newValue] = {"coding": []}
		}
		valueCodingMap[newValue].coding = [... new Set((valueCodingMap[newValue].coding).concat({"code": code, "system": system}))]
		valueCodingMap[oldValue].coding = valueCodingMap[oldValue].coding.filter(value => (!((value.system == system) && (value.code == code))))
	    }
	    annotation.dataElement.valueCodingMap = valueCodingMap
	    updateActionTag(annotation)
	})
	    
    })
}
    

function updateAnnotationTable() {
    // use the ontology annotation action tag to set the annotation table
    console.log("ENTER UAT")
    let annotation = getOntologyAnnotation()
    let items = annotation.dataElement?.coding
    let valueCodingMap = annotation.dataElement?.valueCodingMap
    let values = []
    if (valueCodingMap) {
	for (const [key, value] of Object.entries(valueCodingMap)) {
	    console.log("xUAT: Coding key " + key);
	    (value.coding || []).forEach(c => values = values.concat({field: key, ...c}))
	}
    }
    if (items.length == 0 && values.length == 0) {
	$(".rome-edit-field-ui-list").hide()
	$(".rome-edit-field-ui-list-empty").show()
	return;
    }
    $(".rome-edit-field-ui-list-empty").hide()
    let knownLinks={"http://snomed.info/sct": "https://bioportal.bioontology.org/ontologies/SNOMEDCT?p=classes&conceptid=",
		    "http://loinc.org" : "https://loinc.org/"}
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

    updateFieldChoices()
	
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
	const later = function() {
		previous = options.leading === false ? 0 : Date.now();
		timeout = null;
		result = func.apply(context, args);
		if (!timeout) context = args = null;
	};
	return function() {
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
