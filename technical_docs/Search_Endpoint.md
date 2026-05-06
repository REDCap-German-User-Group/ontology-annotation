# Search API – Request & Response

## Endpoints

The Online Designer receives project-specific URLs from the External Module framework:

- Search: `POST ajax/search.php`
- Poll deferred results: `POST ajax/poll.php`

Authentication and project context are supplied by REDCap.

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
  Search query string. The current server-side minimum is 2 characters.

- **`source_ids`** *(array of strings, optional)*  
  List of source IDs to search.  
  If omitted or empty, the server searches **all effective sources** for the project.

### Notes

- The client **should not** send any limit or pagination parameters.
- Result limits are controlled exclusively by project/system configuration.
- Unknown or unauthorized `source_ids` are reported in `errors`.
- Local sources are searched immediately. Remote sources are deferred and returned through the poll endpoint.

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
  "pending": {
    "src_remote...": {
      "token": "9f...",
      "after_ms": 300
    }
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
  Each value is an array of result objects for that source (possibly empty). Deferred sources are not present here until a poll response returns their results.

- **`pending`** *(object)*
  Map keyed by `source_id` for deferred remote sources. Each value contains a short-lived `token` and an `after_ms` polling hint.

- **`errors`** *(object)*  
  Map keyed by `source_id`.  
  Values are human-readable error messages (e.g. index missing, remote failure).  
  Empty object `{}` if no errors occurred.

- **`stats`** *(object, optional)*  
  Reserved for future use by the search endpoint. The current search endpoint returns `{}` when empty; the poll endpoint does not return `stats`.

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

- Immediate local search results are returned in `results`; deferred remote sources are returned in `pending` first and later move to `results` through polling.
- The server never returns results for sources not effective for the project.
- The server never trusts client-supplied limits or ordering.
- Responses may arrive out of order; clients must use `rid` for correlation.

## Poll Request

```json
{
  "rid": 1,
  "pending": {
    "src_remote...": "9f..."
  }
}
```

`pending` maps source IDs to the tokens returned by the search endpoint.

## Poll Response

```json
{
  "rid": 1,
  "results": {
    "src_remote...": [
      {
        "system": "http://snomed.info/sct",
        "code": "73211009",
        "display": "Diabetes mellitus (disorder)",
        "score": 1
      }
    ]
  },
  "pending": {},
  "errors": {}
}
```

Polling processes at most one uncached remote job per request. Remaining jobs are returned in `pending` with their existing token and a new `after_ms` hint.
