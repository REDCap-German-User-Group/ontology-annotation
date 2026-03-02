<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */

?>
<!-- Add Local Source -->
<div class="modal fade" id="romeLocalSourceModal" tabindex="-1" aria-hidden="true">
	<div class="modal-dialog modal-lg modal-dialog-scrollable">
		<div class="modal-content">
			<div class="modal-header">
				<h5 class="modal-title"><i class="fa-solid fa-database me-2"></i><span id="romeLocalSourceModalTitle">Add/Edit a local source</span></h5>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<input type="hidden" name="local_source_id" id="rome_local_source_id" value="">

				<div class="red mb-3 d-none" id="romeLocalSourceError"></div>


				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_local_title">Title override <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<input class="form-control form-control-sm" data-rome-reset="" type="text" name="title" id="rome_local_title">
						<div class="rome-title-from-file" id="rome-title-from-file"></div>
					</div>
				</div>

				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_local_description">Description override <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<textarea class="form-control form-control-sm" data-rome-reset="" name="description" id="rome_local_description" rows="4"></textarea>
						<div class="rome-description-from-file" id="rome-description-from-file"></div>
					</div>
				</div>

				<div class="mb-2 row">
					<div class="col-sm-3 col-form-label">Annotation source file:</div>
					<div class="col-sm-9">
						<div class="col-form-label" id="rome-file-info">No file selected. Please upload a file.</div>
						<div class="form-check">
							<input class="form-check-input" type="checkbox" id="rome_enable_local_file_upload">
							<label class="form-check-label" for="rome_enable_local_file_upload">Replace existing file</label>
						</div>

						<div id="rome-file-drop-area">
							<div id="rome-file-drop-message">
								<i class="fa-solid fa-file-arrow-up"></i>
								<span id="rome-file-drop-message-text">Drag and drop a file here, or <em>click here</em>, to upload</span>
							</div>
							<input id="rome-file-input" class="rome-file-drop-file-input" type="file">
						</div>
					</div>
				</div>

			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
				<button type="button" class="btn btn-primary" id="romeLocalSourceSaveBtn">Save</button>
			</div>
		</div>
	</div>
</div>