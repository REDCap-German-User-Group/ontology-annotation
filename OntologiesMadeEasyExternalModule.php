<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use Exception;
use Project;
use RCView;

class OntologiesMadeEasyExternalModule extends \ExternalModules\AbstractExternalModule
{
	private $config_initialized = false;
	private $js_debug = false;

	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';

	const STORE_EXCLUSIONS = "ROME_EM::EXCLUDED-FIELDS";

	/** @var Project The current project */
	private $proj = null;
	/** @var int|null Project ID */
	private $project_id = null;

	const AT_ONTOLOGY = "@ONTOLOGY";

	#region Hooks

	// Injection
	function redcap_every_page_top($project_id) {
		if ($project_id == null) return; // Only run in project context
		$this->init_proj($project_id);

		$page = defined("PAGE") ? PAGE : null;
		$form = isset($_GET['page']) && array_key_exists($_GET['page'], $this->proj->forms) ? $_GET['page'] : null;

		if ($page == "Design/online_designer.php" && $form != null) {
			$this->init_online_designer($form);
		}
	}

	function redcap_every_page_before_render($project_id) {
		if ($project_id == null) return; // Only run in project context
		$this->init_proj($project_id);

		$page = defined("PAGE") ? PAGE : null;
		if ($page == "Design/edit_field.php") {
			$field_name = $_POST["field_name"];
			$exclude = ($_POST["rome-em-fieldedit-exclude"] ?? "0") == "1";
			$this->set_field_exclusion([$field_name], $exclude);
		}
	}


	// AJAX handler
	function redcap_module_ajax($action, $payload, $project_id, $record, $instrument, $event_id, $repeat_instance, $survey_hash, $response_id, $survey_queue_hash, $page, $page_full, $user_id, $group_id) {
		$this->init_proj($project_id);
		switch($action) {
			case "search":
				return $this->search_ontologies($payload);
			case "parse":
				$ontology = $this->parse_ontology($payload);
				return $ontology;
			case "get-fieldhelp":
				return $this->get_fieldhelp();
			case "set-matrix-exclusion":
				return $this->set_matrix_exclusion($payload);
			case "refresh-exclusions":
				return $this->refresh_exclusions($payload);
		}
	}

	#endregion

	#region Online Designer

	private function init_online_designer($form) {
		$this->init_config();
		$this->framework->initializeJavascriptModuleObject();
		$jsmo_name = $this->framework->getJavascriptModuleObjectName();
		$this->add_templates("online_designer");

		$config = [
			"debug" => $this->js_debug,
			"version" => $this->VERSION,
			"moduleDisplayName" => $this->tt("module_name"),
			"atName" => self::AT_ONTOLOGY,
			"form" => $form,
		];
		$config = array_merge($config, $this->refresh_exclusions($form));
		require_once "classes/InjectionHelper.php";
		$ih = InjectionHelper::init($this);
		$ih->js("js/OntologiesMadeEasy.js");
		$ih->css("css/OntologiesMadeEasy.css");
		print RCView::script(self::NS_PREFIX . self::EM_NAME . ".init(" . json_encode($config) . ", $jsmo_name);");
	}

	private function add_templates($view) {
		if ($view == "online_designer") {
			$this->framework->tt_transferToJavascriptModuleObject([
				"fieldedit_13",
				"fieldedit_14",
				"fieldedit_15",
			]);
			?>
			<template id="rome-em-fieldedit-ui-template">
				<div class="rome-edit-field-ui-container">
					<div class="rome-edit-field-ui-header">
						<h1><?=$this->tt("fieldedit_01")?></h1>
						<input type="checkbox" class="form-check-input ms-3 rome-em-fieldedit-exclude">
						<label class="form-check-label ms-1 rome-em-fieldedit-exclude">
							<span class="rome-em-fieldedit-exclude-field">
								<?=$this->tt("fieldedit_11")?>
							</span>
							<span class="rome-em-fieldedit-exclude-matrix">
								<?=$this->tt("fieldedit_12")?>
							</span>
						</label>
					</div>
					<div class="rome-edit-field-ui-body">
						<div class="d-flex align-items-baseline gap-2">
							<span><?=$this->tt("fieldedit_08")?></span>
							<input type="search" name="rome-em-fieldedit-search" class="form-control form-control-sm " placeholder="<?= $this->tt("fieldedit_02") ?>">
							<span class="rome-edit-field-ui-spinner">
								<i class="fa-solid fa-spinner fa-spin-pulse rome-edit-field-ui-spinner-spinning"></i>
								<i class="fa-solid fa-arrow-right fa-lg rome-edit-field-ui-spinner-not-spinning"></i>
							</span>
							<select class="form-select form-select-sm w-auto">
								<option>Field</option>
								<option>Choice A</option>
								<option>Choice B</option>
							</select>
							<button type="button" class="btn btn-rcgreen btn-xs"><?=$this->tt("fieldedit_10")?></button>
						</div>
						<div class="rome-edit-field-ui-list">
							<h2><?= $this->tt("fieldedit_03") ?></h2>
						</div>
						<div class="rome-edit-field-ui-list-empty">
							<?= $this->tt("fieldedit_07") ?>
						</div>
					</div>
					<div class="rome-edit-field-ui-footer">
						<?=RCView::interpolateLanguageString($this->tt("fieldedit_04"), [
								"<a href='javascript:;' onclick='".$this->get_js_module_name().".showFieldHelp();'>",
								"</a>"
							], false)
						?>
					</div>
				</div>
			</template>
			<?php
		}
	}

	private function set_field_exclusion($field_names, $exclude) {
		$excluded = $this->get_excluded_fields();
		if ($exclude) {
			// TODO: Delete action tag from fields

			$excluded = array_unique(array_merge($excluded, $field_names));
		}
		else {
			$excluded = array_filter($excluded, function($val) use ($field_names) {
				return !in_array($val, $field_names);
			});
		}
		$valid_field_names = array_keys($this->proj->getMetadata());
		$excluded = array_intersect($excluded, $valid_field_names);
		sort($excluded);
		$this->set_excluded_fields($excluded);
	}

	private function get_excluded_fields() {
		$excluded = json_decode($this->framework->getProjectSetting(self::STORE_EXCLUSIONS) ?? "[]");
		if (!is_array($excluded)) $excluded = [];
		return $excluded;
	}

	private function set_excluded_fields($excluded) {
		if (!is_array($excluded)) $excluded = [];
		$this->framework->setProjectSetting(self::STORE_EXCLUSIONS, json_encode($excluded));
	}

	private function set_matrix_exclusion($args) {
		$grid_name = $args["grid_name"] ?? "";
		$exclude = $args["exclude"] == "1";
		$fields = [];
		foreach ($this->proj->getMetadata() as $field_name => $field_data) {
			if ($field_data["grid_name"] === $grid_name) {
				$fields[] = $field_name;
			}
		}
		$this->set_field_exclusion($fields, $exclude);
	}

	private function refresh_exclusions($form) {
		$form_fields = $this->get_form_fields($form);
		$excluded = array_intersect($this->get_excluded_fields(), $form_fields);
		$mg_excluded = [];
		$metadata = $this->proj->getMetadata();
		foreach ($excluded as $field) {
			if (isset($metadata[$field]) && $metadata[$field]["grid_name"]) {
				$mg_excluded[$metadata[$field]["grid_name"]] = true;
			}
		}
		$mg_excluded = array_keys($mg_excluded);
		return [
			"fieldsExcluded" => $excluded,
			"matrixGroupsExcluded" => $mg_excluded,
		];
	}

	private function search_ontologies($payload) {

		$term = trim($payload["term"] ?? "");
		if ($term == "") return null;
		$dummy_data = [
			"1001" => "Test 1",
			"1002" => "Test 2",
			"1003" => "Test 3",
			"1004" => "Other item 4",
			"1005" => "Other ontology test example 5",
		];
		
		$result = [];
		foreach ($dummy_data as $val => $label) {

			$display_item = "[$val] $label";
			$display_item = filter_tags(label_decode($display_item));
			$pos = stripos($display_item, $term);
			if ($pos !== false) {
				$term_length = strlen($term);
				$display_item = substr($display_item, 0, $pos) . 
					"<b style=\"color:#319AFF;\">".substr($display_item, $pos, $term_length)."</b>" . 
					substr($display_item, $pos + $term_length);
				$result[] = [
					"value" => $val,
					"label" => $label,
					"display" => $display_item,
				];
			}
		}
		if (count($result) == 0) {
			$result[] = [
				"value" => "",
				"label" => "",
				"display" => $this->tt("fieldedit_16"),
			];
		}

		// Artificial pause
		sleep(.5);

		return $result;
	}


	/**
	 * Gets the "Learn about using Ontology Annotations" content 
	 * @return string 
	 */
	private function get_fieldhelp() {
		return $this->tt("fieldedit_06");
	}

	#endregion


	private function parse_ontology($payload) {
		return [];
	}

	#region Private Helpers

	/**
	 * Gets the JS module name
	 * @return string 
	 */
	private function get_js_module_name() {
		return self::NS_PREFIX . self::EM_NAME;
	}

	/**
	 * Gets a list of field on the page
	 * @param string $form 
	 * @param boolean $is_survey
	 * @return array<string, array> 
	 */
	private function get_page_fields($form, $is_survey = false) {
		$this->require_proj();
		$fields = [];
		if ($is_survey) {
			$page = $_GET["__page__"];
			foreach ($GLOBALS["pageFields"][$page] as $field_name) {
				$fields[$field_name] = $this->get_field_metadata($field_name);
			}
		} else {
			foreach ($this->get_form_fields($form) as $field_name) {
				$fields[$field_name] = $this->get_field_metadata($field_name);
			}
		}
		return $fields;
	}

	private function get_project_forms() {
		$this->require_proj();
		return $this->is_draft_preview() ? $this->proj->forms_temp : $this->proj->getForms();
	}

	private function get_form_fields($form_name) {
		$this->require_proj();
		$forms = $this->get_project_forms();
		if (!isset($forms[$form_name])) {
			throw new Exception("Form '$form_name' does not exist!");
		}
		return array_keys($forms[$form_name]["fields"]);
	}

	private function get_project_metadata() {
		$this->require_proj();
		return $this->is_draft_preview() ? $this->proj->metadata_temp : $this->proj->getMetadata();
	}

	private function get_field_metadata($field_name) {
		$this->require_proj();
		$meta = $this->get_project_metadata();
		if (!array_key_exists($field_name, $meta)) {
			throw new Exception("Field '$field_name' does not exist!");
		}
		return $meta[$field_name];
	}

	private function is_draft_preview() {
		$this->require_proj();
		return intval($this->proj->project["status"] ?? 0) > 0 && intval($this->proj->project["draft_mode"]) > 0 && $GLOBALS["draft_preview_enabled"] == true;
	}

	private function init_proj($project_id) {
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
	}

	private function require_proj() {
		if ($this->proj == null) {
			throw new Exception("Project not initialized");
		}
	}

	private function init_config() {
		$this->require_proj();
		if (!$this->config_initialized) {
			$this->js_debug  = $this->getProjectSetting("javascript-debug") == true;
			$this->config_initialized = true;
		}
	}

	#endregion
}
