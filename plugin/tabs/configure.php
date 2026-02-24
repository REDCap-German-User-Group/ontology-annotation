<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

// Plugin page to administrate the ROME module. Settings made here apply system-wide.
// This page will only be shown if the module is designated to allow this from a project context.

// TODOs
// - [ ] Add a nice configuration page that replaces the awkward module config dialog


/** @var OntologiesMadeEasyExternalModule $module */


$canConfigure = $module->framework->getProjectSetting('can-configure') ?? false;
$canConfigure = $canConfigure ? 'checked' : '';

?>
<div class="rome-plugin-page">
	<h2>General Configuration (Admins Only)</h2>
	<div class="form-check form-switch">
		<input class="form-check-input" type="checkbox" role="switch" id="rome-set-can-configure" data-rome-setting="can-configure" <?= $canConfigure ?>>
		<label class="form-check-label" for="rome-set-can-configure">Allow access to this page for users with design rights in this project.</label>
	</div>
	<p class="text-muted">
		Configuration options (instance-wide) will appear here soon &hellip;
	</p>
</div>