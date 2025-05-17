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

	/** @var Project The current project */
	private $proj = null;
	/** @var int|null Project ID */
	private $project_id = null;

	const AT_ONTOLOGY = "@ONTOLOGY";

	#region Hooks

	function redcap_every_page_top($project_id) 
	{
		if ($project_id == null) return; // Only run in project context
		$this->init_proj($project_id);

		$page = defined("PAGE") ? PAGE : null;
		$form = isset($_GET['page']) && array_key_exists($_GET['page'], $this->proj->forms) ? $_GET['page'] : null;
		
		if ($page == "Design/online_designer.php" && $form != null) {
			$this->init_online_designer($form);
		}
	}

	function redcap_module_ajax($action, $payload, $project_id, $record, $instrument, $event_id, $repeat_instance, $survey_hash, $response_id, $survey_queue_hash, $page, $page_full, $user_id, $group_id) 
	{
		
		$breakpoint = "here";
	}

	#endregion

	#region Online Designer

	private function init_online_designer($form) {
		$this->init_config();
		$this->framework->initializeJavascriptModuleObject();
		$jsmo_name = $this->framework->getJavascriptModuleObjectName();
		$config = [
			"debug" => $this->js_debug,
			"version" => $this->VERSION,
		];
		require_once "classes/InjectionHelper.php";
		$ih = InjectionHelper::init($this);
		$ih->js("js/OntologiesMadeEasy.js");
		$ih->css("css/OntologiesMadeEasy.css");
		print RCView::script(self::NS_PREFIX . self::EM_NAME . ".init(".json_encode($config).", $jsmo_name);");
	}

	#endregion


	#region Private Helpers

	/**
	 * Gets a list of field on the page
	 * @param string $form 
	 * @param boolean $is_survey
	 * @return array<string, array> 
	 */
	private function get_page_fields($form, $is_survey = false)
	{
		$this->require_proj();
		$fields = [];
		if ($is_survey) {
			$page = $_GET["__page__"];
			foreach ($GLOBALS["pageFields"][$page] as $field_name) {
				$fields[$field_name] = $this->get_field_metadata($field_name);
			}
		}
		else {
			foreach($this->get_form_fields($form) as $field_name) {
				$fields[$field_name] = $this->get_field_metadata($field_name);
			}
		}
		return $fields;
	}


	private function get_project_forms()
	{
		$this->require_proj();
		return $this->is_draft_preview() ? $this->proj->forms_temp : $this->proj->getForms();
	}

	private function get_form_fields($form_name)
	{
		$this->require_proj();
		$forms = $this->get_project_forms();
		if (!isset($forms[$form_name])) {
			throw new Exception("Form '$form_name' does not exist!");
		}
		return array_keys($forms[$form_name]["fields"]);
	}

	private function get_project_metadata()
	{
		$this->require_proj();
		return $this->is_draft_preview() ? $this->proj->metadata_temp : $this->proj->getMetadata();
	}

	private function get_field_metadata($field_name)
	{
		$this->require_proj();
		$meta = $this->get_project_metadata();
		if (!array_key_exists($field_name, $meta)) {
			throw new Exception("Field '$field_name' does not exist!");
		}
		return $meta[$field_name];
	}

	private function is_draft_preview()
	{
		$this->require_proj();
		return intval($this->proj->project["status"] ?? 0) > 0 && intval($this->proj->project["draft_mode"]) > 0 && $GLOBALS["draft_preview_enabled"] == true;
	}

	private function init_proj($project_id)
	{
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
	}

	private function require_proj()
	{
		if ($this->proj == null) {
			throw new Exception("Project not initialized");
		}
	}

	private function init_config()
	{
		$this->require_proj();
		if (!$this->config_initialized) {
			$this->js_debug  = $this->getProjectSetting("javascript-debug") == true;
			$this->config_initialized = true;
		}
	}

	#endregion

}
