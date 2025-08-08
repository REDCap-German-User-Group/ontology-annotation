# Annotation Format

This document describes the format of the `@ONTOLOGY` action tag parameter (a JSON string)

`@ONTOLOGY=`

Example radio field - _Education Level_

```jsonc
{
    "resourceType": "OntologyAnnotation",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:45:00+02:00",
        "updated": "2025-07-25T13:05:00+02:00",
        "creator": "ROME v1.0.0",
        "language": "de",
        "profile": [
            "https://..."
        ]
    },
    "dataElement": {
        // name and label can/should be omitted - will be generated when exporting ontology annotations for multiple fields
        "name": "education_level",
        "label": "Höchster Bildungsabschluss",
        "type": "radio",
        "coding": [
            {
                "system": "http://loinc.org",
                "code": "82589-3",
                "display": "Highest level of education",
                "version": "Version of the Ontology" // Optional/when available
            },
            {
                "system": "https://snomed.info/sct",
                "code": "276031006",
                "display": "Details of education (observable entity)"
            }
        ],
        "text": "Höchster erreichter Bildungsabschluss",
        "valueCodingMap": {
            "1": {
                "label": "Kein Abschluss", // label is the REDCap label - only added for multi-field export (derived from REDCap metadata)
                "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "410594000",
                    "display": "No formal education"
                }
                ],
                "text": "Kein formaler Abschluss"

            },
            "2": {
                "label": "Schulabschluss",
                "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "289131004",
                    "display": "Completed secondary education"
                }
                ],
                "text": "Abschluss einer weiterführenden Schule"
            },
            "3": {
                "label": "Hochschulabschluss",
                "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "229710002",
                    "display": "Completed higher education"
                }
                ],
                "text": "Abschluss einer Hochschule oder Universität"
            }
        }
    }
}
```

Notes:
- `name` is the REDCap field name. It is not present in the field's ontology annotation, but must be added for multi-field ontology exports
- `label` is the REDCap field/choice label. It is not present in the field's ontology annotation, but must be added for multi-field ontology exports.

## Metadata (`meta`)

```jsonc
"meta": {
    "version": "1.0.0",                       // Format/schema version
    "created": "2025-07-25T12:25:00+02:00",   // Initial annotation
    "updated": "2025-07-25T14:00:00+02:00",   // When this field's annotation was last changed
    "creator": "ROME v1.0.0",                 // Tool used to create the annotation
    "language": "de",                         // The language used for 
    "profile": [
        "https://..."
    ]
}
```


Example of a text field with email validation

```jsonc
{
    "resourceType": "OntologyAnnotation",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:50:00+02:00",
        "updated": "2025-07-25T13:10:00+02:00",
        "creator": "ROME v1.0.0",
        "language": "de"
    },
    "dataElement": {
        "name": "email",           // optional
        "label": "E-Mail-Adresse", // optional
        "type": "text",
        "format": "email",
        "coding": [
            {
                "system": "http://snomed.info/sct",
                "code": "424966008",
                "display": "Patient email address"
            }
        ],
        "text": "E-Mail-Adresse des Patienten"
    }
}
```

Example of a numerical data type (height) with a unit

```jsonc
{
    "resourceType": "OntologyAnnotation",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:55:00+02:00",
        "updated": "2025-07-25T13:15:00+02:00",
        "creator": "ROME v1.0.0",
        "language": "de"
    },
    "dataElement": {
        "name": "body_height",
        "label": "Körpergröße",
        "type": "number",
        "numericType": "decimal",
        "precision": 1,
        "unit": {
            // Optional, this could also reference another field if the unit is flexible - TODO: Which keyword? Maybe: "ref": "fieldname"
            "coding": [
                {
                "system": "http://unitsofmeasure.org",
                "code": "cm",
                "display": "Zentimeter"
                }
            ],
            "text": "cm"
        },
        "coding": [
            {
                "system": "http://loinc.org",
                "code": "8302-2",
                "display": "Body height"
            }
        ],
        "text": "Körpergröße in cm (auf mm genau)"
    }
}
```

## Types

| `type`       | Description                                   | Selection Style        | Additional Fields/Notes                         |
| ------------ | --------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `"radio"`    | Single-choice categorical field (1 of N)      | Single-select          | Use `valueCodingMap`                            |
| `"checkbox"` | Multi-choice categorical field (0 to N)       | Multi-select           | Use `valueCodingMap`                            |
| `"dropdown"` | Single-choice via dropdown UI (same as radio) | Single-select          | Semantically same as `"radio"`                  |
| `"number"`   | Numeric field (integer or decimal)            | Direct input           | Add `numericType`, `precision`, `unit`          |
| `"text"`     | Free-text entry                               | Direct input           | Use `format` if structured (email, url, etc.)   |
| `"date"`     | Date field (various formats)                  | Date picker/input      | Use `unit` (with format code or UCUM date unit) |
| `"datetime"` | Date + time field                             | Timestamp picker/input | Same as `"date"`                                |
| `"yesno"`    | Boolean-like binary choice                    | Single-select          | Alias of `"radio"` with 2 values (`Yes`, `No`)  |
| `"truefalse"`    | Boolean-like binary choice                    | Single-select          | Alias of `"radio"` with 2 values (`True`, `False`)  |

## Additional Keys (used conditionally)

| Field            | Used With                          | Purpose                                     |
| ---------------- | ---------------------------------- | ------------------------------------------- |
| `numericType`    | `"number"`                         | `"integer"` or `"decimal"`                  |
| `precision`      | `"number"`                         | Decimal places if `numericType = "decimal"` |
| `format`         | `"text"`                           | `"email"`, `"url"`, `"phone"`, etc.         |
| `unit`           | `"number"`, `"date"`, `"datetime"` | As `CodeableConcept`                        |
| `valueCodingMap` | `"radio"`, `"checkbox"`, `"dropdown"` | Maps codes to concept labels and codes      |


## Example Mapping: REDCap → Ontology

| REDCap Field Type  | Ontology `type`                                        | Notes                          |
| ------------------ | ------------------------------------------------------ | ------------------------------ |
| Text (plain)       | `"text"`                                               |                                |
| Text (email)       | `"text"` + `format: "email"`                           |                                |
| Integer            | `"number"` + `numericType: "integer"`                  |                                |
| Decimal (2 places) | `"number"` + `numericType: "decimal"` + `precision: 2` |                                |
| Date (DMY)         | `"date"`                                               | Use `unit` for format code     |
| Datetime           | `"datetime"`                                           |                                |
| Radio              | `"radio"`                                              | With `valueCodingMap`          |
| Dropdown           | `"dropdown"`                                           | Same as `"radio"` semantically |
| Checkbox           | `"checkbox"`                                           | Multi-select                   |
| Yes-No             | `"radio"` or `"yesno"`                                 | Semantically boolean           |
| True-False             | `"radio"` or `"truefalse"`                                 | Semantically boolean           |



**Notes:** We probably should provide default ontology annotations for `"Yes"`, `"No"`, `"True"`, `"False"`


## JSON Schema

Ontology annotations can be validated, e.g., in the browser with the [Ajv JSON schema validator](https://ajv.js.org/) (MIT), or in PHP, with [Opis JSON Schema](https://github.com/opis/json-schema) (Apache 2.0).


```json
{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://example.org/schemas/ontology-annotation.schema.json",
    "title": "OntologyAnnotation",
    "type": "object",
    "required": [
        "resourceType",
        "meta",
        "dataElement"
    ],
    "properties": {
        "resourceType": {
            "const": "OntologyAnnotation"
        },
        "meta": {
            "type": "object",
            "required": [
                "version",
                "created",
                "creator"
            ],
            "properties": {
                "version": {
                    "type": "string"
                },
                "created": {
                    "type": "string",
                    "format": "date-time"
                },
                "updated": {
                    "type": "string",
                    "format": "date-time"
                },
                "creator": {
                    "type": "string"
                },
                "language": {
                    "type": "string"
                },
                "profile": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "format": "uri"
                    }
                }
            },
            "additionalProperties": false
        },
        "dataElement": {
            "type": "object",
            "required": [
                "coding",
                "text"
            ],
            "properties": {
                "name": {
                    "type": "string"
                },
                "label": {
                    "type": "string"
                },
                "type": {
                    "type": "string",
                    "enum": [
                        "radio",
                        "checkbox",
                        "dropdown",
                        "number",
                        "text",
                        "date",
                        "datetime",
                        "yesno",
                        "truefalse"
                    ]
                },
                "coding": {
                    "type": "array",
                    "items": {
                        "$ref": "#/$defs/Coding"
                    },
                    "minItems": 1
                },
                "text": {
                    "type": "string"
                },
                "format": {
                    "type": "string",
                    "enum": [
                        "email",
                        "url",
                        "phone"
                    ]
                },
                "numericType": {
                    "type": "string",
                    "enum": [
                        "integer",
                        "decimal"
                    ]
                },
                "precision": {
                    "type": "integer",
                    "minimum": 0
                },
                "unit": {
                    "type": "object",
                    "required": [
                        "coding",
                        "text"
                    ],
                    "properties": {
                        "coding": {
                            "type": "array",
                            "items": {
                                "$ref": "#/$defs/Coding"
                            },
                            "minItems": 1
                        },
                        "text": {
                            "type": "string"
                        }
                    },
                    "additionalProperties": false
                },
                "valueCodingMap": {
                "type": "object",
                "patternProperties": {
                    "^[^\\s]+$": {
                    "type": "object",
                    "required": [
                        "text",
                        "coding"
                    ],
                    "properties": {
                        "label": {
                        "type": "string"
                        },
                        "text": {
                        "type": "string"
                        },
                        "coding": {
                        "type": "array",
                        "items": {
                            "$ref": "#/$defs/Coding"
                        },
                        "minItems": 1
                        }
                    },
                    "additionalProperties": false
                    }
                },
                "additionalProperties": false
                }
            },
            "additionalProperties": false
            }
        },
    "additionalProperties": false,
    "$defs": {
        "Coding": {
            "type": "object",
            "required": [
                "system",
                "code"
            ],
            "properties": {
                "system": {
                    "type": "string",
                    "format": "uri"
                },
                "code": {
                    "type": "string"
                },
                "display": {
                    "type": "string"
                }
            },
            "additionalProperties": false
        }
    }
}
```
