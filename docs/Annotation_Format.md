# Annotation Format

This document describes the format of the `@ONTOLOGY` action tag parameter (a JSON string).

Example: A radio field, _Education Level_, with three options.

`@ONTOLOGY=`
```jsonc
{
    // Note: `resourceType` is not present in the action tag.
    "resourceType": "ROME_Ontology_Annotation",
    // Note: `url` is not present in the action tag. For exports, the value will be set to
    // the base url of the originating REDCap instance + project id [ + form name/report id]
    // depending on the export scope.
    "url": "https://...",
    // Note: `meta` is not present in export files and added for exports only
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
        // Note: `name` and `label` are not present in the action tag - they are 
        // generated (from the REDCap field) when the ontology annotations are exported
        "name": "education_level",
        "label": "Höchster Bildungsabschluss",
        // Note: `type` is not present in the action tag - it is generated (from the REDCap field) when the ontology annotations are exported. This is true for all type-related fields.
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
                // `label` is the REDCap label - only added for multi-field export (derived from REDCap metadata)
                "label": "Kein Abschluss", 
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
    "language": "de",                         // The language of REDCap field-derived labels
    "profile": [
        "https://..."
    ]
}
```


Example of a text field with email validation:

a) Export JSON

```json
{
    "resourceType": "ROME_Ontology_Annotation",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:50:00+02:00",
        "updated": "2025-07-25T13:10:00+02:00",
        "creator": "ROME v1.0.0",
        "language": "de"
    },
    "dataElement": {
        "name": "email",
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

b) Inline @ONTOLOGY annotation

```json
{
    "dataElement": {
        "coding": [
            {
                "system": "http://snomed.info/sct",
                "code": "424966008",
                "display": "Patient email address"
            }
        ],
    }
}
```



Example of a numerical data type (height) with a unit

```jsonc
{
    "resourceType": "ROME_Ontology_Annotation",
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

| `type`        | Description                                   | Selection Style        | Additional Fields/Notes                            |
| ------------- | --------------------------------------------- | ---------------------- | -------------------------------------------------- |
| `"radio"`     | Single-choice categorical field (1 of N)      | Single-select          | Use `valueCodingMap`                               |
| `"checkbox"`  | Multi-choice categorical field (0 to N)       | Multi-select           | Use `valueCodingMap`                               |
| `"dropdown"`  | Single-choice via dropdown UI (same as radio) | Single-select          | Semantically same as `"radio"`                     |
| `"number"`    | Numeric field (integer or decimal)            | Direct input           | Add `numericType`, `precision`, `unit`             |
| `"text"`      | Free-text entry                               | Direct input           | Use `format` if structured (email, url, etc.)      |
| `"date"`      | Date field (various formats)                  | Date picker/input      | Use `unit` (with format code or UCUM date unit)    |
| `"datetime"`  | Date + time field                             | Timestamp picker/input | Same as `"date"`                                   |
| `"yesno"`     | Boolean-like binary choice                    | Single-select          | Alias of `"radio"` with 2 values (`Yes`, `No`)     |
| `"truefalse"` | Boolean-like binary choice                    | Single-select          | Alias of `"radio"` with 2 values (`True`, `False`) |

## Additional Keys (used conditionally)

| Field            | Used With                             | Purpose                                     |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| `numericType`    | `"number"`                            | `"integer"` or `"decimal"`                  |
| `precision`      | `"number"`                            | Decimal places if `numericType = "decimal"` |
| `format`         | `"text"`                              | `"email"`, `"url"`, `"phone"`, etc.         |
| `unit`           | `"number"`, `"date"`, `"datetime"`    | As `CodeableConcept`                        |
| `valueCodingMap` | `"radio"`, `"checkbox"`, `"dropdown"` | Maps codes to concept labels and codes      |


**TODO**: 
- Define/Provide a list of basic data types (e.g., yesno -> Yes) with appropriate annotations. These will be offered by the UI as annotations for the user to assign.
- Similarly, provide annotations for common units.

## Missing Data Codes

- Annotate for each field separately?
- Separate UI for general annotations?
- Override for specific fields? (Obey `@NOMISSING`)
- Coded in `valueCodingMap` (which can then exist for non-radio/checkbox/dropdown types)

Provide standard generic annotations for REDCap-built-in Missing Data Codes.


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
| True-False         | `"radio"` or `"truefalse"`                             | Semantically boolean           |

**Note:** Default ontology annotations for `"Yes"`, `"No"`, `"True"`, `"False"` should probably be provided. However, the 
actual meaning / appropriate annotation of these may vary based on the field's annotation.

## JSON Schema

Ontology annotations can be validated, e.g., in the browser with the [Ajv JSON schema validator](https://ajv.js.org/) (MIT), or in PHP, with [Opis JSON Schema](https://github.com/opis/json-schema) (Apache 2.0), based on the ROME Annotation schema.

The schema is available at [`rome-annotation.schema.json`](../schemas/rome-annotation.schema.json).
