// ROME Plugins type definitions
// @ts-check

//#region Config and public interface

/**
 * @typedef {Object} ROMEPluginConfig
 * @property {boolean=} debug
 * @property {boolean=} isAdmin
 * @property {string=} moduleDisplayName
 * @property {Number=} pid
 * @property {string=} page
 * @property {string=} version
 * @property {SourceInfo[]=} sources
 * @property {SourceInfo[]=} sysSources
 */

/**
 * @typedef {Object} ROMEPluginPublic
 * @property {(config_data?: ROMEPluginConfig, jsmo?: JavascriptModuleObject) => void} init
 */

//#endregion

//#region Discover

/**
 * @typedef {Object} DiscoveryState
 * @property {TomSelect=} TS
 * @property {DiscoveryData=} data
 */

/**
 * @typedef {Object} DiscoveryData
 * @property {DiscoveryField[]} fields
 * @property {Object<string,Object>} projects
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

//#endregion

//#region Export

//#endregion