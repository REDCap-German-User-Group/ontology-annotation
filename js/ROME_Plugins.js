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

	/** @type {Object} */
	let dtInstance;

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
					initRemoteSourcesManagement();
					initLocalSourcesManagement();
					initSourcesTable();
					break;
				case 'configure':
					initRemoteSourcesManagement();
					initLocalSourcesManagement();
					initSourcesTable();
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

	function initRemoteSourcesManagement() {

		let ontologiesLoaded = false;
		let rcBioPortalTokenAvailable = false;

		const $modalEl = $('#romeRemoteSourceModal');
		const $titleEl = $('#romeRemoteSourceModalTitle');
		const $errEl = $('#romeRemoteSourceError');

		const $typeEl = $('#rome_remote_type');
		const $blockBio = $('#rome_remote_block_bioportal');
		const $blockSnow = $('#rome_remote_block_snowstorm');

		const $bioOntEl = $('#rome_bioportal_ontology');
		const $bioOntTokenEl = $('#rome_bioportal_token');
		const $bioRefreshBtn = $('#rome_bioportal_refresh');

		const $snowAuthEl = $('#rome_snowstorm_auth_mode');
		const $snowBasicUserWrap = $('#rome_snowstorm_basic_user_wrap');
		const $snowBasicPassWrap = $('#rome_snowstorm_basic_pass_wrap');
		const $snowBearerWrap = $('#rome_snowstorm_bearer_wrap');
		const $snowRefreshBtn = $('#rome_snowstorm_branch_refresh');
		const $snowBranchesEl = $('#rome_snowstorm_branches');

		const bsModal = new bootstrap.Modal($modalEl.get(0), { backdrop: 'static' });

		$modalEl.on('hide.bs.modal', function () {
			$(document.activeElement).trigger('blur');
		});

		function showError(msg) {
			$errEl.text(msg);
			$errEl.removeClass('d-none');
		}
		function clearError() {
			$errEl.text('');
			$errEl.addClass('d-none');
		}

		function setType(type) {
			if (type === 'snowstorm') {
				$blockBio.addClass('d-none');
				$blockSnow.removeClass('d-none');
			} else {
				$blockSnow.addClass('d-none');
				$blockBio.removeClass('d-none');
			}
		}

		function setSnowAuthMode(dataOrMode) {
			const mode = typeof dataOrMode === 'string' ? dataOrMode : dataOrMode.snowstorm_auth_mode;
			if (typeof dataOrMode === 'object') {
				$('#rome_snowstorm_basic_user').val(dataOrMode.snowstorm_basic_user ?? '');
				$('#rome_snowstorm_basic_pass').val(dataOrMode.snowstorm_basic_pass ?? '');
				$('#rome_snowstorm_bearer_token').val(dataOrMode.snowstorm_bearer_token ?? '');
			}
			$snowBasicUserWrap.toggleClass('d-none', mode !== 'basic');
			$snowBasicPassWrap.toggleClass('d-none', mode !== 'basic');
			$snowBearerWrap.toggleClass('d-none', mode !== 'bearer');
		}


		async function loadBioportalOntologies({ forceRefresh = false } = {}) {
			if (ontologiesLoaded && !forceRefresh) return;
			$bioOntEl.html('<option value="">Loading…</option>');
			try {
				const res = await JSMO.ajax('get-bioportal-ontologies', {
					forceRefresh: forceRefresh,
					token: $bioOntTokenEl.val() ?? null
				});
				log('Loaded bioportal ontologies', res);
				if (res.error) throw res.error;
				const placeholder = res.ontologies.length === 0
					? 'Provide a token and refresh'
					: 'Select an ontology ...';
				$bioOntEl.prop('disabled', res.ontologies.length === 0);
				const select2Data = res.ontologies.map(o => ({
					id: o['@id'],          // stable unique value
					text: o.name,          // fallback
					acronym: o.acronym,
					name: o.name
				}));
				ontologiesLoaded = res.ontologies.length > 0;
				if (ontologiesLoaded) {
					$bioRefreshBtn.remove();
					rcBioPortalTokenAvailable = res.rc_enabled;
				}
				$bioOntEl.select2({
					width: '80%',
					dropdownParent: $modalEl[0],
					data: select2Data,
					templateResult: formatOntology,
					templateSelection: formatOntology,
					placeholder: placeholder,
					allowClear: false
				});
			} catch (e) {
				$bioOntEl.html(`<option value="">(failed to load)</option>`);
				$bioOntEl.prop('disabled', true);
				showError(`BioPortal: failed to load ontology list (${e}).`);
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

		function resetFormForCreate() {
			$modalEl.find('[data-rome-reset]').each(function () {
				const $this = $(this);
				$this.val($this.attr('data-rome-reset')).trigger('change');
			});
			$snowBranchesEl.html('').trigger('change');
			$($bioOntEl).val('').trigger('change');

			$('#rome_source_id').val('');
			clearError();

			setType('bioportal');
			setSnowAuthMode({ snowstorm_auth_mode: 'none' });
		}

		async function openRemoteSourceDialog(mode, sourceData) {
			resetFormForCreate();

			if (mode === 'edit' && sourceData) {
				$titleEl.text('Edit a remote source');
				$('#rome_source_id').val(sourceData.id || '');
				$('#rome_remote_type').val(sourceData.remote_type || 'bioportal');
				$('#rome_title').val(sourceData.title || '');
				$('#rome_description').val(sourceData.description || '');

				setType(sourceData.remote_type || 'bioportal');

				if (sourceData.remote_type === 'bioportal') {
					await loadBioportalOntologies({ forceRefresh: false });
					if (sourceData.bioportal_ontology) $bioOntEl.val(sourceData.bioportal_ontology).trigger('change');
				} else {
					$('#rome_snowstorm_base_url').val(sourceData.snowstorm_base_url || '');
					$('#rome_snowstorm_branch').val(sourceData.snowstorm_branch || '').trigger('change');
					$snowAuthEl.val(sourceData.snowstorm_auth_mode || 'none');
					setSnowAuthMode(sourceData);
				}
			} else {
				$titleEl.text('Add a remote source');
				await loadBioportalOntologies({ forceRefresh: false });
			}

			bsModal.show();
		};

		// Wire events
		$('#rome-add-remote-source').on('click', () => {
			openRemoteSourceDialog('create');
		});

		$typeEl.on('change', async () => {
			clearError();
			setType($typeEl.val());
			if ($typeEl.val() === 'bioportal') {
				await loadBioportalOntologies({ forceRefresh: false });
			}
		});

		$bioRefreshBtn.on('click', async () => {
			clearError();
			await loadBioportalOntologies({ forceRefresh: true });
		});

		$snowAuthEl.on('change', () => {
			setSnowAuthMode(`${$snowAuthEl.val()}`);
		});

		$snowRefreshBtn.on('click', async () => {
			clearError();
			await loadSnowStormBranches();
		});

		// Save
		$('#romeRemoteSourceSaveBtn').on('click', async function (ev) {
			ev.preventDefault();
			clearError();

			// Assemble payload
			const type = `${$typeEl.val()}`;
			const payload = {
				title: `${$('#rome_title').val()}`.trim(),
				description: `${$('#rome_description').val()}`.trim(),
				type: type
			};
			if (type === 'snowstorm') {
				payload.ss_baseurl = `${$('#rome_snowstorm_base_url').val() ?? ''}`.trim();
				payload.ss_branch = $('#rome_snowstorm_branches').val() ?? '';
				payload.ss_auth = `${$('#rome_snowstorm_auth_mode').val() ?? ''}`.trim();
				payload.ss_username = `${$('#rome_snowstorm_basic_user').val() ?? ''}`.trim();
				payload.ss_password = `${$('#rome_snowstorm_basic_pass').val() ?? ''}`.trim();
				payload.ss_token = `${$('#rome_snowstorm_bearer').val() ?? ''}`.trim();
			}
			else if (type === 'bioportal') {
				payload.bp_token = `${$('#rome_bioportal_token').val() ?? ''}`.trim();
				payload.bp_ontology = `${$('#rome_bioportal_ontology').val() ?? ''}`.trim();
			}
			if (payload.type === 'bioportal') {
				if (!payload.bp_ontology) {
					showError('Ontology is required');
					return;
				}
				if (!rcBioPortalTokenAvailable && !payload.bp_token) {
					showError('BioPortal token is required');
					return;
				}
			}
			else if (payload.type === 'snowstorm') {
				if (!payload.ss_baseurl) {
					showError('Snowstorm API base URL is required');
					return;
				}
				if (!payload.ss_branch) {
					showError('Snowstorm branch is required');
					return;
				}
				if (payload.ss_auth === 'basic') {
					if (!payload.ss_username || !payload.ss_password) {
						showError('Snowstorm username and password are required for basic auth');
						return;
					}
				}
				else if (payload.ss_auth === 'bearer') {
					if (!payload.ss_token) {
						showError('Snowstorm bearer token is required');
						return;
					}
				}
			}
			else {
				showError('Invalid source type');
				return;
			}

			// Save
			try {
				$('#romeRemoteSourceSaveBtn').prop('disabled', true);
				const res = await JSMO.ajax('save-remote-source', payload);
				if (res.error) throw `Failed to save remote source: ${res.error}`;
				$(document.activeElement).trigger('blur');
				bsModal.hide();
				refreshSourcesTable(res);
			}
			catch (e) {
				showError(`${e}`);
			}
			finally {
				$('#romeRemoteSourceSaveBtn').prop('disabled', false);
			}
		});


		async function loadSnowStormBranches() {

			$snowBranchesEl.html(`<option value="">Loading…</option>`);
			$snowRefreshBtn.prop('disabled', true);

			const payload = {};
			payload.ss_baseurl = `${$('#rome_snowstorm_base_url').val() ?? ''}`.trim();
			payload.ss_branch = `${$('#rome_snowstorm_branch').val() ?? ''}`.trim();
			payload.ss_auth = `${$('#rome_snowstorm_auth_mode').val() ?? ''}`.trim();
			payload.ss_username = `${$('#rome_snowstorm_basic_user').val() ?? ''}`.trim();
			payload.ss_password = `${$('#rome_snowstorm_basic_pass').val() ?? ''}`.trim();
			payload.ss_token = `${$('#rome_snowstorm_bearer').val() ?? ''}`.trim();

			try {
				const res = await JSMO.ajax('get-snowstorm-branches', payload);
				log('Loaded Snowstorm branches', res);
				if (res.error) throw res.error;
				const placeholder = res.branches.length === 0
					? 'Refresh to load branches ...'
					: 'Select a branch ...';
				$snowBranchesEl.prop('disabled', res.branches.length === 0);
				const select2Data = res.branches.map(o => ({
					id: o,
					text: o
				}));
				$snowBranchesEl.select2({
					width: '80%',
					dropdownParent: $modalEl[0],
					data: select2Data,
					placeholder: placeholder,
					allowClear: true
				});
				if (select2Data.length > 0) {
					$snowBranchesEl.val(select2Data[0].id).trigger('change');
				}
			} catch (e) {
				$snowBranchesEl.html(`<option value="">(failed to load)</option>`);
				showError(`Snowstorm: failed to load branches (${e}).`);
			} finally {
				$snowRefreshBtn.prop('disabled', false);
			}
		}

	}


	function initLocalSourcesManagement() {

		const $modalEl = $('#romeLocalSourceModal');
		const $titleEl = $('#romeLocalSourceModalTitle');
		const $errEl = $('#romeLocalSourceError');
		let localSourceFileContent = '';
		let localSourceFileName = '';


		const bsModal = new bootstrap.Modal($modalEl.get(0), { backdrop: 'static' });

		$modalEl.on('hide.bs.modal', function () {
			$(document.activeElement).trigger('blur');
		});

		function showError(msg) {
			$errEl.text(msg);
			$errEl.removeClass('d-none');
		}

		function clearError() {
			$errEl.text('');
			$errEl.addClass('d-none');
		}

		function resetFormForCreate() {
			$modalEl.find('[data-rome-reset]').each(function () {
				const $this = $(this);
				$this.val($this.attr('data-rome-reset')).trigger('change');
			});

			$('#rome_local_source_id').val('');
			$('#rome-file-input').val('');
			localSourceFileContent = '';
			localSourceFileName = '';
			$('#rome-file-info').text('No file selected. Please upload a file.');
			clearError();
		}

		async function openLocalSourceDialog(mode, sourceData) {
			resetFormForCreate();
			if (mode === 'edit' && sourceData) {
				$titleEl.text('Edit a local source');
				$('#rome_local_source_id').val(sourceData.id || '');
				$('#rome_local_title').val(sourceData.title || '');
				$('#rome_local_description').val(sourceData.description || '');
			} else {
				$titleEl.text('Add a local source');
			}
			bsModal.show();
		};

		// Wire events
		$('#rome-add-local-source').on('click', () => {
			openLocalSourceDialog('create');
		});

		$('#rome-file-input').on('change', async function (ev) {
			// Get file info
			const $fi = $(this);
			const files = $fi.prop('files');
			if (!files || ((files?.length ?? 0) === 0)) {
				localSourceFileContent = '';
				localSourceFileName = '';
				$('#rome-file-info').text('No file selected. Please upload a file.');
				return;
			}

			$fi.prop('disabled', true);
			const file = files[0];
			try {
				const fileText = await file.text();
				const json = JSON.parse(fileText);
				$('#rome-title-from-file').text(json.title ?? '');
				$('#rome-description-from-file').text(json.description ?? '');
				localSourceFileContent = fileText;
				localSourceFileName = file.name;
				$('#rome-file-info').text(localSourceFileName)
					.append(`<i class="fa-solid fa-check text-success ms-2"></i>`);

				clearError();
			} catch (e) {
				localSourceFileContent = '';
				localSourceFileName = '';
				$fi.val('');
				$('#rome-file-info').text('Invalid JSON file. Please upload a valid JSON file.')
					.append(`<i class="fa-solid fa-circle-xmark text-danger ms-2"></i>`);
				showError('Uploaded file is not valid JSON.');
			}
			finally {
				$fi.prop('disabled', false);
			}
		});

		// Save
		$('#romeLocalSourceSaveBtn').on('click', async function (ev) {
			ev.preventDefault();
			clearError();

			// Assemble payload
			const payload = {
				title: `${$('#rome_local_title').val()}`.trim(),
				description: `${$('#rome_local_description').val()}`.trim(),
				fileContent: localSourceFileContent,
				fileName: localSourceFileName,
				context: config.page
			};
			// Validation
			if (payload.fileContent === '' || payload.fileName === '') {
				showError('A file is required');
				return;
			}

			// Save
			try {
				$modalEl.find('input, textarea').prop('disabled', true);
				$('#romeLocalSourceSaveBtn').prop('disabled', true);
				const res = await JSMO.ajax('save-local-source', payload);
				if (res.error) throw `Failed to save local source: ${res.error}`;
				bsModal.hide();
				refreshSourcesTable(res);
			}
			catch (e) {
				showError(`${e}`);
			}
			finally {
				$modalEl.find('input, textarea').prop('disabled', false);
				$('#romeLocalSourceSaveBtn').prop('disabled', false);
			}
		});
	}

	function initSourcesTable() {

		const data = config.sources ?? [];
		const $table = $('#rome-sources');
		const adv = data.length > 10;

		//#region Datatable
		dtInstance = $table.DataTable({
			autoWidth: true,
			data: data,
			columns: [
				{
					data: null,
					render: (_data, type, row) => {
						if (type === 'sort' || type === 'type') {
							return row.type;
						}
						return renderTypeColumn(row);
					}
				},
				{
					data: null,
					render: (_data, type, row) => {
						if (type === 'sort' || type === 'type') {
							return row.enabled ? 'enabled' : 'disabled';
						}
						return renderEnabledColumn(row);
					}
				},
				{
					data: null,
					render: (_data, type, row) => {
						if (type === 'sort' || type === 'type') {
							return `${row.title_resolved} ${row.description_resolved}`;
						}
						return renderTitleColumn(row);
					}
				},
				{
					data: null,
					searchable: false,
					render: (_data, type, row) => {
						if (type === 'sort' || type === 'type') {
							return row?.item_count ?? 0;
						}
						return renderStatsColumn(row);
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
				emptyTable: 'No sources found.'
			},
			paging: adv,
			searching: adv,
			info: adv,
			lengthChange: false,
			pageLength: 10,
			order: [[2, 'asc']],
			createdRow: (rowEl, rowData) => {
				$(rowEl).data('source-entry', rowData);
			}
		});


		/**
		 * Renders "Type" column cell content.
		 * @param {Object} row
		 * @returns {string}
		 */
		function renderTypeColumn(row) {
			let s = '';
			if (row.type === 'local') {
				s = '<i class="fa-solid fa-database text-muted"></i>';
			}
			else {
				s = '<i class="fa-solid fa-cloud text-muted"></i>';
			}
			if (row?.kind === 'fhir_questionnaire') {
				s += '<i class="fa-solid fa-fire fa-sm ms-1 text-warning"></i>';
			}
			if (row?.from_system ?? false) {
				s += '<i class="fa-solid fa-hard-drive fa-sm ms-1 text-info"></i>';
			}
			return s;
		}

		/**
		 * Renders "Enabled" column cell content.
		 * @param {Object} row
		 * @returns {string}
		 */
		function renderEnabledColumn(row) {
			const enabled = (row?.enabled ?? false) === true;
			return `
				<div class="form-check form-switch text-success">
					<input class="form-check-input" type="checkbox" role="switch" data-source="${row.key}" data-action="toggle-enabled" ${enabled ? 'checked' : ''}></input>
				</div>`;
		}

		/**
		 * Renders "Title/Description" column cell content.
		 * @param {Object} row
		 * @returns {string}
		 */
		function renderTitleColumn(row) {
			return `
				<div class="rome-source-title">${escapeHTML(row.title_resolved)}</div>
				<div class="rome-source-description">${escapeHTML(row.description_resolved)}</div>
			`;
		}

		/**
		 * Renders "Stats" column cell content.
		 * @param {Object} row
		 * @returns {string}
		 */
		function renderStatsColumn(row) {
			let s = '';
			if (row.item_count) {
				s += `Items: ${row.item_count}`
			}
			if (typeof row.system_counts === 'object') {
				s += `<br/>Systems: ${Object.keys(row.system_counts).length}`;
			}
			return `<div class="rome-source-stats">${s ? s : '&mdash;'}</div>`;
		}

		/**
		 * Renders "Action" column cell content.
		 * @param {Object} row
		 * @returns {string}
		 */
		function renderActionColumn(row) {
			const delBtn = `
				<button type="button" class="btn btn-sm btn-link text-danger p-0" title="Delete this source" data-source="${row.key}" data-action="delete"><i class="fa fa-trash-alt"></i></button>`;
			const editBtn = `
				<button type="button" class="btn btn-sm btn-link text-secondary p-0 me-2" title="Edit this source" data-source="${row.key}" data-action="edit"><i class="fa fa-pencil"></i></button>`;
			
			return editBtn + delBtn;
		}
		//#endregion DataTable
	
		// Events
		$table.off('click change').on('click change', '[data-action]', function (e) {
			const $el = $(this);
			const action = $el.attr('data-action');
			if (action == 'toggle-enabled' && e.type === 'click') return;
			const key = $el.attr('data-source');
			log('Source action',  { action, key });

			// TODO - act
		});
	}



	function refreshSourcesTable(source) {
		// Remove existing entry from config.sources (identify by key)
		config.sources = config.sources.filter(s => s.key !== source.key);
		config.sources.push(source);
		log('Refreshing sources table', source);
		dtInstance.clear().rows.add(config.sources).draw();
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

	//#endregion

})();
