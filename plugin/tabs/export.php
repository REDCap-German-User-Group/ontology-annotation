<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();

// Inject additional CSS and JS files
$ih->css("libs/tom-select_2.4.3/tom-select.css");
$ih->js("libs/tom-select_2.4.3/tom-select.complete.min.js");

?>
<div class="rome-plugin-page">
	<h2>Export ontology annotations</h2>
	<div class="rome-export-form">
		<div class="mb-3 d-none" id="rome-export-metadata-state-wrap">
			<label for="rome-export-metadata-state" class="form-label">Metadata state:</label>
			<select id="rome-export-metadata-state" class="form-select form-select-sm">
				<option value="draft">Draft</option>
				<option value="production">Production</option>
			</select>
		</div>
		<div id="rome-export-options">
			<div class="mb-3">
				<div class="d-flex align-items-center justify-content-between gap-2">
					<label for="rome-export-forms" class="form-label mb-1">Include annotations from these forms:</label>
					<div class="btn-group btn-group-sm" role="group" aria-label="Form selection shortcuts">
						<button type="button" id="rome-export-add-all" class="btn btn-outline-secondary">Add all</button>
						<button type="button" id="rome-export-clear-all" class="btn btn-outline-secondary">Clear all</button>
					</div>
				</div>
				<select id="rome-export-forms" class="form-select" multiple></select>
			</div>
			<div class="row g-3 align-items-end">
				<div class="col-sm-6">
					<label for="rome-export-format" class="form-label">Format:</label>
					<select id="rome-export-format" class="form-select form-select-sm"></select>
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
