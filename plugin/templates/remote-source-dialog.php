<?php

namespace DE\RUB\OntologiesMadeEasyExternalModule;

if (!defined('ROME_PLUGIN_PAGE')) exit;

/** @var OntologiesMadeEasyExternalModule $module */


?>
<!-- Add Remote Source -->
<div class="modal fade" id="romeRemoteSourceModal" tabindex="-1" aria-hidden="true">
	<div class="modal-dialog modal-lg modal-dialog-scrollable">
		<div class="modal-content">
			<div class="modal-header">
				<h5 class="modal-title" id="romeRemoteSourceModalTitle">Add remote source</h5>
				<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
			</div>

			<form id="romeRemoteSourceForm" novalidate>
				<div class="modal-body">
					<input type="hidden" name="source_id" id="rome_source_id" value="">

					<div class="alert alert-danger d-none" id="romeRemoteSourceError"></div>

					<div class="row g-3">
						<div class="col-md-6">
							<label class="form-label" for="rome_remote_type">Remote type</label>
							<select class="form-select" name="remote_type" id="rome_remote_type" required>
								<option value="bioportal">BioPortal</option>
								<option value="snowstorm">Snowstorm</option>
							</select>
							<div class="invalid-feedback">Please choose a remote type.</div>
						</div>

						<!-- Common -->
						<div class="col-md-6">
							<label class="form-label" for="rome_title">Title</label>
							<input class="form-control" type="text" name="title" id="rome_title" required maxlength="120">
							<div class="invalid-feedback">Title is required.</div>
						</div>

						<div class="col-12">
							<label class="form-label" for="rome_description">Description</label>
							<textarea class="form-control" name="description" id="rome_description" rows="3" maxlength="1000"></textarea>
						</div>
					</div>

					<hr class="my-3">

					<!-- BioPortal block -->
					<div id="rome_remote_block_bioportal">
						<div class="row g-3">
							<div class="col-12">
								<div class="form-check form-switch">
									<input class="form-check-input" type="checkbox" id="rome_bioportal_use_redcap_token" name="bioportal_use_redcap_token" checked>
									<label class="form-check-label" for="rome_bioportal_use_redcap_token">
										Use REDCap-stored BioPortal API token (if available)
									</label>
								</div>
								<div class="form-text">
									If not available, a dedicated token can be entered below.
								</div>
							</div>

							<div class="col-12" id="rome_bioportal_token_wrap">
								<label class="form-label" for="rome_bioportal_token">BioPortal API token</label>
								<input class="form-control" type="password" name="bioportal_token" id="rome_bioportal_token" autocomplete="off">
							</div>

							<div class="col-12">
								<label class="form-label" for="rome_bioportal_ontology">Ontology</label>
								<div class="input-group">
									<select class="form-select" name="bioportal_ontology" id="rome_bioportal_ontology" required>
										<option value="">Loading…</option>
									</select>
									<button class="btn btn-outline-secondary" type="button" id="rome_bioportal_refresh">
										Refresh
									</button>
								</div>
								<div class="form-text">
									Ontologies are fetched from BioPortal if not cached.
								</div>
								<div class="invalid-feedback">Please select an ontology.</div>
							</div>
						</div>
					</div>

					<!-- Snowstorm block -->
					<div id="rome_remote_block_snowstorm" class="d-none">
						<div class="row g-3">
							<div class="col-12">
								<label class="form-label" for="rome_snowstorm_base_url">API base URL</label>
								<input class="form-control" type="url" name="snowstorm_base_url" id="rome_snowstorm_base_url"
									placeholder="https://snowstorm.example.org">
								<div class="form-text">
									Base URL only (no trailing slash). You can proxy Snowstorm behind a gateway.
								</div>
							</div>

							<div class="col-md-6">
								<label class="form-label" for="rome_snowstorm_branch">Branch</label>
								<input class="form-control" type="text" name="snowstorm_branch" id="rome_snowstorm_branch"
									placeholder="MAIN/SNOMEDCT-DE">
							</div>

							<div class="col-md-6">
								<label class="form-label" for="rome_snowstorm_auth_mode">Auth mode</label>
								<select class="form-select" name="snowstorm_auth_mode" id="rome_snowstorm_auth_mode">
									<option value="none">None</option>
									<option value="basic">Basic</option>
									<option value="bearer">Bearer token</option>
								</select>
								<div class="form-text">
									Many private deployments use Basic via Spring Security or a reverse proxy. :contentReference[oaicite:1]{index=1}
								</div>
							</div>

							<div class="col-md-6 d-none" id="rome_snowstorm_basic_user_wrap">
								<label class="form-label" for="rome_snowstorm_basic_user">Username</label>
								<input class="form-control" type="text" name="snowstorm_basic_user" id="rome_snowstorm_basic_user">
							</div>

							<div class="col-md-6 d-none" id="rome_snowstorm_basic_pass_wrap">
								<label class="form-label" for="rome_snowstorm_basic_pass">Password</label>
								<input class="form-control" type="password" name="snowstorm_basic_pass" id="rome_snowstorm_basic_pass" autocomplete="off">
							</div>

							<div class="col-12 d-none" id="rome_snowstorm_bearer_wrap">
								<label class="form-label" for="rome_snowstorm_bearer">Bearer token</label>
								<input class="form-control" type="password" name="snowstorm_bearer" id="rome_snowstorm_bearer" autocomplete="off">
							</div>

							<div class="col-12">
								<button class="btn btn-outline-secondary" type="button" id="rome_snowstorm_test">
									Test connection
								</button>
								<span class="ms-2" id="rome_snowstorm_test_result"></span>
							</div>
						</div>
					</div>

				</div>

				<div class="modal-footer">
					<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
					<button type="submit" class="btn btn-primary" id="romeRemoteSourceSaveBtn">Save</button>
				</div>
			</form>
		</div>
	</div>
</div>