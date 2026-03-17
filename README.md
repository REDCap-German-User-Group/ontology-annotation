# ROME: REDCap Ontology Metadata Extension

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18525817.svg)](https://doi.org/10.5281/zenodo.18525817)


This module provides support to annotate fields in REDCap with references to various ontologies. The aim is to make data *Findable* as described in [FAIR data](https://en.wikipedia.org/wiki/FAIR_data). This is different from using ontologies like ICD10 or SNOMED-CT to describe *data*, which is already supported by REDCap. 

## Features

- **Ontology Annotations**
  - Annotate fields with standardized concepts (e.g., SNOMED CT, LOINC)
  - Store structured metadata (CodeableConcept-like JSON)

- **Configurable Ontology Sources**  
  - Allows uploading of minimal datasets (FHIR Questionnaire format)
  - Supports connection to BioPortal (any supported ontology)
  - Supports connection to Snowstorm (SNOMED CT server)

- **Inline Authoring Experience**
  - Annotate directly within REDCap's Online Designer
  - Minimal friction for end users

- **Performance-Conscious**
  - Caching strategies for remote terminology queries

- **Structured Storage**
  - Annotations are stored as JSON within field metadata
  - Designed to be both human-editable and machine-readable

## Purpose

ROME adds a semantic layer to REDCap projects by enabling:

- Consistent definition of variables
- Reuse of standardized concepts
- Improved data clarity and comparability

## How does it work?

This module provides a user interface (accessible at various places) that facilitates annotation of fields:
- The field itself, i.e., what it captures
- For categorical fields, what the choices represent
- For numerical fields, the unit

The full annotation is captures as a JSON structure in the `@ONTOLOGY` action tag inside the _Field Annotation_ of a field. 

Thus, annotations are integral parts of fields and consequently part of the data dictionary. The annotation format is described in detail [here](technical_docs/Annotation_Format.md).

## Installation

Automatic installation:

- Automatic installation will be available once a release is available and has been submitted to the External Module Repository.

Manual installation:

- Clone this repo into `<redcap-root>/modules/rome_v<version-number>`.
- Go to _Control Center > Technical / Developer Tools > External Modules_ and enable 'ROME: REDCap Ontologies Made Easy'.

## Configuration

After installation, the module's cache mechanism needs to be set up using the built-in external module configuration in Control Center. ROME will not work until this step has been completed.

Further configuration is done on the **ROME: REDCap Ontology Metadata Extension** plugin page. To be able to annotate fields, at least one ontology source has to be added to a project.

To add ontology sources to a project, go to the **Manage** tab and add:
- Local sources (such as an annotated [FHIR Questionnaire](https://build.fhir.org/questionnaire.html))
- Remote sources (such as [BioPortal](https://bioportal.bioontology.org/) or [Snowstorm](https://github.com/IHTSDO/snowstorm))
- System sources (these are local or remote sources set up by a REDCap admin to be available for use in projects)

Furthermore, project designers can choose to make annotations **discoverable** or not.

Admins can pre-configure local and remote sources for use by projects on the **Global Configuration** tab. 

Additional admin options include:
- Enabling or disabling debug output to the browser console (should be off in production)
- Allowing or disallowing the use of the BioPortal token set up in REDCap (if available) for BioPortal ontology searches configured in projects
- Allowing access to the **Global Configuration** tab to users with design rights in certain projects (this allows delegating ROME administration to select users without the need for them to have access to the Control Center; these users won't be able to see or change the admin-only options)


## Usage

Visit the **ROME: REDCap Ontologies Made Easy** plugin page to manage ontology annotations.

### Learning about ROME

Check out the **About** tab.

### Adding annotations

Annotation is done in the _Online Designer_'s **Edit Field** dialog. In future versions, further annotation facilities may be added to the **Annotate** tab.

### Searching an instance

Use the **Discover** tab on the  plugin page in any project with the module enabled. Ontology codes can be selected and a list of projects that capture data matching these ontologies is displayed. Only projects that have opted in to be discoverable are included in the search.

### Merging annotated data

Check out the **Utilities** tab. This content is still experimental. For now, an R function is provided to combine datasets from different REDCap projects that have been annotated using ROME.

## How to cite this work

> Meigen, C. and Rezniczek, G. A. (2026). ROME: REDCap Ontologies Made Easy (REDCap External Module) [Computer software]. https://doi.org/10.5281/zenodo.18525817

Or by adding this reference to your BibTeX database:

```bibtex
@software{Meigen_Rezniczek_ROME_REDCap_EM_2026,
author = {Meigen, Christof and Rezniczek, Günther A.},
doi = {10.5281/zenodo.18525817},
title = {{ROME: REDCap Ontologies Made Easy (REDCap External Module)}},
url = {https://github.com/REDCap-German-User-Group/ontology-annotation},
version = {1.0.0},
year = {2026}
}
```

These instructions are also available on [GitHub](https://github.com/REDCap-German-User-Group/ontology-annotation) under 'Cite This Repository'.

## Support

This work was supported by [TMF – Technologie- und Metho­den­plattform für die ver­netzte medi­zi­nische Forschung e.V.](https://www.tmf-ev.de/) (project V141-01).
