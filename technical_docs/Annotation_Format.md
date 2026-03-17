# Annotation Format

This document describes the format of the `@ONTOLOGY` action tag parameter (a JSON string).
The format is minimal, with a single `dataElement` object.

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

