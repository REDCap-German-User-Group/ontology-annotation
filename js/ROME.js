// ROME plugin page UI

/// <reference types="jquery" />
/// <reference path="./ROME.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />

// @ts-check
; (function () {
	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';
	const LOGGER = ConsoleDebugLogger.create().configure({
		name: EM_NAME,
		active: true,
		version: '??'
	});
	const { log, warn, error } = LOGGER;

	/** @type {ROMEPublic} */
	// @ts-ignore
	const EM = window[NS_PREFIX + EM_NAME] ?? {
		init: initialize
	};
	// @ts-ignore
	window[NS_PREFIX + EM_NAME] = EM;

	/** @type {ROMEConfig} Configuration data supplied from the server */
	let config = {};
	let initialized = false;
	/** @type {JavascriptModuleObject|null} */
	let JSMO = null;

	/**
	 * Implements the public init method.
	 * @param {ROMEConfig=} config_data
	 */
	function initialize(config_data) {
		if (initialized) return;
		config = config_data || {};
		LOGGER.configure({
			active: config.debug,
			version: config.version
		});
		if (typeof config.jsmoName === 'string') {
			JSMO = config.jsmoInstance = getGlobalByName(config.jsmoName);
		}
		// Initalize based on plugin page
		switch(config.plugin) {
			case 'discover':
				$(function() {
					initDiscovery();
				});
				break;
		}
		initialized = true;
		log(`Initialized ${config.moduleDisplayName} ...`, config);
	}



	//#region Discover

	/** @type {DiscoveryState} */
	const ds = {};

	function initDiscovery() {
		JSMO?.ajax('discover', {})
		.then(function(response) {
			ds.data = JSON.parse(response);
			log('Received discover info: ', ds.data);
			const options = ds.data.fields.map((field, idx) => ({
				'id': idx,
				'title': `${field.display} [${field.system}: ${field.code}], n=${field.projects.length}`
			}));
			const settings = {
				'options': options,
				'valueField': 'id',
				'onChange': updateDiscoveredProjectsTable,
				'labelField': 'title',
				'searchField': 'title'
			};
			// @ts-ignore
			ds.TS = new window.TomSelect('#rome-discover-select', settings);
			if (ds.data) {
				$('.rome-discover-project-count').text(Object.keys(ds.data.projects).length);
			}
		})
		.catch(function(err) {
			console.error('Error requesting ROME info', err);
		});
	}
	
	function updateDiscoveredProjectsTable() {
		if (!ds.data) return;
		if (!ds.TS || ds.TS.getValue().length == 0) {
			$("#resulttable").html("<i>Nothing to show.</i>");
			return;
		}
		const values = ds.TS.getValue();

		const fieldnamesForProject = (/** @type Number */ pid) => values
			.filter(i => ds.data.fields[i].field_names[pid])
			.map(i => `${ds.data.fields[i].display}: ${ds.data.fields[i].field_names[pid]}`)
			.join('<br>');
		const formatProjectId = (/** @type Number */ pid) => config.isAdmin && pid != config.pid 
			? `<a href="${window['app_path_webroot']}index.php?pid=${pid}" target="_blank">${pid}</a>`
			: `${pid}`;

		const sets = values.map(field_index => (new Set(ds.data.fields[field_index].projects)));
		let project_ids = sets.pop() || new Set();
		while (project_ids.size > 0 && sets.length > 0) {
			project_ids = project_ids.intersection(sets.pop());
		}
		// Build table
		const html = 
			`<table class="table">
				<thead>
					<tr>
						<th>PID</th><th>Project Name</th><th>Contact</th><th>Email</th><th>Fields</th>
					</tr>
				</thead>
				<tbody>` + [...project_ids].map(project_id => 
					`<tr>
						<td>${formatProjectId(project_id)}</td>
						<td>${ds.data.projects[project_id].app_title}</td>
						<td>${ds.data.projects[project_id].contact}</td>
						<td>${ds.data.projects[project_id].email}</td>
						<td>${fieldnamesForProject(project_id)}</td>
					</tr>`).join('') +
				`</tbody>
			</table>`;
		$("#resulttable").html(html);
	}

	//#endregion


	//#region Misc Helpers

	/**
	 * Resolve a global object by dotted name, e.g.
	 * "ExternalModules.DE.RUB.OntologiesMadeEasyExternalModule"
	 *
	 * @param {string} path
	 * @returns {JavascriptModuleObject|null} The resolved object or null if not reachable
	 */
	function getGlobalByName(path) {
		let obj = window || {};
		for (const key of path.split('.')) {
			if (obj && key in obj) {
				// @ts-ignore
				obj = obj[key];
			} else {
				console.warn(`Cannot resolve path "${path}". Missing "${key}" on`, obj);
				return null;
			}
		}
		// @ts-ignore
		return obj;
	}

	//#endregion

})();
