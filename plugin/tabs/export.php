<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();

// Inject additional CSS and JS files
$ih->css("libs/tom-select_2.4.3/tom-select.css");
$ih->js("libs/tom-select_2.4.3/tom-select.complete.min.js");

$project = new \Project($module->getProjectId());
$hasDraft = $project->isDraftMode();
$defaultMetadataState = $hasDraft ? 'draft' : 'production';
$formats = [
	'native_rome' => 'Native ROME JSON',
	'fhir_questionnaire' => 'FHIR Questionnaire',
];

?>
<div class="rome-plugin-page">
	<h2>Export ontology annotations</h2>
	<div class="rome-export-form">
		<?php if ($hasDraft): ?>
			<div class="mb-3" id="rome-export-metadata-state-wrap">
				<div class="form-label">Metadata state:</div>
				<div class="d-flex align-items-center gap-3">
					<label class="form-check-label">
						<input type="radio" class="form-check-input" name="rome-export-metadata-state" value="draft" <?= $defaultMetadataState === 'draft' ? 'checked' : '' ?>>
						Draft
					</label>
					<label class="form-check-label">
						<input type="radio" class="form-check-input" name="rome-export-metadata-state" value="production" <?= $defaultMetadataState === 'production' ? 'checked' : '' ?>>
						Production
					</label>
				</div>
			</div>
		<?php else: ?>
			<input type="hidden" name="rome-export-metadata-state" value="production">
		<?php endif; ?>
		<div id="rome-export-options">
			<div class="mb-3">
				<label for="rome-export-forms" class="form-label mb-1">Include annotations from these forms:</label>
				<div role="group" class="ms-3 mb-1 fs11" aria-label="Form selection shortcuts">
					<a href="#" id="rome-export-add-all">Add all</a> &bull;
					<a href="#" id="rome-export-clear-all">Clear all</a>
				</div>
				<select id="rome-export-forms" class="" multiple></select>
			</div>
			<div class="row g-3 align-items-end">
				<div class="col-sm-6">
					<div class="form-label">Format:</div>
					<div class="d-flex align-items-center gap-3">
						<?php foreach ($formats as $formatValue => $formatLabel): ?>
							<label class="form-check-label">
								<input type="radio" class="form-check-input" name="rome-export-format" value="<?= htmlspecialchars($formatValue, ENT_QUOTES) ?>" <?= $formatValue === 'native_rome' ? 'checked' : '' ?>>
								<?= htmlspecialchars($formatLabel) ?>
							</label>
						<?php endforeach; ?>
					</div>
				</div>
			</div>
			<div class="mt-3 d-flex align-items-center gap-2">
				<button type="button" id="rome-export-download" class="btn btn-primary btn-sm">
					<i class="fa-solid fa-download"></i> Download
				</button>
				<span id="rome-export-status" class="text-muted"></span>
			</div>
		</div>
		<div id="rome-export-messages" class="mt-3"></div>
	</div>
</div>
