<?php

?>
<h1 class="projhdr">
	<i class="fa-solid fa-tags"></i> ROME: REDCap Ontology Annotations Made Easy
</h1>
<p>ROME is a REDCap external module that facilitates adding and editing ontology annotations to data elements.</p>
<link rel="stylesheet" href="<?php echo $module->getUrl('css/ROME.css'); ?>">
<div id="sub-nav" class="d-sm-block">
	<ul>
		<li>
			<a href="javascript:;" data-rome-action="main-nav" data-rome-target="about">
				<i class="fa-solid fa-info"></i> About
			</a>
		</li>
		<li>
			<a href="javascript:;" data-rome-action="main-nav" data-rome-target="annotate">
				<i class="fa-solid fa-diagram-project"></i> Annotate
			</a>
		</li>
		<li>
			<a href="javascript:;" data-rome-action="main-nav" data-rome-target="discover">
				<i class="fa-solid fa-search"></i> Discover
			</a>
		</li>
		<li>
			<a href="javascript:;" data-rome-action="main-nav" data-rome-target="utilities">
				<i class="fa-solid fa-wrench"></i> Utilities
			</a>
		</li>
	</ul>
</div>
<div id="rome-tabs" class="mt-3">
	<section class="rome-tab-section active" data-rome-section="about">
		<?php include __DIR__ . '/tabs/about.php'; ?>
	</section>
	<section class="rome-tab-section" data-rome-section="annotate">
		<?php include __DIR__ . '/tabs/annotate.php'; ?>
	</section>
	<section class="rome-tab-section" data-rome-section="discover">
		<?php include __DIR__ . '/tabs/discover.php'; ?>
	</section>
	<section class="rome-tab-section" data-rome-section="utilities">
		<?php include __DIR__ . '/tabs/utilities.php'; ?>
	</section>
</div>
<script src="<?php echo $module->getUrl('js/ConsoleDebugLogger.js'); ?>"></script>
<script src="<?php echo $module->getUrl('js/ROME.js'); ?>"></script>
<script>
	$(function() {
		if (window.DE_RUB_ROME && window.DE_RUB_ROME.init) {
			window.DE_RUB_ROME.init({});
		}
	});
</script>
