# Search API – Request & Response

## Endpoint
`POST /ajax/search`  
(Authentication required; project context implied by `pid`)

---

## Request body (JSON)

```json
{
  "rid": 1,
  "q": "diabetes",
  "source_ids": ["src_...","src_..."]
}
```

### Fields

- **`rid`** *(integer, required)*  
  Client-generated request identifier.  
  Used by the client to correlate responses and discard out-of-order replies.

- **`q`** *(string, required)*  
  Search query string.

- **`source_ids`** *(array of strings, optional)*  
  List of source IDs to search.  
  If omitted or empty, the server searches **all effective sources** for the project.

### Notes

- The client **should not** send any limit or pagination parameters.
- Result limits are controlled exclusively by project/system configuration.
- Unknown or unauthorized `source_ids` are ignored or reported per source.

---

## Response body (JSON)

```json
{
  "rid": 1,
  "results": {
    "src_...": [
      {
        "system": "http://snomed.info/sct",
        "code": "73211009",
        "display": "Diabetes mellitus (disorder)",
        "type": {
          "mapped": {},
          "native": {}
        },
        "score": 0.87
      }
    ]
  },
  "errors": {},
  "stats": {}
}
```

### Top-level fields

- **`rid`** *(integer)*  
  Echoes the request ID from the client.

- **`results`** *(object)*  
  Map keyed by `source_id`.  
  Each value is an array of result objects for that source (possibly empty).

- **`errors`** *(object)*  
  Map keyed by `source_id`.  
  Values are human-readable error messages (e.g. index missing, remote failure).  
  Empty object `{}` if no errors occurred.

- **`stats`** *(object, optional)*  
  Reserved for future use (e.g. timings, counts).  
  May be omitted or returned as `{}`.

---

## Result object (per hit)

```json
{
  "system": "http://snomed.info/sct",
  "code": "73211009",
  "display": "Diabetes mellitus (disorder)",
  "type": {
    "mapped": {},
    "native": {}
  },
  "score": 0.87
}
```

### Fields

- **`system`** *(string, required)*  
  Coding system URI.

- **`code`** *(string, required)*  
  Code value within the system.

- **`display`** *(string, optional)*  
  Human-readable label.

- **`type`** *(object, optional)*  
  Type information associated with the hit.  
  If present:
  - **`mapped`** *(object)*: normalized / REDCap-relevant type information  
  - **`native`** *(object)*: source-native type information (e.g. FHIR item type)

  Either sub-object may be empty (`{}`), and `type` may be omitted entirely if no type information is available.

- **`score`** *(number, required)*  
  Relevance score within the source.  
  Higher means more relevant; absolute scale is source-specific.

---

## Behavioral guarantees

- Each source listed in `results` will always be present as a key if it was searched, even if the result array is empty.
- The server never returns results for sources not effective for the project.
- The server never trusts client-supplied limits or ordering.
- Responses may arrive out of order; clients must use `rid` for correlation.
