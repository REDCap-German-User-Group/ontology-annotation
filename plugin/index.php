<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();
$ih->js("js/ConsoleDebugLogger.js");
$ih->js("js/ROME_Plugins.js");
$ih->css("css/ROME.css");
$config = $module->get_plugin_base_config();
$module->framework->initializeJavascriptModuleObject();
$jsmo_name = $module->framework->getJavascriptModuleObjectName();

$nav_tabs = [
	"about" => [
		"label" => "About",
		"icon" => "fa-solid fa-info",
	],
	"annotate" => [
		"label" => "Annotate",
		"icon" => "fa-solid fa-diagram-project",
	],
	"discover" => [
		"label" => "Discover",
		"icon" => "fa-solid fa-search",
	],
	"utilities" => [
		"label" => "Utilities",
		"icon" => "fa-solid fa-wrench",
	],
	"export" => [
		"label" => "Export",
		"icon" => "fa-solid fa-arrow-up-right-from-square",
	]
];
$default_tab = "annotate";
$active_tab = array_key_exists($_GET['tab'], $nav_tabs) ? $_GET['tab'] : $default_tab;
$config["plugin"] = $active_tab;

?>
<h1 class="projhdr">
	<i class="fa-solid fa-tags"></i> ROME: REDCap Ontology Annotations Made Easy
</h1>
<p>
	ROME is a REDCap external module that facilitates adding and editing ontology
	annotations to data elements in a project and searching for annotations accross multiple
	projects on a REDCap instance.
</p>
<div id="sub-nav" class="d-sm-block mb-3">
	<ul>
		<?php foreach ($nav_tabs as $tab => $tab_info): ?>
			<li class="<?= $active_tab == $tab ? 'active' : '' ?>">
				<a href="<?= $module->getUrl("plugin/index.php?tab={$tab}") ?>" data-nav-link="<?= $tab ?>">
					<i class="<?= $tab_info['icon'] ?>"></i> <?= $tab_info['label'] ?>
				</a>
			</li>
		<?php endforeach; ?>
	</ul>
</div>
<div id="rome-tab">
	<?php include __DIR__ . "/tabs/{$active_tab}.php"; ?>
</div>
<script>
	$(function() {
		if (window.DE_RUB_ROME && window.DE_RUB_ROME.init) {
			window.DE_RUB_ROME.init(<?= json_encode($config); ?>, <?= $jsmo_name ?>);
		}
	});
</script>