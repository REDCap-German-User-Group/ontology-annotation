<?php
namespace DE\RUB\OntologiesMadeEasyExternalModule;

/** @var OntologiesMadeEasyExternalModule $module */

$config = $module->get_js_base_config(true);
$js_config = json_encode($config);

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
	]
];
$default_tab = "annotate";
$active_tab = array_key_exists($_GET['tab'], $nav_tabs) ? $_GET['tab'] : $default_tab;

require_once __DIR__ . "/../classes/InjectionHelper.php";
$ih = InjectionHelper::init($module);
$ih->js("js/ConsoleDebugLogger.js");
$ih->js("js/ROME.js");
$ih->css("css/ROME.css");


?>
<h1 class="projhdr">
	<i class="fa-solid fa-tags"></i> ROME: REDCap Ontology Annotations Made Easy
</h1>
<p>ROME is a REDCap external module that facilitates adding and editing ontology annotations to data elements.</p>
<div id="sub-nav" class="d-sm-block mb-3">
	<ul>
	<?php foreach ($nav_tabs as $tab => $tab_info): ?>
		<li class="<?= $active_tab == $tab ? 'active' : '' ?>">
			<a href="<?= $module->getUrl("plugin/index.php?tab={$tab}") ?>" data-nav-link="<?= $tab ?>">
				<i class="<?= $tab_info['icon']?>"></i> <?= $tab_info['label'] ?>
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
			window.DE_RUB_ROME.init(<?= $js_config ?>);
		}
	});
</script>
