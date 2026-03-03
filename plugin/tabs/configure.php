<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

// Plugin page to administrate the ROME module. Settings made here apply system-wide.
// This page will only be shown if the module is designated to allow this from a project context.

// TODOs
// - [ ] Add a nice configuration page that replaces the awkward module config dialog


/** @var OntologiesMadeEasyExternalModule $module */

$context = defined('PROJECT_ID') ? 'project' : 'system';

$canConfigure = $context === 'project' && ($module->framework->getProjectSetting('proj-can-configure') ?? false);
$hasBioPortalToken = $module->isBioPortalAvailable();
$allowBioPortal = $module->framework->getSystemSetting('sys-allow-rc-bioportal') ?? false;
$isSuperuser = $module->framework->isSuperUser();

?>
<div class="rome-plugin-page">
	<h2>General Configuration</h2>
	<p>
		Define system-wide behavior of ROME and manage the ontology annotation sources available to projects on this REDCap instance.
	</p>
	<div class="rome-config-block">
		<?php if ($context === 'project' && $isSuperuser): ?>
		<div class="form-check form-switch">
			<input class="form-check-input" type="checkbox" role="switch" id="rome-set-can-configure" data-rome-setting="proj-can-configure" <?= $canConfigure ? 'checked' : '' ?>>
			<label class="form-check-label" for="rome-set-can-configure">Allow access to this page for users with design rights in this project. <code>[Admin only]</code></label>
		</div>
		<?php endif; ?>
		<?php if ($isSuperuser): ?>
		<div class="form-check form-switch">
			<input class="form-check-input" type="checkbox" role="switch" id="rome-set-js-debug" data-rome-setting="sys-javascript-debug" <?= $config['debug'] ? 'checked' : '' ?>>
			<label class="form-check-label" for="rome-set-js-debug">Enable JavaScript debug output.
				<?php if ($context === 'project'): ?>
				<code>[Admin only]</code>
				<?php endif; ?>
			</label>
		</div>
		<?php endif; ?>
		<div class="form-check form-switch">
			<input class="form-check-input" type="checkbox" role="switch" id="rome-set-allow-rc-bioportal" data-rome-setting="sys-allow-rc-bioportal" <?= $allowBioPortal ? 'checked' : '' ?>>
			<label class="form-check-label" for="rome-set-allow-rc-bioportal">Allow projects to use the built-in BioPortal to define custom sources.</label>
			<span id="rome-rc-bioportal-status" class="badge <?= $hasBioPortalToken ? 'badge-success' : 'badge-danger' ?>"><?= $hasBioPortalToken ? 'AVAILABLE' : 'DISABLED or NO TOKEN SET' ?></span>
		</div>
	</div>
	<p>
		 <b>Local</b> or <b>remote</b> ontology sources can be added here. These preloaded or preconfigured sources will be available in projects when enabled.
	</p>
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
	</div>
	<h3><i class="fa-solid fa-folder"></i> Annotation Sources</h3>
	<table id="rome-sources" class="table table-sm table-hover align-middle rome-sources-table">
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