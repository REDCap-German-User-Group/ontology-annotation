<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

// TODOs
// - [ ] Add a description of the module
// - [ ] Add a link to the GitHub repository / Zenodo
// - [ ] Add a link to the MIE publication

/** @var OntologiesMadeEasyExternalModule $module */


?>
<div class="rome-plugin-page">

	<?php if ($rome_cache_status !== 'ok'): ?>
	<p class="red">
		<b>ROME setup has not been completed yet.</b> Please contact your REDCap administrator and have them configure the module in Control Center using the module configuration dialog.
	</p>
	<?php endif; ?>

	<h2>What is ROME?</h2>
	<p>
		ROME provides facilities to annotate REDCap fields with standardized ontology concepts such as SNOMED CT or LOINC.
	</p>
	<p>
		These annotations are stored as structured metadata and can be used to improve consistency and interoperability of data captured in REDCap projects.
	</p>

	<h3>What does ROME do?</h3>
	<ul>
		<li>Fields can be annotated with standardized terms</li>
		<li>Consistent definitions across projects can be supported</li>
		<li>Data clarity and comparability can be improved</li>
		<li>The <b>findability</b> of data can be enhanced in line with FAIR principles</li>
	</ul>

	<h3>How does it work?</h3>
	<p>A user interface is provided within REDCap through which:</p>
	<ul>
		<li>the meaning of a field can be described</li>
		<li>the meaning of answer options can be defined</li>
		<li>units for numeric values can be specified</li>
	</ul>
	<p>
		These annotations are stored together with the field and become part of the project metadata.
	</p>

	<h3>What can it be used for?</h3>
	<ul>
		<li>Easier understanding of variables across projects</li>
		<li>Identification of projects capturing similar types of data</li>
		<li>Reuse and harmonization of data definitions</li>
	</ul>

	<h3>Notes</h3>
	<ul>
		<li>Data entry itself is not changed by ROME</li>
		<li>Annotations are stored as additional metadata only</li>
		<li>Whether a project is discoverable can be configured</li>
	</ul>

	<hr class="mt-4">
	<section class="fs12 text-muted ms-2 me-2">
		<b>External Libraries</b> &mdash;<br>ROME makes use of the following third party libraries and softwares:
		<ul>
			<li><b>Tom Select</b> (Apache 2.0) - <a target="_blank" href="https://tom-select.js.org/">https://tom-select.js.org/</a></li>
			<li><b>highlight.js</b> (BSD-3-Clause) - <a target="_blank" href="https://highlightjs.org/">https://highlightjs.org/</a></li>
		</ul>
	</section>
</div>
