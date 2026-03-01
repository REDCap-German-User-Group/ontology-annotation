<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */

$bpTokenMessage =
	$lang['system_config_398'] . ' <b>' . \BioPortal::getApiUrl() . '</b>. ' .
	$lang['system_config_399'] . ' <a href="' . \BioPortal::$SIGNUP_URL . '" target="_blank" style="text-decoration:underline;">' . $lang['system_config_400'] . '</a>.<br>';
$bp = $module->getBioPortalApiDetails();
$allowRcBioPortal = (defined('PROJECT_ID') && !PROJECT_ID) || ($module->framework->getSystemSetting('sys-allow-rc-bioportal') === true);
if ($bp['enabled'] && $allowRcBioPortal) {
	$bpTokenMessage .=
		'Provide a token or <b>leave blank</b> to use the built-in BioPortal API token.';
} else {
	$bpTokenMessage .=
		'<span class="text-danger">' . $lang['system_config_401'] . '</span>';
}
?>
<!-- Add Remote Source -->
<div class="modal fade" id="romeRemoteSourceModal" tabindex="-1" aria-hidden="true">
	<div class="modal-dialog modal-lg modal-dialog-scrollable">
		<div class="modal-content">
			<div class="modal-header">
				<h5 class="modal-title"><i class="fa-solid fa-cloud me-2"></i><span id="romeRemoteSourceModalTitle">Add/Edit a remote source</span></h5>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>
			<div class="modal-body">
				<input type="hidden" name="source_id" id="rome_source_id" value="">

				<div class="red mb-3 d-none" id="romeRemoteSourceError"></div>


				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_title">Title <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<input class="form-control form-control-sm" data-rome-reset="" type="text" name="title" id="rome_title" maxlength="120">
					</div>
				</div>

				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_description">Description <i>(optional)</i>:</label>
					<div class="col-sm-9">
						<textarea class="form-control form-control-sm" data-rome-reset="" name="description" id="rome_description" rows="3" maxlength="1000"></textarea>
					</div>
				</div>

				<div class="mb-2 row">
					<label class="col-sm-3 col-form-label" for="rome_remote_type">Remote type:</label>
					<div class="col-sm-9">
						<select class="form-select form-select-sm" name="remote_type" id="rome_remote_type" required>
							<option value="bioportal">BioPortal</option>
							<option value="snowstorm">Snowstorm</option>
						</select>
						<div class="invalid-feedback">Please choose a remote type.</div>
					</div>
				</div>

				<!-- BioPortal block -->
				<div id="rome_remote_block_bioportal">
					<div class="mb-2 row g-3">
						<label class="col-sm-3 col-form-label" for="rome_bioportal_token">BioPortal API token:</label>
						<div class="col-sm-9" id="rome_bioportal_token_wrap">
							<input class="form-control form-control-sm" type="password" data-rome-reset="" name="bioportal_token" id="rome_bioportal_token" autocomplete="off">
							<div class="form-text">
								<?= $bpTokenMessage ?>
							</div>
						</div>
					</div>

					<div class="mb-2 row">
						<label class="col-sm-3 col-form-label" for="rome_bioportal_ontology">Ontology:</label>
						<div class="col-sm-9">
							<select class="form-select form-select-sm rome_bioportal_ontologies" name="bioportal_ontology" id="rome_bioportal_ontology" required>
								<option value="">Loading…</option>
							</select>
							<button class="btn btn-link btn-sm ms-1" type="button" id="rome_bioportal_refresh">
								<span class="visually-hidden">Refresh</span>
								<i class="fa-solid fa-arrows-rotate"></i>
							</button>
							<div class="invalid-feedback">Please select an ontology.</div>
						</div>
					</div>
				</div>

				<!-- Snowstorm block -->
				<div id="rome_remote_block_snowstorm" class="d-none">
					<div class="mb-2 row">
						<label class="col-sm-3 col-form-label" for="rome_snowstorm_base_url">API base URL:</label>
						<div class="col-sm-9">
							<input class="form-control form-control-sm" type="url" data-rome-reset="" name="snowstorm_base_url" id="rome_snowstorm_base_url"
								placeholder="https://snowstorm.example.org">
							<div class="form-text">
								Base URL only (no trailing slash).
							</div>
						</div>
					</div>

					<div class="mb-2 row">
						<label class="col-sm-3 col-form-label" for="rome_snowstorm_auth_mode">Auth mode:</label>
						<div class="col-sm-9">
							<select class="form-select form-select-sm" data-rome-reset="none" name="snowstorm_auth_mode" id="rome_snowstorm_auth_mode">
								<option value="none">None</option>
								<option value="basic">Basic</option>
								<option value="bearer">Bearer token</option>
							</select>
						</div>
					</div>

					<div class="mb-2 row d-none" id="rome_snowstorm_basic_user_wrap">

						<label class="col-sm-3 col-form-label" for="rome_snowstorm_basic_user">Username:</label>
						<div class="col-sm-9">
							<input class="form-control" type="text" data-rome-reset="" name="snowstorm_basic_user" id="rome_snowstorm_basic_user">
						</div>

					</div>

					<div class="mb-2 row d-none" id="rome_snowstorm_basic_pass_wrap">
						<label class="col-sm-3 col-form-label" for="rome_snowstorm_basic_pass">Password:</label>
						<div class="col-sm-9">
							<input class="form-control" type="password" data-rome-reset="" name="snowstorm_basic_pass" id="rome_snowstorm_basic_pass" autocomplete="off">
						</div>
					</div>

					<div class="mb-2 row d-none" id="rome_snowstorm_bearer_wrap">
						<label class="col-sm-3 col-form-label" for="rome_snowstorm_bearer">Bearer token:</label>
						<div class="col-sm-9">
							<input class="form-control" type="password" data-rome-reset="" name="snowstorm_bearer" id="rome_snowstorm_bearer" autocomplete="off">
						</div>
					</div>

					<div class="mb-2 row">
						<label class="col-sm-3 col-form-label" for="rome_snowstorm_branches">Branch:</label>
						<div class="col-sm-9">
							<div class="d-flex">
								<select class="form-select form-select-sm rome_snowstorm_branches" name="snowstorm_branches" id="rome_snowstorm_branches" disabled required style="width: 80%;">
									<option value="">Refresh to load branches ...</option>
								</select>
								<button class="btn btn-link btn-sm ms-1" type="button" id="rome_snowstorm_branch_refresh">
									<span class="visually-hidden">Refresh</span>
									<i class="fa-solid fa-arrows-rotate"></i>
								</button>
							</div>
							<div class="invalid-feedback">Please select a branch.</div>

						</div>
					</div>

				</div>

			</div>

			<div class="modal-footer">
				<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
				<button type="button" class="btn btn-primary" id="romeRemoteSourceSaveBtn">Save</button>
			</div>
		</div>
	</div>
</div>