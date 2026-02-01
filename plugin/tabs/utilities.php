<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

// TODOs
// - [ ] Add copy code button to code blocks
// - [ ] Add dark/light theme switcher

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();
// Inject additional JS and CSS
$ih->js("libs/highlightjs_11.11.1/highlight.min.js");
$ih->js("libs/highlightjs_11.11.1/r.min.js");
$ih->js("libs/highlightjs_11.11.1/json.min.js");
$ih->css($code_theme = [
	"dark" => "libs/highlightjs_11.11.1/github-dark.min.css",
	"light" => "libs/highlightjs_11.11.1/github.min.css",
][$module->getProjectSetting("code-theme") ?? "dark"]);

$combine_script = $module->framework->getSafePath("plugin/utils/rome_combine.r");


?>
<div class="rome-plugin-page">
	<h2> Combining datasets </h2>
	<p>
		Use this function to combine datasets from different REDCap projects that have
		been annotated using ROME.
	</p>
	<p>
		<i>Note:</i> Currently, this does not harmonize answer codes.
	</p>
	<div class="rome-code">
		<pre><code class="language-r"><?= file_get_contents($combine_script) ?></code></pre>
	</div>
</div>
<script>
	$(function() {
		hljs.highlightAll();
	})
</script>