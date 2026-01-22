# ROME: REDCap Ontology annotation Made Easy

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

To install this external module in a REDCap instance, download a release.   
TODO

## Configuration

TODO

## Usage

### Adding annotations

TODO

### Searching an instance

TODO

### Merging annotated data

TODO


## How to cite this work

TODO
