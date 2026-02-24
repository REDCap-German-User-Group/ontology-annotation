<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

// TODOs
// - [ ] Allow export of results table as CSV

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();

// Inject additional CSS and JS files
$ih->css("libs/tom-select_2.4.3/tom-select.css");
$ih->js("libs/tom-select_2.4.3/tom-select.complete.min.js");

?>
<div class="rome-plugin-page">
	<h2>Discover metadata from other projects</h2>
	<p>
		This page allows you to explore metadata from other REDCap projects hosted on this instance.
		Only projects that have been explicitly marked as <em>discoverable</em> will appear in the results.
	</p>
	<label for="rome-discover-select">Select ontology annotations to discover in 
		<b class="rome-discover-project-count">
			<i class="fa-solid fa-hashtag fa-bounce fa-xs text-muted"></i>
		</b>
		annotated projects:</label>
	<div class="rome-discover-select-container">
		<div class="rome-discover-select-waiter">
			<i class="fa-solid fa-spinner fa-spin-pulse fa-2x me-2"></i>Loading ontologies &hellip;
		</div>
		<select id="rome-discover-select" autofocus="autofocus" multiple placeholder="&hellip;" style="display: none;"></select>
	</div>
	<p id="rome-matching-projects-message">
		Matching projects will be displayed below.
	</p>	
	<div id="resulttable"></div>
</div>
