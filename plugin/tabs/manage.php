<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

// Plugin page to administrate the ROME module for a specific project.

// TODOs
// - [ ] Add a nice configuration page that replaces the awkward module config dialog


// Local = fa-database
// Remote = fa-cloud
// System = 

/** @var OntologiesMadeEasyExternalModule $module */

$discoverable = $module->framework->getProjectSetting('proj-discoverable') ?? false;

?>
<div class="rome-plugin-page">
	<h2>Manage ROME and Ontologies</h2>
	<p>
		Configure how ROME operates within this project and manage the ontology annotation sources available for use.
	</p>
	<div class="rome-config-block">
		<div class="form-check form-switch">
			<input class="form-check-input" type="checkbox" role="switch" id="rome-set-discoverable" data-rome-setting="proj-discoverable" <?= $discoverable ? 'checked' : '' ?>>
			<label class="form-check-label" for="rome-set-discoverable">Make the metadata (annotated fields + contact data) from <b>this project</b> discoverable to other users.</label>
		</div>
	</div>
	<p>
		 Available ontologies for annotation are listed below. Each row in the tables represents one ontology source (local or remote) and may be enabled or disabled independently. <b>Local</b> ontology sources can be provided by uploading <i>FHIR Questionnaire</i> or <i>ROME Ontology Annotation</i> JSON files. These local sources are preprocessed by ROME to enable fast local search. <b>Remote</b> ontology sources are provided by external web services such as, e.g., <i>BioPortal</i> or <i>Snowstorm</i>. Additionally, sources can be added by picking from a list of preloaded/preconfigured <b>system</b> sources (added by the REDCap admin). 
	<p>
		 By default, the title and description are taken from the source's <code>title</code> and <code>description</code> fields, when available, but overrides may be provided.
	</p>
	<div class="rome-config-block">
		<button id="rome-add-local-source" class="btn btn-xs btn-success">
			<i class="fa-solid fa-database"></i> Add a local source
		</button>
		<button id="rome-add-remote-source" class="btn btn-xs btn-success ms-1">
			<i class="fa-solid fa-cloud"></i> Add a remote source
		</button>
		<button id="rome-add-system-source" class="btn btn-xs btn-success ms-1">
			<i class="fa-solid fa-hard-drive"></i> Add a system source
		</button>
	</div>
	<h3><i class="fa-solid fa-folder"></i> Annotation Sources</h3>
	<table id="rome-sources" class="table table-sm table-striped align-middle rome-sources-table">
		<thead>
			<tr>
				<th class="rome-sources-col-type">Type</th>
				<th class="rome-sources-col-enabled">Enabled</th>
				<th class="rome-sources-col-title">Title / Description</th>
				<th class="rome-sources-col-stats">Stats</th>
				<th class="rome-sources-col-actions">Actions</th>
			</tr>
		</thead>
		<tbody></tbody>
	</table>
</div>