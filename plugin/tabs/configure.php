<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

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
	<h2>General Configuration (Admins Only)</h2>
	<?php if ($context === 'project' && $isSuperuser): ?>
	<div class="form-check form-switch">
		<input class="form-check-input" type="checkbox" role="switch" id="rome-set-can-configure" data-rome-setting="proj-can-configure" <?= $canConfigure ? 'checked' : '' ?>>
		<label class="form-check-label" for="rome-set-can-configure">Allow access to this page for users with design rights in this project.</label>
	</div>
	<?php endif; ?>
	<div class="form-check form-switch">
		<input class="form-check-input" type="checkbox" role="switch" id="rome-set-allow-rc-bioportal" data-rome-setting="sys-allow-rc-bioportal" <?= $allowBioPortal ? 'checked' : '' ?>>
		<label class="form-check-label" for="rome-set-allow-rc-bioportal">Allow projects to use the built-in BioPortal to define custom sources.</label>
		<span id="rome-rc-bioportal-status" class="badge <?= $hasBioPortalToken ? 'badge-success' : 'badge-danger' ?>"><?= $hasBioPortalToken ? 'AVAILABLE' : 'DISABLED or NO TOKEN SET' ?></span>
	</div>
	<p class="text-muted">
		Configuration options (instance-wide) will appear here soon &hellip;
	</p>
</div>