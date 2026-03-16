<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */

?>
<!-- Add Local Source -->
<div class="modal fade" id="romeSystemSourceModal" tabindex="-1" aria-hidden="true">
	<div class="modal-dialog modal-lg modal-dialog-scrollable">
		<div class="modal-content">
			<div class="modal-header">
				<h5 class="modal-title"><i class="fa-solid fa-hard-drive me-2"></i><span id="romeSystemSourceModalTitle">Add/Edit a system source</span></h5>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<input type="hidden" name="system_source_id" id="rome_system_source_id" value="">

				<div class="red mb-3 d-none" id="romeSystemSourceError"></div>

				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_system_title">Title override <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<input class="form-control form-control-sm" data-rome-reset="" type="text" name="title" id="rome_system_title">
						<div class="rome-title-from-source" id="rome-title-from-system"></div>
					</div>
				</div>

				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_system_description">Description override <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<textarea class="form-control form-control-sm" data-rome-reset="" name="description" id="rome_system_description" rows="4"></textarea>
						<div class="rome-description-from-source" id="rome-description-from-system"></div>
					</div>
				</div>

				<div class="mb-2 row">
					<div class="col-sm-3 col-form-label">System source type:</div>
					<div class="col-sm-9">
						<div class="col-form-label" id="rome-system-source-info">
							No system source selected. Please select one from the list.
						</div>

					</div>
				</div>
				<div id="rome-system-sources-table-wrapper">
					<hr>
					<table id="rome-system-sources-table" class="table table-sm table-hover align-middle rome-sources-table rome-system-sources-table">
						<thead>
							<tr>
								<th class="rome-sources-col-checked">&nbsp;</th>
								<th class="rome-sources-col-type">Type</th>
								<th class="rome-sources-col-title">Title / Description</th>
								<th class="rome-sources-col-stats">Stats</th>
							</tr>
						</thead>
						<tbody></tbody>
					</table>
				</div>

			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
				<button type="button" class="btn btn-primary" id="romeSystemSourceSaveBtn">Save</button>
			</div>
		</div>
	</div>
</div>