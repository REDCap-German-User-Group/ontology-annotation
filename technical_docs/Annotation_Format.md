# Annotation Format

This document describes the JSON object stored as the parameter of the `@ONTOLOGY` action tag in the REDCap Field Annotation field.

The annotation has one top-level object, `dataElement`. The Online Designer editor writes only targets that have at least one coding:

- `dataElement.coding`: ontology codings for the REDCap field itself.
- `dataElement.valueCodingMap`: ontology codings for categorical choice values, keyed by REDCap choice code.
- `dataElement.unit`: ontology codings for the field unit. The editor also writes `unit.text` from the first unit coding display value.

The parser accepts unquoted and quoted action tag parameters, for example `@ONTOLOGY={...}` and `@ONTOLOGY='{...}'`. If multiple `@ONTOLOGY` tags are present, the parser uses the last valid tag and reports warnings for invalid earlier tags.

## Coding

A coding object follows the FHIR `Coding` shape used by the module:

```json
{
    "system": "http://loinc.org",
    "code": "8302-2",
    "display": "Body height"
}
```

`system` and `code` are required for a coding to be useful. `display` is optional, but the UI and search results normally provide it.

## Schema

The annotation schema is available at [`schemas/rome-annotation.schema.json`](../schemas/rome-annotation.schema.json).

## Example 1: 
A radio field, _Education Level_, with three options.

`@ONTOLOGY=`
```json
{
    "dataElement": {
        "coding": [
            {
                "system": "http://loinc.org",
                "code": "82589-3",
                "display": "Highest level of education"
            },
            {
                "system": "https://snomed.info/sct",
                "code": "276031006",
                "display": "Details of education (observable entity)"
            }
        ],
        "valueCodingMap": {
            "1": {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "410594000",
                        "display": "No formal education"
                    }
                ]
            },
            "2": {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "289131004",
                        "display": "Completed secondary education"
                    }
                ]
            },
            "3": {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "229710002",
                        "display": "Completed higher education"
                    }
                ]
            }
        }
    }
}
```

## Example 2:
A text field with email validation:

```json
{
    "dataElement": {
        "coding": [
            {
                "system": "http://snomed.info/sct",
                "code": "424966008",
                "display": "Patient email address"
            }
        ]
    }
}
```

## Example 3:
A numerical data type (height) with a unit

```json
{
    "dataElement": {
        "unit": {
            "coding": [
                {
                "system": "http://unitsofmeasure.org",
                "code": "cm",
                "display": "Zentimeter"
                }
            ]
        },
        "coding": [
            {
                "system": "http://loinc.org",
                "code": "8302-2",
                "display": "Body height"
            }
        ]
    }
}
```
