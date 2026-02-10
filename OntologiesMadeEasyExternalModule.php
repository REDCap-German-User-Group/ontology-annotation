<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use Exception;
use InvalidArgumentException;
use Project;
use RCView;
use stdClass;
use Throwable;

class OntologiesMadeEasyExternalModule extends \ExternalModules\AbstractExternalModule
{
	private $config_initialized = false;
	private $js_debug = false;
	private $cache_backend = null;
	private $cache_dir = null;
	private $external_module_id = 0;

	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';

	const STORE_EXCLUSIONS = 'ROME_EM::EXCLUDED-FIELDS';

	const MIN_SEARCH_LENGTH = 2;

	/** @var Project The current project */
	private $proj = null;
	/** @var int|null Project ID */
	private $project_id = null;

	const AT_ONTOLOGY = '@ONTOLOGY';

	#region Hooks

	function redcap_module_link_check_display($project_id, $link) {
		// Allow for all users in all contexts
		return $link;
	}

	// Injection
	function redcap_every_page_top($project_id)
	{
		// Only run in project context and on specific pages
		if ($project_id == null) return;
		$page = defined('PAGE') ? PAGE : null;
		if (!in_array($page, ['Design/online_designer.php'], true)) return;

		// Online Designer
		if ($page === 'Design/online_designer.php') {
			$this->initProject($project_id);
			$form = isset($_GET['page']) && array_key_exists($_GET['page'], $this->proj->forms) ? $_GET['page'] : null;
			if ($form) $this->initOnlineDesigner($form);
			else return;
		}
	}

	// Injection
	function redcap_every_page_before_render($project_id)
	{
		// Only run in project context and on specific pages
		if ($project_id == null) return;
		$page = defined('PAGE') ? PAGE : null;
		if (!in_array($page, ['Design/edit_field.php'])) return;

		// Online Designer - Edit Field
		if ($page == 'Design/edit_field.php') {
			$this->initProject($project_id);
			$field_name = $_POST['field_name'];
			$exclude = ($_POST['rome-em-fieldedit-exclude'] ?? '0') == '1';
			$this->set_field_exclusion([$field_name], $exclude);
		}
	}

	// Config defaults
	function redcap_module_project_enable($version, $project_id)
	{
		// Ensure that some project settings have default values
		$current = $this->getProjectSettings();
		if (!array_key_exists('code-theme', $current)) {
			$this->setProjectSetting('code-theme', 'dark');
		}
	}

	// Inject system sources into project config
	public function redcap_module_configuration_settings($project_id, $settings)
	{
		// Only inject per-project system source selectors when viewing a PROJECT config dialog.
		if ($project_id === null) {
			return $settings;
		}

		// Read system sources (repeatable system setting).
		$settingKey = 'sys-fhir-source';
		$sysSources = $this->framework->getSubSettings($settingKey, null);
		if (!is_array($sysSources)) $sysSources = [];

		// Build a list of eligible system sources: active + metadata present
		$injected = [];

		foreach ($sysSources as $row) {
			if (!is_array($row)) continue;

			// Checkbox "active" can come in as string/array/bool depending on framework/version/UI.
			$isActive = $row['sys-fhir-active'] == true;
			if (!$isActive) continue;

			$meta = $this->decodeMetadata($row['sys-fhir-metadata'] ?? null);
			if ($meta === null) continue;

			$id = isset($meta['id']) ? (string)$meta['id'] : '';
			if ($id === '') continue;

			$title = isset($meta['title']) ? trim((string)$meta['title']) : '';
			if ($title === '') $title = 'Untitled';

			$count = (int)$meta['item_count'];
			$badge_class = ($count === 0) ? 'badge-danger' : 'badge-info fw-normal';
			$suffix = '<span style="vertical-align:top;margin-top: 2px;" class="me-1 badge badge-pill ' . $badge_class . '">&nbsp;' . $count . '&nbsp;</span>' . $this->framework->tt("conf_proj_fhir_active");
			$desc = trim((string) $meta['description'] ?? '');
			if ($desc !== '') $desc = '<br><i class="text-muted">' . $desc . '</i>';

			$injected[] = [
				'key' => $id, // e.g. src_<uuidhex>
				'name' =>  '<div><b>' . $title . '</b>' . $desc . '</div>' . $suffix,
				'type' => 'checkbox',
			];
		}


		$bioportal_enabled = $this->isBioPortalAvailable();
		// TODO - Add a BioPortal source config interface

		// Inject into settings
		if (!empty($injected)) {
			$settings[] = [
				'key' => 'sys-source-select-note',
				'name' => $this->framework->tt('conf_sys_source_select_note'),
				'type' => 'descriptive',
			];
			foreach ($injected as $s) {
				$settings[] = $s;
			}
		}

		return $settings;
	}


	// After a module config has been saved
	function redcap_module_save_configuration($project_id)
	{
		if (empty($project_id)) $project_id = null;
		$this->initProject($project_id);
		$this->initConfig();

		$cache = $this->getCache();

		if ($cache === null) {
			// We cannot continue without a valid cache backend configuration
			// TODO: Alert the admin about this
			return;
		}

		require_once __DIR__ . '/classes/FhirQuestionnaireIndexBuilder.php';

		// Builders (dummy for now).
		$builders = [
			new FhirQuestionnaireIndexBuilder(),
		];

		// Load repeatable sources.
		$settingKeyPrefix = $project_id === null ? 'sys-' : 'proj-';
		$settingKey = $settingKeyPrefix . 'fhir-source';
		$entries = $this->framework->getSubSettings($settingKey, $project_id);
		if (!is_array($entries)) $entries = [];

		$changed_entries = [];
		$warnings = [];
		$errors = [];

		foreach ($entries as $repeatIdx => $entry) {
			if (!is_array($entry)) continue;
			// Skip first entry if it's empty.
			if (
				$repeatIdx == 0 && empty($entry[$settingKeyPrefix . 'fhir-file']) &&
				empty($entry[$settingKeyPrefix . 'fhir-metadata'])
			) continue;

			$titleOverride = $entry[$settingKeyPrefix . 'fhir-title'] ?? '';
			$descOverride = $entry[$settingKeyPrefix . 'fhir-desc'] ?? '';
			$titleOverride = is_string($titleOverride) ? trim($titleOverride) : '';
			$descOverride  = is_string($descOverride) ? trim($descOverride) : '';

			// Ensure build + metadata sync.
			$opts = [
				'kind' => 'fhir_questionnaire', // May need to add autodetection (Questionnaire and ROME-specific "ROME_Annotation")
				'doc_id_key' => $settingKeyPrefix . 'fhir-file',
				'meta_key' => $settingKeyPrefix . 'fhir-metadata',
				'title_key' => $settingKeyPrefix . 'fhir-title',
				'desc_key' => $settingKeyPrefix . 'fhir-desc',
				'active_key' => $settingKeyPrefix . 'fhir-active',
				'resolved_title' => $titleOverride,
				'resolved_desc' => $descOverride,
				'fallback_title' => 'Untitled',
				'fallback_desc' => '',
				'cache_ttl' => 0, // safe due to doc_id versioning
				'is_system' => $project_id === null,
				'repeat_idx' => $repeatIdx,
			];
			$res = $this->ensureBuiltAndMetadata(
				$cache,
				$builders,
				$entry,
				$opts
			);

			foreach ($res['warnings'] as $w) $warnings[] = $w;
			foreach ($res['errors'] as $e) $errors[] = $e;

			$newEntry = $res['updated_entry'];

			// Persist only if metadata changed (we only mutate fhir-metadata).
			$metadataKey = $settingKeyPrefix . 'fhir-metadata';
			if (($newEntry[$metadataKey] ?? null) !== ($entry[$metadataKey] ?? null)) {
				$changed_entries[$repeatIdx] = $newEntry;
			} else {
				// If source is to be deactivated, only update active status.
				if ($newEntry[$settingKeyPrefix . 'active'] !== $entry[$settingKeyPrefix . 'active']) {
					$changed_entries[$repeatIdx] = [
						$settingKeyPrefix . 'active' => $newEntry[$settingKeyPrefix . 'active']
					];
				}
			}
		}

		// Write back updated repeatable setting if needed.
		if (count($changed_entries)) {
			// Full per key arrays must be written. Therefore, we need to transform them first
			$firstChangedEntry = $changed_entries[array_key_first($changed_entries)] ?? [];
			$valuesByKey = [];
			foreach ($entries as $idx => $entry) {
				foreach ($firstChangedEntry as $key => $value) {
					if (array_key_exists($idx, $changed_entries)) {
						// Use changed value
						$value = $changed_entries[$idx][$key];
					}
					$valuesByKey[$key][$idx] = $value;
				}
			}
			// Now write back the changed entries
			foreach ($valuesByKey as $key => $values) {
				if ($project_id === null) {
					$this->framework->setSystemSetting($key, $values);
				} else {
					$this->framework->setProjectSetting($key, $values, $project_id);
				}
			}
			// Set log message
			$log_msg = 'FHIR source build complete';
		}

		// Log warnings / errors
		if (!empty($errors) || !empty($warnings)) {
			$log_msg = 'FHIR source build issues:' . count($errors) . ' errors, ' . count($warnings) . ' warnings';

			$this->log($log_msg, [
				'errors' => json_encode(
					$errors,
					JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
				),
				'warnings' => json_encode(
					$warnings,
					JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
				),
			]);
		}
	}

	// AJAX handler
	function redcap_module_ajax($action, $payload, $project_id, $record, $instrument, $event_id, $repeat_instance, $survey_hash, $response_id, $survey_queue_hash, $page, $page_full, $user_id, $group_id)
	{
		$this->initProject($project_id);
		switch ($action) {
			case 'search':
				return $this->search_ontologies($payload);
			case 'parse':
				$ontology = $this->parseOntology($payload);
				return $ontology;
			case 'get-fieldhelp':
				return $this->getFieldHelp();
			case 'set-matrix-exclusion':
				return $this->set_matrix_exclusion($payload);
			case 'refresh-exclusions':
				return $this->refresh_exclusions($payload);
			case 'discover':
				return $this->discoverOntologies($payload);
		}
	}

	#endregion


	#region Plugin Page Configuration

	/**
	 * Get the base config for the JS client on plugin pages
	 * @return array 
	 */
	function get_plugin_base_config()
	{
		$pid = intval($this->framework->getProjectId());
		if ($pid === 0) $pid = null;
		$debug = $pid ? $this->getProjectSetting('javascript-debug') == true : $this->getSystemSetting("sys-javascript-debug") == true;
		$js_base_config = [
			'debug' => $debug,
			'version' => $this->VERSION,
			'moduleDisplayName' => $this->tt('module_name'),
			'isAdmin' => $this->framework->isSuperUser(),
			'pid' => $pid,
		];
		return $js_base_config;
	}

	#endregion


	#region Online Designer

	/**
	 * Sets up Online Designer integration on a 
	 * @param string $form 
	 * @return void 
	 */
	private function initOnlineDesigner($form)
	{
		$this->initConfig();
		$this->framework->initializeJavascriptModuleObject();
		$jsmo_name = $this->framework->getJavascriptModuleObjectName();
		$this->add_templates('online_designer');

		$sources_list = [];
		// Check for conditions that prevent search from working
		$errors = [];
		if ($this->checkCacheConfigured() == false) {
			$errors[] = $this->tt('error_cache_not_configured');
		} else {
			$sources_list = $this->buildSourceRegistry($this->project_id)['list'];
		}
		$warnings = [];

		$config = [
			'debug' => $this->js_debug,
			'version' => $this->VERSION,
			'isAdmin' => $this->framework->isSuperUser(),
			'moduleDisplayName' => $this->tt('module_name'),
			'atName' => self::AT_ONTOLOGY,
			'form' => $form,
			'minimalAnnotation' => $this->getMinimalAnnotationJSON(),
			'knownLinks' => $this->getKnownLinks(),
			'errors' => $errors,
			'warnings' => $warnings,
			'sources' => $sources_list,
			'searchEndpoint' => $this->framework->getUrl('ajax/search.php'),
			'pollEndpoint' => $this->framework->getUrl('ajax/poll.php'),
		];
		// Add some language strings
		$this->framework->tt_transferToJavascriptModuleObject([
			'fieldedit_17',
			'fieldedit_18',
			'fieldedit_19',
		]);
		$config = array_merge($config, $this->refresh_exclusions($form));
		$ih = $this->getInjectionHelper();
		$ih->js('js/ConsoleDebugLogger.js');
		$ih->js('js/ROME_OnlineDesigner.js');
		$ih->css('css/ROME_OnlineDesigner.css');
		echo RCView::script(self::NS_PREFIX . self::EM_NAME . '.init(' . json_encode($config) . ", $jsmo_name);");
	}

	private function add_templates($view)
	{
		if ($view == 'online_designer') {
			$this->framework->tt_transferToJavascriptModuleObject([
				'fieldedit_13',
				'fieldedit_14',
				'fieldedit_15',
			]);
?>
			<template id="rome-em-fieldedit-ui-template">
				<div class="rome-edit-field-ui-container">
					<div class="rome-edit-field-ui-header">
						<h1><?= $this->tt('fieldedit_01') ?></h1>
						<input type="checkbox" class="form-check-input ms-3 rome-em-fieldedit-exclude">
						<label class="form-check-label ms-1 rome-em-fieldedit-exclude">
							<span class="rome-em-fieldedit-exclude-field">
								<?= $this->tt('fieldedit_11') ?>
							</span>
							<span class="rome-em-fieldedit-exclude-matrix">
								<?= $this->tt('fieldedit_12') ?>
							</span>
						</label>
					</div>
					<div class="rome-edit-field-ui-body">
						<div class="rome-edit-field-ui-content-wrapper">
							<div id="rome-search-bar" class="d-flex align-items-baseline gap-2">
								<span><?= $this->tt('fieldedit_08') ?></span>
								<input type="search" name="rome-em-fieldedit-search" class="form-control form-control-sm rome-search" placeholder="<?= $this->tt('fieldedit_02') ?>">
								<span class="rome-edit-field-ui-spinner">
									<i class="fa-solid fa-spinner fa-spin-pulse rome-edit-field-ui-spinner-spinning"></i>
									<i class="fa-solid fa-arrow-right fa-lg rome-edit-field-ui-spinner-not-spinning"></i>
								</span>
								<select id="rome-field-choice" class="form-select form-select-sm w-auto">
									<option value="dataElement"><?= $this->tt('fieldedit_18') ?></option>
								</select>
								<button id="rome-add-button" data-rome-action="add" type="button" class="btn btn-rcgreen btn-xs" disabled><?= $this->tt('fieldedit_10') ?></button>
								<div id="rome-add-selection-info" class="rome-add-selection-info" title="No selection">
									<i class="fa-solid fa-circle-info"></i>
								</div>
								<div id="rome-search-errors">
									<i class="fa-solid fa-circle-exclamation fa-lg fa-fade"></i>
								</div>
							</div>
							<div class="rome-edit-field-ui-list">
								<h2><?= $this->tt('fieldedit_03') ?></h2>
							</div>
							<div class="rome-edit-field-ui-list-empty mt-2">
								<?= $this->tt('fieldedit_07') ?>
							</div>
							<div class="rome-json-error-overlay" style="display:none;">
								<div class="rome-json-error-overlay-content">
									<h3>Annotation JSON Error</h3>
									<div class="rome-json-error-overlay-message"></div>
									<p>Please fix the `@ONTOLOGY` JSON in Field Annotation. Search and table actions are temporarily disabled.</p>
								</div>
							</div>
						</div>
					</div>
					<div class="rome-edit-field-ui-footer">
						<?= RCView::interpolateLanguageString($this->tt('fieldedit_04'), [
							'<a href="javascript:;" onclick="' . $this->getModuleClientName() . '.showFieldHelp();">',
							'</a>'
						], false)
						?>
					</div>
				</div>
			</template>
<?php
		}
	}

	private function set_field_exclusion($field_names, $exclude)
	{
		$excluded = $this->load_excluded_fields();
		if ($exclude) {
			// TODO: Delete action tag from fields

			$excluded = array_unique(array_merge($excluded, $field_names));
		} else {
			$excluded = array_filter($excluded, function ($val) use ($field_names) {
				return !in_array($val, $field_names);
			});
		}
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		$valid_field_names = array_keys($metadata);
		$excluded = array_intersect($excluded, $valid_field_names);
		sort($excluded);
		$this->store_excluded_fields($excluded);
	}

	private function load_excluded_fields()
	{
		$excluded = json_decode($this->framework->getProjectSetting(self::STORE_EXCLUSIONS) ?? "[]");
		if (!is_array($excluded)) $excluded = [];
		return $excluded;
	}

	private function store_excluded_fields($excluded)
	{
		if (!is_array($excluded)) $excluded = [];
		$this->framework->setProjectSetting(self::STORE_EXCLUSIONS, json_encode($excluded));
	}

	private function set_matrix_exclusion($args)
	{
		$grid_name = $args['grid_name'] ?? '';
		$exclude = $args['exclude'] == '1';
		$fields = [];
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		foreach ($metadata as $field_name => $field_data) {
			if ($field_data['grid_name'] === $grid_name) {
				$fields[] = $field_name;
			}
		}
		$this->set_field_exclusion($fields, $exclude);
	}

	private function refresh_exclusions($form)
	{
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		$form_fields = array_keys(array_filter($metadata, function ($field_data) use ($form) {
			return $field_data['form_name'] === $form;
		}));
		$excluded = array_intersect($this->load_excluded_fields(), $form_fields);
		$mg_excluded = [];
		foreach ($excluded as $field) {
			if (isset($metadata[$field]) && $metadata[$field]['grid_name']) {
				$mg_excluded[$metadata[$field]['grid_name']] = true;
			}
		}
		$mg_excluded = array_keys($mg_excluded);
		return [
			'fieldsExcluded' => $excluded,
			'matrixGroupsExcluded' => $mg_excluded,
		];
	}

	private function search_ontologies($payload)
	{

		$term = trim($payload['term'] ?? '');
		if ($term == '') return null;

		$result = [];

		// search configured minimal datasets first
		$minimal_datasets  = [];
		// project specific jsons
		foreach ($this->getProjectSetting('minimal-dataset') as $minimal_dataset_string) {
			if ($minimal_dataset_string == null) continue;
			$minimal_datasets[] = $minimal_dataset_string;
			return json_decode($minimal_dataset_string);
		}
		// enabled standard minimal datasets
		foreach (glob(__DIR__ . '/minimal_datasets/*.json') as $filename) {
			if ($this->getProjectSetting('minimal-dataset-file-' . basename($filename, '.json'))) {
				$minimal_datasets[] = file_get_contents($filename);
			}
		}

		foreach ($minimal_datasets as $minimal_dataset_string) {
			$minimal_dataset = json_decode($minimal_dataset_string, true);
			$title = $minimal_dataset['title'];
			$items_stack = $minimal_dataset['item'];
			while (!empty($items_stack)) {
				$current_item = array_shift($items_stack);
				if (is_array($current_item['item'])) {
					array_push($items_stack, ...$current_item['item']);
				}
				if ($current_item['text'] && is_array($current_item['code'])) {
					$display_item = $current_item['text'];
					if (preg_match("/$term/i", $display_item)) {
						$pos = stripos($display_item, $term);
						if ($pos !== false) {
							$term_length = strlen($term);
							$display_item = substr($display_item, 0, $pos) .
								'<span class="rome-edit-field-ui-search-match">' . substr($display_item, $pos, $term_length) . '</span>' .
								substr($display_item, $pos + $term_length);
						}
						$result[] = [
							'value' => json_encode($current_item),
							'label' => $current_item['text'],
							'display' => "<b>$title</b>: " . $display_item
						];
					}
				}
			}
		}

		if ($this->getProjectSetting('minimal-datasets-only')) {
			return $result;
		}



		$bioportal_api_token = $GLOBALS['bioportal_api_token'] ?? '';
		if ($bioportal_api_token == '') return null;

		$bioportal_api_url = $GLOBALS['bioportal_api_url'] ?? '';
		if ($bioportal_api_url == '') return null;

		// Fixed
		$ontology_acronym = 'SNOMEDCT';
		$ontology_system  = 'http://snomed.info/sct';


		// Build URL to call
		$url = $bioportal_api_url . 'search?q=' . urlencode($term) . '&ontologies=' . urlencode($ontology_acronym)
			. '&suggest=true&include=prefLabel,notation,cui&display_links=false&display_context=false&format=json&apikey=' . $bioportal_api_token;
		// Call the URL
		$json = http_get($url);

		$response = json_decode($json, true);

		if (!$response || !$response['collection']) return null;

		$dummy_data = [];
		foreach ($response['collection'] as $item) {
			$dummy_data[$item['notation']] = $item['prefLabel'];
		}

		foreach ($dummy_data as $val => $label) {
			$display_item = "[$val] $label";
			$display_item = filter_tags(label_decode($display_item));
			$pos = stripos($display_item, $term);
			if ($pos !== false) {
				$term_length = strlen($term);
				$display_item = substr($display_item, 0, $pos) .
					'<span class="rome-edit-field-ui-search-match">' . substr($display_item, $pos, $term_length) . '</span>' .
					substr($display_item, $pos + $term_length);
				$result[] = [
					'value' => json_encode(['code' => ['system' => $ontology_system, 'code' => $val, 'display' => $label]]),
					'label' => $label,
					'display' => '<b>' . $ontology_acronym . '</b>: ' . $display_item,
				];
			}
		}
		if (count($result) == 0) {
			$result[] = [
				'value' => '',
				'label' => '',
				'display' => $this->tt('fieldedit_16'),
			];
		}

		return $result;
	}


	/**
	 * Gets the "Learn about using Ontology Annotations" content 
	 * @return string 
	 */
	private function getFieldHelp()
	{
		return $this->tt("fieldedit_06");
	}

	#endregion


	// Method not currently implemented - used for ??
	private function parseOntology($payload)
	{
		return [];
	}

	#region Discover Page

	/**
	 * Generates a JSON string with all annotated fields from (discoverable) projects
	 * @param Array $payload - Ajax payload (not currently used; used for future functionality such as
	 * excluding projects in development, or requiring a minimum number of records)
	 * @return string
	 */
	private function discoverOntologies($payload)
	{
		$sql = <<<SQL
			WITH
				-- all projects that have the module installed and metadata marked as 'discoverable'
				project_ids AS
				(
					SELECT exs.project_id
					FROM redcap_external_modules ex 
					INNER JOIN redcap_external_module_settings exs ON
						ex.external_module_id=exs.external_module_id AND
						ex.directory_prefix = ? AND
						exs.key = 'discoverable' AND
						exs.value='true'
				),
				-- name + contact info of the projects
				project_infos AS
				(
					SELECT rp.project_id, app_title, COALESCE(project_contact_email, ru.user_email) AS email,
						COALESCE(project_contact_name, CONCAT(ru.user_firstname, ' ', ru.user_lastname)) AS contact
					FROM redcap_projects rp INNER JOIN project_ids ON rp.project_id=project_ids.project_id
					LEFT JOIN redcap_user_information ru ON rp.created_by=ru.ui_id
				),
				-- all the fields from these projects with an @ONTOLOGY annotation	        
				fields as
				(
					SELECT project_id, field_name, 
						regexp_replace(misc, ".*@ONTOLOGY='([^']*)'.*", "\\\\1") AS ontology
					FROM redcap_metadata 
					WHERE project_id IN (SELECT project_id FROM project_ids) AND 
						misc LIKE '%@ONTOLOGY%'
				),    
				-- all the annotations for these fields
				annotations AS 
				(
					SELECT project_id, field_name, j.system, j.code, j.display
					FROM fields, json_table(
						ontology, '$.dataElement.coding[*]' columns(
							system varchar(255) path '$.system',
							code   varchar(255) path '$.code',
							display varchar(255) path '$.display')
					) j 
					WHERE json_valid(ontology)
				),
				-- grouped annotations
				grouped_annotations AS
				(
					SELECT system, code, display,
						json_objectagg(project_id, field_name) as field_names,
						json_arrayagg(project_id) as projects
					FROM annotations
					GROUP BY system, code, display
				)
				-- putting it all together: project_info and grouped annotated fields
				SELECT json_object
				(
					'projects', (SELECT json_objectagg(project_id, json_object('app_title', app_title, 'email', email, 'contact', contact)) FROM project_infos),
					'fields', (SELECT json_arrayagg(json_object('field_names', field_names, 'system', system, 'code', code, 'display', display, 'projects', projects)) FROM grouped_annotations)
				) AS info;
		SQL;
		$q = $this->query($sql, [$this->PREFIX]);
		$result = $q->fetch_assoc();
		return $result["info"]; // JSON string
	}

	#endregion

	#region Misc Private Helpers

	/**
	 * Gets the module name for client side internal use
	 * @return string 
	 */
	private function getModuleClientName()
	{
		return self::NS_PREFIX . self::EM_NAME;
	}

	/**
	 * Gets the module's internal id
	 * 0 signals an error
	 * @return int 
	 */
	private function getExternalModuleId()
	{
		$sql = <<<SQL
			SELECT external_module_id
			FROM redcap_external_modules
			WHERE directory_prefix = ?
		SQL;
		$q = $this->query($sql, [$this->PREFIX]);
		$result = $q->fetch_assoc();
		// Return 0 if not found
		return $result["external_module_id"] ?? 0;
	}


	/**
	 * Makes the internal project structure accessible to the module
	 * @param string|int $project_id 
	 * @return void 
	 */
	function initProject($project_id)
	{
		if ($project_id === null) return;
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
	}

	/**
	 * Reads and sets commonly used module settings as fields of the class, for convenience
	 * @return void 
	 */
	function initConfig()
	{
		if ($this->config_initialized) return;

		// System-only settings
		if ($this->project_id === null) {
		}
		// Project-only settings
		else {
			$this->js_debug  = $this->framework->getProjectSetting("javascript-debug") == true;
		}
		// Common settings
		$cache_backend = $this->framework->getSystemSetting("cache-backend") ?? "";
		$this->cache_backend = in_array($cache_backend, ["db", "disk"], true) ? $cache_backend : "";
		$this->cache_dir = $cache_backend === "disk" ? (string)$this->framework->getSystemSetting("file-cache-dir") : null;
		$this->external_module_id = $this->getExternalModuleId();
		$this->config_initialized = true;
	}


	private function checkCacheConfigured()
	{
		if (empty($this->cache_backend)) return false;
		if ($this->cache_backend === "db") {
			// Module ID must be known
			return $this->external_module_id > 0;
		}
		// Check disk cache directory
		if (empty($this->cache_dir)) return false;
		// Verify that the directory exists AND is writable
		return is_dir($this->cache_dir) && is_writable($this->cache_dir);
	}


	#endregion

	#region Public Helpers

	function getInjectionHelper()
	{
		if ($this->injection_helper === null) {
			require_once "classes/InjectionHelper.php";
			$this->injection_helper = InjectionHelper::init($this);
		}
		return $this->injection_helper;
	}
	/** @var InjectionHelper */
	private $injection_helper = null;


	/**
	 * Return a minimal annotation
	 * @return string 
	 */
	function getMinimalAnnotationJSON()
	{
		$minimal = [
			"dataElement" => [
				'coding' => [],
				'text' => '',
				'valueCodingMap' => new stdClass(),
			],
		];
		return json_encode($minimal, JSON_UNESCAPED_UNICODE);
	}

	function getKnownLinks()
	{
		return [
			"http://snomed.info/sct" => "https://bioportal.bioontology.org/ontologies/SNOMEDCT?p=classes&conceptid=",
			"http://loinc.org" => "https://loinc.org/",
		];
	}

	/**
	 * Create an ontology annotation parser with fixed options.
	 *
	 * Options:
	 * - 'tag' (string, required): marker, e.g. "@ONTOLOGY"
	 * - 'getMinAnnotation' (callable, required): returns minimal/fallback annotation array
	 * - 'validate' (callable|null, optional): function(array $obj): bool, may expose ->errors or ['errors']
	 *
	 * Returns an object with method parse(string $text): array
	 *
	 * Parse result array keys:
	 * - json (array)            Parsed JSON object (assoc array) OR minimal fallback
	 * - usedFallback (bool)     True if fallback was used
	 * - numTags (int)           Number of tag occurrences found
	 * - error (bool)            True only if tag(s) exist but none have valid JSON
	 * - errorMessage (string)   Error message if error=true
	 * - warnings (array)        List of ['line' => int, 'message' => string]
	 * - text (string)           Exact substring from tag start to end of JSON (incl. optional closing quote)
	 * - start (int)             0-based start offset of text in input, -1 if none
	 * - end (int)               0-based end offset (exclusive), -1 if none
	 */
	function createOntologyAnnotationParser(array $options)
	{
		if (!isset($options['tag']) || !is_string($options['tag']) || $options['tag'] === '') {
			throw new InvalidArgumentException('createOntologyAnnotationParser: tag must be a non-empty string');
		}
		if (!isset($options['getMinAnnotation']) || !is_callable($options['getMinAnnotation'])) {
			throw new InvalidArgumentException('createOntologyAnnotationParser: getMinimalOntologyAnnotation must be a function');
		}

		$tag = $options['tag'];
		$getMinAnnotation = $options['getMinAnnotation'];
		$validate = (isset($options['validate']) && is_callable($options['validate'])) ? $options['validate'] : null;

		// --- helpers ---

		$isWS = static function (string $ch): bool {
			return $ch === ' ' || $ch === "\t" || $ch === "\n" || $ch === "\r" || $ch === "\f" || $ch === "\v";
		};

		$computeLineStarts = static function (string $s): array {
			$starts = [0];
			$len = strlen($s);
			for ($i = 0; $i < $len; $i++) {
				if ($s[$i] === "\n") $starts[] = $i + 1;
			}
			return $starts;
		};

		$indexToLine = static function (array $starts, int $pos): int {
			$lo = 0;
			$hi = count($starts) - 1;
			while ($lo <= $hi) {
				$mid = ($lo + $hi) >> 1;
				if ($starts[$mid] <= $pos) $lo = $mid + 1;
				else $hi = $mid - 1;
			}
			return max(1, $hi + 1);
		};

		$formatValidatorErrors = static function ($errors): string {
			if (!is_array($errors) || count($errors) === 0) return 'Unknown validation error';
			$slice = array_slice($errors, 0, 3);
			$parts = [];
			foreach ($slice as $e) {
				$instancePath = '(root)';
				$message = 'invalid';

				if (is_array($e)) {
					if (isset($e['instancePath']) && $e['instancePath'] !== '') $instancePath = (string)$e['instancePath'];
					elseif (isset($e['dataPath']) && $e['dataPath'] !== '') $instancePath = (string)$e['dataPath']; // some validators
					if (isset($e['message']) && $e['message'] !== '') $message = (string)$e['message'];
				} elseif (is_object($e)) {
					if (isset($e->instancePath) && $e->instancePath !== '') $instancePath = (string)$e->instancePath;
					if (isset($e->message) && $e->message !== '') $message = (string)$e->message;
				}

				$parts[] = $instancePath . ': ' . $message;
			}
			$more = count($errors) > 3 ? ' (+' . (count($errors) - 3) . ' more)' : '';
			return implode('; ', $parts) . $more;
		};

		$scanJsonObject = static function (string $s, int $start) {
			$depth = 0;
			$inString = false;
			$escape = false;

			$len = strlen($s);
			for ($i = $start; $i < $len; $i++) {
				$ch = $s[$i];

				if ($inString) {
					if ($escape) {
						$escape = false;
					} elseif ($ch === '\\') {
						$escape = true;
					} elseif ($ch === '"') {
						$inString = false;
					}
					continue;
				}

				if ($ch === '"') {
					$inString = true;
					continue;
				}

				if ($ch === '{') {
					$depth++;
				} elseif ($ch === '}') {
					$depth--;
					if ($depth < 0) return ['ok' => false, 'reason' => 'Bracket mismatch: unexpected "}"'];
					if ($depth === 0) return ['ok' => true, 'start' => $start, 'end' => $i + 1];
				}
			}

			return ['ok' => false, 'reason' => 'Bracket mismatch: unterminated JSON object (reached end of text)'];
		};

		// Return a small object with parse()
		return new class($tag, $getMinAnnotation, $validate, $isWS, $computeLineStarts, $indexToLine, $scanJsonObject, $formatValidatorErrors) {
			private string $tag;
			private $getMinAnnotation;
			private $validate;
			private $isWS;
			private $computeLineStarts;
			private $indexToLine;
			private $scanJsonObject;
			private $formatValidatorErrors;

			public function __construct(
				string $tag,
				callable $getMinAnnotation,
				$validate,
				callable $isWS,
				callable $computeLineStarts,
				callable $indexToLine,
				callable $scanJsonObject,
				callable $formatValidatorErrors
			) {
				$this->tag = $tag;
				$this->getMinAnnotation = $getMinAnnotation;
				$this->validate = $validate;
				$this->isWS = $isWS;
				$this->computeLineStarts = $computeLineStarts;
				$this->indexToLine = $indexToLine;
				$this->scanJsonObject = $scanJsonObject;
				$this->formatValidatorErrors = $formatValidatorErrors;
			}

			public function parse(string $text): array
			{
				$result = [
					'json' => ($this->getMinAnnotation)(),
					'usedFallback' => true,
					'numTags' => 0,
					'error' => false,
					'errorMessage' => '',
					'warnings' => [],
					'text' => '',
					'start' => -1,
					'end' => -1,
				];

				if ($text === '') return $result;

				$lineStarts = ($this->computeLineStarts)($text);

				$idx = 0;
				$lastValid = null;     // ['json'=>array,'start'=>int,'end'=>int,'text'=>string]
				$lastFailure = null;   // ['line'=>int,'message'=>string]

				while (true) {
					$tagIdx = strpos($text, $this->tag, $idx);
					if ($tagIdx === false) break;

					$result['numTags']++;
					$idx = $tagIdx + strlen($this->tag);

					$attempt = $this->parseOneTag($text, (int)$tagIdx, strlen($this->tag));
					if ($attempt['ok']) {
						$lastValid = $attempt['value'];
					} else {
						$line = ($this->indexToLine)($lineStarts, (int)$tagIdx);
						$message = isset($attempt['reason']) ? $attempt['reason'] : 'Unknown parse error';
						$warning = ['line' => $line, 'message' => $message];
						$result['warnings'][] = $warning;
						$lastFailure = $warning;
					}
				}

				if ($result['numTags'] === 0) {
					return $result; // no annotation present
				}

				if ($lastValid !== null) {
					$result['json'] = $lastValid['json'];
					$result['usedFallback'] = false;
					$result['text'] = $lastValid['text'];
					$result['start'] = $lastValid['start'];
					$result['end'] = $lastValid['end'];
					return $result;
				}

				$result['error'] = true;
				if ($lastFailure) {
					$result['errorMessage'] = $this->tag . ' present but no valid JSON found. Last issue at line ' .
						$lastFailure['line'] . ': ' . $lastFailure['message'];
				} else {
					$result['errorMessage'] = $this->tag . ' present but no valid JSON found.';
				}
				return $result;
			}

			private function parseOneTag(string $s, int $tagIdx, int $tagLen): array
			{
				$len = strlen($s);
				$i = $tagIdx + $tagLen;

				// TAG [ws]
				while ($i < $len && ($this->isWS)($s[$i])) $i++;

				// =
				if ($i >= $len || $s[$i] !== '=') {
					return ['ok' => false, 'reason' => 'Missing "=" after tag'];
				}
				$i++;

				// [ws]
				while ($i < $len && ($this->isWS)($s[$i])) $i++;

				if ($i >= $len) {
					return ['ok' => false, 'reason' => 'JSON object missing after "=" (end of text)'];
				}

				// Optional quote wrapper
				$quote = null;
				if ($s[$i] === "'" || $s[$i] === '"') {
					$quote = $s[$i];
					$i++;
					while ($i < $len && ($this->isWS)($s[$i])) $i++; // tolerate ws after quote
				}

				if ($i >= $len || $s[$i] !== '{') {
					return ['ok' => false, 'reason' => 'JSON object missing after "=" (expected "{")'];
				}

				$scan = ($this->scanJsonObject)($s, $i);
				if (!$scan['ok']) {
					return ['ok' => false, 'reason' => $scan['reason']];
				}

				$jsonText = substr($s, $scan['start'], $scan['end'] - $scan['start']);

				// If quoted, require closing quote after JSON
				$end = (int)$scan['end']; // end of JSON object by default
				if ($quote !== null) {
					$j = $end;
					while ($j < $len && ($this->isWS)($s[$j])) $j++;
					if ($j >= $len || $s[$j] !== $quote) {
						return ['ok' => false, 'reason' => 'Missing closing ' . $quote . ' after JSON object'];
					}
					$end = $j + 1; // include closing quote
				}

				// JSON parse
				$parsed = json_decode($jsonText, true);
				if (json_last_error() !== JSON_ERROR_NONE) {
					return ['ok' => false, 'reason' => 'JSON.parse failed: ' . json_last_error_msg()];
				}
				if (!is_array($parsed)) {
					return ['ok' => false, 'reason' => 'Parsed JSON is not an object'];
				}

				// Optional schema validation (only on parsed tag JSON)
				if ($this->validate) {
					$ok = ($this->validate)($parsed);
					if (!$ok) {
						$errors = null;

						// Support validators that expose errors as property or array key
						if (is_object($this->validate) && property_exists($this->validate, 'errors')) {
							$errors = $this->validate->errors;
						} elseif (is_array($this->validate) && isset($this->validate['errors'])) {
							$errors = $this->validate['errors'];
						} elseif (is_object($this->validate) && method_exists($this->validate, 'getErrors')) {
							$errors = $this->validate->getErrors();
						}

						$msg = ($this->formatValidatorErrors)($errors);
						return ['ok' => false, 'reason' => 'Schema validation failed: ' . $msg];
					}
				}

				$start = $tagIdx;

				return [
					'ok' => true,
					'value' => [
						'json' => $parsed,
						'start' => $start,
						'end' => $end,
						'text' => substr($s, $start, $end - $start),
					],
				];
			}
		};
	}

	#endregion

	#region Cache Building

	/**
	 * Generate a stable module source id and its canonical UUID.
	 *
	 * Returns:
	 *  - id:   "src_<uuidhex>"  (uuid without hyphens)
	 *  - uuid: canonical UUID v4 with hyphens
	 *
	 * @return array{id:string, uuid:string}
	 * @throws Exception
	 */
	private function generateSourceId(): array
	{
		// UUID v4: 16 random bytes with version/variant bits set.
		$b = random_bytes(16);
		$b[6] = chr((ord($b[6]) & 0x0f) | 0x40); // version 4
		$b[8] = chr((ord($b[8]) & 0x3f) | 0x80); // variant RFC 4122

		$hex = bin2hex($b); // 32 hex chars

		$uuid = substr($hex, 0, 8) . '-' .
			substr($hex, 8, 4) . '-' .
			substr($hex, 12, 4) . '-' .
			substr($hex, 16, 4) . '-' .
			substr($hex, 20, 12);

		return [
			'id' => 'src_' . $hex,
			'uuid' => $uuid,
		];
	}

	/**
	 * Ensure a local source is built and its internal metadata is in sync.
	 *
	 * Invariants:
	 *  - internal metadata is only written/updated after successful build OR for pure label updates
	 *  - cache entry is written before metadata is written when a build is required
	 *
	 * Metadata update rules:
	 *  - If metadata missing OR doc_id changed: build + write cache + write metadata
	 *  - Else if resolved title/description changed: update metadata only
	 *
	 * @param Cache $cache Cache instance (DB/file backend).
	 * @param LocalSourceIndexBuilder[] $builders List of builders; first matching supports($kind) is used.
	 * @param array $entry A single repeatable entry, containing at least:
	 *   - 'doc_id' (int|string) or 'file' (int|string) depending on your config field key
	 *   - 'active' (bool-ish) optional (caller can skip inactive)
	 *   - 'title_override' (string|null) optional
	 *   - 'description_override' (string|null) optional
	 *   - 'fhir-metadata' (string|null) JSON string (hidden field)
	 * @param array $opts Options:
	 *   - 'kind' => string (default 'fhir_questionnaire')
	 *   - 'doc_id_key' => string (required) Key in $entry that contains doc_id
	 *   - 'meta_key' => string (required) Key in $entry that contains metadata
	 *   - 'title_key' => string (required) Key in $entry that contains title
	 *   - 'desc_key' => string (required) Key in $entry that contains description
	 *   - 'active_key' => string (required) Key in $entry that contains active flag
	 *   - 'resolved_title' => string|null (if null, computed or fallback)
	 *   - 'resolved_desc' => string|null (if null, computed or fallback)
	 *   - 'fallback_title' => string (default 'Untitled')
	 *   - 'fallback_desc' => string (default '')
	 *   - 'cache_ttl' => int (default 0 = no expiry)
	 * @return array{
	 *   updated_entry: array,
	 *   meta: array|null,
	 *   built: bool,
	 *   warnings: string[],
	 *   errors: string[]
	 * }
	 */
	private function ensureBuiltAndMetadata(
		Cache $cache,
		array $builders,
		array $entry,
		array $opts = []
	): array {
		$warnings = [];
		$errors = [];
		$built = false;

		$kind = (string)($opts['kind'] ?? 'fhir_questionnaire');
		// Metadata Keys (all required)
		$docIdKey = (string)($opts['doc_id_key'] ?? '');
		$metaKey = (string)($opts['meta_key'] ?? '');
		$titleKey = (string)($opts['title_key'] ?? '');
		$descKey = (string)($opts['desc_key'] ?? '');
		$activeKey = (string)($opts['active_key'] ?? '');
		if (empty($docIdKey) || empty($metaKey) || empty($titleKey) || empty($descKey) || empty($activeKey)) {
			$errors[] = 'Missing required entry keys: doc_id_key, meta_key, title_key, desc_key, active_key';
			return [
				'updated_entry' => $entry,
				'meta' => null,
				'built' => false,
				'warnings' => $warnings,
				'errors' => $errors
			];
		}
		// Title and Description overrides/fallbacks
		$fallbackTitle = (string)($opts['fallback_title'] ?? 'Untitled');
		$fallbackDesc = (string)($opts['fallback_desc'] ?? '');
		$resolvedTitle = (string)($opts['resolved_title'] ?? '');
		$resolvedDesc = (string)($opts['resolved_desc'] ?? '');

		$ttl = (int)($opts['cache_ttl'] ?? 0);

		$repeatIdx = (int)($opts['repeat_idx'] ?? -1);
		$isSystem  = (bool)($opts['is_system'] ?? false);

		$docIdRaw = $entry[$docIdKey] ?? null;
		$docId = is_numeric($docIdRaw) ? (int)$docIdRaw : 0;
		if ($docId <= 0) {
			$errors[] = "Missing or invalid doc_id in entry key '{$docIdKey}'.";
			// When a file is gone, set the entry to inactive and the metadata to null
			$entry[$activeKey] = false;

			// IMPORTANT: For system repeatIdx 0, do NOT delete metadata (keeps stable id + semantic identity across delete→save→reopen→upload).
			if ($isSystem && $repeatIdx === 0) {
				// keep $entry[$metaKey] as-is
			} else {
				$entry[$metaKey] = null;
			}

			return [
				'updated_entry' => $entry,
				'meta' => null,
				'built' => false,
				'warnings' => $warnings,
				'errors' => $errors,
			];
		}

		if (!is_string($resolvedTitle) || trim($resolvedTitle) === '') {
			$t = $entry[$titleKey] ?? '';
			$t = is_string($t) ? trim($t) : '';
			$resolvedTitle = ($t !== '') ? $t : $fallbackTitle;
		}
		if (!is_string($resolvedDesc) || trim($resolvedDesc) === '') {
			$d = $entry[$descKey] ?? '';
			$d = is_string($d) ? trim($d) : '';
			$resolvedDesc = ($d !== '') ? $d : $fallbackDesc;
		}

		$metaJson = $entry[$metaKey] ?? '';
		$meta = null;
		if (is_string($metaJson) && trim($metaJson) !== '') {
			$tmp = json_decode($metaJson, true);
			if (is_array($tmp)) $meta = $tmp;
		}

		$metaId = is_array($meta) ? (string)($meta['id'] ?? '') : '';
		$metaUuid = is_array($meta) ? (string)($meta['uuid'] ?? '') : '';
		$metaDocId = is_array($meta) ? (int)($meta['doc_id'] ?? 0) : 0;

		$oldUrl = is_array($meta) ? trim((string)($meta['url'] ?? '')) : '';
		$oldTitleResolved = is_array($meta) ? trim((string)($meta['title_resolved'] ?? $meta['title'] ?? '')) : '';


		// Determine if we need to build.
		$needsBuild = ($meta === null) || ($metaId === '') || ($metaDocId !== $docId);

		// Select builder.
		$builder = null;
		foreach ($builders as $b) {
			if ($b instanceof LocalSourceIndexBuilder && $b->supports($kind)) {
				$builder = $b;
				break;
			}
		}
		if ($builder === null) {
			$errors[] = "No builder available for kind '{$kind}'.";
			return [
				'updated_entry' => $entry,
				'meta' => $meta,
				'built' => false,
				'warnings' => $warnings,
				'errors' => $errors,
			];
		}

		// If build is required and no stable id exists yet, generate one at build start.
		if ($needsBuild && ($metaId === '' || $metaUuid === '')) {
			try {
				$ids = $this->generateSourceId();
				$metaId = $ids['id'];
				$metaUuid = $ids['uuid'];
			} catch (Exception $e) {
				$errors[] = "Failed to generate source id: " . $e->getMessage();
				return [
					'updated_entry' => $entry,
					'meta' => $meta,
					'built' => false,
					'warnings' => $warnings,
					'errors' => $errors,
				];
			}
		}

		// If metadata exists and doc_id unchanged, but labels changed -> metadata-only update.
		$labelsChanged = false;
		if (!$needsBuild && is_array($meta)) {
			$oldTitle = (string)($meta['title'] ?? '');
			$oldDesc  = (string)($meta['description'] ?? '');
			if ($oldTitle !== $resolvedTitle || $oldDesc !== $resolvedDesc) {
				$labelsChanged = true;
			}
		}

		// Build if required.
		if ($needsBuild) {
			try {
				$result = $builder->buildFromDocId($docId, [
					// reserved for future use
				]);

				$srcTitle = trim((string)($result->payload['title'] ?? ''));
				$srcDesc  = trim((string)($result->payload['description'] ?? ''));

				// Override precedence already handled by caller via opts['resolved_*'].
				// If no override was provided (i.e. opts value empty), use Questionnaire title/description as fallback.
				if (isset($opts['resolved_title']) && trim((string)$opts['resolved_title']) === '') {
					if ($srcTitle !== '') $resolvedTitle = $srcTitle;
				}
				if (isset($opts['resolved_desc']) && trim((string)$opts['resolved_desc']) === '') {
					if ($srcDesc !== '') $resolvedDesc = $srcDesc;
				}

				$newUrl = trim((string)($result->payload['url'] ?? ''));

				// Decide whether to reuse existing id (only relevant if we already have one)
				$reuseId = false;
				if ($metaId !== '' && $metaUuid !== '') {
					if ($oldUrl !== '' && $newUrl !== '') {
						$reuseId = ($oldUrl === $newUrl);
					} elseif ($oldUrl === '' && $newUrl === '') {
						// Fallback: decide based on resolved title (override-aware)
						$reuseId = ($oldTitleResolved !== '' && $oldTitleResolved === $resolvedTitle);
					} else {
						$reuseId = false; // one has url, other doesn't => repurpose
					}
				}

				// If this is a repurpose (not a replacement), generate a new id/uuid (even for repeatIdx 0).
				$hasPriorIdentity = ($oldUrl !== '' || $oldTitleResolved !== '');
				if (!$reuseId && $hasPriorIdentity) {
					$ids = $this->generateSourceId();
					$metaId = $ids['id'];
					$metaUuid = $ids['uuid'];
				}

				// Cache key: versioned by doc_id.
				// Format: idx:<src_id>:<doc_id>
				$cacheKey = "idx:" . $metaId . ":" . $docId;

				// Store payload. TTL=0 means "never expires" (safe due to doc_id versioning).
				$cache->setPayload($cacheKey, $result->payload, $ttl, [
					'kind' => $result->kind,
					'id' => $metaId,
					'uuid' => $metaUuid,
					'doc_id' => $docId,
				]);

				// Validate code systems in use
				$system_counts = $result->payload['system_counts'] ?? [];
				if (!is_array($system_counts)) $system_counts = [];

				$built = true;

				$meta = [
					'v' => 1,
					'id' => $metaId,
					'uuid' => $metaUuid,
					'doc_id' => $docId,
					'kind' => $result->kind,
					'title' => $srcTitle,
					'title_resolved' => $resolvedTitle,
					'description' => $srcDesc,
					'description_resolved' => $resolvedDesc,
					'item_count' => (int)$result->itemCount,
					'system_counts' => $system_counts,
					'url' => (string)($result->payload['url'] ?? ''),
					'built_at' => date('c'),
				];

				if ((int)$result->itemCount === 0) {
					$warnings[] = "Source '{$resolvedTitle}' produced 0 searchable items. Check the source file or remove/replace it.";
				}
			} catch (Throwable $e) {
				$errors[] = "Build failed for '{$resolvedTitle}': " . $e->getMessage();
				return [
					'updated_entry' => $entry,
					'meta' => $meta,
					'built' => false,
					'warnings' => $warnings,
					'errors' => $errors,
				];
			}
		} elseif ($labelsChanged) {
			// Metadata-only update.
			$meta['title'] = $resolvedTitle;
			$meta['description'] = $resolvedDesc;
			$meta['v'] = (int)($meta['v'] ?? 1);

			// Preserve item_count/built_at as-is (they describe the built artifact).
			if (isset($meta['item_count']) && (int)$meta['item_count'] === 0) {
				$warnings[] = "Source '{$resolvedTitle}' has 0 searchable items. Check the source file or remove/replace it.";
			}
		} else {
			// No build, no label changes; still add warning if item_count==0.
			if (is_array($meta) && (int)($meta['item_count'] ?? 0) === 0) {
				$warnings[] = "Source '{$resolvedTitle}' has 0 searchable items. Check the source file or remove/replace it.";
			}
		}

		// Write back metadata JSON into entry (caller persists settings).
		if (is_array($meta)) {
			$entry[$metaKey] = json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
			if ($entry[$metaKey] === false) {
				// Should be rare; keep old metaJson if encoding fails.
				$entry[$metaKey] = $metaJson;
				$errors[] = "Failed to encode internal metadata JSON for '{$resolvedTitle}'.";
			}
		}

		return [
			'updated_entry' => $entry,
			'meta' => $meta,
			'built' => $built,
			'warnings' => $warnings,
			'errors' => $errors,
		];
	}

	function getCache()
	{
		// Check that cache backend config is available
		if (!$this->checkCacheConfigured()) return null;

		require_once __DIR__ . '/classes/Cache.php';
		require_once __DIR__ . '/classes/CacheBuilder.php';

		// Instantiate cache backend
		$cacheBackend = ($this->cache_backend === 'disk') ? 'file' : 'module_log';
		$cache = CacheFactory::create($cacheBackend, $this->external_module_id, $this->cache_dir);
		return $cache;
	}

	#endregion



	#region Sources Registry

	public function buildSourceRegistry(int $project_id): array
	{
		$effective = [];

		// Project-private sources (active + built)
		$proj_sources = $this->getBuiltActiveFhirSources($project_id);
		foreach ($proj_sources as $id => $src) {
			$effective[$id] = $src;
		}

		// System sources (opt-in per project)
		$sys_sources = $this->getBuiltActiveFhirSources(null);
		foreach ($sys_sources as $id => $src) {
			if ($this->isSystemSourceSelectedInProject($project_id, $id)) {
				$effective[$id] = $src;
			}
		}

		// Remote sources
		$ext_sources = $this->getConfiguredActiveRemoteSources($project_id);
		foreach ($ext_sources as $id => $src) {
			$effective[$id] = $src;
		}

		// Build JS list (id + label + optional hint/count)
		$list = [];
		foreach ($effective as $id => $src) {
			$system_counts = ($src['meta'] ?? [])['system_counts'] ?? null;
			$list[] = [
				'id' => $src['id'],
				'label' => $src['label'],
				'desc' => $src['desc'],
				'count' => $src['item_count'] ?? null,
				'system_counts' => $system_counts,
				'hint' => ($src['deferred'] === true) ? 'remote' : 'local',
			];
		}

		// Stable ordering helps UX
		usort($list, function ($a, $b) {
			return strcasecmp((string)$a['label'], (string)$b['label']);
		});

		// Lookup map for server dispatch (by id)
		$map = [];
		foreach ($effective as $id => $src) {
			if ($src['deferred'] === true) {
				$docId = null;
				$indexCacheKey = null;
				$itemCount = -1;
				$meta = $src['meta'] ?? [];
			}
			else {
				$docId = (int)$src['doc_id'];
				$indexCacheKey = 'idx:' . $id . ':' . $docId;
				$itemCount = (int)($src['item_count'] ?? 0);
				$meta = null;
			}
			$map[$id] = [
				'id' => $id,
				'scope' => $src['scope'],
				'kind' => $src['kind'],
				'deferred' => $src['deferred'] === true,
				'doc_id' => $docId,
				'item_count' => $itemCount,
				// cache key for local index:
				'index_cache_key' => $indexCacheKey,
				// meta for remote sources (e.g. for access details)
				'meta' => $meta,
			];
		}

		return [
			'list' => $list,
			'map' => $map,
		];
	}


	/**
	 * Decode metadata JSON stored in fhir-metadata.
	 * Returns null if empty/invalid.
	 */
	private function decodeMetadata($json): ?array
	{
		if (!is_string($json)) return null;
		$json = trim($json);
		if ($json === '') return null;

		$meta = json_decode($json, true);
		return is_array($meta) ? $meta : null;
	}

	/** Minimal label normalization */
	private function buildLabelFromMeta(array $meta): string
	{
		$title = isset($meta['title']) ? trim((string)$meta['title']) : '';
		if ($title === '') $title = 'Untitled';

		$count = isset($meta['item_count']) ? (int)$meta['item_count'] : 0;
		$suffix = ($count === 0) ? ' (0 items)' : " ({$count} items)";

		return $title . $suffix;
	}

	private function getBuiltActiveFhirSources($project_id): array
	{
		$settingPrefix = $project_id === null ? 'sys-' : 'proj-';
		$rows = $this->framework->getSubSettings($settingPrefix . 'fhir-source', $project_id);
		if (!is_array($rows)) $rows = [];

		$out = [];
		foreach ($rows as $row) {
			if (!is_array($row)) continue;
			// Skip inactive sources
			if (!$row[$settingPrefix . 'fhir-active']) continue;

			$meta = $this->decodeMetadata($row[$settingPrefix . 'fhir-metadata'] ?? null);
			if ($meta === null) continue;

			// Require id + doc_id
			$id = (string)($meta['id'] ?? '');
			$docId = (int)($meta['doc_id'] ?? 0);
			if ($id === '' || $docId <= 0) continue;

			$out[$id] = [
				'id' => $id,
				'scope' => $project_id === null ? 'system' : 'project',
				'deferred' => false,
				'kind' => (string)($meta['kind'] ?? 'fhir_questionnaire'),
				'doc_id' => $docId,
				'item_count' => intval($meta['item_count'] ?? 0),
				'label' => $this->buildLabelFromMeta($meta),
				'desc' => (string)($meta['description'] ?? ''),
				'meta' => $meta,
			];
		}
		return $out;
	}

	function getConfiguredActiveRemoteSources(int $project_id): array 
	{
		$out = [];
		// TODO: get configured sources from project settings

		// return $out;

		// TODO - fix query/result acronym mismatch
		// Idea to get ACRONYM - DIFFERENT ACRONYM mapping is to do a simple request to search for a 
		// single ontology and extract the id. 
		// This is a bit of a hack, but it's the only way to get the ACRONYM - DIFFERENT ACRONYM mapping


		// For now, return hardcoded BioPortal SNOMEDCT
		$out['src_bioportal_snomedct'] = [
			'id' => 'src_bioportal_snomedct',
			'kind' => 'bioportal',
			'scope' => 'project',
			'label' => 'BioPortal: SNOMEDCT',
			'desc' => 'Search SNOMED CT via BioPortal',
			'deferred' => true,
			'meta' => [
				'type' => 'bioportal',
				'q_acronym' => 'SNOMEDCT',
				'r_acronym' => 'SNOMEDCT', // CAVE: Need to get creatively, see LOINC<>LNC
				'sys_uri' => 'http://snomed.info/sct',
			],
		];
		return $out;
	}

	private function isSystemSourceSelectedInProject(int $project_id, string $sourceId): bool
	{
		$v = $this->getProjectSetting($sourceId, $project_id);
		return $v == true;
	}


	#endregion

	function getMinSearchLength(): int
	{
		return self::MIN_SEARCH_LENGTH;
	}

	function getMaxSearchResultsPerSource(): int
	{
		// TODO: Make this configurable
		return 20;
	}


	#region BioPortal

	function isBioPortalAvailable()
	{

		$enabled = $GLOBALS['enable_ontology_auto_suggest'] == true;
		$hasApiKey = trim($GLOBALS['bioportal_api_token']) != '';
		return $enabled && $hasApiKey;
	}

	/**
	 * Gets BioPortal API details (if available)
	 * @return array{api_url: string, api_token: string, ontology_list: string, enabled: bool} 
	 */
	function getBioPortalApiDetails()
	{
		// Ontoloy list:
		// "name": "VODANAFACILITIESLIST",
		// "acronym": "VODANAMFLCODE",
		// "@id": "https://data.bioontology.org/ontologies/VODANAMFLCODE",
		// "@type": "http://data.bioontology.org/metadata/Ontology"

		$details = [
			'api_url' => (string)$GLOBALS['bioportal_api_url'] ?? '',
			'api_token' => (string)$GLOBALS['bioportal_api_token'] ?? '',
			'ontology_list' => (string)$GLOBALS['bioportal_ontology_list'] ?? '',
			'enabled' => $this->isBioPortalAvailable(),
		];
		return $details;
	}

	/**
	 * BioPortal search across multiple ontologies (acronyms).
	 * - validates acronyms against REDCap cached ontology list
	 * - returns per-acronym hit lists (each capped to $limit)
	 * - does ONE BioPortal call for all cache misses
	 *
	 * @param Cache $cache
	 * @param array{api_url: string, api_token: string, ontology_list: string, enabled: bool} $bp
	 * @param array<int, string> $acronym_query_response_map Requested ontology acronyms as a map: QUERY ACRONYM => RESPONSE ACRONYM
	 * @param string $q Query
	 * @param int $limit_per_acronym Limit per acronym
	 * @param int $ttlSeconds Cache TTL per acronym (e.g. 1800)
	 * @return array<string, array<int, array{system:string, code:string, display:string, score:int|float}>> keyed by QUERY ACRONYM
	 */
	function searchBioPortal(
		Cache $cache,
		array $bp,
		array $acronym_query_response_map,
		string $q,
		int $limit_per_acronym,
		int $ttlSeconds = 1800
	): array {
		$out = [];
		$q = trim($q);

		if (empty($bp['enabled']) || $q === '' || $limit_per_acronym <= 0) return $out;

		$base  = rtrim((string)($bp['api_url'] ?? ''), '/') . '/';
		$token = (string)($bp['api_token'] ?? '');
		if ($base === '/' || $token === '') return $out;

		// Allowed acronyms (REDCap cached list)
		$allowed = $this->getBioPortalAllowedAcronyms($bp);

		// Normalize + validate requested acronyms
		$req = [];
		foreach ($acronym_query_response_map as $q_acr => $r_acr) {
			if (!in_array($q_acr, $allowed, true)) continue; // only allow known ontologies
			$req[$q_acr] = true;
		}
		$reqAcronyms = array_keys($req);
		if (!$reqAcronyms) return $out;

		// Cache check per acronym
		$misses = [];
		foreach ($reqAcronyms as $q_acr) {
			$cacheKey = $this->generateBioPortalSearchCacheKey($q_acr, $q);
			$cached = $cache->getPayload($cacheKey);
			if (is_array($cached)) {
				$out[$q_acr] = $cached;
			} else {
				$misses[] = $q_acr;
			}
		}

		// If all hit cache, done
		if (!$misses) return $out;

		// One unified BioPortal call for misses
		$pagesize = $limit_per_acronym * count($misses);
		
		$params = [
			'q' => $q,
			'ontologies' => implode(',', $misses),
			'suggest' => 'true',
			'include' => 'prefLabel,notation,cui',
			'display_links' => 'false',
			'display_context' => 'false',
			'format' => 'json',
			'pagesize' => (int)$pagesize,
			'page' => 1,
			'apikey' => $token,
		];
		$url = $base . 'search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

		$headers = ['Accept: application/json'];
		$ua = $this->getUserAgentString();

		$resp = http_get($url, 5, '', $headers, $ua);
		if ($resp === false || trim($resp) === '') {
			// If BioPortal fails, return whatever cache hits we had (misses remain absent)
			return $out;
		}

		$json = json_decode($resp, true);
		$collection = is_array($json) ? ($json['collection'] ?? null) : null;
		if (!is_array($collection)) return $out;

		// Prepare buckets for misses
		$fetched = [];
		foreach ($misses as $acr) $fetched[$acr] = [];
		// Prepare reverse lookup (last one wins if case of collision)
		$r_q_map = [];
		foreach ($acronym_query_response_map as $q_acr => $r_acr) $r_q_map[$r_acr] = $q_acr;

		// Split + map, enforcing per-acronym limit
		foreach ($collection as $r) {
			if (!is_array($r)) continue;

			$id = isset($r['@id']) && is_string($r['@id']) ? $r['@id'] : '';
			$r_acr = $this->getBioPortalAcronymFromId($id);
			if ($r_acr === '' || !isset($r_q_map[$r_acr])) continue;
			$acr = $r_q_map[$r_acr];

			if (count($fetched[$acr]) >= $limit_per_acronym) continue;

			$display = isset($r['prefLabel']) && is_string($r['prefLabel']) ? trim($r['prefLabel']) : '';
			if ($display === '' && isset($r['label']) && is_string($r['label'])) $display = trim($r['label']);
			if ($display === '') continue;

			// Prefer notation when present (canonical codes)
			$code = isset($r['notation']) && is_string($r['notation']) ? trim($r['notation']) : '';
			if ($code === '') {
				// fallback (still stable, but BioPortal-specific)
				$code = $id !== '' ? trim($id) : '';
			}
			if ($code === '') continue;

			$fetched[$acr][] = [
				'system' => $this->bioPortalSystemUriForAcronym($acr),
				'code' => $code,
				'display' => $display,
				'score' => 1,
			];
		}

		// Store misses into cache + merge into output (even if empty, cache empties to avoid hammering)
		foreach ($misses as $acr) {
			$hits = $fetched[$acr] ?? [];
			$cacheKey = $this->generateBioPortalSearchCacheKey($acr, $q);
			$cache->setPayload($cacheKey, $hits, $ttlSeconds, [
				'kind' => 'bioportal',
				'acr' => $acr,
			]);
			$out[$acr] = $hits;
		}

		return $out;
	}

	/**
	 * Build a remote cache key stored in redcap_external_modules_log.record (VARCHAR(100)).
	 *
	 * Format:
	 *   r:<remote>:<segments...>[:<preview>][:<hash>]
	 *
	 * - All keys start with "r:" so prune can delete "r:%".
	 * - Segments are ':'-separated.
	 * - Preview is optional (human readable, truncated to fit).
	 * - Hash is optional (short sha1 over a canonical string).
	 */
	private function remoteCacheKey(
		string $remote,         // e.g. 'bp', 'ss', 'umls'
		array $segments = [],   // e.g. ['s', 'SNOMEDCT']
		string $hashInput = '', // canonical string to hash (already normalized)
		?string $preview = null // human-readable preview (already normalized), truncated to fit
	): string {
		$maxLen = 100;

		$remote = trim($remote);
		if ($remote === '') {
			throw new \InvalidArgumentException('remoteCacheKey: remote must be non-empty');
		}

		// Normalize/escape segments (no ':' to keep keys readable)
		$cleanSegs = [];
		foreach ($segments as $seg) {
			if ($seg === null) continue;
			$seg = trim((string)$seg);
			if ($seg === '') continue;
			$seg = str_replace(':', '∶', $seg);
			$cleanSegs[] = $seg;
		}

		$base = 'r:' . str_replace(':', '∶', $remote);
		if ($cleanSegs) {
			$base .= ':' . implode(':', $cleanSegs);
		}

		$hashPart = ':' . substr(sha1($hashInput), 0, 12);
		$fixed = $base . $hashPart;

		if ($preview === null || $preview === '') {
			return $fixed; // already short; hash always present
		}

		$p = str_replace(':', '∶', $preview);
		$p = preg_replace('/[\x00-\x1F\x7F]+/u', '', $p) ?? $p;

		// Fit ":<preview>" into maxLen, shrinking by characters until byte length fits
		$key = $fixed . ':' . $p;
		if (strlen($key) <= $maxLen) {
			return $key;
		}

		// Reduce preview safely (character-wise) until the overall key fits in bytes
		while ($p !== '' && strlen($fixed . ':' . $p) > $maxLen) {
			$p = mb_substr($p, 0, mb_strlen($p) - 1);
		}

		return $p === '' ? $fixed : ($fixed . ':' . $p);
	}



	private function generateBioPortalSearchCacheKey(string $acr, string $q): string
	{
		$acr = strtoupper(trim($acr));

		$qNorm = mb_strtolower(trim($q));
		$qNorm = preg_replace('/\s+/u', ' ', $qNorm) ?? $qNorm;

		$preview = mb_substr($qNorm, 0, 40); // you can keep 40 as a goal; builder will truncate if needed

		$cacheKey = $this->remoteCacheKey(
			'bp',
			['s', $acr],
			$qNorm,      // hashInput (canonical)
			$preview,      // preview
			100,
			12
		);
		return $cacheKey;
	}

	/**
	 * Extract acronym from BioPortal @id like:
	 * http://purl.bioontology.org/ontology/SNOMEDCT/111552007
	 */
	private function getBioPortalAcronymFromId(string $id): string
	{
		if ($id === '') return '';
		// Fast parse without regex
		$needle = '/ontology/';
		$pos = strpos($id, $needle);
		if ($pos === false) return '';
		$rest = substr($id, $pos + strlen($needle));
		$slash = strpos($rest, '/');
		if ($slash === false) return '';
		$acr = substr($rest, 0, $slash);
		$acr = strtoupper(trim($acr));
		return $acr;
	}

	/**
	 * System URI mapping (expand later).
	 */
	private function bioPortalSystemUriForAcronym(string $acr): string
	{
		$acr = strtoupper(trim($acr));
		if ($acr === 'SNOMEDCT') return 'http://snomed.info/sct';
		if ($acr === 'LOINC') return 'http://loinc.org';
		return 'bioportal:' . $acr;
	}



	/**
	 * @param array{ontology_list: string} $bp
	 * @return array<string> List of allowed acronyms (uppercase)
	 */
	private function getBioPortalAllowedAcronyms(array $bp): array
	{
		$set = [];

		// TODO: The list is capped by what is configured to be searchable in the project


		$raw = (string)($bp['ontology_list'] ?? '');
		if ($raw === '') return $set;

		$list = json_decode($raw, true);
		if (!is_array($list)) return $set;

		foreach ($list as $o) {
			if (!is_array($o)) continue;
			$acr = $o['acronym'] ?? '';
			if (!is_string($acr)) continue;
			$acr = trim($acr);
			if ($acr === '') continue;
			$set[strtoupper($acr)] = true;
		}

		return array_keys($set);
	}

	
	#endregion

	function getUserAgentString() 
	{
		return 'ROME-REDCap-EM (BioPortal search, experimental)';
	}

	#region Crons

	/**
	 * Prune the cache. 
	 * @param array $cronInfo 
	 * @return string 
	 */
	function cron_prune($cronInfo) {
		try {
			$this->initConfig();
			$cache = $this->getCache();
			$cache->prune();
		}
		catch (Exception $e) {
			$this->framework->log('Cache pruning failed: '.$e->getMessage());
			return "ROME: Pruning failed.";
		}
		return "ROME: Pruning completed successfully.";
	}

	#endregion

}
