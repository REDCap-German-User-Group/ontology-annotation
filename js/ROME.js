// ROME plugin page UI

/// <reference types="jquery" />
/// <reference path="./ROME.typedef.js" />

// @ts-check
;(function() {
	const EM_NAME = 'ROME';
	const NS_PREFIX = 'DE_RUB_';
	const INITAL_TAB = 'annotate';

	/** @type {ROMEPublic} */
	// @ts-ignore
	const EM = window[NS_PREFIX + EM_NAME] ?? {
		init: initialize
	};
	// @ts-ignore
	window[NS_PREFIX + EM_NAME] = EM;

	/** @type {ROMEConfig} Configuration data supplied from the server */
	let config = {};
	let initialized = false;

	/**
	 * Implements the public init method.
	 * @param {ROMEConfig=} config_data
	 */
	function initialize(config_data) {
		config = config_data || {};
		if (initialized) return;
		initialized = true;
		$(function() {
			if ($('#sub-nav').length === 0) return;
			bindTabs();
			const target = getInitialTab();
			setActiveTab(target);
		});
	}


	//#region Tab navigation

	function bindTabs() {
		$('#sub-nav').on('click', 'a[data-rome-action="main-nav"]', function(event) {
			event.preventDefault();
			const target = normalizeTabName($(this).attr('data-rome-target'));
			if (!target) return;
			setActiveTab(target);
		});
	}

	/**
	 * @param {string=} target
	 * @returns {ROMESection|null}
	 */
	function normalizeTabName(target) {
		return ['about', 'annotate', 'discover', 'utilities'].includes(target ?? '')
			? /** @type {ROMESection} */ (target)
			: null;
	}

	/**
	 * @returns {ROMESection}
	 */
	function getInitialTab() {
		const $active = $('#sub-nav li.active a[data-rome-target]').first();
		return normalizeTabName($active.attr('data-rome-target')) || INITAL_TAB;
	}

	/**
	 * @param {ROMESection} target
	 */
	function setActiveTab(target) {
		const $nav = $('#sub-nav');
		$nav.find('li').removeClass('active');
		$nav.find('a[data-rome-target="' + target + '"]').closest('li').addClass('active');
		$('.rome-tab-section').removeClass('active');
		$('.rome-tab-section[data-rome-section="' + target + '"]').addClass('active');
	}

	//#endregion

})();
