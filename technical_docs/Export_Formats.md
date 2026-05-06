# Export Formats

ROME currently exports annotations in two formats:

- Native ROME JSON (`resourceType: "ROME_Ontology_Annotations"`)
- FHIR Questionnaire (`resourceType: "Questionnaire"`)

The export tab lets the user select one or more REDCap forms and, in draft mode, whether to export production or draft metadata.

## Native ROME JSON

Native exports are collection documents. The exporter does not emit single-field `ROME_Ontology_Annotation` documents.

Example: A radio field, _Education Level_, with three options.

```jsonc
{
    "resourceType": "ROME_Ontology_Annotations",
    // For exports, the value for url will be set to the base url of the
    // originating REDCap instance + project id
    // depending on the export scope.
    "url": "https://...",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:45:00+02:00",
        "creator": "ROME v1.0.0",
        "metadataState": "development"
    },
    "title": "Ontology annotations for REDCap project ...",
    "description": "Export of ontology annotations for project:\n...",
    "dataElements": [
        {
            // Note: `name` and `text` correspond to the REDCap field name and label
            "name": "education_level",
            "text": "Höchster erreichter Bildungsabschluss",
            // Note: `type` is generated from the REDCap field type
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
            "valueCodingMap": {
                "1": {
                    // `text` is the REDCap choice label
                    "text": "Kein formaler Abschluss",
                    "coding": [
                        {
                            "system": "http://snomed.info/sct",
                            "code": "410594000",
                            "display": "No formal education"
                        }
                    ]
                },
                "2": {
                    "text": "Abschluss einer weiterführenden Schule",
                    "coding": [
                        {
                            "system": "http://snomed.info/sct",
                            "code": "289131004",
                            "display": "Completed secondary education"
                        }
                    ]
                },
                "3": {
                    "text": "Abschluss einer Hochschule oder Universität",
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
    ]
}
```

Notes:
- `name` is the REDCap field name. It is not present in the field's ontology annotation, but must be added for multi-field ontology exports
- `text` is the REDCap field/choice label. It is not present in the field's ontology annotation, but must be added for multi-field ontology exports.
- `coding` may be omitted when a field only has unit or choice annotations.
- `valueCodingMap` only includes choices with at least one ontology coding.

## Metadata (`meta`)

```jsonc
"meta": {
    "version": "1.0.0",                       // Format/schema version
    "created": "2025-07-25T12:25:00+02:00",   // Timestamp of the export
    "creator": "ROME v1.0.0",                 // Tool used to create the annotation
    "metadataState": "development"            // development, production, or draft
}
```


Example of a text field with email validation:

```json
{
    "resourceType": "ROME_Ontology_Annotations",
    "url": "https://...",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:50:00+02:00",
        "creator": "ROME v1.0.0",
        "metadataState": "production"
    },
    "title": "Ontology annotations for REDCap project ...",
    "description": "Export of ontology annotations for project:\n...",
    "dataElements": [
        {
            "name": "email",
            "text": "E-Mail-Adresse des Patienten",
            "type": "string",
            "format": "email",
            "coding": [
                {
                    "system": "http://snomed.info/sct",
                    "code": "424966008",
                    "display": "Patient email address"
                }
            ]
        }
    ]
}
```

Example of a numerical data type (height) with a unit

```jsonc
{
    "resourceType": "ROME_Ontology_Annotations",
    "url": "https://...",
    "meta": {
        "version": "1.0.0",
        "created": "2025-07-25T12:55:00+02:00",
        "creator": "ROME v1.0.0",
        "metadataState": "production"
    },
    "title": "Ontology annotations for REDCap project ...",
    "description": "Export of ontology annotations for project:\n...",
    "dataElements": [
        {
            "name": "body_height",
            "text": "Körpergröße in cm (auf mm genau)",
            "type": "number",
            "numericType": "decimal",
            "precision": 1,
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
    ]
}
```

## FHIR Questionnaire

FHIR exports use `Questionnaire.item` groups for REDCap forms and one child item per exported field. Field codings become `item.code`. Choice labels become `answerOption.valueCoding` entries using ROME's REDCap choice system, and choice ontology codings are attached to the answer option with ROME extensions. Unit codings are attached as Questionnaire unit extensions.

```jsonc
{
    "resourceType": "Questionnaire",
    "url": "https://...",
    "status": "active",
    "title": "Ontology annotations for REDCap project ...",
    "description": "Export of ontology annotations for project:\n...",
    "date": "2025-07-25T12:55:00+02:00",
    "publisher": "ROME v1.0.0",
    "extension": [
        {
            "url": "https://rub.de/rome/fhir/StructureDefinition/metadata-state",
            "valueCode": "production"
        }
    ],
    "item": [
        {
            "linkId": "demographics",
            "text": "Demographics",
            "type": "group",
            "item": [
                {
                    "linkId": "body_height",
                    "text": "Körpergröße in cm (auf mm genau)",
                    "type": "decimal",
                    "code": [
                        {
                            "system": "http://loinc.org",
                            "code": "8302-2",
                            "display": "Body height"
                        }
                    ]
                }
            ]
        }
    ]
}
```

## Type Mapping

Native ROME exports start with the REDCap `element_type` and then map text validation types as follows:

| REDCap field/validation | Native ROME output |
| --- | --- |
| `text` with no validation | `type: "string"` |
| `textarea` | `type: "text"` |
| `text` + `int` | `type: "number"`, `numericType: "integer"` |
| `text` + `float` or `number_comma_decimal` | `type: "number"`, `numericType: "decimal"` |
| `text` + `number_1dp` ... `number_4dp` variants | `type: "number"`, `numericType: "decimal"`, `precision: 1` ... `4` |
| `text` + `time` | `type: "time"`, `precision: "minutes"` |
| `text` + `time_hh_mm_ss` | `type: "time"`, `precision: "seconds"` |
| `text` + `date_ymd`, `date_dmy`, `date_mdy` | `type: "string"`, `format: "ymd"`, `"dmy"`, or `"mdy"` |
| `text` + `datetime_*` | `type: "string"`, `format: "ymd"`, `"dmy"`, or `"mdy"`, `precision: "minutes"` |
| `text` + `datetime_seconds_*` | `type: "string"`, `format: "ymd"`, `"dmy"`, or `"mdy"`, `precision: "seconds"` |
| Other `text` validations | `type: "string"`, `format: <REDCap validation type>` |
| `radio`, `checkbox`, `dropdown`/`select`, `yesno`, `truefalse`, `slider`, `file`, `sql`, `calc`, `descriptive` | The REDCap `element_type` value is retained |

FHIR Questionnaire exports use the module's FHIR mapping instead: `textarea` to `text`, yes/no and true/false to `boolean`, categorical fields to `coding`, file to `attachment`, slider to `choice`, SQL to `string`, numeric validations to `integer` or `decimal`, dates to `date`, and datetimes to `dateTime`.

## Additional Keys

| Field            | Purpose |
| ---------------- | ------- |
| `numericType`    | `"integer"` or `"decimal"` for numeric text validations |
| `precision`      | Decimal places for fixed decimal validations, or `"minutes"`/`"seconds"` for time and datetime validations |
| `format`         | REDCap validation format, such as `"email"`, `"url"`, `"phone"`, `"ymd"`, `"dmy"`, or `"mdy"` |
| `unit`           | CodeableConcept-like object with `coding` and optional `text` |
| `valueCodingMap` | Maps REDCap choice codes to choice labels and ontology codings |

## Local Source Indexing

Native ROME JSON exports can also be uploaded as local ontology sources. The local index builder extracts codings from:

- `dataElements[].coding[]`
- `dataElements[].valueCodingMap.*.coding[]`
- `dataElements[].unit.coding[]`

FHIR Questionnaire local sources are indexed from `item.code[]`, `item.answerOption[].valueCoding`, ROME answer option ontology extensions, and Questionnaire unit extensions. REDCap choice helper codings are skipped when indexing.

## JSON Schema

The native ROME export schema is available at [`rome-export.schema.json`](../schemas/rome-export.schema.json). Field-level `@ONTOLOGY` action tags use [`rome-annotation.schema.json`](../schemas/rome-annotation.schema.json).
