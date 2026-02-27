// ROME plugin page UI

/// <reference types="jquery" />
/// <reference path="../typedefs/ROME.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />

// @ts-check
; (function () {
	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';
	const LOGGER = ConsoleDebugLogger.create().configure({
		name: 'ROME Plugin',
		active: true,
		version: '??'
	});
	const { log, warn, error } = LOGGER;

	/** @type {ROMEPluginPublic} */
	// @ts-ignore
	const EM = window[NS_PREFIX + EM_NAME] ?? {
		init: initialize
	};
	// @ts-ignore
	window[NS_PREFIX + EM_NAME] = EM;

	/** @type {ROMEPluginConfig} Configuration data supplied from the server */
	let config = {};
	let initialized = false;
	/** @type {JavascriptModuleObject|null} */
	let JSMO = null;

	/**
	 * Implements the public init method.
	 * @param {ROMEPluginConfig=} config_data
	 * @param {JavascriptModuleObject=} jsmo
	 * @returns {void}
	 */
	function initialize(config_data, jsmo) {
		if (initialized) return;
		config = config_data || {};
		LOGGER.configure({
			active: config.debug,
			version: config.version
		});
		JSMO = jsmo ?? null;

		// Initalize based on plugin page
		$(function () {
			switch (config.page) {
				case 'about':
					break;
				case 'annotate':
					break;
				case 'discover':
					initDiscovery();
					break;
				case 'utilities':
					break;
				case 'export':
					break;
				case 'manage':
					initSourcesManagement();
					break;
				case 'configure':
					initSourcesManagement();
					break;
			}
			initConfigSetters(config.page);
			initialized = true;
			log(`Initialized plugin page (${config.page})`, config);
		});
	}



	//#region Manage / Configure

	function initConfigSetters(page) {
		$('.rome-plugin-page').on('change', '[data-rome-setting]', function (e) {
			const $el = $(e.target);
			const setting = $el.attr('data-rome-setting');
			if (!setting) return;
			const value = $el.is(':checkbox') ? $el.is(':checked') : $el.val();
			JSMO?.ajax('configure', { setting, value })
				.then(function (response) {
					postProcessConfigChange(setting, value);
					log('Configuration updated', { setting, value, response });
				}).catch(function (err) {
					error('Error setting configuration', err);
				});
		});
	}

	/**
	 * Post-process a configuration change.
	 * @param {string} setting The setting that was changed
	 * @param {any} value The new value of the setting
	 */
	function postProcessConfigChange(setting, value) {
		switch (setting) {
			case 'user-toggledarkmode':
				location.reload();
				break;
			case 'sys-javascript-debug':
				config.debug = value;
				LOGGER.configure({
					active: value
				});
				break;
		}
	}

	//#endregion


	//#region Sources Management


	const srcMgmt = {};

	function initSourcesManagement() {

		srcMgmt.modalEl = document.getElementById('romeRemoteSourceModal');
		srcMgmt.formEl = document.getElementById('romeRemoteSourceForm');
		srcMgmt.titleEl = document.getElementById('romeRemoteSourceModalTitle');
		srcMgmt.errEl = document.getElementById('romeRemoteSourceError');

		srcMgmt.typeEl = document.getElementById('rome_remote_type');
		srcMgmt.blockBio = document.getElementById('rome_remote_block_bioportal');
		srcMgmt.blockSnow = document.getElementById('rome_remote_block_snowstorm');

		srcMgmt.bioOntEl = document.getElementById('rome_bioportal_ontology');
		srcMgmt.bioRefreshBtn = document.getElementById('rome_bioportal_refresh');

		srcMgmt.snowAuthEl = document.getElementById('rome_snowstorm_auth_mode');
		srcMgmt.snowBasicUserWrap = document.getElementById('rome_snowstorm_basic_user_wrap');
		srcMgmt.snowBasicPassWrap = document.getElementById('rome_snowstorm_basic_pass_wrap');
		srcMgmt.snowBearerWrap = document.getElementById('rome_snowstorm_bearer_wrap');

		srcMgmt.addRemoteBtn = document.getElementById('rome-add-remote-source');
		srcMgmt.bsModal = new bootstrap.Modal(srcMgmt.modalEl, { backdrop: 'static' });

		function showError(msg) {
			srcMgmt.errEl.textContent = msg;
			srcMgmt.errEl.classList.remove('d-none');
		}
		function clearError() {
			srcMgmt.errEl.textContent = '';
			srcMgmt.errEl.classList.add('d-none');
		}

		function setType(type) {
			if (type === 'snowstorm') {
				srcMgmt.blockBio.classList.add('d-none');
				srcMgmt.blockSnow.classList.remove('d-none');
			} else {
				srcMgmt.blockSnow.classList.add('d-none');
				srcMgmt.blockBio.classList.remove('d-none');
			}
		}

		function setSnowAuthMode(mode) {
			srcMgmt.snowBasicUserWrap.classList.toggle('d-none', mode !== 'basic');
			srcMgmt.snowBasicPassWrap.classList.toggle('d-none', mode !== 'basic');
			srcMgmt.snowBearerWrap.classList.toggle('d-none', mode !== 'bearer');
		}


		async function loadBioportalOntologies({ forceRefresh = false } = {}) {
			if (srcMgmt.ontologiesLoaded && !forceRefresh) return;
			srcMgmt.bioOntEl.innerHTML = `<option value="">Loading…</option>`;
			try {
				const res = await JSMO.ajax('get-bioportal-ontologies', { forceRefresh });
				log('Loaded bioportal ontologies', res);
				const placeholder = res.ontologies.length === 0
					? 'Provide a token and refresh'
					: 'Select an ontology ...';
				srcMgmt.bioOntEl.disabled = res.ontologies.length === 0;
				const select2Data = res.ontologies.map(o => ({
					id: o['@id'],          // stable unique value
					text: o.name,          // fallback
					acronym: o.acronym,
					name: o.name
				}));
				srcMgmt.ontologiesLoaded = res.ontologies.length > 0;
				if (srcMgmt.ontologiesLoaded) {
					$(srcMgmt.bioRefreshBtn).remove();
				}
				$(srcMgmt.bioOntEl).select2({
					width: '80%',
					dropdownParent: srcMgmt.modalEl,
					data: select2Data,
					templateResult: formatOntology,
					templateSelection: formatOntology,
					placeholder: placeholder,
					allowClear: true
				});
			} catch (e) {
				srcMgmt.bioOntEl.innerHTML = `<option value="">(failed to load)</option>`;
				srcMgmt.bioOntEl.disabled = true;
				showError(`BioPortal: failed to load ontology list (${e.message}).`);
			}
		}

		function formatOntology(data) {
			// Placeholder / loading entry
			if (!data.id) return data.text;

			const $container = $('<span>');

			$('<b>')
				.text(data.acronym || '')
				.appendTo($container);

			$container.prepend('[');
			$container.append('] ');

			$('<span>')
				.text(data.name || data.text || '')
				.appendTo($container);

			return $container;
		}

		// very small helper (avoid pulling in libs)
		function escapeHtml(s) {
			return String(s)
				.replaceAll('&', '&amp;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#039;');
		}

		function resetFormForCreate() {
			srcMgmt.formEl.reset();
			$('#rome_source_id').val('');
			clearError();

			setType('bioportal');
			setSnowAuthMode('none');

			// Default title suggestion could be left blank, or set from type later.
		}

		// Public-ish API you can call from your table "Edit" button later
		async function openRemoteSourceDialog(mode, sourceData) {
			resetFormForCreate();

			if (mode === 'edit' && sourceData) {
				srcMgmt.titleEl.textContent = 'Edit a remote source';
				$('#rome_source_id').val(sourceData.id || '');
				$('#rome_remote_type').val(sourceData.remote_type || 'bioportal');
				$('#rome_title').val(sourceData.title || '');
				$('#rome_description').val(sourceData.description || '');

				setType(sourceData.remote_type || 'bioportal');

				if (sourceData.remote_type === 'bioportal') {
					await loadBioportalOntologies({ forceRefresh: false });
					if (sourceData.bioportal_ontology) srcMgmt.bioOntEl.value = sourceData.bioportal_ontology;
				} else {
					$('#rome_snowstorm_base_url').val(sourceData.snowstorm_base_url || '');
					$('#rome_snowstorm_branch').val(sourceData.snowstorm_branch || '');
					srcMgmt.snowAuthEl.value = sourceData.snowstorm_auth_mode || 'none';
					setSnowAuthMode(srcMgmt.snowAuthEl.value);
				}
			} else {
				srcMgmt.titleEl.textContent = 'Add a remote source';
				await loadBioportalOntologies({ forceRefresh: false });
			}

			srcMgmt.bsModal.show();
		};

		// Wire events
		srcMgmt.addRemoteBtn.addEventListener('click', () => {
			openRemoteSourceDialog('create');
		});

		srcMgmt.typeEl.addEventListener('change', async () => {
			clearError();
			setType(srcMgmt.typeEl.value);
			if (srcMgmt.typeEl.value === 'bioportal') {
				await loadBioportalOntologies({ forceRefresh: false });
			}
		});

		srcMgmt.bioRefreshBtn.addEventListener('click', async () => {
			clearError();
			await loadBioportalOntologies({ forceRefresh: true });
		});

		srcMgmt.snowAuthEl.addEventListener('change', () => {
			setSnowAuthMode(srcMgmt.snowAuthEl.value);
		});

		srcMgmt.formEl.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			clearError();

			// Bootstrap validation
			if (!srcMgmt.formEl.checkValidity()) {
				srcMgmt.formEl.classList.add('was-validated');
				return;
			}

			const fd = new FormData(srcMgmt.formEl);
			try {
				const res = await JSMO.ajax('save_remote_source', fd);
				// const data = await res.json(); // expected: { ok: true, source: {...} } or { ok: false, error: "..." }
				// if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

				srcMgmt.bsModal.hide();

				// You’ll plug this into your table refresh logic:
				// - either re-render row from data.source
				// - or do a full reload of sources table
				refreshSourcesTable(res);
			} catch (e) {
				showError(e.message);
			}
		});
	}

	function refreshSourcesTable(src) {
		log('Refreshing sources table', src);
	}


	//#endregion


	//#region Discover

	/** @type {DiscoveryState} */
	const ds = {};

	function initDiscovery() {
		JSMO?.ajax('discover', {})
			.then(function (response) {
				ds.data = response;
				log('Received discover info: ', ds.data);
				if (!Array.isArray(ds.data.fields)) ds.data.fields = [];
				if (!ds.data.projects) ds.data.projects = {};
				const options = ds.data.fields.map((field, idx) => ({
					'id': idx,
					'title': `${field.display} [${field.system}: ${field.code}], n=${field.projects.length}`
				}));
				if (ds.data.fields.length == 0) {
					$('#rome-matching-projects-message').hide();
					$('.rome-discover-select-waiter').text('No ontology annotations found in any projects.').addClass('rome-no-annotations red mb-2');
					$('#rome-discover-select').prop('disabled', true);
					updateDiscoveredProjectsTable();
				}
				else {
					const settings = {
						'options': options,
						'valueField': 'id',
						'onChange': updateDiscoveredProjectsTable,
						'labelField': 'title',
						'searchField': 'title'
					};
					// @ts-ignore
					ds.TS = new window.TomSelect('#rome-discover-select', settings);
				}
				if (ds.data) {
					$('.rome-discover-project-count').text(Object.keys(ds.data.projects).length);
				}
			})
			.catch(function (err) {
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
