<?php namespace DE\RUB\OntologiesMadeEasyExternalModule;

/** @var OntologiesMadeEasyExternalModule $module */

$ih = $module->getInjectionHelper();
$ih->js("libs/highlightjs_11.11.1/highlight.min.js");    
$ih->js("libs/highlightjs_11.11.1/r.min.js");    
$ih->js("libs/highlightjs_11.11.1/json.min.js"); 
$ih->css("css/ROME.css"); 
$ih->css($code_theme = [
    "dark" => "libs/highlightjs_11.11.1/github-dark.min.css",
    "light" => "libs/highlightjs_11.11.1/github.min.css",
][$module->getProjectSetting("code-theme") ?? "dark"]);

?>

<h1 class="projhdr">
	<i class="fa fa-search"></i> ROME: Utility functions for data processing
</h1>

<script>
     $(function() {
         hljs.highlightAll();
     })
</script>        
     
<h3> Combining datasets </h3>

<p> Use this function to combine datasets from different redcap projects that have been annotated using ROME</p>
<p> <i>Note:</i> Currently, this does not harmonize answer codes.</p>
<div class="rome-code">
    <pre><code class="language-r"><?= file_get_contents(__DIR__ . "/utils/rome_combine.r") ?></code></pre>
</div> 
     
