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
 * @property {string=} moduleDisplayName
 * @property {Number=} pid
 * @property {string=} version
 * @property {string=} form
 */

/**
 * @typedef {Object} ROMEPublic
 * @property {(config_data?: ROMEConfig, jsmo?: JavascriptModuleObject) => void} init
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
