// ROME plugin page UI

/// <reference types="jquery" />
/// <reference path="../typedefs/ROME_Plugins.typedef.js" />
/// <reference path="../typedefs/JSMO.typedef.js" />
/// <reference path="./ConsoleDebugLogger.js" />

// @ts-check
; (function () {
	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';
	const romeWindow = /** @type {ROMEWindow} */ (window);
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

	/** @type {MinimalDataTableApi|null} */
	let dtInstance = null;
	/** @type {(source: PluginSourceInfo) => void} */
	let editRemoteSource = () => {};
	/** @type {(source: PluginSourceInfo, file: SourceFileInfo) => void} */
	let editLocalSource = () => {};
	/** @type {(source: PluginSourceInfo) => void} */
	let editSystemSource = () => {};
	/** @type {ExportResult|null} */
	let lastExport = null;
	let exportPending = false;

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
					initExport();
					break;
				case 'manage':
					initRemoteSourcesManagement();
					initLocalSourcesManagement();
					initSystemSourcesManagement();
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

	/**
	 * @returns {JavascriptModuleObject}
	 */
	function getJSMO() {
		if (!JSMO) throw new Error('JSMO is not available for this ROME plugin page.');
		return JSMO;
	}

	/**
	 * @param {JQuery<HTMLElement>} $el
	 * @returns {HTMLElement}
	 */
	function requireElement($el) {
		const el = $el.get(0);
		if (!el) throw new Error('Required ROME plugin element is missing.');
		return el;
	}

	function blurActiveElement() {
		const active = document.activeElement;
		if (active instanceof HTMLElement) active.blur();
	}



	//#region Export

	function initExport() {
		const exportConfig = config.export || {};
		const metadataState = exportConfig.defaultMetadataState || 'production';

		const $forms = $('#rome-export-forms');
		const $download = $('#rome-export-download');

		if (romeWindow.TomSelect && $forms.length) {
			new romeWindow.TomSelect('#rome-export-forms', {
				plugins: ['remove_button'],
				valueField: 'value',
				labelField: 'text',
				searchField: 'text',
				hideSelected: true,
				onChange: () => refreshExportStatus(),
			});
		}

		$forms.on('change', () => refreshExportStatus());
		$('input[name="rome-export-metadata-state"]').on('change', function () {
			populateExportFormsForState(getSelectedExportMetadataState());
			renderExportMessages({ errors: [], warnings: [] });
		});
		$('#rome-export-add-all').on('click', selectAllExportForms);
		$('#rome-export-clear-all').on('click', clearExportForms);
		$download.on('click', runExportDownload);
		populateExportFormsForState(getSelectedExportMetadataState() || metadataState);
	}

	/**
	 * @returns {string}
	 */
	function getSelectedExportMetadataState() {
		return `${$('input[name="rome-export-metadata-state"]:checked').val() || $('input[name="rome-export-metadata-state"]').val() || config.export?.defaultMetadataState || 'production'}`;
	}

	/**
	 * @returns {string}
	 */
	function getSelectedExportFormat() {
		return `${$('input[name="rome-export-format"]:checked').val() || 'native_rome'}`;
	}

	/**
	 * @param {string} state
	 * @returns {ExportFormInfo[]}
	 */
	function getExportFormsForState(state) {
		const exportConfig = config.export || {};
		const stateConfig = exportConfig.states?.[state] || {};
		if (Array.isArray(stateConfig.forms)) return stateConfig.forms;
		if (state === (exportConfig.defaultMetadataState || 'production') && Array.isArray(exportConfig.forms)) {
			return exportConfig.forms;
		}
		return [];
	}

	/**
	 * @param {string} state
	 * @returns {void}
	 */
	function populateExportFormsForState(state) {
		const forms = getExportFormsForState(state);
		const select = /** @type {TomSelectElement|null} */ ($('#rome-export-forms').get(0));
		if (select?.tomselect) {
			select.tomselect.clear(true);
			select.tomselect.clearOptions();
			for (const form of forms) {
				const valid = getExportFormValidCount(form);
				select.tomselect.addOption({
					value: form.name,
					text: formatExportFormOptionLabel(form),
					disabled: valid === 0,
				});
				if (valid > 0) select.tomselect.addItem(form.name, true);
			}
			select.tomselect.refreshOptions(false);
			select.tomselect.refreshItems();
		} else {
			$('#rome-export-forms').html(forms.map(form => {
				const disabled = getExportFormValidCount(form) === 0;
				return `<option value="${escapeHTML(form.name)}" ${disabled ? 'disabled' : 'selected'}>${escapeHTML(formatExportFormOptionLabel(form))}</option>`;
			}).join(''));
		}

		setExportOptionsEnabled(state !== '');
		refreshExportStatus();
	}

	/**
	 * @param {ExportFormInfo} form
	 * @returns {string}
	 */
	function formatExportFormOptionLabel(form) {
		const valid = getExportFormValidCount(form);
		const invalid = getExportFormInvalidCount(form);
		return `${form.label} (${valid} annotated${invalid ? `, ${invalid} invalid` : ''})`;
	}

	/**
	 * @param {ExportFormInfo} form
	 * @returns {number}
	 */
	function getExportFormValidCount(form) {
		return Number(form.validAnnotationCount || 0);
	}

	/**
	 * @param {ExportFormInfo} form
	 * @returns {number}
	 */
	function getExportFormInvalidCount(form) {
		return Number(form.invalidAnnotationCount || 0);
	}

	/**
	 * @param {boolean} enabled
	 * @returns {void}
	 */
	function setExportOptionsEnabled(enabled) {
		$('input[name="rome-export-format"], #rome-export-add-all, #rome-export-clear-all').prop('disabled', !enabled);
		const select = /** @type {TomSelectElement|null} */ ($('#rome-export-forms').get(0));
		if (select?.tomselect) {
			if (enabled) select.tomselect.enable();
			else select.tomselect.disable();
		} else {
			$('#rome-export-forms').prop('disabled', !enabled);
		}
	}

	function selectAllExportForms() {
		const forms = getExportFormsForState(getSelectedExportMetadataState());
		const values = forms.filter(form => getExportFormValidCount(form) > 0).map(form => form.name);
		const select = /** @type {TomSelectElement|null} */ ($('#rome-export-forms').get(0));
		if (select?.tomselect) {
			select.tomselect.clear(true);
			for (const value of values) select.tomselect.addItem(value, true);
			select.tomselect.refreshItems();
		} else {
			$('#rome-export-forms').val(values);
		}
		refreshExportStatus();
	}

	function clearExportForms() {
		const select = /** @type {TomSelectElement|null} */ ($('#rome-export-forms').get(0));
		if (select?.tomselect) {
			select.tomselect.clear(true);
		} else {
			$('#rome-export-forms').val([]);
		}
		refreshExportStatus();
	}

	/**
	 * @param {string} [message]
	 * @returns {void}
	 */
	function refreshExportStatus(message = '') {
		const forms = getSelectedExportForms();
		const stateForms = getExportFormsForState(getSelectedExportMetadataState());
		let count = 0;
		for (const formName of forms) {
			const form = stateForms.find(f => f.name === formName);
			count += form ? getExportFormValidCount(form) : 0;
		}
		$('#rome-export-status').text(message || `${count} annotation${count === 1 ? '' : 's'} ready`);
		$('#rome-export-download').prop('disabled', exportPending || forms.length === 0);
	}

	/**
	 * @returns {string[]}
	 */
	function getSelectedExportForms() {
		const select = /** @type {TomSelectElement|null} */ ($('#rome-export-forms').get(0));
		if (select?.tomselect) {
			const value = select.tomselect.getValue();
			const values = Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean);
			const enabled = new Set(getExportFormsForState(getSelectedExportMetadataState())
				.filter(form => getExportFormValidCount(form) > 0)
				.map(form => form.name));
			return values.filter(value => enabled.has(value));
		}
		const value = $('#rome-export-forms').val();
		return Array.isArray(value) ? value.map(String) : [];
	}

	async function runExportDownload() {
		if (!JSMO || exportPending) return;
		const payload = {
			forms: getSelectedExportForms(),
			format: getSelectedExportFormat(),
			metadataState: getSelectedExportMetadataState(),
		};
		if (payload.forms.length === 0) {
			renderExportMessages({ errors: [{ message: 'Select at least one form with exportable annotations.' }], warnings: [] });
			return;
		}

		exportPending = true;
		refreshExportStatus('Preparing export ...');
		renderExportMessages({ errors: [], warnings: [] });
		let finalStatus = '';

		try {
			const res = /** @type {ExportResult} */ (await getJSMO().ajax('export-annotations', payload));
			lastExport = res || null;
			renderExportMessages(res || {});
			if (res?.success && res.content && res.filename) {
				downloadExportContent(res.content, res.filename, res.mimeType || 'application/json');
				finalStatus = `Downloaded ${res.annotationCount || 0} annotation${res.annotationCount === 1 ? '' : 's'}`;
			} else {
				finalStatus = res?.error || 'No export file generated';
			}
		} catch (err) {
			error('Export failed', err);
			renderExportMessages({ errors: [{ message: 'Export failed. Check the browser console for details.' }], warnings: [] });
			finalStatus = 'Export failed';
		} finally {
			exportPending = false;
			refreshExportStatus(finalStatus);
		}
	}

	/**
	 * @param {Partial<ExportResult>} result
	 * @returns {void}
	 */
	function renderExportMessages(result) {
		const errors = Array.isArray(result.errors) ? result.errors : [];
		const warnings = Array.isArray(result.warnings) ? result.warnings : [];
		const $messages = $('#rome-export-messages');
		if (errors.length === 0 && warnings.length === 0) {
			$messages.empty();
			return;
		}

		/**
		 * @param {ExportIssue[]} items
		 * @param {string} cls
		 * @param {string} title
		 * @returns {string}
		 */
		const renderItems = (items, cls, title) => {
			if (items.length === 0) return '';
			return `<div class="alert ${cls} py-2 mb-2">
				<strong>${escapeHTML(title)}</strong>
				<ul class="mb-0 ps-3">
					${items.map(item => {
						const where = [item.form, item.field].filter(Boolean).join(' / ');
						const prefix = where ? `${where}: ` : '';
						return `<li>${escapeHTML(prefix + (item.message || 'Unknown issue'))}</li>`;
					}).join('')}
				</ul>
			</div>`;
		};

		$messages.html(
			renderItems(errors, 'alert-warning', 'Export issues') +
			renderItems(warnings, 'alert-secondary', 'Warnings')
		);
	}

	/**
	 * @param {string} content
	 * @param {string} filename
	 * @param {string} mimeType
	 * @returns {void}
	 */
	function downloadExportContent(content, filename, mimeType) {
		const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	//#endregion

	//#region Manage / Configure

	/**
	 * @param {string=} page
	 * @returns {void}
	 */
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
		/** @type {EditMode} */
		let editMode = 'create';

		const $modalEl = $('#romeRemoteSourceModal');
		const $titleEl = $('#romeRemoteSourceModalTitle');
		const $errEl = $('#romeRemoteSourceError');

		const $typeEl = $('#rome_remote_type');
		const $blockBio = $('#rome_remote_block_bioportal');
		const $blockSnow = $('#rome_remote_block_snowstorm');

		const $bioOntEl = $('#rome_bioportal_ontology');
		const $bioOntTokenEl = $('#rome_bioportal_token');
		const $bioTestTokenBtn = $('#rome_bioportal_token_test');
		const $bioRefreshBtn = $('#rome_bioportal_refresh');

		const $snowAuthEl = $('#rome_snowstorm_auth_mode');
		const $snowBasicUserWrap = $('#rome_snowstorm_basic_user_wrap');
		const $snowBasicPassWrap = $('#rome_snowstorm_basic_pass_wrap');
		const $snowBearerWrap = $('#rome_snowstorm_bearer_wrap');
		const $snowRefreshBtn = $('#rome_snowstorm_branch_refresh');
		const $snowBranchesEl = $('#rome_snowstorm_branches');

		const bsModal = new bootstrap.Modal(requireElement($modalEl), { backdrop: 'static' });

		$modalEl.on('hide.bs.modal', function () {
			blurActiveElement();
		});

		/**
		 * @param {string} msg
		 * @returns {void}
		 */
		function showError(msg) {
			$errEl.text(msg);
			$errEl.removeClass('d-none');
		}
		function clearError() {
			$errEl.text('');
			$errEl.addClass('d-none');
		}

		/**
		 * @param {string|string[]|number|undefined} type
		 * @returns {void}
		 */
		function setType(type) {
			if (type === 'snowstorm') {
				$blockBio.addClass('d-none');
				$blockSnow.removeClass('d-none');
			} else {
				$blockSnow.addClass('d-none');
				$blockBio.removeClass('d-none');
			}
		}

		/**
		 * @param {string|SnowstormAuthData} dataOrMode
		 * @returns {void}
		 */
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

		async function testBioPortalToken() {
			const token = $bioOntTokenEl.val();
			if ($bioOntTokenEl.hasClass('is-valid')) return; // already tested
			if (!token) return;
			$bioTestTokenBtn.prop('disabled', true);
			try {
				const res = await getJSMO().ajax('test-bioportal-token', { token });
				log('Tested bioportal token', res);
				$bioOntTokenEl.addClass(res ? 'is-valid' : 'is-invalid');
			}
			catch (e) {
				showError(`BioPortal: failed to perform token test (${e})`);
			}
			finally {
				$bioTestTokenBtn.prop('disabled', false);
			}
		}

		async function loadBioportalOntologies({ forceRefresh = false } = {}) {
			if (ontologiesLoaded && !forceRefresh) return;
			$bioOntEl.html('<option value="">Loading…</option>');
			try {
				const res = /** @type {{ error?: string, ontologies: BioPortalOntology[], rc_enabled: boolean }} */ (await getJSMO().ajax('get-bioportal-ontologies', {
					forceRefresh: forceRefresh,
					token: $bioOntTokenEl.val() ?? null
				}));
				log('Loaded bioportal ontologies', res);
				if (res.error) throw res.error;
				const placeholder = res.ontologies.length === 0
					? 'Provide a token and refresh'
					: 'Select an ontology ...';
				$bioOntEl.prop('disabled', res.ontologies.length === 0);
				const select2Data = res.ontologies.map((/** @type {BioPortalOntology} */ o) => ({
					id: o.acronym,
					text: `${o.acronym} ${o.name}`,
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

		/**
		 * @param {Select2Option} data
		 * @returns {string|JQuery<HTMLElement>}
		 */
		function formatOntology(data) {
			// Placeholder / loading entry
			if (!data.id) return data.text;

			const $container = $('<span>');

			$('<b>')
				.text(data.id || '')
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
				$this.val($this.attr('data-rome-reset') ?? '').trigger('change');
			});
			$snowBranchesEl.html('').trigger('change');
			$($bioOntEl).val('').trigger('change');

			$('#rome_source_id').val('');
			clearError();

			setType('bioportal');
			setSnowAuthMode({ snowstorm_auth_mode: 'none' });
		}

		/**
		 * @param {EditMode} mode
		 * @param {PluginSourceInfo=} sourceData
		 * @returns {Promise<void>}
		 */
		async function openRemoteSourceDialog(mode, sourceData) {
			resetFormForCreate();
			editMode = mode;
			if (mode === 'edit' && sourceData) {
				$titleEl.text('Edit a remote source');
				$('#rome_source_id').val(sourceData.key || '');
				const title = (sourceData.title_resolved ?? '').trim();
				if (title !== (sourceData.title ?? '')) {
					$('#rome_title').val(title);
				}
				$('#rome-title-from-source').text(sourceData.title || '');
				const description = (sourceData.description_resolved ?? '');
				if (description !== (sourceData.description ?? '')) {
					$('#rome_description').val(description);
				}
				$('#rome-description-from-source').text(sourceData.description || '');
				$('#rome_remote_block_edit').removeClass('d-none');
				$('#rome_remote_block_add').addClass('d-none');
				if (sourceData.kind === 'bioportal') {
					$('#rome_remote_type_info').val(`BioPortal: ${sourceData.acronym}`);
				}
				else if (sourceData.kind === 'snowstorm') {
					$('#rome_remote_type_info').val(`Snowstorm: ${sourceData.ss_branch}`);
				}
				$('#rome-remote-with-own-credentials')[(sourceData.usesOwnCredentials ?? false) ? 'removeClass' : 'addClass']('d-none');
			} else {
				$titleEl.text('Add a remote source');
				$('#rome-title-from-source').text('');
				$('#rome-description-from-source').text('');

				$('#rome_remote_block_edit').addClass('d-none');
				$('#rome_remote_block_add').removeClass('d-none');
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

		$bioTestTokenBtn.on('click', async () => {
			clearError();
			await testBioPortalToken();
		});
		$bioOntTokenEl.on('change', () => {
			$bioOntTokenEl.removeClass('is-valid is-invalid');
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

			/** @type {RemoteSourcePayload} */
			let payload = {
				context: config.page,
				title: `${$('#rome_title').val()}`.trim(),
				description: `${$('#rome_description').val()}`.trim(),
			};

			if (editMode === 'edit') {
				payload.id = $('#rome_source_id').val();
			}
			else {
				// Assemble payload
				const type = `${$typeEl.val()}`;
				payload.type = type;
				if (type === 'snowstorm') {
					payload.ss_baseurl = `${$('#rome_snowstorm_base_url').val() ?? ''}`.trim();
					payload.ss_branch = `${$('#rome_snowstorm_branches').val() ?? ''}`;
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
					if (config.page !== 'configure' && !rcBioPortalTokenAvailable && !payload.bp_token) {
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
			}

			// Save
			try {
				$('#romeRemoteSourceSaveBtn').prop('disabled', true);
				const res = /** @type {{ error?: string, source: PluginSourceInfo }} */ (await getJSMO().ajax('save-remote-source', payload));
				if (res.error) throw `Failed to save remote source: ${res.error}`;
				blurActiveElement();
				bsModal.hide();
				refreshSourcesTable(res.source);
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

			/** @type {SnowstormPayload} */
			const payload = {
				ss_baseurl: '',
				ss_branch: '',
				ss_auth: '',
				ss_username: '',
				ss_password: '',
				ss_token: ''
			};
			payload.ss_baseurl = `${$('#rome_snowstorm_base_url').val() ?? ''}`.trim();
			payload.ss_branch = `${$('#rome_snowstorm_branch').val() ?? ''}`.trim();
			payload.ss_auth = `${$('#rome_snowstorm_auth_mode').val() ?? ''}`.trim();
			payload.ss_username = `${$('#rome_snowstorm_basic_user').val() ?? ''}`.trim();
			payload.ss_password = `${$('#rome_snowstorm_basic_pass').val() ?? ''}`.trim();
			payload.ss_token = `${$('#rome_snowstorm_bearer').val() ?? ''}`.trim();

			try {
				const res = /** @type {{ error?: string, branches: string[] }} */ (await getJSMO().ajax('get-snowstorm-branches', payload));
				log('Loaded Snowstorm branches', res);
				if (res.error) throw res.error;
				const placeholder = res.branches.length === 0
					? 'Refresh to load branches ...'
					: 'Select a branch ...';
				$snowBranchesEl.prop('disabled', res.branches.length === 0);
				const select2Data = res.branches.map((/** @type {string} */ o) => ({
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

		// Public
		editRemoteSource = function (source) {
			openRemoteSourceDialog('edit', source);
		};
	}

	function initLocalSourcesManagement() {

		const $modalEl = $('#romeLocalSourceModal');
		const $titleEl = $('#romeLocalSourceModalTitle');
		const $errEl = $('#romeLocalSourceError');
		const bsModal = new bootstrap.Modal(requireElement($modalEl), { backdrop: 'static' });
		let localSourceFileContent = '';
		let localSourceFileName = '';
		/** @type {EditMode} */
		let editMode = 'create';

		// Wire events

		$modalEl.on('hide.bs.modal', function () {
			blurActiveElement();
		});

		$('#rome-add-local-source').on('click', () => {
			openLocalSourceDialog('create');
		});

		$('#rome_enable_local_file_upload').on('change', function () {
			$('#rome-file-drop-area').toggleClass('d-none', !$(this).is(':checked'));
		});

		$('#rome-file-input').on('change', async function (ev) {
			// Get file info
			const $fi = $(this);
			const files = /** @type {FileList|undefined} */ ($fi.prop('files'));
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
				const json = /** @type {{ title?: string, description?: string }} */ (JSON.parse(fileText));
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
				context: config.page,
				id: editMode === 'edit' ? `${$('#rome_local_source_id').val()}`.trim() : null,
				title: `${$('#rome_local_title').val()}`.trim(),
				description: `${$('#rome_local_description').val()}`.trim(),
				fileContent: localSourceFileContent,
				fileName: localSourceFileName
			};
			// Validation
			if (editMode === 'create' && (payload.fileContent === '' || payload.fileName === '')) {
				showError('A file is required');
				return;
			}

			// Save
			try {
				// Disable form elements
				$modalEl.find('input, textarea').prop('disabled', true);
				$('#romeLocalSourceSaveBtn').prop('disabled', true);
				const res = /** @type {{ error?: string, source: PluginSourceInfo }} */ (await getJSMO().ajax('save-local-source', payload));
				if (res.error) throw `Failed to save local source: ${res.error}`;
				bsModal.hide();
				refreshSourcesTable(res.source);
			}
			catch (e) {
				showError(`${e}`);
			}
			finally {
				// Enable form elements
				$modalEl.find('input, textarea').prop('disabled', false);
				$('#romeLocalSourceSaveBtn').prop('disabled', false);
			}
		});

		// Public
		editLocalSource = function (source, file) {
			openLocalSourceDialog('edit', source, file);
		};

		/**
		 * @param {string} msg
		 * @returns {void}
		 */
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
				$this.val($this.attr('data-rome-reset') ?? '').trigger('change');
			});

			$('#rome_local_source_id').val('');
			$('#rome-title-from-file').text('');
			$('#rome-description-from-file').text('');
			$('#rome-file-input').val('');
			localSourceFileContent = '';
			localSourceFileName = '';
			$('#rome-file-info').text('No file selected. Please upload a file.');
			$('#rome_enable_local_file_upload').prop('checked', false);
			$('#rome-replace-file-checkbox').addClass('d-none');
			$('#rome-file-drop-area').removeClass('d-none');
			clearError();
		}

		/**
		 * @param {EditMode} mode
		 * @param {PluginSourceInfo=} sourceData
		 * @param {SourceFileInfo=} fileData
		 * @returns {Promise<void>}
		 */
		async function openLocalSourceDialog(mode, sourceData, fileData) {
			resetFormForCreate();
			editMode = mode;
			if (mode === 'edit' && sourceData) {
				$titleEl.text('Edit a local source');
				$('#rome_local_source_id').val(sourceData.key || '');
				$('#rome-title-from-file').text(sourceData.title || '');
				$('#rome-description-from-file').text(sourceData.description || '');
				if (sourceData.title !== sourceData.title_resolved) {
					$('#rome_local_title').val(sourceData.title_resolved || '');
				}
				if (sourceData.description !== sourceData.description_resolved) {
					$('#rome_local_description').val(sourceData.description_resolved || '');
				}
				$('#rome-file-info').text(fileData?.name || '');
				$('#rome-replace-file-checkbox').removeClass('d-none');
				$('#rome-file-drop-area').addClass('d-none');
			} else {
				$titleEl.text('Add a local source');
			}
			bsModal.show();
		};
	}

	function initSystemSourcesManagement() {

		const $modalEl = $('#romeSystemSourceModal');
		const $titleEl = $('#romeSystemSourceModalTitle');
		const $errEl = $('#romeSystemSourceError');
		const bsModal = new bootstrap.Modal(requireElement($modalEl), { backdrop: 'static' });
		/** @type {EditMode} */
		let editMode = 'create';
		/** @type {string|null} */
		let selectedSystemSourceId = null;
		/** @type {MinimalDataTableApi|null} */
		let ssDtInstance = null;

		// Wire events
		$modalEl.on('hide.bs.modal', function () {
			blurActiveElement();
		});

		$('#rome-add-system-source').on('click', () => {
			openSystemSourceDialog('create');
		});

		// Save
		$('#romeSystemSourceSaveBtn').on('click', async function (ev) {
			ev.preventDefault();
			clearError();

			// Assemble payload
			const payload = {
				context: config.page,
				id: editMode === 'edit' ? `${$('#rome_system_source_id').val()}`.trim() : null,
				title: `${$('#rome_system_title').val()}`.trim(),
				description: `${$('#rome_system_description').val()}`.trim(),
				systemSourceId: selectedSystemSourceId
			};
			// Validation
			if (editMode === 'create' && payload.systemSourceId === null) {
				showError('A system source must be selected');
				return;
			}

			// Save
			try {
				// Disable form elements
				$modalEl.find('input, textarea').prop('disabled', true);
				$('#romeSystemSourceSaveBtn').prop('disabled', true);
				const res = /** @type {{ error?: string, source: PluginSourceInfo }} */ (await getJSMO().ajax('save-system-source', payload));
				if (res.error) throw `Failed to save system source: ${res.error}`;
				bsModal.hide();
				refreshSourcesTable(res.source);
			}
			catch (e) {
				showError(`${e}`);
			}
			finally {
				// Enable form elements
				$modalEl.find('input, textarea').prop('disabled', false);
				$('#romeSystemSourceSaveBtn').prop('disabled', false);
			}
		});

		// Public
		editSystemSource = function (source) {
			openSystemSourceDialog('edit', source);
		};

		// Setup table
		initSystemSourcesTable();

		/**
		 * @param {string} msg
		 * @returns {void}
		 */
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
				$this.val($this.attr('data-rome-reset') ?? '').trigger('change');
			});

			$('#rome_system_source_id').val('');
			selectedSystemSourceId = null;
			$('#rome-system-source-info').text('No system source selected. Please select one from the list.');
			$('#rome-system-sources-table-wrapper').removeClass('d-none');
			$('#rome-title-from-system').text('');
			$('#rome-description-from-system').text('');
			clearError();
			refreshSystemSourcesTable();
		}

		/**
		 * @param {EditMode} mode
		 * @param {PluginSourceInfo=} sourceData
		 * @returns {Promise<void>}
		 */
		async function openSystemSourceDialog(mode, sourceData) {
			resetFormForCreate();
			editMode = mode;
			if (mode === 'edit' && sourceData) {
				$titleEl.text('Edit a system source');
				$('#rome_system_source_id').val(sourceData.key || '');
				$('#rome-title-from-source').text(sourceData.title || '');
				$('#rome-description-from-source').text(sourceData.description || '');
				if (sourceData.title !== sourceData.title_resolved) {
					$('#rome_system_title').val(sourceData.title_resolved || '');
				}
				if (sourceData.description !== sourceData.description_resolved) {
					$('#rome_system_description').val(sourceData.description_resolved || '');
				}
				$('#rome-system-source-info').text(sourceData.info || '');
				$('#rome-system-sources-table-wrapper').addClass('d-none');
				setSystemSourceInfo(sourceData);
			} else {
				$titleEl.text('Add a system source');
				$('#rome-system-sources-table-wrapper').removeClass('d-none');
			}
			bsModal.show();
		};

		function initSystemSourcesTable() {

			const $table = $('#rome-system-sources-table');

			//#region Datatable
			ssDtInstance = /** @type {MinimalDataTableApi} */ ($table.DataTable({
				autoWidth: true,
				data: config.sysSources ?? [],
				columns: [
					{
						data: null,
						render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
							if (type === 'sort' || type === 'type') {
								return row.checked ? 'checked' : 'unchecked';
							}
							return renderCheckedColumn(row);
						}
					},
					{
						data: null,
						render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
							if (type === 'sort' || type === 'type') {
								return row.type;
							}
							return renderTypeColumn(row);
						}
					},
					{
						data: null,
						render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
							if (type === 'sort' || type === 'type') {
								return `${row.title_resolved} ${row.description_resolved}`;
							}
							return renderTitleColumn(row);
						}
					},
					{
						data: null,
						searchable: false,
						render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
							if (type === 'sort' || type === 'type') {
								return row?.item_count ?? 0;
							}
							return renderStatsColumn(row);
						}
					}
				],
				language: {
					emptyTable: 'No system sources found.'
				},
				paging: true,
				searching: true,
				info: true,
				lengthChange: false,
				pageLength: 5,
				order: [[2, 'asc']],
				createdRow: (rowEl, rowData) => {
					const source = /** @type {PluginSourceInfo} */ (rowData);
					$(rowEl).data('source-key', source.key ?? '');
				}
			}));


			/**
			 * Renders "Type" column cell content.
			 * @param {PluginSourceInfo} row
			 * @returns {string}
			 */
			function renderTypeColumn(row) {
				return getSourceTypeIcon(row);
			}

			/**
			 * Renders "Checked" column cell content.
			 * @param {PluginSourceInfo} row
			 * @returns {string}
			 */
			function renderCheckedColumn(row) {
				const checked = (row?.checked ?? false) === true;
				return `
					<div class="form-radio">
						<input class="form-radio-input" type="radio" name="system-source-selected" data-source="${row.key}" data-action="select-source" ${checked ? 'checked' : ''} aria-label="Select row ${escapeHTML(row.title_resolved ?? '')}">
					</div>
				`;
			}

			/**
			 * Renders "Title/Description" column cell content.
			 * @param {PluginSourceInfo} row
			 * @returns {string}
			 */
			function renderTitleColumn(row) {
				return `
					<div class="rome-system-source-select" data-action="select-source" data-source="${row.key}">
						<div class="rome-source-title">${escapeHTML(row.title_resolved ?? '')}</div>
						<div class="rome-source-description">${escapeHTML(row.description_resolved ?? '')}</div>
					</div>
				`;
			}

			/**
			 * Renders "Stats" column cell content.
			 * @param {PluginSourceInfo} row
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
			//#endregion DataTable

			//#region Events
			$table.off('click change').on('click change', '[data-action]', function (e) {
				const $el = $(this);
				const action = $el.attr('data-action');
				if (action === 'select-source') {
					const key = $el.attr('data-source');
					log('System source action', { action, key });
					selectedSystemSourceId = key ?? null;
					const source = (config.sysSources ?? []).find(s => s.key === key);
					if (source) setSystemSourceInfo(source);
					refreshSystemSourcesTable();
				}
			});
			//#endregion

		}

		/**
		 * @param {PluginSourceInfo} source
		 * @returns {void}
		 */
		function setSystemSourceInfo(source) {
			$('#rome-system-source-info').html(getSourceTypeIcon(source)).append(
				`<span class="ms-1">${source.type === 'remote' ? 'Remote' : 'Local'}</span>`
			);
			$('#rome-title-from-system').text(source.title || '');
			$('#rome-description-from-system').text(source.description_resolved || '');

		}

		function refreshSystemSourcesTable() {
			const data = config.sysSources ?? [];
			for (const source of data) {
				source['checked'] = source.key === selectedSystemSourceId;
			}
			ssDtInstance?.clear().rows.add(data).draw();
		}
	}

	/**
	 * @param {PluginSourceInfo} source
	 * @returns {string}
	 */
	function getSourceTypeIcon(source) {
		let s = '';
		if (source.type === 'local') {
			s = '<i class="fa-solid fa-database text-muted"></i>';
		}
		else {
			s = '<i class="fa-solid fa-cloud text-muted"></i>';
		}
		if (source?.kind === 'fhir_questionnaire') {
			s += '<i class="fa-solid fa-fire fa-sm ms-1 text-warning"></i>';
		}
		else if (source?.kind === 'native_rome') {
			s += '<i class="fa-solid fa-building-columns fa-sm ms-1"></i>';
		}
		if (source?.from_system ?? false) {
			s += '<i class="fa-solid fa-hard-drive fa-sm ms-1 text-info"></i>';
		}
		return s;
	}

	function initSourcesTable() {

		const data = config.sources ?? [];
		const $table = $('#rome-sources');
		const adv = data.length > 10;

		//#region Datatable
		dtInstance = /** @type {MinimalDataTableApi} */ ($table.DataTable({
			autoWidth: true,
			data: data,
			columns: [
				{
					data: null,
					render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
						if (type === 'sort' || type === 'type') {
							return row.type;
						}
						return renderTypeColumn(row);
					}
				},
				{
					data: null,
					render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
						if (type === 'sort' || type === 'type') {
							return row.enabled ? 'enabled' : 'disabled';
						}
						return renderEnabledColumn(row);
					}
				},
				{
					data: null,
					render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
						if (type === 'sort' || type === 'type') {
							return `${row.title_resolved} ${row.description_resolved}`;
						}
						return renderTitleColumn(row);
					}
				},
				{
					data: null,
					searchable: false,
					render: (/** @type {unknown} */ _data, /** @type {string} */ type, /** @type {PluginSourceInfo} */ row) => {
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
					render: (/** @type {unknown} */ _data, /** @type {string} */ _type, /** @type {PluginSourceInfo} */ row) => renderActionColumn(row)
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
				const source = /** @type {PluginSourceInfo} */ (rowData);
				$(rowEl).data('source-entry', source);
			}
		}));


		/**
		 * Renders "Type" column cell content.
		 * @param {PluginSourceInfo} row
		 * @returns {string}
		 */
		function renderTypeColumn(row) {
			return getSourceTypeIcon(row);
		}

		/**
		 * Renders "Enabled" column cell content.
		 * @param {PluginSourceInfo} row
		 * @returns {string}
		 */
		function renderEnabledColumn(row) {
			const enabled = (row?.enabled ?? false) === true;
			const disabled = (typeof row.system_state === 'string' && row.system_state !== 'enabled') ? 'disabled' : '';
			const disabledIcon = disabled !== '' ? `<i class="fa-solid fa-lock fa-sm text-${row.system_state === 'deleted' ? 'danger' : 'warning'} ms-1"></i>` : '';
			return `
				<div class="form-check form-switch text-success">
					<input class="form-check-input" type="checkbox" role="switch" data-source="${row.key}" data-action="toggle-enabled" ${enabled ? 'checked' : ''} ${disabled}>
					${disabledIcon}
				</div>`;
		}

		/**
		 * Renders "Title/Description" column cell content.
		 * @param {PluginSourceInfo} row
		 * @returns {string}
		 */
		function renderTitleColumn(row) {
			return `
				<div class="rome-source-title">${escapeHTML(row.title_resolved ?? '')}</div>
				<div class="rome-source-description">${escapeHTML(row.description_resolved ?? '')}</div>
				${(typeof row.system_state === 'string' && row.system_state !== 'enabled') ? `<div class="rome-source-state">${escapeHTML(row.message ?? '')}</div>` : ''}
			`;
		}

		/**
		 * Renders "Stats" column cell content.
		 * @param {PluginSourceInfo} row
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
		 * @param {PluginSourceInfo} row
		 * @returns {string}
		 */
		function renderActionColumn(row) {
			const delBtn = `
				<button type="button" class="btn btn-sm btn-link text-danger p-0" title="Delete this source" data-source="${row.key}" data-action="delete"><i class="fa fa-trash-alt"></i></button>`;
			const editBtn = `
				<button type="button" class="btn btn-sm btn-link text-secondary p-0 me-2" title="Edit this source" data-source="${row.key}" ${row.system_state === 'deleted' ? 'disabled' : ''} data-action="edit"><i class="fa fa-pencil"></i></button>`;

			return editBtn + delBtn;
		}
		//#endregion DataTable

		//#region Events
		$table.off('click change').on('click change', '[data-action]', function (e) {
			const $el = $(this);
			const action = $el.attr('data-action');
			if (action == 'toggle-enabled' && e.type === 'click') return;
			const key = $el.attr('data-source');
			log('Source action', { action, key });

			switch (action) {
				case 'edit':
					editSource(key, $el);
					break;
				case 'delete':
					deleteSource(key, $el);
					break;
				case 'toggle-enabled':
					toggleSourceEnabled(key, $el);
					break;
				default:
					warn('Unknown action', action);
					break;
			}
		});

		/**
		 * @param {string|undefined} key
		 * @param {JQuery<HTMLElement>} $btn
		 * @returns {Promise<void>}
		 */
		async function toggleSourceEnabled(key, $btn) {
			if (!key) return;
			const toState = $btn.prop('disabled', true).is(':checked');
			try {
				const res = /** @type {{ error?: string, source: PluginSourceInfo }} */ (await getJSMO().ajax('toggle-source-enabled', {
					key: key,
					enabled: toState,
					context: config.page
				}));
				if (res.error) throw res.error;
				refreshSourcesTable(res.source);
			}
			catch (err) {
				showToast('ERROR', err, 'error');
				refreshSourcesTable();
			}
			finally {
				$btn.prop('disabled', false);
			}
		}

		/**
		 * @param {string|undefined} key
		 * @param {JQuery<HTMLElement>} $btn
		 * @returns {Promise<void>}
		 */
		async function editSource(key, $btn) {
			if (!key) return;
			const source = (config.sources ?? []).find(s => s.key === key);
			if (!source) return;
			if (source.from_system) {
				editSystemSource(source);
			}
			else if (source.type === 'local') {
				// We need to get file details from the server
				try {
					const res = /** @type {{ error?: string, file: SourceFileInfo }} */ (await getJSMO().ajax('get-source-file-info', { key }));
					if (res.error) throw res.error;
					editLocalSource(source, res.file);
				}
				catch (err) {
					showToast('ERROR', err, 'error');
					return;
				}
			}
			else {
				editRemoteSource(source);
			}
		}

		/**
		 * @param {string|undefined} key
		 * @param {JQuery<HTMLElement>} $btn
		 * @returns {Promise<void>}
		 */
		async function deleteSource(key, $btn) {
			if (!key) return;
			const source = (config.sources ?? []).find(s => s.key === key);
			const sourceTitle = source?.title_resolved ?? '(unnamed source)';
			const confirmed = await confirmModal({
				title: 'DELETE',
				message: `Are you sure you want to delete this source?<br><br><strong>${escapeHTML(sourceTitle)}</strong>`,
				cancelLabel: 'Cancel',
				cancelClass: 'btn-secondary',
				confirmLabel: 'Delete',
				confirmClass: 'btn-danger'
			});

			if (!confirmed) return;

			try {
				$btn.prop('disabled', true);
				const res = /** @type {{ error?: string }} */ (await getJSMO().ajax('delete-source', { key }));
				if (res.error) throw res.error;
				config.sources = (config.sources ?? []).filter(s => s.key !== key);
				refreshSourcesTable();
			}
			catch (err) {
				showToast('ERROR', err, 'error');
			}
			finally {
				$btn.prop('disabled', false);
			}
		}
		//#endregion Events
	}

	/**
	 * @param {PluginSourceInfo|null} [source]
	 * @returns {void}
	 */
	function refreshSourcesTable(source = null) {
		config.sources = config.sources ?? [];
		// Remove existing entry from config.sources (identify by key)
		if (source && typeof source.key === 'string') {
			config.sources = config.sources.filter(s => s.key !== source.key);
			config.sources.push(source);
		}
		log('Refreshing sources table', config.sources);
		dtInstance?.clear().rows.add(config.sources).draw();
	}


	//#endregion


	//#region Discover

	/** @type {DiscoveryState} */
	const ds = {};

	function initDiscovery() {
		JSMO?.ajax('discover', {})
			.then(function (response) {
				ds.data = /** @type {DiscoveryData} */ (response);
				const data = ds.data;
				log('Received discover info: ', data);
				if (!Array.isArray(data.fields)) data.fields = [];
				if (!data.projects) data.projects = {};
				const options = data.fields.map((field, idx) => ({
					'id': idx,
					'title': `${field.display} [${field.system}: ${field.code}], n=${field.projects.length}`
				}));
				if (data.fields.length == 0) {
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
					if (romeWindow.TomSelect) {
						ds.TS = /** @type {DiscoveryTomSelect} */ (/** @type {unknown} */ (new romeWindow.TomSelect('#rome-discover-select', settings)));
					}
				}
				$('.rome-discover-project-count').text(Object.keys(data.projects).length);
			})
			.catch(function (err) {
				console.error('Error requesting ROME info', err);
			});
	}

	function updateDiscoveredProjectsTable() {
		const data = ds.data;
		if (!data) return;
		if (!ds.TS || ds.TS.getValue().length == 0) {
			$("#resulttable").html("<i>Nothing to show.</i>");
			return;
		}
		const values = ds.TS.getValue();

		const fieldnamesForProject = (/** @type {number} */ pid) => values
			.filter(i => data.fields[i].field_names[pid])
			.map(i => `${data.fields[i].display}: ${data.fields[i].field_names[pid]}`)
			.join('<br>');
		const formatProjectId = (/** @type {number} */ pid) => config.isAdmin && pid != config.pid
			? `<a href="${romeWindow.app_path_webroot ?? ''}index.php?pid=${pid}" target="_blank">${pid}</a>`
			: `${pid}`;

		const sets = values.map(field_index => (new Set(data.fields[field_index].projects)));
		let project_ids = sets.pop() || new Set();
		while (project_ids.size > 0 && sets.length > 0) {
			const nextSet = sets.pop();
			if (nextSet) project_ids = project_ids.intersection(nextSet);
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
						<td>${data.projects[project_id].app_title}</td>
						<td>${data.projects[project_id].contact}</td>
						<td>${data.projects[project_id].email}</td>
						<td>${fieldnamesForProject(project_id)}</td>
					</tr>`).join('') +
			`</tbody>
			</table>`;
		$("#resulttable").html(html);
	}

	//#endregion


	//#region Misc Helpers

	/**
	 * Show an awaitable Bootstrap 5 confirmation modal.
	 * @param {{
	 *   title?: string,
	 *   message?: string,
	 *   cancelLabel?: string,
	 *   cancelClass?: string,
	 *   confirmLabel?: string,
	 *   confirmClass?: string
	 * }} opts
	 * @returns {Promise<boolean>} Resolves true when confirmed, false otherwise
	 */
	function confirmModal(opts = {}) {
		const {
			title = 'Confirm',
			message = 'Are you sure?',
			cancelLabel = 'Cancel',
			cancelClass = 'btn-secondary',
			confirmLabel = 'Confirm',
			confirmClass = 'btn-primary'
		} = opts;

		const modalId = `romeConfirmModal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const modalHtml = `
			<div class="modal fade modal-md" id="${modalId}" tabindex="-1" aria-hidden="true">
				<div class="modal-dialog">
					<div class="modal-content">
						<div class="modal-header">
							<h5 class="modal-title">${escapeHTML(title)}</h5>
							<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
						</div>
						<div class="modal-body">${message}</div>
						<div class="modal-footer">
							<button type="button" class="btn ${escapeHTML(cancelClass)}" data-bs-dismiss="modal">${escapeHTML(cancelLabel)}</button>
							<button type="button" class="btn ${escapeHTML(confirmClass)}" data-rome-action="confirm">${escapeHTML(confirmLabel)}</button>
						</div>
					</div>
				</div>
			</div>`;

		return new Promise((resolve) => {
			$('body').append(modalHtml);
			const $modal = $(`#${modalId}`);
			const bsModal = new bootstrap.Modal(requireElement($modal), { backdrop: 'static' });
			let confirmed = false;
			$modal.find('[data-rome-action="confirm"]').on('click', function () {
				confirmed = true;
				bsModal.hide();
			});
			$modal.on('hide.bs.modal', function () {
				blurActiveElement();
			});
			$modal.on('hidden.bs.modal', function () {

				bsModal.dispose();
				$modal.remove();
				resolve(confirmed);
			});
			bsModal.show();
		});
	}

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
