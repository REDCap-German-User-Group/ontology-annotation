<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();

// Inject additional CSS and JS files
$ih->css("libs/tom-select_2.4.3/tom-select.css");
$ih->js("libs/tom-select_2.4.3/tom-select.complete.min.js");

$od_link = APP_PATH_WEBROOT . "Design/online_designer.php?pid=" . $module->getProjectId();
?>
<div class="rome-plugin-page">
	<h2>Annotation Workspace</h2>
	<p class="text-muted">
		Annotation workspace coming soon &hellip;
	</p>
	<p>
		For now, please use the annotation facility integrated into 
		<a href="<?= $od_link ?>"><i class="fa-solid fa-edit"></i> Online Designer</a> 
		to annotate metadata.
	</p>
</div>