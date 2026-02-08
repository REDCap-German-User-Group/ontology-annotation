<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

// TODOs
// - [ ] Add copy code button to code blocks
// - [ ] Add dark/light theme switcher

/** @var OntologiesMadeEasyExternalModule $module */

$code_theme = $module->framework->getUserSetting("code-theme") ?? "dark";
$theme_file = ["dark" => "github-dark.min.css", "light" => "github.min.css"][$code_theme];

$ih = $module->getInjectionHelper();
// Inject additional JS and CSS
$hljs_path = "libs/highlightjs_11.11.1/";
$ih->js($hljs_path."highlight.min.js");
$ih->js($hljs_path."r.min.js");
$ih->js($hljs_path."json.min.js");
$ih->css($hljs_path.$theme_file);

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