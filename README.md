# Ontology Annotation

This module provides support to annotate fields in REDCap with references to various ontologies. The aim is to make data *Findable* as described in [FAIR data](https://en.wikipedia.org/wiki/FAIR_data). 

This is different from using ontologies like ICD10 or SNOMED-CT to describe *data*, which is already supported by REDCap. 

# Design considerations

The list of supported ontologies is part of the module - as opposed to be configurable by the users. This makes it possible for the module to treat special cases in terms of backends, parent/child relations between ontology entries an various other ideosyncracies in the code. Also, this ensures that the field annotations are in a standardized format, as opposed to one user configuring an ontology "SNOMED" and the next one "SNOMED_CT". 

## Format of the field annotation

- The field annotation is in JSON format to be easily machine readable. One of the main goals of this module is to make manual editing of these annotations unnecessary.
- The annotations contains relevant info from the entry in the ontology, most importantly the label. An ID like `1162737008` is of little use for a user without the label "Self reported systolic blood pressure". It is impractical to retrieve the label on demand from an ontology service when doing queries. Updating of labels should be rare and and could be done asynchronically. 
- Obviously, one field can have references to different ontologies. It cannot, however, contain references to different entries in the same ontology. The ontology itself might provide additional references for an entry, most commonly parent relations, which should also be stored, but just as a simple "is-a" relationship. The same goes for additional labels. Since there are always new and updated releases of the ontologies, it might be tempting to allow versioning of the entries. While it makes sense to store the (minimal) version of the ontology alongside the reference, it would be harmful to allow different references for different versions.
- The references are always strings, even if they look like a number
- Hard-Coded URLs can be added for convenience, especially when provided by the ontology as a link to the authoritative website, but the module should be able to construct appropriate URLs by ontology.

```{json}
    {
       "SNOMED-CT": {"id": "43396009",
                    "label": "Hemoglobin A1c measurement (procedure)",
                    "version": "MAIN/LOINC/2023-10-15",
                    "other_labels": [{"lang": "en", "label": "Haemoglobin A1c measurement"}, {"lang": "en", "label": "HBA1c (haemoglobin A1c) level"}],
                    "url": "https://browser.loincsnomed.org/?perspective=full&conceptId1=43396009&edition=MAIN/LOINC/2023-10-15&release=&languages=en",
                    "parents": [{"id": "74040009", "label": "Protein measurement (procedure)"}, {"id": "430925007", "label": "Measurement of substance (procedure)"}]},
       "LOINC":    {"id": "4548-4",
                   "label": "Hemoglobin A1c/Hemoglobin.total in Blood",
                   "url": "https://loinc.org/4548-4/",
                   "parents": [{"id": "LG51070-7", "label": "Hemoglobin A1c/Hemoglobin.total|MFr|Pt|ANYBldSerPl"}]}
     }


```

