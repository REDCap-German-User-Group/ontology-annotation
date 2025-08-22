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
		// Only run in project context and on specific pages
		if ($project_id == null) return; 
		$page = defined("PAGE") ? PAGE : null;
		if (!in_array($page, ["Design/online_designer.php"])) return;

		$this->init_proj($project_id);
		$form = isset($_GET['page']) && array_key_exists($_GET['page'], $this->proj->forms) ? $_GET['page'] : null;
		if ($page == "Design/online_designer.php" && $form != null) {
			$this->init_online_designer($form);
		}
	}

	function redcap_every_page_before_render($project_id) {
		// Only run in project context and on specific pages
		if ($project_id == null) return;
		$page = defined("PAGE") ? PAGE : null;
		if (!in_array($page, ["Design/edit_field.php"])) return;

		$this->init_proj($project_id);
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
            case "discover":
                return $this->discover_ontologies($payload);
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
							<button id="rome-add-button" type="button" class="btn btn-rcgreen btn-xs"><?=$this->tt("fieldedit_10")?></button>
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
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->getMetadata();
		foreach ($metadata as $field_name => $field_data) {
			if ($field_data["grid_name"] === $grid_name) {
				$fields[] = $field_name;
			}
		}
		$this->set_field_exclusion($fields, $exclude);
	}

	private function refresh_exclusions($form) {
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->getMetadata();
		$form_fields = array_filter($metadata, function($field_data) use ($form) { return $field_data["form_name"] === $form; });
		$excluded = array_intersect($this->get_excluded_fields(), $form_fields);
		$mg_excluded = [];
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

		$result = [];

        // search configured minimal datasets first
        $minmal_datasets  = [];
        // project specific jsons
        foreach ($this->getProjectSetting("minimal-dataset") as $minimal_dataset_string) {
			if ($minimal_dataset_string == null) continue;
            $minimal_datasets[] = $minimal_dataset_string;
        }
        // enabled standard minimal datasets
        foreach (glob(__DIR__ . "/minimal_datasets/*.json") as $filename) {
            if ($this->getProjectSetting("minimal-dataset-file-" . basename($filename, ".json"))) {
                $minimal_datasets[] = file_get_contents($filename);
            }
        }
                

		foreach ($minimal_datasets as $minimal_dataset_string) {
            $minimal_dataset = json_decode($minimal_dataset_string, true);
		    foreach (array_filter($minimal_dataset["items"],
                                  fn($item)  =>  preg_match("/$term/", $item["name"]))
                     as $found_item) {
                $result[] = [
                    "value" => json_encode($found_item["coding"]),
                    "label" => $found_item["name"],
                    "display" => "<b>" . $minimal_dataset["name"] . "</b>: " . $found_item["name"]
                ];
		    }	
		}		
		

		$bioportal_api_token = $GLOBALS["bioportal_api_token"] ?? "";
		if ($bioportal_api_token == "") return null;

		$bioportal_api_url = $GLOBALS["bioportal_api_url"] ?? "";
		if ($bioportal_api_url == '') return null;

		// Fixed
		$ontology_acronym = "SNOMEDCT";
        $ontology_system  = "http://snomed.info/sct";


			// Build URL to call
		$url = $bioportal_api_url . "search?q=".urlencode($term)."&ontologies=".urlencode($ontology_acronym)
			 . "&suggest=true&include=prefLabel,notation,cui&display_links=false&display_context=false&format=json&apikey=" . $bioportal_api_token;
		// Call the URL
		$json = http_get($url);
		
		$response = json_decode($json, true);

		if (!$response || !$response["collection"]) return null;
		
		$dummy_data = [];
		foreach ($response["collection"] as $item) {
			$dummy_data[$item["notation"]] = $item["prefLabel"];
		}
	
		foreach ($dummy_data as $val => $label) {
			$display_item = "[$val] $label";
			$display_item = filter_tags(label_decode($display_item));
			$pos = stripos($display_item, $term);
			if ($pos !== false) {
				$term_length = strlen($term);
				$display_item = substr($display_item, 0, $pos) . 
					"<span class=\"rome-edit-field-ui-search-match\">".substr($display_item, $pos, $term_length)."</span>" . 
					substr($display_item, $pos + $term_length);
				$result[] = [
					"value" => json_encode(["system" => $ontology_system, "code" => $val, "display" => $label]),
					"label" => $label,
					"display" => "<b>" . $ontology_acronym . "</b>: " . $display_item,
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


    private function discover_ontologies($payload) {
        # JSON object containing all the relevant projects and fields
        # for now, return all the data, in the future $payload might
        # restrict search for example to projects in production etc.
        $sql = <<<SQL
            with
    -- all projects that have the module installed and metadata marked as 'discoverable'
    project_ids as
       (select exs.project_id
           from redcap_external_modules ex inner join redcap_external_module_settings exs
	   on ex.external_module_id=exs.external_module_id and
	   ex.directory_prefix = 'rome' and exs.key = 'discoverable' and
	   exs.value='true'),
    -- name + contact info of the projects
    project_infos as
       (select rp.project_id, app_title, coalesce(project_contact_email, ru.user_email) as email,
               coalesce(project_contact_name, concat(ru.user_firstname, ' ', ru.user_lastname)) as contact
               from redcap_projects rp inner join project_ids on rp.project_id=project_ids.project_id
	       left join redcap_user_information ru on rp.created_by=ru.ui_id),
    -- all the fields from these projects with an @ONTOLOGY annotation	        
    fields as
     (select project_id, field_name,
      regexp_replace(misc, ".*@ONTOLOGY='([^']*)'.*", "\\\\1") as ontology
      from redcap_metadata where project_id in (select project_id from project_ids) and
      misc like '%@ONTOLOGY%'),    
    -- all the annotations for these fields
    annotations as 
    (select project_id, field_name, j.system, j.code, j.display from
           fields, json_table(ontology,
                   '$.item[*]' columns(system varchar(255) path '$.system',
		               code   varchar(255) path '$.code',
            display varchar(255) path '$.display')) j where json_valid(ontology)),
    -- grouped annotations
    grouped_annotations as
    (select system, code, display,
            json_objectagg(project_id, field_name) as field_names,
	    json_arrayagg(project_id) as projects
    from annotations group by system, code, display)
    -- putting it all together: project_info and grouped annotated fields
    select json_object('projects',
                       (select json_objectagg(project_id,
		                    json_object('app_title', app_title, 'email', email, 'contact', contact))
				from project_infos),
		       'fields',
		              (select json_arrayagg(json_object('field_names', field_names, 'system', system,
			                                       'code', code, 'display', display, 'projects', projects))
		               from grouped_annotations)) as info;
SQL;
        return ($this->query($sql, [])->fetch_assoc())["info"];
    }

	#region Private Helpers

	/**
	 * Gets the JS module name
	 * @return string 
	 */
	private function get_js_module_name() {
		return self::NS_PREFIX . self::EM_NAME;
	}



	private function init_proj($project_id) {
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
	}


	private function init_config() {
		if (!$this->config_initialized) {
			$this->js_debug  = $this->getProjectSetting("javascript-debug") == true;
			$this->config_initialized = true;
		}
	}

	#endregion
}
