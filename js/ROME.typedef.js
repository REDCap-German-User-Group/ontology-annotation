// ROME type definitions

// @ts-check

/**
 * @typedef {Object} ROMEPluginConfig
 * @property {boolean=} debug
 * @property {boolean=} isAdmin
 * @property {string=} moduleDisplayName
 * @property {Number=} pid
 * @property {string=} plugin
 * @property {string=} version
 */

/**
 * @typedef {Object} ROMEOnlineDesignerConfig
 * @property {string=} atName
 * @property {boolean=} debug
 * @property {boolean=} isAdmin
 * @property {string[]=} errors
 * @property {string[]=} warnings
 * @property {string=} moduleDisplayName
 * @property {Number=} pid
 * @property {string=} version
 * @property {string=} form
 * @property {string=} minimalAnnotation
 * @property {Object<string, string>=} knownLinks
 * @property {string[]=} fieldsExcluded
 * @property {string[]=} matrixGroupsExcluded
 * @property {string[]=} sources
 * @property {string=} searchEndpoint
 */

/**
 * @typedef {Object} SourceInfo
 * @property {string=} id
 * @property {string=} label
 * @property {string=} desc
 * @property {string=} hint
 * @property {Number=} count
 * @property {Object<string, Number>=} systems
 */

/**
 * @typedef {Object} ROMEPluginPublic
 * @property {(config_data?: ROMEPluginConfig, jsmo?: JavascriptModuleObject) => void} init
 */

/**
 * @typedef {Object} ROMEOnlineDesignerPublic
 * @property {(config_data?: ROMEOnlineDesignerConfig, jsmo?: JavascriptModuleObject) => void} init
 * @property {() => void} showFieldHelp
*/

/**
 * @typedef {Object} OnlineDesignerState
 * @property {string=} fieldHelpContent
 * @property {string=} fieldType
 * @property {string=} enum
 * @property {boolean=} isMatrix
 * @property {JQuery<HTMLElement>=} $dlg
 */

/**
 * @typedef {Object} DiscoveryState
 * @property {TomSelect=} TS
 * @property {DiscoveryData=} data
 */

/**
 * @typedef {Object} DiscoveryData
 * @property {DiscoveryField[]} fields
 * @property {object[]} projects
 */

/**
 * @typedef {Object} DiscoveryField
 * @property {string} display
 * @property {string} system
 * @property {string} code
 * @property {Number[]} projects
 * @property {Object<Number,string>} field_names
 */

/**
 * @typedef {Object} TomSelect
 * @property {() => Number[]} getValue
 */

/**
 * @typedef {Object} OntologyAnnotationJSON
 * @property {string} resourceType
 * @property {OntologyAnnotationMeta=} meta
 * @property {OntologyAnnotationDataElement} dataElement
 */

/**
 * @typedef {Object} OntologyAnnotationMeta
 * @property {string=} creator
 * @property {string=} version
 * @property {string=} language
 * @property {string=} created
 * @property {string=} updated
 */

/**
 * @typedef {Object} OntologyAnnotationDataElement
 * @property {string} type
 */


/**
 * @typedef {Object} OntologyAnnotationWarning
 * @property {number} line  1-based line number where the tag starts
 * @property {string} message
 */

/**
 * Optional ontology annotation validator (e.g. Ajv-compiled).
 * Callable like a function and may carry Ajv-style `.errors`.
 *
 * @typedef {(
 *   ((data: any) => boolean)
 *   & { errors?: any[] | null | undefined }
 * )} OntologyAnnotationValidator
 */

/**
 * @typedef {Object} OntologyAnnotationParserOptions
 * @property {() => OntologyAnnotationJSON} getMinAnnotation
 *   Factory for a minimal/fallback annotation JSON object.
 *   NOTE: This minimal object is NOT schema-validated (even if validate is provided).
 * @property {string} tag
 *   Marker to search for (no quotes), e.g. "@ONTOLOGY".
 * @property {OntologyAnnotationValidator|null} [validate=null]
 *   Optional validator for parsed JSON objects (NOT applied to the minimal fallback).
 */

/**
 * @typedef {{ ok: true, value: { json:any, start:number, end:number, text:string } }} ParseOk
 * @typedef {{ ok: false, reason: string }} ParseErr
 * @typedef {ParseOk | ParseErr} ParseAttempt
*/

/**
 * @typedef {Object} OntologyAnnotationParser
 * @property {(text: string) => OntologyAnnotationParseResult} parse
 *   Parse the LAST valid tag JSON object from the given text.
 */



/**
 * @typedef {Object} OntologyAnnotationParseResult
 * @property {OntologyAnnotationJSON} json
 * @property {number} numTags
 * @property {boolean} usedFallback
 * @property {boolean} error
 * @property {string} errorMessage
 * @property {OntologyAnnotationWarning[]} warnings
 * @property {string} text
 *   Exact substring of the LAST valid tag occurrence: from tag start to end of JSON object.
 *   Empty string if no valid tag was found.
 * @property {number} start
 *   0-based start index of `text` within the input string, or -1 if none.
 * @property {number} end
 *   0-based end index (exclusive) of `text` within the input string, or -1 if none.
 */























/**
 * Callback invoked by {@link JavascriptModuleObject#afterRender}.
 *
 * @callback AfterRenderAction
 * @returns {void}
 */

/**
 * A value returned by {@link JavascriptModuleObject#getUrlParameter}.
 *
 * @typedef {string|string[]|null} UrlParameterValue
 */

/**
 * All URL parameters returned by {@link JavascriptModuleObject#getUrlParameters}.
 *
 * Note: Some query params may occur multiple times, hence `string | string[]`.
 *
 * @typedef {Object.<string, string|string[]>} UrlParameters
 */

/**
 * A key in the language store used by {@link JavascriptModuleObject#tt} / {@link JavascriptModuleObject#tt_add}.
 * (Usually a string like "some_key".)
 *
 * @typedef {string} TranslationKey
 */

/**
 * Interpolation values for {@link JavascriptModuleObject#tt}.
 *
 * @typedef {Array<any>|Object<string, any>} TranslationInterpolationMap
 */

/**
 * The REDCap External Module JavaScript Module Object (JSMO).
 * Available in framework version 2+.
 *
 * @typedef {Object} JavascriptModuleObject
 *
 * @property {(action: AfterRenderAction) => void} afterRender
 *   Registers a callback to run after the page finishes rendering, and again if the page is re-rendered
 *   (e.g., when switching languages via Multi-Language Management). The callback may be invoked multiple times.
 *
 * @property {(action: string, data?: any) => Promise<any>} ajax
 *   Performs a POST request to the module's AJAX endpoint using the given action name and payload.
 *   Requires the module to implement the `redcap_module_ajax` hook.
 *
 * @property {() => (string|null|false)} getCurrentLanguage
 *   Returns the currently active MLM language code.
 *   - `string`: active language code
 *   - `null`: MLM is enabled but initialization is still pending
 *   - `false`: MLM is not enabled on the current page
 *
 * @property {(path?: string, noAuth?: boolean) => string} getUrl
 *   Returns a module URL for the given path (JS always returns API endpoints). If `noAuth` is true,
 *   returns a non-authenticated URL where supported.
 *
 * @property {(name: string) => UrlParameterValue} getUrlParameter
 *   Returns the value of the specified URL query parameter (or `null` if missing).
 *
 * @property {() => UrlParameters} getUrlParameters
 *   Returns an object containing all query parameters for the current URL.
 *
 * @property {() => boolean} isImportPage
 *   Returns true if the current page is a Data Import Tool page.
 *
 * @property {() => boolean} isImportReviewPage
 *   Returns true if the current page is the Data Import Tool review page.
 *
 * @property {() => boolean} isImportSuccessPage
 *   Returns true if the current page is the Data Import Tool success page.
 *
 * @property {() => boolean} isMlmActive
 *   Returns true if Multi-Language Management is enabled on the current page.
 *
 * @property {(routeName: string) => boolean} isRoute
 *   Returns true if the current page matches the given REDCap route name (behavior mirrors the PHP method).
 *
 * @property {(message: string, parameters?: any) => (void|Promise<number|string>)} log
 *   Adds a log entry on the server (requires enable-ajax-logging in config.json; in no-auth contexts,
 *   enable-no-auth-logging is also required for all framework versions). In framework v11+, returns a promise
 *   resolving to the created log ID.
 *
 * @property {(key: TranslationKey, ...values: any[]) => string} tt
 *   Returns a localized string identified by `key`, optionally interpolated with values.
 *   If the first interpolation value is an array or object, it is used for interpolation and remaining
 *   arguments are ignored.
 *
 * @property {(key: TranslationKey, item: any) => void} tt_add
 *   Adds or replaces an item (typically a string) in the JSMO language store under `key`.
 */
