<h1 class="projhdr">
	<i class="fa fa-search"></i> ROME: Utility functions for data processing
</h1>

<link rel="stylesheet" href="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/styles/default.min.css">
<script src="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/highlight.min.js"></script>
<script src="https://unpkg.com/@highlightjs/cdn-assets@11.11.1/languages/r.min.js"></script>
<script>
     $(function() {
         hljs.highlightAll();
     })
</script>        
     
<h3> Combining datasets </h3>

<p> Use this function to combine datasets from different redcap projects that have been annotated using ROME</p>
<p> <i>Note:</i> Currently, this does not harmonize answer codes.</p>        
<pre><code class="language-r"><?= file_get_contents(__DIR__ . "/utils/rome_combine.r") ?></code></pre>
     
