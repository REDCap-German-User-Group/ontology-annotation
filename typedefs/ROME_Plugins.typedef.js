// ROME Plugins type definitions
// @ts-check

//#region Config and public interface

/**
 * @typedef {Object} ROMEPluginConfig
 * @property {boolean=} debug
 * @property {boolean=} isAdmin
 * @property {string=} moduleDisplayName
 * @property {number=} pid
 * @property {string=} page
 * @property {string=} version
 * @property {PluginSourceInfo[]=} sources
 * @property {PluginSourceInfo[]=} sysSources
 * @property {ExportConfig=} export
 */

/**
 * @typedef {Object} ROMEPluginPublic
 * @property {(config_data?: ROMEPluginConfig, jsmo?: JavascriptModuleObject) => void} init
 */


/**
 * REDCap toast helper available on pages that use this plugin.
 * @param {string} title
 * @param {any} message
 * @param {string=} type
 * @returns {void}
 */
function showToast(title, message, type) {}

//#endregion

//#region Discover

/**
 * @typedef {Object} DiscoveryState
 * @property {DiscoveryTomSelect=} TS
 * @property {DiscoveryData=} data
 */

/**
 * @typedef {Object} DiscoveryData
 * @property {DiscoveryField[]} fields
 * @property {Object<number,DiscoveryProject>} projects
 */

/**
 * @typedef {Object} DiscoveryProject
 * @property {string} app_title
 * @property {string} contact
 * @property {string} email
 */

/**
 * @typedef {Object} DiscoveryField
 * @property {string} display
 * @property {string} system
 * @property {string} code
 * @property {number[]} projects
 * @property {Object<number,string>} field_names
 */

/**
 * @typedef {Object} DiscoveryTomSelect
 * @property {() => number[]} getValue
 */

//#endregion

//#region Export

/**
 * @typedef {Object} ExportConfig
 * @property {string=} defaultMetadataState
 * @property {ExportFormInfo[]=} forms
 * @property {Object<string,ExportStateConfig>=} states
 */

/**
 * @typedef {Object} ExportStateConfig
 * @property {ExportFormInfo[]=} forms
 */

/**
 * @typedef {Object} ExportFormInfo
 * @property {string} name
 * @property {string} label
 * @property {number=} validAnnotationCount
 * @property {number=} invalidAnnotationCount
 */

/**
 * @typedef {Object} ExportIssue
 * @property {string=} form
 * @property {string=} field
 * @property {string=} message
 */

/**
 * @typedef {Object} ExportResult
 * @property {boolean=} success
 * @property {string=} content
 * @property {string=} filename
 * @property {string=} mimeType
 * @property {number=} annotationCount
 * @property {string=} error
 * @property {ExportIssue[]=} errors
 * @property {ExportIssue[]=} warnings
 */

//#endregion

//#region Sources

/**
 * @typedef {Object} PluginSourceInfo
 * @property {string=} id
 * @property {string} key
 * @property {string=} label
 * @property {string=} title
 * @property {string=} title_resolved
 * @property {string=} description
 * @property {string=} description_resolved
 * @property {string=} kind
 * @property {string=} type
 * @property {string=} url
 * @property {string=} acronym
 * @property {string=} ss_branch
 * @property {string=} system_state
 * @property {string=} message
 * @property {string=} info
 * @property {number=} item_count
 * @property {Object<string, number>=} system_counts
 * @property {boolean=} enabled
 * @property {boolean=} from_system
 * @property {boolean=} checked
 * @property {boolean=} usesOwnCredentials
 */

/**
 * @typedef {Object} SourceFileInfo
 * @property {string=} name
 */

/**
 * @typedef {'create'|'edit'} EditMode
 */

/**
 * @typedef {'bioportal'|'snowstorm'} RemoteSourceType
 */

/**
 * @typedef {Object} RemoteSourcePayload
 * @property {string=} context
 * @property {string|number|string[]=} id
 * @property {string} title
 * @property {string} description
 * @property {string=} type
 * @property {string=} ss_baseurl
 * @property {string|string[]=} ss_branch
 * @property {string=} ss_auth
 * @property {string=} ss_username
 * @property {string=} ss_password
 * @property {string=} ss_token
 * @property {string=} bp_token
 * @property {string=} bp_ontology
 */

/**
 * @typedef {Object} SnowstormPayload
 * @property {string} ss_baseurl
 * @property {string} ss_branch
 * @property {string} ss_auth
 * @property {string} ss_username
 * @property {string} ss_password
 * @property {string} ss_token
 */

/**
 * @typedef {Object} BioPortalOntology
 * @property {string} acronym
 * @property {string} name
 */

/**
 * @typedef {Object} Select2Option
 * @property {string|number=} id
 * @property {string} text
 * @property {string=} name
 */

/**
 * Minimal Select2 options used by the plugin pages.
 * @typedef {Object} ROMEPluginSelect2Options
 * @property {string=} width
 * @property {JQuery<HTMLElement>|Element|string=} dropdownParent
 * @property {Select2Option[]=} data
 * @property {(data: Select2Option) => string|JQuery<HTMLElement>=} templateResult
 * @property {(data: Select2Option) => string|JQuery<HTMLElement>=} templateSelection
 * @property {string=} placeholder
 * @property {boolean=} allowClear
 */

/**
 * @typedef {Object} SnowstormAuthData
 * @property {string} snowstorm_auth_mode
 * @property {string=} snowstorm_basic_user
 * @property {string=} snowstorm_basic_pass
 * @property {string=} snowstorm_bearer_token
 */

/**
 * @typedef {Object} MinimalDataTableApi
 * @property {() => MinimalDataTableApi} clear
 * @property {{ add: (data: PluginSourceInfo[]) => MinimalDataTableApi }} rows
 * @property {() => MinimalDataTableApi} draw
 */

/**
 * Minimal DataTables options and jQuery plugin bridge used by the plugin pages.
 * @typedef {Object} MinimalPluginDataTableOptions
 * @property {boolean=} autoWidth
 * @property {PluginSourceInfo[]=} data
 * @property {any[]=} columns
 * @property {Object<string,string>=} language
 * @property {boolean=} paging
 * @property {boolean=} searching
 * @property {boolean=} info
 * @property {boolean=} lengthChange
 * @property {number=} pageLength
 * @property {any[]=} order
 * @property {(rowEl: HTMLElement, rowData: unknown) => void=} createdRow
 */

/**
 * @typedef {JQuery<HTMLElement> & {
 *   DataTable: (options?: MinimalPluginDataTableOptions) => MinimalDataTableApi
 * }} ROMEPluginDataTableJQuery
 */

//#endregion

//#region Browser globals

/**
 * @typedef {Object} TomSelectInstance
 * @property {() => string|string[]} getValue
 * @property {(silent?: boolean) => void} clear
 * @property {() => void} clearOptions
 * @property {(option: { value: string, text: string, disabled?: boolean }) => void} addOption
 * @property {(value: string, silent?: boolean) => void} addItem
 * @property {(open?: boolean) => void} refreshOptions
 * @property {() => void} refreshItems
 * @property {() => void} enable
 * @property {() => void} disable
 */

/**
 * @typedef {new (selector: string|Element, settings?: Object) => TomSelectInstance} TomSelectConstructor
 */

/**
 * @typedef {HTMLSelectElement & { tomselect?: TomSelectInstance }} TomSelectElement
 */

/**
 * Minimal Bootstrap modal API used by the plugin pages.
 * @typedef {Object} BootstrapModal
 * @property {() => void} show
 * @property {() => void} hide
 * @property {() => void} dispose
 */

/**
 * @typedef {Object} BootstrapGlobal
 * @property {new (element: Element, options?: Object) => BootstrapModal} Modal
 */

/** @type {BootstrapGlobal} */
var bootstrap;

/**
 * @typedef {JQuery<HTMLElement> & {
 *   select2: {
 *     (options?: ROMEPluginSelect2Options): JQuery<HTMLElement>,
 *     (method: string, ...args: any[]): JQuery<HTMLElement>
 *   }
 * }} ROMEPluginSelect2JQuery
 */

/**
 * @typedef {Window & {
 *   TomSelect?: TomSelectConstructor,
 *   app_path_webroot?: string
 * }} ROMEWindow
 */

//#endregion
