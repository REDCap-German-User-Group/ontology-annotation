<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

use InvalidArgumentException;
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
		if (!in_array($page, ["Design/online_designer.php"], true)) return;
	
		// Online Designer
		if ($page === "Design/online_designer.php") {
			$this->init_proj($project_id);
			$form = isset($_GET['page']) && array_key_exists($_GET['page'], $this->proj->forms) ? $_GET['page'] : null;
			if ($form) $this->init_online_designer($form);
			else return;
		}
	}

	// Injection
	function redcap_every_page_before_render($project_id) {
		// Only run in project context and on specific pages
		if ($project_id == null) return;
		$page = defined("PAGE") ? PAGE : null;
		if (!in_array($page, ["Design/edit_field.php"])) return;

		// Online Designer - Edit Field
		if ($page == "Design/edit_field.php") {
			$this->init_proj($project_id);
			$field_name = $_POST["field_name"];
			$exclude = ($_POST["rome-em-fieldedit-exclude"] ?? "0") == "1";
			$this->set_field_exclusion([$field_name], $exclude);
		}
	}

	// Config defaults
	function redcap_module_project_enable($version, $project_id) {
		// Ensure that some project settings have default values
		$current = $this->getProjectSettings();
		if (!array_key_exists("code-theme", $current)) {
			$this->setProjectSetting("code-theme", "dark");
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


	#region Plugin Page Configuration

	/**
	 * Get the base config for the JS client on plugin pages
	 * @return array 
	 */
	function get_plugin_base_config() {
		$js_base_config = [
			"debug" => $this->getProjectSetting("javascript-debug") == true,
			"version" => $this->VERSION,
			"moduleDisplayName" => $this->tt("module_name"),
			"isAdmin" => $this->framework->isSuperUser(),
			"pid" => intval($this->framework->getProjectId()),
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
	private function init_online_designer($form) {
		$this->init_config();
		$this->framework->initializeJavascriptModuleObject();
		$jsmo_name = $this->framework->getJavascriptModuleObjectName();
		$this->add_templates("online_designer");

		$config = [
			"debug" => $this->js_debug,
			"version" => $this->VERSION,
			"isAdmin" => $this->framework->isSuperUser(),
			"moduleDisplayName" => $this->tt("module_name"),
			"atName" => self::AT_ONTOLOGY,
			"form" => $form,
			"minimalAnnotation" => $this->getMinimalAnnotationJSON(),
			"knownLinks" => $this->getKnownLinks(),
		];
		$config = array_merge($config, $this->refresh_exclusions($form));
		$ih = $this->getInjectionHelper();
		$ih->js("js/ConsoleDebugLogger.js");
        $ih->js("js/ROME_OnlineDesigner.js");
		$ih->css("css/ROME_OnlineDesigner.css");
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
							<select id="rome-field-choice" class="form-select form-select-sm w-auto">
								<option value="dataElement">Field</option>
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
		$excluded = $this->load_excluded_fields();
		if ($exclude) {
			// TODO: Delete action tag from fields

			$excluded = array_unique(array_merge($excluded, $field_names));
		}
		else {
			$excluded = array_filter($excluded, function($val) use ($field_names) {
				return !in_array($val, $field_names);
			});
		}
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		$valid_field_names = array_keys($metadata);
		$excluded = array_intersect($excluded, $valid_field_names);
		sort($excluded);
		$this->store_excluded_fields($excluded);
	}

	private function load_excluded_fields() {
		$excluded = json_decode($this->framework->getProjectSetting(self::STORE_EXCLUSIONS) ?? "[]");
		if (!is_array($excluded)) $excluded = [];
		return $excluded;
	}

	private function store_excluded_fields($excluded) {
		if (!is_array($excluded)) $excluded = [];
		$this->framework->setProjectSetting(self::STORE_EXCLUSIONS, json_encode($excluded));
	}

	private function set_matrix_exclusion($args) {
		$grid_name = $args["grid_name"] ?? "";
		$exclude = $args["exclude"] == "1";
		$fields = [];
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		foreach ($metadata as $field_name => $field_data) {
			if ($field_data["grid_name"] === $grid_name) {
				$fields[] = $field_name;
			}
		}
		$this->set_field_exclusion($fields, $exclude);
	}

	private function refresh_exclusions($form) {
		$metadata = $this->proj->isDraftMode() ? $this->proj->metadata_temp : $this->proj->metadata;
		$form_fields = array_keys(array_filter($metadata, function($field_data) use ($form) { return $field_data["form_name"] === $form; }));
		$excluded = array_intersect($this->load_excluded_fields(), $form_fields);
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
        $minimal_datasets  = [];
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
             $title = $minimal_dataset["title"];
             $items_stack = $minimal_dataset["item"];
             while(!empty($items_stack)) {
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
                                 "<span class=\"rome-edit-field-ui-search-match\">".substr($display_item, $pos, $term_length)."</span>" . 
                                 substr($display_item, $pos + $term_length);
                         }
                         $result[] = [
                             "value" => json_encode($current_item),
                             "label" => $current_item['text'],
                             "display" => "<b>$title</b>: " . $display_item
                         ];
                     }
                 }
             }
 		}		
        
        if ($this->getProjectSetting("minimal-datasets-only")) {
            return $result;
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
					"value" => json_encode(["code" => ["system" => $ontology_system, "code" => $val, "display" => $label]]),
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


	// Method not currently implemented - used for ??
	private function parse_ontology($payload) {
		return [];
	}

	#region Discover Page

	/**
	 * Generates a JSON string with all annotated fields from (discoverable) projects
	 * @param Array $payload - Ajax payload (not currently used; used for future functionality such as
	 * excluding projects in development, or requiring a minimum number of records)
	 * @return string
	 */
    private function discover_ontologies($payload) {
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
        return $result["info"];
    }

	#endregion

	#region Misc Private Helpers

	/**
	 * Gets the JS module name
	 * @return string 
	 */
	private function get_js_module_name() {
		return self::NS_PREFIX . self::EM_NAME;
	}

	/**
	 * Makes the internal project structure accessible to the module
	 * @param string|int $project_id 
	 * @return void 
	 */
	private function init_proj($project_id) {
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
	}

	/**
	 * Reads and sets commonly used module settings as fields of the class, for convenience
	 * @return void 
	 */
	private function init_config() {
		if (!$this->config_initialized) {
			$this->js_debug  = $this->getProjectSetting("javascript-debug") == true;
			$this->config_initialized = true;
		}
	}

	#endregion

	#region Public Helpers

	function getInjectionHelper() {
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
	function getMinimalAnnotationJSON() {
		$minimal = [
			"resourceType" => "ROME_Annotation",
			"meta" => null,
			"dataElement" => [
				"type" => '',
				'coding' => [],
				'text' => '',
				'valueCodingMap' => null,
			],
		];
		return json_encode($minimal, JSON_UNESCAPED_UNICODE);
	}

	function getKnownLinks() {
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

}
