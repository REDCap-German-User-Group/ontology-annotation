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

$user = $module->framework->getUser();
if ($user == null) exit;
$is_project = $config['pid'] !== null;

$annotate_enabled = $manage_enabled = $is_project && ($user->hasDesignRights() || $user->isSuperUser());
$configure_enabled = $user->isSuperUser() || 
	(
		$is_project && 
		$user->hasDesignRights() && 
		$module->framework->getProjectSetting("can-configure") === true
	);

$nav_tabs = [
	"about" => [
		"label" => "About",
		"icon" => "fa-solid fa-info",
		"enabled" => true,
	],
	"annotate" => [
		"label" => "Annotate",
		"icon" => "fa-solid fa-diagram-project",
		"enabled" => $annotate_enabled,
	],
	"discover" => [
		"label" => "Discover",
		"icon" => "fa-solid fa-search",
		"enabled" => true,
	],
	"utilities" => [
		"label" => "Utilities",
		"icon" => "fa-solid fa-wrench",
		"enabled" => true,
	],
	"export" => [
		"label" => "Export",
		"icon" => "fa-solid fa-arrow-up-right-from-square",
		"enabled" => $is_project,
	],
	"manage" => [
		"label" => "Manage",
		"icon" => "fa-solid fa-list-check",
		"enabled" => $manage_enabled,
	],
	"configure" => [
		"label" => "Configuration",
		"icon" => "fa-solid fa-gear",
		"enabled" => $configure_enabled,
	]
];
$default_tab = "about";
if ($is_project && $annotate_enabled) { $default_tab = "annotate"; }
if (!$is_project) { $default_tab = "configure"; }
// Filter out disabled tabs
$enabled_nav_tabs = array_filter($nav_tabs, function ($tab) {
	return $tab['enabled']; 
});
// Set active tab
$active_tab = array_key_exists($_GET['tab'], $enabled_nav_tabs) ? $_GET['tab'] : $default_tab;
$config["plugin"] = $active_tab;

// Render page
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
		<?php foreach ($enabled_nav_tabs as $tab => $tab_info): ?>
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