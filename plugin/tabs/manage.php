<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

// Plugin page to administrate the ROME module for a specific project.

// TODOs
// - [ ] Add a nice configuration page that replaces the awkward module config dialog


/** @var OntologiesMadeEasyExternalModule $module */

$discoverable = $module->framework->getProjectSetting('proj-discoverable') ?? false;

?>
<div class="rome-plugin-page">
	<h2>Manage Ontologies</h2>
	<p class="text-muted">
		Management options will appear here soon &hellip;
	</p>
	<div class="form-check form-switch">
		<input class="form-check-input" type="checkbox" role="switch" id="rome-set-discoverable" data-rome-setting="proj-discoverable" <?= $discoverable ? 'checked' : '' ?>>
		<label class="form-check-label" for="rome-set-discoverable">Make the metadata (annotated fields + contact data) from <b>this project</b> discoverable to other users.</label>
	</div>
	<p>
		 Available ontologies for annotation are listed below. Each row in the tables represents one ontology source (local or remote) and may be enabled or disabled independently. By default, the title and description are taken from the source's <code>title</code> and <code>description</code> fields, when available, but overrides may be provided.
	</p>
	<h3><i class="fa-solid fa-database"></i> Local Annotation Sources</h3>
	<p>
		Local ontology sources can be provided by uploading <b>FHIR Questionnaire</b> or <b>ROME Ontology Annotation</b> JSON files or by picking from a list of preloaded sources. These local sources are preprocessed by ROME to enable fast local search.
	</p>
	<p>
		<button id="rome-add-local-source" class="btn btn-xs btn-success">
			<i class="fa fa-plus"></i> Add a local source
		</button>
	</p>
	<table id="rome-local-sources" class="table table-sm table-striped align-middle rome-sources-table">
		<thead>
			<tr>
				<th class="rome-sources-col-title">Title / Description</th>
				<th class="rome-sources-col-type">Type / Stats</th>
				<th class="rome-sources-col-enabled">Enabled</th>
				<th class="rome-sources-col-actions">Actions</th>
			</tr>
		</thead>
		<tbody></tbody>
	</table>
	<h3 class="mt-5"><i class="fa-solid fa-cloud"></i> Remote Annotation Sources</h3>
	<p>
		Remote ontology sources are provided by external web services such as, e.g., <b>BioPortal</b> or <b>Snowstorm</b>. 
	</p>
	<p>
		<button id="rome-add-remote-source" class="btn btn-xs btn-success">
			<i class="fa fa-plus"></i> Add a remote source
		</button>
	</p>
	<table id="rome-remote-sources" class="table table-sm table-striped align-middle rome-sources-table">
		<thead>
			<tr>
				<th class="rome-sources-col-title">Title / Description</th>
				<th class="rome-sources-col-type">Type</th>
				<th class="rome-sources-col-enabled">Enabled</th>
				<th class="rome-sources-col-actions">Actions</th>
			</tr>
		</thead>
		<tbody></tbody>
	</table>
</div>