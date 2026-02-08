# ROME: REDCap Ontology annotation Made Easy


**NOTICE**: This is a work in progress. This is an early preview release. **It is not yet ready for production use.** Active development is ongoing on the `revamp` branch. A first release is planned within early in Q2 2026.

---

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.18525817.svg)](https://doi.org/10.5281/zenodo.18525817)


This module provides support to annotate fields in REDCap with references to various ontologies. The aim is to make data *Findable* as described in [FAIR data](https://en.wikipedia.org/wiki/FAIR_data). This is different from using ontologies like ICD10 or SNOMED-CT to describe *data*, which is already supported by REDCap. 

For context, see also this thread on Community: https://redcap.vumc.org/community/post.php?id=261549 (account required).

## How does it work?

This module provides a user interface (accessible at various places) that facilitates annotation of fields:
- The field itself, i.e., what it captures
- For categorical fields, what the choices represent
- For numerical fields, the unit

The full annotation is captures as a JSON structure in the `@ONTOLOGY` action tag inside the _Field Annotation_ of a field. 

Thus, annotations are integral parts of fields and consequently part of the data dictionary. The annotation format is described in detail [here](docs/Annotation_Format.md).(ontology.md).

## Installation

Automatic installation:

- Automatic installation will be available once a release is available and has been submitted to the External Module Repository.

Manual installation:

- Clone this repo into `<redcap-root>/modules/rome_v<version-number>`.
- Go to _Control Center > Technical / Developer Tools > External Modules_ and enable 'ROME: REDCap Ontology Annotation Made Easy'.

## Configuration

Use the built-in external module configuration.

## Usage

### Adding annotations

Annotation is done in the _Online Designer_'s **Edit Field** dialog.

### Searching an instance

Use the **ROME - Discover projects** plugin page in any project with the module enabled.

### Merging annotated data

Check out the **ROME - Utility functions** plugin page.

## How to cite this work

Detals are still being formalized. The DOI (see above) is stable already.
