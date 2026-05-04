<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

require_once __DIR__ . '/classes/RomeFhirExtensions.php';

use BioPortal;
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
	const EXPORT_FORMAT_VERSION = '1.0.0';



	#region Hooks

	/**
	 * Link check
	 * @param int|string|null $project_id 
	 * @param array $link 
	 * @return array 
	 */
	function redcap_module_link_check_display($project_id, $link)
	{
		// Allow for all users in all contexts
		return $link;
	}

	/**
	 * Injection
	 * @param int|string|null $project_id 
	 * @return void 
	 */
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

	/**
	 * Injection
	 * @param int|string|null $project_id 
	 * @return void 
	 */
	function redcap_every_page_before_render($project_id)
	{
		// Only run in project context and on specific pages
		if ($project_id == null) return;
		$page = defined('PAGE') ? PAGE : null;

		// Online Designer - Edit Field
		if ($page == 'Design/edit_field.php') {
			$this->initProject($project_id);
			$field_name = $_POST['field_name'];
			$exclude = ($_POST['rome-em-exclude'] ?? '0') == '1';
			$this->set_field_exclusion([$field_name], $exclude);
		}
	}

	/**
	 * AJAX handler
	 * @param string $action 
	 * @param mixed $payload 
	 * @param int|string $project_id 
	 * @param string $record 
	 * @param string $instrument 
	 * @param string|int $event_id 
	 * @param string|int $repeat_instance 
	 * @param string $survey_hash 
	 * @param string|int $response_id 
	 * @param string $survey_queue_hash 
	 * @param string $page 
	 * @param string $page_full 
	 * @param string $user_id 
	 * @param string|int $group_id 
	 * @return mixed
	 */
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
			case 'configure':
				return $this->setConfigFromPluginPage($payload);
			case 'get-bioportal-ontologies':
				return $this->getBioPortalOntologies($payload);
			case 'test-bioportal-token':
				return $this->testBioPortalApiToken($payload);
			case 'get-snowstorm-branches':
				return $this->getSnowstormBranches($payload);
			case 'save-remote-source':
				try {
					return $this->saveRemoteSource($payload);
				} catch (Throwable $e) {
					return [
						'error' => $e->getMessage()
					];
				}
				break;
			case 'save-local-source':
				try {
					return $this->saveLocalSource($payload);
				} catch (Throwable $e) {
					return [
						'error' => $e->getMessage()
					];
				}
				break;
			case 'save-system-source':
				try {
					return $this->saveSystemSource($payload);
				} catch (Throwable $e) {
					return [
						'error' => $e->getMessage()
					];
				}
				break;
			case 'toggle-source-enabled':
				return $this->toggleSourceEnabled($payload);
			case 'delete-source':
				return $this->deleteSource($payload);
			case 'get-source-file-info':
				return $this->getSourceFileInfo($payload);
			case 'export-annotations':
				try {
					return $this->exportAnnotations($payload);
				} catch (Throwable $e) {
					return [
						'success' => false,
						'error' => $e->getMessage(),
						'errors' => [[
							'message' => $e->getMessage(),
						]],
					];
				}
		}
	}

	#endregion Hooks



	#region Plugin Page Configuration

	/**
	 * Get the config for the JS client on plugin pages
	 * 
	 * @param string $page
	 * @return array 
	 */
	function getPluginConfig($page)
	{
		$pid = intval($this->framework->getProjectId());
		if ($pid === 0) $pid = null;
		$debug = $this->getSystemSetting('sys-javascript-debug') == true;
		$jsConfig = [
			'debug' => $debug,
			'version' => $this->VERSION,
			'moduleDisplayName' => $this->tt('module_name'),
			'isAdmin' => $this->framework->isSuperUser(),
			'pid' => $pid,
			'page' => $page
		];

		if ($page === 'configure') {
			$jsConfig['sources'] = $this->getSystemSources();
		} else if ($page === 'manage' && $pid !== null) {
			$jsConfig['sources'] = $this->getProjectSources($pid);
			$jsConfig['sysSources'] = $this->getSystemSources(true);
		} else if ($page === 'export' && $pid !== null) {
			$jsConfig['export'] = $this->getExportPageConfig();
		}

		return $jsConfig;
	}

	#endregion

	#region Export

	private function getExportPageConfig(): array
	{
		$hasDraft = $this->proj !== null && $this->proj->isDraftMode();
		$states = ['production'];
		if ($hasDraft) $states[] = 'draft';

		$stateConfigs = [];
		foreach ($states as $state) {
			$metadata = $this->getProjectMetadataForState($state);
			$forms = [];
			foreach ($this->getProjectFormsForExport($metadata) as $formName => $formLabel) {
				$stats = $this->countExportableAnnotations($metadata, [$formName]);
				$forms[] = [
					'name' => $formName,
					'label' => $formLabel,
					'fieldCount' => $stats['fieldCount'],
					'validAnnotationCount' => $stats['valid'],
					'invalidAnnotationCount' => $stats['invalid'],
					'annotationCounts' => [
						$state => [
							'valid' => $stats['valid'],
							'invalid' => $stats['invalid'],
						],
					],
				];
			}
			$stateConfigs[$state] = [
				'forms' => $forms,
			];
		}

		$defaultMetadataState = $hasDraft ? 'draft' : 'production';
		return [
			'states' => $stateConfigs,
			'forms' => $stateConfigs[$defaultMetadataState]['forms'] ?? [],
			'formats' => [
				['value' => 'native', 'label' => 'Native ROME JSON'],
				['value' => 'fhir_questionnaire', 'label' => 'FHIR Questionnaire'],
			],
			'hasDraft' => $hasDraft,
			'defaultMetadataState' => $defaultMetadataState,
		];
	}

	private function exportAnnotations($payload): array
	{
		$forms = $payload['forms'] ?? [];
		if (!is_array($forms)) $forms = [];
		$forms = array_values(array_filter(array_map('strval', $forms)));

		$format = (string)($payload['format'] ?? 'native');
		if (!in_array($format, ['native', 'fhir_questionnaire'], true)) {
			throw new Exception('Unsupported export format.');
		}

		$metadataState = 'development';
		if ($this->proj->isProduction()) {
			$metadataState = (string)($payload['metadataState'] ?? ($this->proj->isDraftMode() ? 'draft' : 'production'));
			if ($metadataState === 'draft' && !$this->proj->isDraftMode()) $metadataState = 'production';
		}
		$metadata = $this->getProjectMetadataForState($metadataState);
		$knownForms = $this->getProjectFormsForExport($metadata);
		if (count($forms) === 0) $forms = array_keys($knownForms);
		$forms = array_values(array_intersect($forms, array_keys($knownForms)));
		if (count($forms) === 0) {
			throw new Exception('No valid forms selected for export.');
		}
		$scan = $this->collectExportAnnotations($metadata, $forms);

		$warnings = $scan['warnings'];
		if (count($scan['dataElements']) === 0) {
			return [
				'success' => false,
				'filename' => null,
				'mimeType' => 'application/json',
				'content' => '',
				'annotationCount' => 0,
				'errors' => $scan['errors'],
				'warnings' => $warnings,
				'error' => 'No viable ontology annotations found in the selected forms.',
			];
		}

		if ($format === 'fhir_questionnaire') {
			$doc = $this->buildFhirQuestionnaireExport($scan['dataElements'], $forms, $knownForms, $metadataState, $metadata);
			$filename = $this->buildExportFilename('fhir-questionnaire', 'json');
		} else {
			$doc = $this->buildNativeAnnotationExport($scan['dataElements'], $metadataState, $metadata);
			$filename = $this->buildExportFilename('rome-annotations', 'json');
		}

		return [
			'success' => true,
			'filename' => $filename,
			'mimeType' => 'application/json',
			'content' => json_encode($doc, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR),
			'annotationCount' => count($scan['dataElements']),
			'errors' => $scan['errors'],
			'warnings' => $warnings,
		];
	}

	private function getProjectFormsForExport(?array $metadata = null): array
	{
		$forms = [];
		$formLabels = [];
		if ($this->proj !== null && is_array($this->proj->forms)) {
			foreach ($this->proj->forms as $formName => $formInfo) {
				if (is_array($formInfo) && isset($formInfo['menu']) && trim((string)$formInfo['menu']) !== '') {
					$formLabels[(string)$formName] = (string)$formInfo['menu'];
				}
			}
		}
		if ($metadata !== null) {
			foreach ($metadata as $fieldData) {
				if (!is_array($fieldData)) continue;
				$formName = (string)($fieldData['form_name'] ?? '');
				if ($formName === '' || isset($forms[$formName])) continue;
				$forms[$formName] = $formLabels[$formName] ?? $formName;
			}
			return $forms;
		}
		if ($this->proj === null || !is_array($this->proj->forms)) return $forms;
		foreach ($this->proj->forms as $formName => $formInfo) {
			$forms[(string)$formName] = $formLabels[(string)$formName] ?? (string)$formName;
		}
		return $forms;
	}

	private function getProjectMetadataForState(string $state): array
	{
		if ($this->proj === null) return [];
		if ($state === 'draft' && $this->proj->isDraftMode() && is_array($this->proj->metadata_temp)) {
			return $this->proj->metadata_temp;
		}
		return is_array($this->proj->metadata) ? $this->proj->metadata : [];
	}

	private function countExportableAnnotations(array $metadata, array $forms): array
	{
		$fieldCount = 0;
		$valid = 0;
		$invalid = 0;
		$parser = $this->getExportAnnotationParser();
		foreach ($metadata as $fieldName => $fieldData) {
			if (!is_array($fieldData)) continue;
			if (!in_array((string)($fieldData['form_name'] ?? ''), $forms, true)) continue;
			$fieldCount++;
			$parsed = $parser->parse((string)($fieldData['misc'] ?? ''));
			if ($parsed['numTags'] === 0) continue;
			if ($parsed['error']) {
				$invalid++;
				continue;
			}
			if ($this->annotationHasExportableCoding($parsed['json'] ?? [])) $valid++;
		}
		return [
			'fieldCount' => $fieldCount,
			'valid' => $valid,
			'invalid' => $invalid,
		];
	}

	private function collectExportAnnotations(array $metadata, array $forms): array
	{
		$parser = $this->getExportAnnotationParser();
		$dataElements = [];
		$errors = [];
		$warnings = [];

		foreach ($metadata as $fieldName => $fieldData) {
			if (!is_array($fieldData)) continue;
			$formName = (string)($fieldData['form_name'] ?? '');
			if (!in_array($formName, $forms, true)) continue;

			$parsed = $parser->parse((string)($fieldData['misc'] ?? ''));
			if ($parsed['numTags'] === 0) continue;
			if ($parsed['error']) {
				$errors[] = [
					'form' => $formName,
					'field' => (string)$fieldName,
					'message' => $parsed['errorMessage'] ?: 'Invalid @ONTOLOGY JSON.',
				];
				continue;
			}

			$annotation = $parsed['json'] ?? [];
			if (!$this->annotationHasExportableCoding($annotation)) {
				$warnings[] = [
					'form' => $formName,
					'field' => (string)$fieldName,
					'message' => 'Annotation contains no exportable codings.',
				];
				continue;
			}

			$dataElements[(string)$fieldName] = $this->buildExportDataElement(
				(string)$fieldName,
				$fieldData,
				$annotation
			);
		}

		return [
			'dataElements' => $dataElements,
			'errors' => $errors,
			'warnings' => $warnings,
		];
	}

	private function getExportAnnotationParser()
	{
		return $this->createOntologyAnnotationParser([
			'tag' => self::AT_ONTOLOGY,
			'getMinAnnotation' => function () {
				return json_decode($this->getMinimalAnnotationJSON(), true);
			},
			'validate' => null,
		]);
	}

	private function annotationHasExportableCoding(array $annotation): bool
	{
		$de = $annotation['dataElement'] ?? [];
		if (!is_array($de)) return false;
		if (!empty($de['coding']) && is_array($de['coding'])) return true;
		if (!empty($de['unit']['coding']) && is_array($de['unit']['coding'])) return true;
		if (!empty($de['valueCodingMap']) && is_array($de['valueCodingMap'])) {
			foreach ($de['valueCodingMap'] as $entry) {
				if (!empty($entry['coding']) && is_array($entry['coding'])) return true;
			}
		}
		return false;
	}

	private function buildExportDataElement(string $fieldName, array $fieldData, array $annotation): array
	{
		$de = $annotation['dataElement'] ?? [];
		if (!is_array($de)) $de = [];
		$out = [
			'name' => $fieldName,
			'text' => (string)($fieldData['element_label'] ?? $fieldName),
			'type' => (string)($fieldData['element_type'] ?? 'text'),
		];

		if (!empty($de['coding']) && is_array($de['coding'])) {
			$out['coding'] = array_values($de['coding']);
		}
		if (!empty($de['unit']) && is_array($de['unit']) && !empty($de['unit']['coding']) && is_array($de['unit']['coding'])) {
			$out['unit'] = $de['unit'];
		}
		if (!empty($de['valueCodingMap']) && is_array($de['valueCodingMap'])) {
			$choices = $this->getChoiceLabelsForField($fieldData);
			$valueCodingMap = new stdClass();
			$count = 0;
			foreach ($de['valueCodingMap'] as $code => $entry) {
				if (!is_array($entry) || empty($entry['coding']) || !is_array($entry['coding'])) continue;
				$entry['text'] = $choices[(string)$code] ?? (string)($entry['text'] ?? $code);
				$valueCodingMap->$code = $entry;
				$count++;
			}
			if ($count > 0) $out['valueCodingMap'] = $valueCodingMap;
		}

		return $out;
	}

	private function getChoiceLabelsForField(array $fieldData): array
	{
		$fieldType = (string)($fieldData['element_type'] ?? '');
		if (in_array($fieldType, ['truefalse', 'yesno', 'slider'], true)) {
			$fixed = $this->getFixedEnums();
			$enum = $fixed[$fieldType] ?? '';
		} else {
			$enum = (string)($fieldData['element_enum'] ?? '');
		}
		return parseEnum($enum);
	}

	private function buildNativeAnnotationExport(array $dataElements, string $metadataState, array $metadata): array
	{
		// Transform data elements to output format
		$out = [];
		foreach ($dataElements as $fieldname => $de) {
			$out[] = $this->buildNativeExportDataElement($de, $metadata[$fieldname]);
		}

		return [
			'resourceType' => 'ROME_Ontology_Annotations',
			'url' => $this->getExportSourceUrl(),
			'meta' => [
				'version' => self::EXPORT_FORMAT_VERSION,
				'created' => date('c'),
				'creator' => 'ROME ' . $this->VERSION,
				'metadataState' => $metadataState,
			],
			'dataElements' => $out,
		];
	}

	private function buildNativeExportDataElement(array $de, array $fmd): array
	{
		$out = $de;
		// Type mapping from REDCap types to ROME types (depending on type and validation type)
		$vt = $fmd['element_validation_type'] ?? '';
		if ($fmd['element_type'] === 'text') {
			$out['type'] = 'string';
			switch ($vt) {
				case '': break;
				case 'time':
					$out['type'] = 'time';
					$out['precision'] = 'minutes';
					break;
				case 'time_hh_mm_ss':
					$out['type'] = 'time';
					$out['precision'] = 'seconds';
					break;
				case 'int':
					$out['type'] = 'number';
					$out['numericType'] = 'integer';
					break;
				case 'float':
				case 'number_comma_decimal':
					$out['type'] = 'number';
					$out['numericType'] = 'decimal';
					break;
				case 'number_1dp':
				case 'number_1dp_comma_decimal':
				case 'number_2dp':
				case 'number_2dp_comma_decimal':
				case 'number_3dp':
				case 'number_3dp_comma_decimal':
				case 'number_4dp':
				case 'number_4dp_comma_decimal':
					$out['type'] = 'number';
					$out['numericType'] = 'decimal';
					$out['precision'] = intval(substr($vt, 7, 1));
					break;
				case 'date_ymd':
				case 'date_dmy':
				case 'date_mdy':
					$out['format'] = substr($vt, -3);
					break;
				case 'datetime_ymd':
				case 'datetime_dmy':
				case 'datetime_mdy':
					$out['format'] = substr($vt, -3);
					$out['precision'] = 'minutes';
					break;
				case 'datetime_seconds_ymd':
				case 'datetime_seconds_dmy':
				case 'datetime_seconds_mdy':
					$out['format'] = substr($vt, -3);
					$out['precision'] = 'seconds';
					break;
				default:
					$out['format'] = $vt;
					break;
			}
		}
		else if ($fmd['element_type'] === 'textarea') {
			$out['type'] = 'text';
		}
		return $out;
	}

	private function buildFhirQuestionnaireExport(array $dataElements, array $forms, array $knownForms, string $metadataState, array $metadata): array
	{
		$itemsByForm = [];
		foreach ($dataElements as $fieldname => $de) {
			$form = $metadata[$fieldname]['form_name'];
			if (!isset($itemsByForm[$form])) $itemsByForm[$form] = [];
			$itemsByForm[$form][] = $this->buildFhirQuestionnaireItem($de, $metadata[$fieldname]);
		}

		$formItems = [];
		foreach ($forms as $form) {
			if (empty($itemsByForm[$form])) continue;
			$formItems[] = [
				'linkId' => $form,
				'text' => $knownForms[$form] ?? $form,
				'type' => 'group',
				'item' => $itemsByForm[$form],
			];
		}

		return [
			'resourceType' => 'Questionnaire',
			'url' => $this->getExportSourceUrl(),
			'status' => 'active',
			'title' => 'ROME ontology annotations',
			'date' => date('c'),
			'publisher' => 'ROME ' . $this->VERSION,
			'extension' => [[
				'url' => 'https://rub.de/rome/fhir/StructureDefinition/metadata-state',
				'valueCode' => $metadataState,
			]],
			'item' => $formItems,
		];
	}

	private function buildFhirQuestionnaireItem(array $de, array $fmd): array
	{
		$item = [
			'linkId' => (string)$de['name'],
			'text' => (string)$de['text'],
			'type' => $this->mapTypeToFhirQuestionnaireType($fmd),
		];

		if (!empty($de['coding']) && is_array($de['coding'])) {
			$item['code'] = array_values($de['coding']);
		}
		// Check if stdClass has any entries
		if (is_object($de['valueCodingMap']) && count(get_object_vars($de['valueCodingMap'])) > 0) {
			$item['answerOption'] = [];
			foreach ($de['valueCodingMap'] as $choiceCode => $entry) {
				// Add REDCap choice as valueCoding
				$answerOption = [
					'valueCoding' => [
						'system' => ROME_FHIR_Extensions::ROME_REDCAP_CHOICE,
						'code' => (string)$choiceCode,
						'display' => (string)($entry['text'] ?? $choiceCode),
					],
				];
				// Add codings as extension
				if (!empty($entry['coding']) && is_array($entry['coding'])) {
					$extensions = [];
					foreach ($entry['coding'] as $coding) {
						if (!is_array($coding)) continue;
						$extension = [
							'url' => ROME_FHIR_Extensions::ROME_ANSWEROPTION_ONTOLOGYANNOTATION,
							'extension' => [
								'url' => 'code',
								'valueCoding' => $coding,
							],
						];
						$extensions[] = $extension;
					}
					$answerOption['extension'] = $extensions;
				}
				$item['answerOption'][] = $answerOption;
			}
		}
		if ((string)($fmd['element_type'] ?? '') === 'checkbox') {
			$item['repeats'] = true;
		}
		if (!empty($de['unit']['coding']) && is_array($de['unit']['coding'])) {
			foreach ($de['unit']['coding'] as $coding) {
				if (!is_array($coding)) continue;
				$item['extension'][] = [
					'url' => ROME_FHIR_Extensions::QUESTIONNAIRE_UNIT,
					'valueCoding' => $coding,
				];
			}
		}

		return $item;
	}

	private function mapTypeToFhirQuestionnaireType(array $fmd): string
	{
		$type = (string)($fmd['element_type'] ?? '');
		switch ($type) {
			case 'textarea':
				return 'text';
			case 'yesno':
			case 'truefalse':
				return 'boolean';
			case 'radio':
			case 'dropdown':
			case 'checkbox':
				return 'coding';
			case 'file':
				return 'attachment';
			case 'slider':
				return 'choice';
			case 'sql':
				return 'string';
		}
		// Remaining are all text
		$vt = (string)($fmd['element_validation_type'] ?? '');
		switch ($vt) {
			case '': 
				return 'string';
			case 'time':
			case 'time_hh_mm_ss':
				return 'time';
			case 'int':
				return 'integer';
			case 'float':
			case 'number_comma_decimal':
			case 'number_1dp':
			case 'number_1dp_comma_decimal':
			case 'number_2dp':
			case 'number_2dp_comma_decimal':
			case 'number_3dp':
			case 'number_3dp_comma_decimal':
			case 'number_4dp':
			case 'number_4dp_comma_decimal':
				return 'decimal';
			case 'date_ymd':
			case 'date_dmy':
			case 'date_mdy':
				return 'date';
			case 'datetime_ymd':
			case 'datetime_dmy':
			case 'datetime_mdy':
			case 'datetime_seconds_ymd':
			case 'datetime_seconds_dmy':
			case 'datetime_seconds_mdy':
				return 'dateTime';
		}
		return 'string';
	}

	private function getExportSourceUrl(): string
	{
		if (!defined('APP_PATH_WEBROOT_FULL') || !defined('REDCAP_VERSION')) return '';
		$base = APP_PATH_WEBROOT_FULL . 'redcap_v' . REDCAP_VERSION . '/';
		$url = $base . 'index.php?pid=' . $this->project_id;
		return $url;
	}

	private function buildExportFilename(string $prefix, string $extension): string
	{
		return $prefix . '-' . date('Ymd-His') . '.' . $extension;
	}

	#endregion



	#region Prepare Sources for Client Use

	/**
	 * Gets all system sources
	 * 
	 * @param boolean $enabledOnly
	 * @return array 
	 */
	function getSystemSources($enabledOnly = false): array
	{
		$settings = $this->framework->getSystemSettings();
		$sources = [];
		foreach ($settings as $key => $value) {
			if (
				strpos($key, 'sys-ls_') === 0 ||
				strpos($key, 'sys-rs_') === 0
			) {
				$source = json_decode($value['system_value'], true);
				if (!is_array($source)) continue;
				if ($enabledOnly && !$source['enabled']) continue;
				$source = $this->prepSourceForClient(
					$source,
					$key,
					strpos($key, 'sys-ls_') === 0 ? 'local' : 'remote'
				);
				$sources[] = $source;
			}
		}
		return $sources;
	}

	/**
	 * Gets all project sources
	 * 
	 * @param int $project_id
	 * @param boolean $redact When false, the source will not be redacted (i.e., for internal use)
	 * @return array 
	 */
	function getProjectSources($project_id, $redact = true): array
	{
		$settings = $this->framework->getProjectSettings($project_id);
		$sources = [];
		foreach ($settings as $key => $value) {
			if (
				strpos($key, 'proj-ls_') === 0 || // Local
				strpos($key, 'proj-rs_') === 0 || // Remote
				strpos($key, 'proj-ss_') === 0    // System
			) {
				$source = json_decode($value, true);
				if (!is_array($source)) continue;
				$type = strpos($key, 'proj-ls_') === 0 ? 'local' : 'remote';

				$source = $this->prepSourceForClient(
					$source,
					$key,
					$type,
					$redact
				);
				$sources[] = $source;
			}
		}
		return $sources;
	}

	/**
	 * Prepares a source for client use (redacting sensitive stuff, etc.)
	 * @param array $source 
	 * @param string $key 
	 * @param string $type 
	 * @param bool $redact 
	 * @return array 
	 */
	function prepSourceForClient($source, $key, $type, $redact = true): array
	{
		$source['key'] = $key;

		// If this is a system source proxy, then check if the system source is 
		// currently still available (present and enabled)
		if (($source['system_source_id'] ?? null) !== null) {
			$systemSource = $this->getSourceByKey($source['system_source_id']);
			// Add warnings
			if ($systemSource === null) {
				$source['message'] = "The system source for this source is no longer available. This source should be deleted.";
				$source['system_state'] = 'deleted';
				$source['enabled'] = false;
			}
			else if (!$systemSource['enabled']) {
				$source['message'] = "This system source for this source is currently disabled.";
				$source['system_state'] = 'disabled';
				$source['enabled'] = false;
			}
			else {
				$source['system_state'] = 'enabled';
			}
			$type = strpos($source['system_source_id'], 'sys-ls_') === 0 ? 'local' : 'remote';
			// If this is a local source, copy over stats
			if ($type === 'local') {
				$source['item_count'] = $systemSource['item_count'];
				$source['system_counts'] = $systemSource['system_counts'];
			}
			$source['from_system'] = true;
		}
		else {
			$source['from_system'] = false;
			if ($type === 'remote') {
				// Add indicator whether the source uses its own credentials (proj-defined sources only)
				$source['usesOwnCredentials'] = ($source['credentials'] ?? '') !== '';
			}
		}
		$source['type'] = $type;
		if ($redact) {
			// We don't want to leak doc_id and credentials to the client
			unset($source['credentials']);
			unset($source['doc_id']);
		}
		return $source;
	}

	#endregion



	#region Set Configuration from plugin pages

	private function requireProjectContext()
	{
		return $this->project_id !== null;
	}

	private function requireDesignRights()
	{
		if (!$this->requireProjectContext()) return false;
		if (!defined('USERID')) return false;
		$user = $this->framework->getUser(USERID);
		return $user->hasDesignRights($this->project_id);
	}

	private function requireSuperuser()
	{
		if (!defined('USERID')) return false;
		$user = $this->framework->getUser(USERID);
		return $user->isSuperUser();
	}

	private function setConfigFromPluginPage($payload)
	{
		$response = [
			'success' => true,
			'error' => null,
		];

		$valid_settings = [
			'proj-discoverable' => ['requireProjectContext', 'requireDesignRights'],
			'proj-can-configure' => ['requireProjectContext', 'requireSuperuser'],
			'sys-allow-rc-bioportal' => ['requireSuperuser'],
			'sys-javascript-debug' => ['requireSuperuser'],
			'user-toggledarkmode' => ['requireProjectContext'],
		];

		$setting = $payload['setting'] ?? '';
		$new_value = $payload['value'] ?? null;

		if (!array_key_exists($setting, $valid_settings)) {
			$response['success'] = false;
			$response['error'] = 'Invalid setting';
			return $response;
		}
		foreach ($valid_settings[$setting] as $requirement) {
			if (method_exists($this, $requirement) && is_callable([$this, $requirement])) {
				$result = $this->$requirement();
				if (!$result) {
					$response['success'] = false;
					$response['error'] = 'Insufficient permissions';
					return $response;
				}
			}
		}
		if (substr($setting, 0, 4) === 'sys-') {
			$this->framework->setSystemSetting($setting, $new_value);
		} else if ($this->project_id !== null && substr($setting, 0, 5) === 'proj-') {
			$this->framework->setProjectSetting($setting, $new_value, $this->project_id);
		} else if ($this->project_id !== null && defined('USERID') && substr($setting, 0, 5) === 'user-') {
			$this->framework->setUserSetting($setting, $new_value, USERID);
		} else {
			$response['success'] = false;
			$response['error'] = 'Invalid setting scope';
		}
		return $response;
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
		if (count($sources_list) == 0) {
			$errors[] = $this->tt('error_no_sources_configured');
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
			'minSearchLength' => self::MIN_SEARCH_LENGTH,
			'fixedEnums' => $this->getFixedEnums(),

		];
		// Add some language strings
		$this->framework->tt_transferToJavascriptModuleObject([
			'fieldedit_07',
			'fieldedit_17',
			'fieldedit_18',
			'fieldedit_19',
		]);
		$config = array_merge($config, $this->refresh_exclusions($form));
		$ih = $this->getInjectionHelper();
		$ih->js('js/ConsoleDebugLogger.js');
		$ih->js('js/WatchTargets.js');
		$ih->js('js/ROME_OnlineDesigner.js');
		$ih->css('css/ROME_OnlineDesigner.css');
		echo RCView::script(self::NS_PREFIX . self::EM_NAME . '.init(' . $this->romeJsonEncode($config) . ", $jsmo_name);");
	}

	private function getFixedEnums()
	{
		return [
			'truefalse' => "1, " . \RCView::getLangStringByKey('design_186') . "\n0, " . \RCView::getLangStringByKey('design_187'),
			'yesno' => "1, " . \RCView::getLangStringByKey('design_100') . "\n0, " . \RCView::getLangStringByKey('design_99'),
			// We treat 'slider' as a special case of a categorical variable
			'slider' => "L, " . $this->framework->tt("fieldedit_20") . "\nM, " . $this->framework->tt("fieldedit_21") . "\nR, " . $this->framework->tt("fieldedit_22"),
		];
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
						<div class="rome-em-exclude-field">
							<label class="form-check-label ms-1 rome-em-field-exclude">
								<input type="checkbox" class="form-check-input ms-3 rome-em-exclude">
								<?= $this->tt('fieldedit_11') ?>
							</label>
						</div>
						<div class="rome-em-exclude-matrix">
							<label class="form-check-label ms-1 rome-em-matrix-exclude">
								<input type="checkbox" class="form-check-input ms-3 rome-em-exclude">
								<?= $this->tt('fieldedit_12') ?>
							</label>
						</div>
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
								<div id="rome-search-error">
									<i class="fa-solid fa-circle-exclamation fa-lg fa-fade"></i>
								</div>
							</div>
							<div class="rome-edit-field-ui-list">
								<table id="rome-annotation-table" class="table table-sm table-striped align-middle">
									<thead>
										<tr>
											<th>System</th>
											<th>Code</th>
											<th>Display</th>
											<th>Target</th>
											<th>Action</th>
										</tr>
									</thead>
									<tbody></tbody>
								</table>
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
		$this->framework->setProjectSetting(
			self::STORE_EXCLUSIONS,
			$this->romeJsonEncode($excluded)
		);
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
							'value' => $this->romeJsonEncode($current_item),
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
					'value' => $this->romeJsonEncode(['code' => ['system' => $ontology_system, 'code' => $val, 'display' => $label]]),
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
		$discoverableSettingName = 'proj-discoverable';
		// $sql = <<<SQL
		// 	WITH
		// 		-- all projects that have the module installed and metadata marked as 'discoverable'
		// 		project_ids AS
		// 		(
		// 			SELECT exs.project_id
		// 			FROM redcap_external_modules ex 
		// 			INNER JOIN redcap_external_module_settings exs ON
		// 				ex.external_module_id=exs.external_module_id AND
		// 				ex.directory_prefix = ? AND
		// 				exs.key = 'discoverable' AND
		// 				exs.value='true'
		// 		),
		// 		-- name + contact info of the projects
		// 		project_infos AS
		// 		(
		// 			SELECT rp.project_id, app_title, COALESCE(project_contact_email, ru.user_email) AS email,
		// 				COALESCE(project_contact_name, CONCAT(ru.user_firstname, ' ', ru.user_lastname)) AS contact
		// 			FROM redcap_projects rp INNER JOIN project_ids ON rp.project_id=project_ids.project_id
		// 			LEFT JOIN redcap_user_information ru ON rp.created_by=ru.ui_id
		// 		),
		// 		-- all the fields from these projects with an @ONTOLOGY annotation	        
		// 		fields as
		// 		(
		// 			SELECT project_id, field_name, 
		// 				regexp_replace(misc, ".*@ONTOLOGY='([^']*)'.*", "\\\\1") AS ontology
		// 			FROM redcap_metadata 
		// 			WHERE project_id IN (SELECT project_id FROM project_ids) AND 
		// 				misc LIKE '%@ONTOLOGY%'
		// 		),
		// 		-- all the annotations for these fields
		// 		annotations AS 
		// 		(
		// 			SELECT project_id, field_name, j.system, j.code, j.display
		// 			FROM fields, json_table(
		// 				ontology, '$.dataElement.coding[*]' columns(
		// 					system varchar(255) path '$.system',
		// 					code   varchar(255) path '$.code',
		// 					display varchar(255) path '$.display')
		// 			) j 
		// 			WHERE json_valid(ontology)
		// 		),
		// 		-- grouped annotations
		// 		grouped_annotations AS
		// 		(
		// 			SELECT system, code, display,
		// 				json_objectagg(project_id, field_name) as field_names,
		// 				json_arrayagg(project_id) as projects
		// 			FROM annotations
		// 			GROUP BY system, code, display
		// 		)
		// 		-- putting it all together: project_info and grouped annotated fields
		// 		SELECT json_object
		// 		(
		// 			'projects', (SELECT json_objectagg(project_id, json_object('app_title', app_title, 'email', email, 'contact', contact)) FROM project_infos),
		// 			'fields', (SELECT json_arrayagg(json_object('field_names', field_names, 'system', system, 'code', code, 'display', display, 'projects', projects)) FROM grouped_annotations)
		// 		) AS info;
		// SQL;
		// $start = microtime(true);
		// $q = $this->query($sql, [$this->PREFIX]);
		// $result = $q->fetch_assoc();

		// $end = microtime(true);
		// $duration_ms = round(($end - $start) * 1000, 2);
		// $json = json_decode($result["info"], true); 
		// $json['queryDurationMs'] = $duration_ms;
		// return $json;


		// Part 1
		$sql = <<<SQL
			SELECT
				rp.project_id,
				rp.app_title,
				COALESCE(rp.project_contact_email, ru.user_email) AS email,
				COALESCE(rp.project_contact_name, CONCAT(ru.user_firstname, ' ', ru.user_lastname)) AS contact
			FROM redcap_external_modules ex
			INNER JOIN redcap_external_module_settings exs
				ON ex.external_module_id = exs.external_module_id
				AND ex.directory_prefix = ?
				AND exs.`key` = ?
				AND exs.`value` = 'true'
			INNER JOIN redcap_projects rp
				ON rp.project_id = exs.project_id
			LEFT JOIN redcap_user_information ru
				ON rp.created_by = ru.ui_id;
		SQL;
		$start = microtime(true);
		$q = $this->query($sql, [$this->PREFIX, $discoverableSettingName]);
		$projects = [];
		while ($row = $q->fetch_assoc()) {
			$projects[$row['project_id']] = [
				'app_title' => $row['app_title'],
				'email' => $row['email'],
				'contact' => $row['contact'],
			];
		}
		$end = microtime(true);
		$duration_ms = round(($end - $start) * 1000, 2);
		$json['projects'] = $projects;
		$json['projectQueryDurationMs'] = $duration_ms;
		// Part 2
		$sql = <<<SQL
			SELECT
				y.project_id,
				y.field_name,
				CASE
					WHEN y.json_start > 0 AND y.last_brace_in_tail > 0
					THEN SUBSTRING(y.tail, y.json_start, y.last_brace_in_tail - y.json_start + 1)
					ELSE NULL
				END AS ontology_json
			FROM (
				SELECT
					x.project_id,
					x.field_name,
					x.tail,
					x.json_start,
					(LENGTH(x.tail) - LOCATE('}', REVERSE(x.tail)) + 1) AS last_brace_in_tail
				FROM (
					SELECT
						m.project_id,
						m.field_name,
						SUBSTRING(m.misc, LOCATE('@ONTOLOGY', m.misc)) AS tail,
						/* erste '{' im Tail (Start JSON) */
						LOCATE('{', SUBSTRING(m.misc, LOCATE('@ONTOLOGY', m.misc))) AS json_start
					FROM redcap_external_modules ex
					INNER JOIN redcap_external_module_settings exs
						ON ex.external_module_id = exs.external_module_id
						AND ex.directory_prefix = ?
						AND exs.`key` = ?
						AND exs.`value` = 'true'
					INNER JOIN redcap_metadata m
						ON m.project_id = exs.project_id
					WHERE m.misc LIKE '%@ONTOLOGY%'
				) AS x
			) AS y;
		SQL;

		$fields = [];
		$start = microtime(true);
		$q = $this->query($sql, [$this->PREFIX, $discoverableSettingName]);
		while ($row = $q->fetch_assoc()) {
			$fields[] = $row;
		}
		$end = microtime(true);
		$duration_ms = round(($end - $start) * 1000, 2);
		$json['fieldQueryDurationMs'] = $duration_ms;

		$parser = $this->createOntologyAnnotationParser([
			'tag' => '@ONTOLOGY',
			'getMinAnnotation' => function () {
				return json_decode($this->getMinimalAnnotationJSON(), true);
			},
			'validate' => null,
		]);
		$start = microtime(true);
		$annotations = [];
		foreach ($fields as $field) {
			$r = $parser->parse('@ONTOLOGY=' . $field['ontology_json']);
			if (!$r['error']) {
				foreach ($r['json']['dataElement']['coding'] as $coding) {
					$system = "{$coding['system']}";
					$code = "{$coding['code']}";
					if (!isset($annotations[$system][$code])) {
						$annotations[$system][$code] = [
							'display' => $coding['display'] ?? null,
							'field_names' => [],
							'projects' => [],
						];
					}
					$pid = $field['project_id'];
					$annotations[$system][$code]['field_names'][$pid] = $field['field_name'];
					$annotations[$system][$code]['projects'][$pid] = true;
				}
			}
		}
		$alt_fields = [];
		foreach ($annotations as $system => $codes) {
			foreach ($codes as $code => $info) {
				$alt_fields[] = [
					'system' => $system,
					'code' => $code,
					'display' => $info['display'],
					'field_names' => $info['field_names'],
					'projects' => array_keys($info['projects']),
				];
			}
		}
		$end = microtime(true);
		$duration_ms = round(($end - $start) * 1000, 2);
		$json['annotationProcessingDurationMs'] = $duration_ms;
		$json['fields'] = $alt_fields;

		return $json;
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
	 * @param string|int|bool $project_id 
	 * @return bool 
	 */
	function initProject($project_id = false)
	{
		if ($project_id === false) {
			$project_id = defined('PROJECT_ID') ? PROJECT_ID : $this->framework->getProjectId();
		}
		if ($project_id === null) return false;
		if ($this->proj == null) {
			$this->proj = new \Project($project_id);
			$this->project_id = $project_id;
		}
		return $project_id !== null;
	}

	/**
	 * Reads and sets commonly used module settings as fields of the class, for convenience
	 * @return void 
	 */
	function initConfig()
	{
		if ($this->config_initialized) return;

		$project_id = defined('PROJECT_ID') ? PROJECT_ID : $this->framework->getProjectId();
		$this->initProject($project_id);

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


	function checkCacheConfigured()
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
				'valueCodingMap' => new stdClass(),
				'unit' => [
					'coding' => [],
					'text' => '',
				]
			],
		];
		return $this->romeJsonEncode($minimal);
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
	 * @param string|null $hexOrUuid A UUID or 32-character hex string that will be used as the source id when provided
	 * @return array{id:string, uuid:string}
	 * @throws Exception
	 */
	private function generateSourceId($hexOrUuid = null): array
	{
		if ($hexOrUuid !== null) {
			$hex = preg_replace('/[^A-Fa-f0-9]/', '', $hexOrUuid);
			if (strlen($hex) !== 32) {
				throw new Exception('Invalid uuid or hex string');
			}
		} else {
			// UUID v4: 16 random bytes with version/variant bits set.
			$b = random_bytes(16);
			$b[6] = chr((ord($b[6]) & 0x0f) | 0x40); // version 4
			$b[8] = chr((ord($b[8]) & 0x3f) | 0x80); // variant RFC 4122

			$hex = bin2hex($b); // 32 hex chars
		}

		$uuid = substr($hex, 0, 8) . '-' .
			substr($hex, 8, 4) . '-' .
			substr($hex, 12, 4) . '-' .
			substr($hex, 16, 4) . '-' .
			substr($hex, 20, 12);

		return [
			'id' => 'src_' . $hex,
			'uuid' => $uuid,
			'hex' => $hex
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
			$entry[$metaKey] = $this->romeJsonEncode($meta);
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
		$this->initConfig();
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

	public function buildSourceRegistry(int $project_id, ?string $type = null): array
	{
		$effective = [];

		$sources = $this->getProjectSources($project_id, false);
		foreach ($sources as $src) {
			if (!($src['enabled'] ?? false)) continue;
			if ($type && $type !== $src['type']) continue;
			$effective[$src['id']] = $src;
		}

		// Build JS list (id + label + optional hint/count)
		$list = [];
		foreach ($effective as $id => $src) {
			$list[] = [
				'id' => $src['id'],
				'label' => $src['title_resolved'],
				'desc' => $src['description_resolved'],
				'count' => $src['item_count'] ?? null,
				'system_counts' => $src['system_counts'] ?? null,
				'hint' => $src['type'],
			];
		}

		// Stable ordering helps UX
		usort($list, function ($a, $b) {
			return strcasecmp((string)$a['label'], (string)$b['label']);
		});

		// Lookup map for server dispatch (by id)
		$map = [];
		foreach ($effective as $id => $src) {
			if ($src['type'] === 'remote') {
				$docId = null;
				$indexCacheKey = null;
				$itemCount = -1;
				$meta = $src;
			} else {
				$docId = (int)$src['doc_id'];
				$indexCacheKey = 'idx:' . $id . ':' . $docId;
				$itemCount = (int)($src['item_count'] ?? 0);
				$meta = $src;
			}
			// TODO: Determine scope (project or system)
			$scope = 'project';
			$map[$id] = [
				'id' => $id,
				'scope' => $scope,
				'kind' => $src['kind'],
				'deferred' => $src['type'] === 'remote',
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



	#endregion

	function getMinSearchLength(): int
	{
		return self::MIN_SEARCH_LENGTH;
	}

	function getMaxSearchResultsPerSource(): int
	{
		// TODO: Make this configurable
		return 25;
	}


	private function saveRemoteSource($payload)
	{
		try {
			// Validate
			// If context is 'configure', the user must be a superuser or
			// a project designer and the project must be allowed to use
			// the configure page
			if ($payload['context'] === 'configure' && !$this->canConfigure()) {
				throw new Exception('Not permitted to add sources outside a project context');
			}
			// id must be null (new source) or have a valid local source prefix (proj or sys)
			$id = $payload['id'] ?? null;
			if (! ($id === null ||
				strpos($id, 'sys-rs_') === 0 ||
				strpos($id, 'proj-rs_') === 0
			)) {
				throw new Exception('Invalid id');
			}
			// New entries must have a valid type
			if ($id === null) {
				$type = $payload['type'];
				if (!in_array($type, ['bioportal', 'snowstorm'], true)) {
					throw new Exception('Invalid type');
				}
				// Generate new ids
				$ids = $this->generateSourceId();
				$setting_key = ($payload['context'] === 'configure' ? 'sys-rs_' : 'proj-rs_') . $ids['hex'];
				$metaId = $ids['id'];
				$metaUuid = $ids['uuid'];
				// Create meta
				$meta = [
					'v' => 1,
					'id' => $metaId,
					'uuid' => $metaUuid,
					'kind' => $type,
					'enabled' => true,
				];
				if ($type === 'bioportal') {
					// BioPortal must have an acronym
					if (trim($payload['bp_ontology'] ?? '') === '') {
						throw new Exception('Missing BioPortal ontology');
					}
					$acronym = trim($payload['bp_ontology']);
					$meta['title'] = 'BioPortal: ' . $acronym;
					$bp = $this->getBioPortalApiDetails();
					$bp_ontologies = json_decode($bp['ontology_list'], true);
					$bp_ontology = array_find($bp_ontologies, function ($o) use ($acronym) {
						return $o['acronym'] === $acronym;
					});
					$meta['description'] = 'Search via BioPortal: ' . $bp_ontology['name'];
					$meta['acronym'] = $acronym;
					$token = trim($payload['bp_token'] ?? '');
					$creds = [];
					if ($token !== '') $creds['t'] = $token;
					$meta['credentials'] = $this->encryptCredentials($creds);
				} else if ($type === 'snowstorm') {
					// Snowstorm must have a base url
					if (trim($payload['ss_baseurl'] ?? '') === '') {
						throw new Exception('Missing Snowstorm base url');
					}
					// Snowstorm must have a branch
					if (trim($payload['ss_branch'] ?? '') === '') {
						throw new Exception('Missing Snowstorm branch');
					}
					// Auth must be one of none, basic or token
					if (!in_array($payload['ss_auth'] ?? '', ['none', 'basic', 'token'], true)) {
						throw new Exception('Invalid Snowstorm auth');
					}
					$meta['baseurl'] = trim($payload['ss_baseurl']);
					$meta['branch'] = trim($payload['ss_branch']);
					$meta['auth'] = $payload['ss_auth'];
					$creds = [];
					if ($meta['auth'] === 'basic') {
						$creds['u'] = trim($payload['ss_username'] ?? '');
						$creds['p'] = trim($payload['ss_password'] ?? '');
					} else if ($meta['auth'] === 'token') {
						$creds['t'] = trim($payload['ss_token'] ?? '');
					}
					$meta['credentials'] = $this->encryptCredentials($creds);
					$meta['title'] = 'Snowstorm:' . $meta['branch'];
					$meta['description'] = 'Search SNOMED CT via Snowstorm at ' . $meta['baseurl'];
				}
				// Title and description overrides
				$title = trim($payload['title'] ?? '');
				$meta['title_resolved'] = $title === '' ? $meta['title'] : $title;
				$description = trim($payload['description'] ?? '');
				$meta['description_resolved'] = $description === '' ? $meta['description'] : $description;
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				if ($payload['context'] === 'configure') {
					$this->framework->setSystemSetting($setting_key, $metaJson);
				} else {
					$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
				}
			} else {
				// Existing entries must have a valid id and type
				$source = $this->getSourceByKey($id);
				if (!is_array($source)) {
					return [
						'error' => 'Missing or invalid id. The source may have been deleted. Please refresh the page.',
					];
				}
				$meta = $source;
				// Resolve title and description
				$meta['title_resolved'] = strlen(trim($payload['title'])) > 0
					? trim($payload['title']) : $meta['title'];
				$meta['description_resolved'] = strlen(trim($payload['description'])) > 0
					? trim($payload['description']) : $meta['description'];
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				$setting_key = $id;
				if ($payload['context'] === 'configure') {
					$this->framework->setSystemSetting($setting_key, $metaJson);
				} else {
					$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
				}
			}

			$type = 'remote';

			return [
				'source' => $this->prepSourceForClient($meta, $setting_key, $type),
			];
		} catch (Throwable $e) {
			return [
				'error' => $e->getMessage(),
			];
		}
	}


	private function testBioPortalApiToken($token)
	{
		$token = trim($token['token'] ?? '');
		if ($token === '') return false;

		$url = 'https://data.bioontology.org/ontologies/LOINC?include=acronym&display_links=false&display_context=false&format=json';
		$ch = curl_init($url);
		curl_setopt_array($ch, [
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_HEADER         => true,
			CURLOPT_HTTPHEADER     => [
				"Authorization: apikey token=$token",
				'User-Agent: ' . $this->getUserAgentString(),
				'Accept: application/json',
			],
			CURLOPT_TIMEOUT        => 30,
		]);

		$body = curl_exec($ch);
		$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$err   = curl_error($ch);
		curl_close($ch);
		return $code !== 401 && $code !== 403;
	}

	/**
	 * Encrypts an array
	 * @param array $payload 
	 * @return null|string|false 
	 */
	private function encryptCredentials($payload)
	{
		if ($payload === null) return null;
		if ($payload === []) return '';
		if (!is_array($payload)) throw new \Exception('Invalid payload - must be null, empty string, or an array');
		$payload['__r'] = base64_encode(random_bytes(8));
		return encrypt($this->romeJsonEncode($payload));
	}

	/**
	 * Decrypts an encrypted array
	 * @param null|string $payload 
	 * @return null|array
	 */
	private function decryptCredentials($payload)
	{
		if ($payload === null) return null;
		if ($payload === '') return [];
		$decryptedVal = json_decode(decrypt($payload), true, 512, JSON_THROW_ON_ERROR);
		unset($decryptedVal['__r']);
		return $decryptedVal;
	}

	function canConfigure()
	{
		$is_project = $this->project_id !== null;
		$user = $this->framework->getUser();
		if ($user == null) return false;
		$hasDesignRights = $is_project && $user->hasDesignRights($this->project_id);
		$isSuperuser = $user->isSuperUser();
		$normalUserCanConfigure = $is_project && $this->framework->getProjectSetting("proj-can-configure", $this->project_id) === true;
		return $isSuperuser || ($hasDesignRights && $normalUserCanConfigure);
	}

	function canManage()
	{
		$is_project = $this->project_id !== null;
		$user = $this->framework->getUser();
		if ($user == null) return false;
		return $is_project && ($user->hasDesignRights() || $user->isSuperUser());
	}

	private function toggleSourceEnabled($payload)
	{
		$key = $payload['key'] ?? null;
		if (strpos($key, 'sys-') === 0) {
			if (!$this->canConfigure()) {
				return [
					'error' => 'You do not have permission to configure this source.',
				];
			}
			$source = json_decode($this->framework->getSystemSetting($key) ?? '', true);
		} else {
			$source = json_decode($this->framework->getProjectSetting($key, $this->project_id) ?? '', true);
		}
		if ($key === null || !is_array($source)) {
			return [
				'error' => 'Missing or invalid key. The source may have been deleted. Please refresh the page.',
			];
		}
		$source['enabled'] = !$source['enabled'];
		if (strpos($key, 'sys-') === 0) {
			$this->framework->setSystemSetting($key, $this->romeJsonEncode($source));
		} else {
			$this->framework->setProjectSetting($key, $this->romeJsonEncode($source), $this->project_id);
		}
		// Augment source
		$type = strpos($key, '-ls_') !== false ? 'local' : 'remote';
		$source = $this->prepSourceForClient($source, $key, $type);
		return [
			'source' => $source,
		];
	}

	private function deleteSource($payload): array
	{
		$key = trim($payload['key'] ?? '');
		$source = $this->getSourceByKey($key);
		if (!is_array($source)) {
			return [
				'error' => 'Missing or invalid key. The source may have been deleted. Please refresh the page.',
			];
		}

		// Delete it
		$project_id = strpos($key, 'sys-') === 0 ? null : $this->project_id;
		if ($project_id === null && !$this->canConfigure()) {
			return [
				'error' => 'You do not have permission to configure this source.',
			];
		} else if ($project_id !== null && !$this->canManage()) {
			return [
				'error' => 'You do not have permission to manage this source.',
			];
		}
		$doc_id = intval($source['doc_id'] ?? 0);
		if ($doc_id > 0) {
			$deleted = \Files::deleteFileByDocId($doc_id, $project_id);
		}
		if (strpos($key, 'sys-') === 0) {
			$this->framework->removeSystemSetting($key);
		} else {
			$this->framework->removeProjectSetting($key, $project_id);
		}
		$logMsg = strip_tags("Delete source $key: {$source['title_resolved']}");
		$this->framework->log($logMsg, [
			'project_id' => $project_id,
		]);

		return [
			'deleted' => $key,
		];
	}

	public function getSourceByKey($key)
	{
		$key = trim("$key");
		if ($key === '') return null;
		$source = null;
		if (strpos($key, 'sys-') === 0) {
			$source = json_decode($this->framework->getSystemSetting($key) ?? '', true);
		} else if (strpos($key, 'proj-') === 0) {
			$source = json_decode($this->framework->getProjectSetting($key, $this->project_id) ?? '', true);
		}
		return $source;
	}

	private function getSourceFileInfo($payload): array
	{
		$key = trim($payload['key'] ?? '');
		$source = $this->getSourceByKey($key);
		if (!is_array($source)) {
			return [
				'error' => 'Missing or invalid key. The source may have been deleted. Please refresh the page.',
			];
		}
		$doc_id = intval($source['doc_id'] ?? 0);
		$info = \Files::getEdocInfo($doc_id);
		$name = $info['doc_name'];
		// Trim .gz from compressed files
		if (ends_with($name, '.gz')) {
			$name = substr($name, 0, strlen($name) - 3);
		}
		return [
			'file' => [
				'name' => $name,
				'stored' => $info['stored_date'],
				'deleted' => $info['delete_date'] !== null,
			],
		];
	}


	private function saveSystemSource($payload): array
	{
		try {
			// Validate
			// Context must be 'manage', the user must be a project designer 
			if ($payload['context'] !== 'manage' || !$this->canManage()) {
				throw new Exception('Not permitted to add sources.');
			}
			// id must be null (new source) or have a valid system source prefix (proj)
			$id = $payload['id'] ?? null;
			if (! ($id === null || strpos($id, 'proj-ss_') === 0)) {
				throw new Exception('Invalid id');
			}
			if ($id === null) {
				// New entries must have a systemSourceId
				$systemSourceId = trim($payload['systemSourceId'] ?? '');
				$systemSource = $this->getSourceByKey($systemSourceId);
				if ($systemSource === null || !($systemSource['enabled'] ?? false)) {
					throw new Exception('Invalid system source id or system source has been disabled or deleted. Please refresh the page.');
				}
				$ids = $this->generateSourceId();
				$meta = [
					'v' => 1,
					'id' => $ids['id'],
					'uuid' => $ids['uuid'],
					'kind' => $systemSource['kind'],
					'title' => $systemSource['title'],
					'description' => $systemSource['description'],
				];
				// Resolve title and description
				$meta['title_resolved'] = strlen(trim($payload['title'])) > 0
					? trim($payload['title']) : $meta['title'];
				$meta['description_resolved'] = strlen(trim($payload['description'])) > 0
					? trim($payload['description']) : $meta['description'];
				// Set enabled to true
				$meta['enabled'] = true;
				// Finally, store the systemSourceId
				$meta['system_source_id'] = $systemSourceId;
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				$setting_key = 'proj-ss_' . $ids['hex'];
				$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
			} else {
				// Existing entries must have a an existing docId or a replacement file
				$source = $this->getSourceByKey($id);
				if (!is_array($source)) {
					return [
						'error' => 'Missing or invalid id. The source may have been deleted. Please refresh the page.',
					];
				}
				// Get the system source
				$systemSourceId = $source['system_source_id'] ?? '';
				$systemSource = $this->getSourceByKey($systemSourceId);
				if ($systemSource === null) {
					return [
						'error' => 'Missing or invalid system source id. The system source may have been deleted. Please refresh the page.',
					];
				} 
				$meta = $source;
				// Resolve title and description
				$meta['title_resolved'] = strlen(trim($payload['title'])) > 0
					? trim($payload['title']) : $meta['title'];
				$meta['description_resolved'] = strlen(trim($payload['description'])) > 0
					? trim($payload['description']) : $meta['description'];
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				$setting_key = $id;
				if ($payload['context'] === 'configure') {
					$this->framework->setSystemSetting($setting_key, $metaJson);
				} else {
					$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
				}
			}
			$type = $meta['type'];
			return [
				'source' => $this->prepSourceForClient($meta, $setting_key, $type),
			];
		} catch (Throwable $e) {
			return [
				'error' => $e->getMessage(),
			];
		}
	}

	private function saveLocalSource($payload): array
	{
		try {
			// Validate
			// If context is 'configure', the user must be a superuser or
			// a project designer and the project must be allowed to use
			// the configure page
			if ($payload['context'] === 'configure' && !$this->canConfigure()) {
				throw new Exception('Not permitted to add sources outside a project context.');
			}

			// id must be null (new source) or have a valid local source prefix (proj or sys)
			$id = $payload['id'] ?? null;
			if (! ($id === null ||
				strpos($id, 'sys-ls_') === 0 ||
				strpos($id, 'proj-ls_') === 0
			)) {
				throw new Exception('Invalid id');
			}
			if ($id === null) {
				// New entries must have a file
				$fileName = trim($payload['fileName'] ?? '');
				$fileContent = trim($payload['fileContent'] ?? '');
				if ($fileName === '' || $fileContent === '') {
					throw new Exception('Invalid or empty file');
				}
				list($setting_key, $meta) = $this->tryStoreNewLocalSource([
					'fileName' => $fileName,
					'fileContent' => $fileContent,
					'project_id' => $payload['context'] === 'configure' ? null : $this->project_id,
					'current_id' => null,
				]);
				// Resolve title and description
				$meta['title_resolved'] = strlen(trim($payload['title'])) > 0
					? trim($payload['title']) : $meta['title'];
				$meta['description_resolved'] = strlen(trim($payload['description'])) > 0
					? trim($payload['description']) : $meta['description'];
				// Set enabled to true
				$meta['enabled'] = true;
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				if ($payload['context'] === 'configure') {
					$this->framework->setSystemSetting($setting_key, $metaJson);
				} else {
					$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
				}
			} else {
				// Existing entries must have a an existing docId or a replacement file
				$source = $this->getSourceByKey($id);
				if (!is_array($source)) {
					return [
						'error' => 'Missing or invalid id. The source may have been deleted. Please refresh the page.',
					];
				}
				// Is this a replacement file?
				$fileName = trim($payload['fileName'] ?? '');
				$fileContent = trim($payload['fileContent'] ?? '');
				if ($fileContent !== '' && $fileName !== '') {
					// Replace file
					list($_, $meta) = $this->tryStoreNewLocalSource([
						'fileName' => $fileName,
						'fileContent' => $fileContent,
						'project_id' => $payload['context'] === 'configure' ? null : $this->project_id,
						'current_id' => $source['uuid'],
					]);
					// Copy updated meta over to source
					foreach ($meta as $metaKey => $metaValue) {
						$source[$metaKey] = $metaValue;
					}
				}
				$meta = $source;
				// Resolve title and description
				$meta['title_resolved'] = strlen(trim($payload['title'])) > 0
					? trim($payload['title']) : $meta['title'];
				$meta['description_resolved'] = strlen(trim($payload['description'])) > 0
					? trim($payload['description']) : $meta['description'];
				// Store metadata
				$metaJson = $this->romeJsonEncode($meta);
				$setting_key = $id;
				if ($payload['context'] === 'configure') {
					$this->framework->setSystemSetting($setting_key, $metaJson);
				} else {
					$this->framework->setProjectSetting($setting_key, $metaJson, $this->project_id);
				}
			}

			$type = 'local';

			return [
				'source' => $this->prepSourceForClient($meta, $setting_key, $type),
			];
		} catch (Throwable $e) {
			return [
				'error' => $e->getMessage(),
			];
		}
	}

	/**
	 * Parses a local resource file and stores the original file and sets the search cache
	 * @param array $data Array with fileContent, fileName, project_id, current_id (optional)
	 * @return array{string, array{v: int, id: string, uuid: string, doc_id: int|string, kind: mixed, title: mixed, description: mixed, item_count: int, system_counts: array, url: string, built_at: string}} 
	 * @throws mixed
	 */
	private function tryStoreNewLocalSource($data)
	{
		$fileContent = $data['fileContent'] ?? '';
		$fileName = $data['fileName'] ?? '';
		$project_id = $data['project_id'] ?? null;
		$current_id = $data['current_id'] ?? null;
		// File content must be valid JSON
		$json = json_decode(
			$fileContent,
			true,
			512,
			JSON_THROW_ON_ERROR
		);
		$kind = $this->mapLocalResourceKind($json['resourceType'] ?? null);
		$builders = $this->getLocalResourceBuilders($kind);
		if (count($builders) === 0) {
			throw new Exception('Incompatible file type (no builder found)');
		}
		$result = $builders[0]->buildFromJsonString($fileContent, []);
		// Do not save files with 0 counts
		if ($result->itemCount === 0) {
			throw new Exception('Invalid file (no items)');
		}
		// Check cache
		$cache = $this->getCache();
		if ($cache === null) {
			throw new Exception('Failed to access cache.');
		}
		// Save file (always compress)
		$filePath = $this->framework->createTempFile();
		$compressed = gzencode($fileContent, 9);
		file_put_contents($filePath, $compressed);
		$docId = \REDCap::storeFile($filePath, $project_id, $fileName . '.gz');
		if (!is_numeric($docId) || $docId <= 0) {
			throw new Exception('Failed to store file.');
		}
		// Due to a quirk in REDCap, project id will be set to a value other than null when
		// PROJECT_ID is defined. We compensate for system files by manually removing the project
		// id from the redcap_edocs_metadata table
		if ($docId > 0 && $project_id === null) {
			$sql = "UPDATE redcap_edocs_metadata SET project_id = NULL WHERE doc_id = ?";
			$this->framework->query($sql, $docId);
		}
		// Generate or recreate ids
		$ids = $this->generateSourceId($current_id);
		$setting_key = ($project_id === null ? 'sys-ls_' : 'proj-ls_') . $ids['hex'];
		$metaId = $ids['id'];
		$metaUuid = $ids['uuid'];
		// Save to cache
		// Cache key: versioned by doc_id.
		// Format: idx:<src_id>:<doc_id>
		$cacheKey = "idx:" . $metaId . ":" . $docId;
		// Store payload. TTL=0 means "never expires" (safe due to doc_id versioning).
		$ttl = 0;
		$cache->setPayload($cacheKey, $result->payload, $ttl, [
			'kind' => $result->kind,
			'id' => $metaId,
			'uuid' => $metaUuid,
			'doc_id' => $docId,
		]);
		// Validate code systems in use
		$system_counts = $result->payload['system_counts'] ?? [];
		if (!is_array($system_counts)) $system_counts = [];
		// Get title and description from source file
		$srcTitle = $result->payload['title'] ?? null;
		$srcDesc = $result->payload['description'] ?? null;
		// Generate metadata stub (missing: title_resolved, description_resolved, enabled)
		$meta_stub = [
			'v' => 1,
			'id' => $metaId,
			'uuid' => $metaUuid,
			'doc_id' => $docId,
			'kind' => $result->kind,
			'title' => $srcTitle,
			'description' => $srcDesc,
			'item_count' => (int)$result->itemCount,
			'system_counts' => $system_counts,
			'url' => (string)($result->payload['url'] ?? ''),
			'built_at' => (new \DateTimeImmutable(
				'now',
				new \DateTimeZone('UTC')
			)
			)->format('Y-m-d\TH:i:s\Z'),
		];
		return [$setting_key, $meta_stub];
	}

	function mapLocalResourceKind($kind)
	{
		switch ($kind) {
			case 'Questionnaire':
				return 'fhir_questionnaire';
		}
		return null;
	}

	private function getLocalResourceBuilders($kind = null, $first_only = false): array
	{
		require_once __DIR__ . '/classes/CacheBuilder.php';
		require_once __DIR__ . '/classes/FhirQuestionnaireIndexBuilder.php';

		// Builders
		$builders = [
			new FhirQuestionnaireIndexBuilder(),
		];

		if ($kind === null) return $builders;

		// Select compatible builders
		$valid_builders = [];
		foreach ($builders as $b) {
			if ($b instanceof LocalSourceIndexBuilder && $b->supports($kind)) {
				$valid_builders[] = $b;
				if ($first_only) break;
			}
		}
		return $valid_builders;
	}



	#region All Remote Source Kinds (from cache)

	/**
	 * Searches the cache for any previously stored results for the given source/query
	 * @param Cache $cache 
	 * @param string $q 
	 * @param array $source 
	 * @return null|array 
	 */
	function searchCached(Cache $cache, string $q, array $source): ?array
	{
		// Construct cache key
		$cacheKey = null;
		if ($source['kind'] === 'bioportal') {
			$acronym = $source['meta']['acronym'] ?? null;
			if ($acronym === null) throw new Exception('Invalid source - missing acronym');
			$cacheKey = $this->generateBioPortalSearchCacheKey($acronym, $q);
		} else if ($source['kind'] === 'snowstorm') {
			$cacheKey = $this->generateSnowstormSearchCacheKey($source['meta'], $q);
		}
		// Success?
		if ($cacheKey === null) {
			throw new Exception('Invalid source - unknown kind');
		}
		// Get cached (returns null if not cached, thus we can return this directly)
		$cached = $cache->getPayload($cacheKey);
		return $cached;
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

	#endregion All Remote Sources (Cache)



	#region Remote Source Kind: BioPortal

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
		$details = [
			'api_url' => (string)$GLOBALS['bioportal_api_url'] ?? '',
			'api_token' => (string)$GLOBALS['bioportal_api_token'] ?? '',
			'ontology_list' => (string)$GLOBALS['bioportal_ontology_list'] ?? '',
			'enabled' => $this->isBioPortalAvailable(),
		];
		return $details;
	}

	function getBioPortalResultIdPrefix($acronym, $token)
	{
		$bp = $this->getBioPortalApiDetails();
		$base = $bp['api_url'];
		$token = $token === '' ? $bp['api_token'] : $token;
		$headers = ['Accept: application/json'];
		$ua = $this->getUserAgentString();

		$id_prefix = null;

		$qs = str_split('aeioubcd0fghqvz', 1);
		foreach ($qs as $q) {
			$params = [
				'q' => $q,
				'ontologies' => $acronym,
				'suggest' => 'true',
				'include' => 'prefLabel,notation,cui',
				'display_links' => 'false',
				'display_context' => 'false',
				'format' => 'json',
				'pagesize' => 1,
				'page' => 1,
				'apikey' => $token,
			];
			$url = $base . 'search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);


			$resp = http_get($url, 5, '', $headers, $ua);
			try {
				$json = json_decode($resp, true, 512, JSON_THROW_ON_ERROR);
				foreach ($json['collection'] ?? [] as $result) {
					$val = $result['notation'] ?? $result['cui'] ?? null;
					$id = $result['@id'] ?? null;
					if ($val === null || $id === null) return null; // We cannot parse this result
					// Match val to id from their ends and find the part of id from start to where the match fails
					// e.g., val = "dcterms:AgentClass" and id = "http://purl.org/dc/terms/AgentClass",
					// then the id prefix would be "http://purl.org/dc/terms/"
					$id_len = mb_strlen($id);
					$val_len = mb_strlen($val);
					$val_pos = mb_strlen($val) - 1;
					while ($val_pos >= 0) {
						$c = mb_substr($val, $val_pos, 1);
						if ($c !== mb_substr($id, $id_len - ($val_len - $val_pos), 1)) break;
						$val_pos--;
					}
					$id_prefix = mb_substr($id, 0, $id_len - ($val_len - $val_pos));
					break;
				}
			} catch (\Throwable $e) {
				// do nothing
			}
		}
		return $id_prefix;
	}


	function getBioPortalOntologies($payload)
	{
		$token = $payload['token'] ?? null;
		$bp = $this->getBioPortalApiDetails();
		$rc_enabled = $bp['enabled'];
		if ($this->project_id) {
			$rc_enabled = $rc_enabled && $this->framework->getSystemSetting("sys-allow-rc-bioportal");
		}

		// We will NOT fetch the list of ontologies if REDCap already has a cached list
		if (!empty($bp['ontology_list'])) return [
			'rc_enabled' => $rc_enabled,
			'ontologies' =>	json_decode($bp['ontology_list'], true)
		];
		if (empty($token)) return [
			'rc_enabled' => $rc_enabled,
			'ontologies' => []
		];
		// Get the list of ontologies from BioPortal using the provided token
		try {
			return [
				'rc_enabled' => $rc_enabled,
				'ontologies' => $this->fetchBioPortalOntologies($token),
			];
		} catch (Exception $e) {
			return [
				'rc_enabled' => $rc_enabled,
				'ontologies' => [],
				'error' => $e->getMessage(),
			];
		}
	}

	private function fetchBioPortalOntologies($token)
	{
		$url = BioPortal::getApiUrl() . 'ontologies?include=name,acronym&display_links=false&display_context=false&format=json&apikey=' . $token;
		// Call the URL
		$jsonString = http_get($url);
		// Parse the JSON into an array
		$list = json_decode($jsonString, true);
		if (isset($list['error'])) throw new Exception($list['error']);
		if (!is_array($list)) throw new Exception("Failed to obtain data from BioPortal.");
		// Save the JSON in the config table
		$GLOBAL['bioportal_ontology_list'] = $jsonString;
		$GLOBAL['bioportal_ontology_list_cache_time'] = TODAY;
		$sql = "UPDATE redcap_config SET `value` = ? WHERE field_name = 'bioportal_ontology_list'";
		db_query($sql, [$jsonString]);
		$sql = "UPDATE redcap_config SET `value` = ? WHERE field_name = 'bioportal_ontology_list_cache_time'";
		db_query($sql, [TODAY]);
		return $list;
	}

	/**
	 * BioPortal search across multiple ontologies (acronyms).
	 * - validates acronyms against REDCap cached ontology list
	 * - returns per-acronym hit lists (each capped to $limit)
	 * - does ONE BioPortal call for all cache misses
	 *
	 * @param Cache $cache
	 * @param string $q
	 * @param array $source
	 * @param int $limit Limit per acronym
	 * @param int $ttlSeconds Cache TTL per acronym (e.g. 1800)
	 * @return array<string, array<int, array{system:string, code:string, display:string, score:int|float}>> keyed by QUERY ACRONYM
	 */
	function searchBioPortal(
		Cache $cache,
		string $q,
		array $source,
		int $limit,
		int $ttlSeconds = 1800
	): array {
		$out = [];
		$q = trim($q);

		if ($q === '' || $limit <= 0) return $out;
		$bp = $this->getBioPortalApiDetails();
		$base  = rtrim((string)($bp['api_url'] ?? ''), '/') . '/';
		$token = (string)($bp['api_token'] ?? '');
		$meta = $source['meta'] ?? [];
		if ($meta['credentials'] !== '') {
			$token = $this->decryptCredentials($meta['credentials'])['t'];
		}
		// Some checks
		if (empty($token)) throw new Exception('Invalid source metadata - missing BioPortal API token');
		$acronym = $meta['acronym'] ?? null;
		if ($acronym === null) throw new Exception('Invalid source metadata - missing BioPortal acronym');
		if ($limit < 1) throw new Exception('Invalid search request - limit must be at least 1');
		$limit = max(1, min($this->getMaxSearchResultsPerSource(), $limit));
		// Build request
		$params = [
			'q' => $q,
			'ontologies' => $acronym,
			'suggest' => 'true',
			'include' => 'prefLabel,notation,cui',
			'display_links' => 'false',
			'display_context' => 'false',
			'format' => 'json',
			'pagesize' => $limit,
			'page' => 1,
			'apikey' => $token,
		];
		$url = $base . 'search?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
		$headers = ['Accept: application/json'];
		$ua = $this->getUserAgentString();
		// Do request
		$resp = http_get($url, 5, '', $headers, $ua);
		if ($resp === false || trim($resp) === '') {
			throw new Exception('BioPortal search failed');
		}
		$json = json_decode($resp, true);
		$collection = is_array($json) ? ($json['collection'] ?? null) : null;
		if (!is_array($collection)) throw new Exception('BioPortal search failed');

		// Parse results
		foreach ($collection as $r) {
			if (!is_array($r)) continue;
			$id = isset($r['@id']) && is_string($r['@id']) ? $r['@id'] : '';
			$display = isset($r['prefLabel']) && is_string($r['prefLabel']) ? trim($r['prefLabel']) : '';
			if ($display === '' && isset($r['label']) && is_string($r['label'])) $display = trim($r['label']);
			if ($display === '') continue;
			$display = html_entity_decode($display, ENT_QUOTES | ENT_HTML5, 'UTF-8');
			// Prefer notation when present (canonical codes)
			$code = isset($r['notation']) && is_string($r['notation']) ? trim($r['notation']) : '';
			if ($code === '') {
				// fallback (still stable, but BioPortal-specific)
				$code = $id !== '' ? trim($id) : '';
			}
			if ($code === '') continue;

			$out[] = [
				'system' => $this->bioPortalSystemUriForAcronym($acronym, $id),
				'code' => $code,
				'display' => $display,
				'score' => 1,
			];
		}

		// Store into cache (even if empty, cache empties to avoid hammering)
		$cacheKey = $this->generateBioPortalSearchCacheKey($acronym, $q);
		$cache->setPayload($cacheKey, $out, $ttlSeconds, [
			'kind' => 'bioportal',
			'acr' => $acronym,
		]);

		return $out;
	}

	/**
	 * 
	 * @param string $acr 
	 * @param string $q 
	 * @return string 
	 */
	private function generateBioPortalSearchCacheKey(string $acr, string $q): string
	{
		$acr = strtoupper(trim($acr));

		$qNorm = mb_strtolower(trim($q));
		$qNorm = preg_replace('/\s+/u', ' ', $qNorm) ?? $qNorm;

		$preview = mb_substr($qNorm, 0, 40); // goal; will be truncated if needed

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
	 * System URI mapping (to be expanded).
	 * @param string $acr 
	 * @param string $id 
	 * @return string 
	 */
	private function bioPortalSystemUriForAcronym(string $acr, string $id): string
	{
		$acr = strtoupper(trim($acr));
		if ($acr === 'SNOMEDCT') return 'http://snomed.info/sct';
		if ($acr === 'LOINC') return 'http://loinc.org';
		return 'bioportal:' . $acr;
	}

	#endregion BioPortal



	#region Remote Source Kind: Snwowstorm

	/**
	 * Snowstorm search 
	 *
	 * @param Cache $cache
	 * @param string $q
	 * @param array $source
	 * @param int $limit Limit per acronym
	 * @param int $ttlSeconds Cache TTL per acronym (e.g. 1800)
	 * @return array
	 */
	function searchSnowstorm(
		Cache $cache,
		string $q,
		array $source,
		int $limit,
		int $ttlSeconds = 1800
	): array {
		$out = [];
		$q = trim($q);

		if ($q === '' || $limit <= 0) return $out;

		$meta = $source['meta'];

		$baseUrl = trim((string)($meta['baseurl'] ?? ''));
		if ($baseUrl === '') throw new Exception('Snowstorm base URL not set.');
		$auth = strtolower(trim((string)($meta['auth'] ?? 'none')));
		if (!in_array($auth, ['none', 'basic', 'token'], true)) throw new Exception('Invalid auth type: ' . $auth);

		$headers = [
			'Content-Type: application/json',
			'Accept: application/json',
			'User-Agent: ' . $this->getUserAgentString(),
		];
		$cred_decoded = $this->decryptCredentials($meta['credentials'] ?? '');

		$curlUserPwd = null;
		if ($auth === 'basic') {
			$username = $cred_decoded['u'] ?? '';
			$password = $cred_decodedd['p'] ?? '';
			$curlUserPwd = $username . ':' . $password;
		} elseif ($auth === 'token') {
			$token = $cred_decodedd['t'] ?? '';
			if (stripos($token, 'Bearer ') !== 0) $token = 'Bearer ' . $token;
			$headers[] = 'Authorization: ' . $token;
		}

		$url = rtrim($baseUrl, '/') . '/' . $meta['branch'] . '/concepts/search';
		$post_data = json_encode([
			'termFilter' => $q,
			'limit' => $limit,
			'activeFilter' => true,
		]);

		$ch = curl_init($url);
		if ($ch === false) throw new Exception('Failed to initialize Snowstorm request.');

		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_POST, true);
		curl_setopt($ch, CURLOPT_POSTFIELDS, $post_data);
		curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
		curl_setopt($ch, CURLOPT_TIMEOUT, 20);
		curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
		if ($curlUserPwd !== null) curl_setopt($ch, CURLOPT_USERPWD, $curlUserPwd);

		$body = curl_exec($ch);
		$httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$curlErr = curl_error($ch);
		if (!empty($curlErr)) throw new Exception('Failed to execute Snowstorm request: ' . $curlErr);

		$json = json_decode($body, true, flags: JSON_THROW_ON_ERROR);

		if (is_array($json['items'] ?? null)) {

			// We filter by active concepts and ignore any extensions
			// (extension concept IDs start with 999 or 1xxxxxx)
			foreach ($json['items'] as $concept) {
				if (($concept['active'] ?? false) === false) continue;
				$concept_id = $concept['conceptId'] ?? null;
				// if ($concept_id === null || preg_match('/^(999|1[0-9]{9,})/', $concept_id)) continue;

				$display = $concept['fsn']['term'] ?? $concept['pt']['term'] ?? 'Unknown';

				$out[] = [
					'system' => 'http://snomed.info/sct',
					'code' => $concept_id,
					'display' => $display,
					'score' => 1, // TODO: Add some sensible weighting, e.g., is the search term present in full?
				];
			}
		}

		// Store into cache (even if empty, cache empties to avoid hammering)
		$cacheKey = $this->generateSnowstormSearchCacheKey($meta, $q);
		$cache->setPayload($cacheKey, $out, $ttlSeconds, [
			'kind' => 'snowstorm',
			'branch' => $meta['branch'],
		]);

		return $out;
	}

	/**
	 * 
	 * @param array $meta 
	 * @param string $q 
	 * @return string 
	 */
	private function generateSnowstormSearchCacheKey(array $meta, string $q): string
	{
		// We cache snowstorm results by snowstorm server/branch
		// For this, we generate a hash of baseurl + branch and use the first 10 chars of it
		$server = $meta['baseurl'] . ',' . $meta['branch'];
		$hash_fragment = strtoupper(left(hash('sha256', $server), 10));

		$qNorm = mb_strtolower(trim($q));
		$qNorm = preg_replace('/\s+/u', ' ', $qNorm) ?? $qNorm;

		$preview = mb_substr($qNorm, 0, 40); // goal; will be truncated if needed

		$cacheKey = $this->remoteCacheKey(
			'ss',
			['s', $hash_fragment],
			$qNorm,      // hashInput (canonical)
			$preview,      // preview
			100,
			12
		);
		return $cacheKey;
	}

	private function getSnowstormBranches($payload)
	{
		$baseUrl = trim((string)($payload['ss_baseurl'] ?? ''));
		if ($baseUrl === '') {
			return [
				'success' => false,
				'branches' => [],
				'error' => 'Snowstorm base URL is required.',
			];
		}

		$auth = strtolower(trim((string)($payload['ss_auth'] ?? 'none')));
		if (!in_array($auth, ['none', 'basic', 'token'], true)) $auth = 'none';

		$headers = [
			'Accept: application/json',
			'User-Agent: ' . $this->getUserAgentString(),
		];
		$curlUserPwd = null;

		if ($auth === 'basic') {
			$username = (string)($payload['ss_username'] ?? '');
			$password = (string)($payload['ss_password'] ?? '');
			if ($username === '' || $password === '') {
				return [
					'success' => false,
					'branches' => [],
					'error' => 'Snowstorm basic auth requires username and password.',
				];
			}
			$curlUserPwd = $username . ':' . $password;
		} elseif ($auth === 'token') {
			$token = trim((string)($payload['ss_token'] ?? ''));
			if ($token === '') {
				return [
					'success' => false,
					'branches' => [],
					'error' => 'Snowstorm token auth requires a token.',
				];
			}
			if (stripos($token, 'Bearer ') !== 0) $token = 'Bearer ' . $token;
			$headers[] = 'Authorization: ' . $token;
		}

		$url = rtrim($baseUrl, '/') . '/branches';

		$ch = curl_init($url);
		if ($ch === false) {
			return [
				'success' => false,
				'branches' => [],
				'error' => 'Failed to initialize Snowstorm request.',
			];
		}

		curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
		curl_setopt($ch, CURLOPT_HTTPGET, true);
		curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
		curl_setopt($ch, CURLOPT_TIMEOUT, 20);
		curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
		if ($curlUserPwd !== null) curl_setopt($ch, CURLOPT_USERPWD, $curlUserPwd);

		$body = curl_exec($ch);
		$httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
		$curlErr = curl_error($ch);

		if ($body === false) {
			return [
				'success' => false,
				'branches' => [],
				'error' => 'Snowstorm request failed: ' . ($curlErr !== '' ? $curlErr : 'unknown cURL error'),
			];
		}

		$data = json_decode($body, true);
		if (!is_array($data)) {
			return [
				'success' => false,
				'branches' => [],
				'error' => 'Snowstorm response was not valid JSON.',
			];
		}

		if ($httpCode < 200 || $httpCode >= 300) {
			$msg = '';
			if (isset($data['message']) && is_string($data['message'])) $msg = trim($data['message']);
			if ($msg === '' && isset($data['error']) && is_string($data['error'])) $msg = trim($data['error']);
			if ($msg === '') $msg = 'HTTP ' . $httpCode;
			return [
				'success' => false,
				'branches' => [],
				'error' => 'Snowstorm returned an error: ' . $msg,
			];
		}

		$rawBranches = [];
		if (isset($data['items']) && is_array($data['items'])) $rawBranches = $data['items'];
		elseif (array_keys($data) === range(0, count($data) - 1)) $rawBranches = $data;

		$branches = [];
		foreach ($rawBranches as $item) {
			if (!is_array($item)) continue;
			$name = isset($item['name']) && is_string($item['name']) ? trim($item['name']) : '';
			if ($name === '' && isset($item['path']) && is_string($item['path'])) $name = trim($item['path']);
			if ($name !== '') $branches[] = $name;
		}
		$branches = array_values(array_unique($branches));

		return [
			'success' => true,
			'branches' => $branches,
			'error' => null,
		];
	}

	#endregion Snowstorm


	function getUserAgentString()
	{
		return 'ROME-REDCap-EM (BioPortal search, experimental)';
	}

	function romeJsonEncode($data)
	{
		return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
	}

	#region Crons

	/**
	 * Prune the cache. 
	 * @param array $cronInfo 
	 * @return string 
	 */
	function cron_prune($cronInfo)
	{
		try {
			$this->initConfig();
			$cache = $this->getCache();
			$cache->prune();
		} catch (Exception $e) {
			$this->framework->log('Cache pruning failed: ' . $e->getMessage());
			return "ROME: Pruning failed.";
		}
		return "ROME: Pruning completed successfully.";
	}

	#endregion

}
