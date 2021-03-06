/* globals define:true */
if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
	// To avoid lodash conflict with some AMD build optimizers
	var oldDefine = define;
	define = null;
	require('lodash');
	define = oldDefine;
}

var _ = require('lodash');
var resolveUrl = require('./resolveUrl');
var bundleLoader = require('@dr-core/bundle-loader');
var loadCssBundles = bundleLoader.loadCssBundles;
module.exports = BrowserApi;

var packageNameReg = /(?:@([^\/]+)\/)?(\S+)/;

function BrowserApi(packageName, bundleName) {
	if (!(this instanceof BrowserApi)) {
		return new BrowserApi(packageName, bundleName);
	}
	this.packageName = packageName;
	var m = packageNameReg.exec(packageName);
	this.packageShortName = m[2];
	this.bundle = bundleName;

	var path = this.config.get(['packageContextPathMapping', this.packageShortName]);
	path = path != null ? path : '/' + this.packageShortName;
	this.contextPath = this.config().serverURL + path;
	BrowserApi.packageApiMap[packageName] = this;
}

BrowserApi.setup = function(obj) {
	_.assign(BrowserApi.prototype, obj);
};

BrowserApi.packageApiMap = {}; // Cache browser side API instance by package name
BrowserApi.getCachedApi = function(name) {
	return _.get(BrowserApi.packageApiMap, name);
};
/**
 * Code splitting
 * @param  {string | string[]} bundlePaths  dependencies bundles
 * @param  {function(function require())} callBack
 */
BrowserApi.ensureRequire = function(splitPoints, callBack) {
	var self = BrowserApi.prototype;
	try {
		console.log('BrowserApi.ensureRequire()');
		var loadedBundleFileSet = self.loadedBundleFileSet;

		var js = {}; // JS bundles need to be loaded
		var css = {}; // CSS bundles need to be loaded
		var allLoaded = true;
		_.each(splitPoints, function(splitPoint) {
			var splitPointMeta = self.splitPoints[splitPoint];
			var jsBundles = splitPointMeta.js;
			var cssBundles = splitPointMeta.css;
			_.each(jsBundles, function(jsBundle) {
				if (!_.has(loadedBundleFileSet, jsBundle)) {
					allLoaded = false;
					js[jsBundle] = 1;
				}
			});
			_.each(cssBundles, function(cssBundle) {
				if (!_.has(loadedBundleFileSet, cssBundle)) {
					allLoaded = false;
					css[cssBundle] = 1;
				}
			});
		});
		if (allLoaded) {
			callBack(require);
			return;
		}
		js = _.keys(js);
		css = _.keys(css);
		if (self.isDebug()) {
			console.log('loading ' + css);
		}
		// load CSS
		if (_.size(css) > 0) {
			self._loadCssBundles(css);
		}
		if (self.isDebug()) {
			console.log('loading ' + js);
		}
		// load JS
		window.$LAB.script(_.map(js, function(jsPath) {
			return bundleLoader.resolveBundleUrl(jsPath, self.config().staticAssetsURL);
		})).wait(function() {
			self.markBundleLoaded(js);
			self.markBundleLoaded(css);
			callBack(require);
		});
	} catch (e) {
		if (self.isDebug()) {
			console.error(e);
		}
	}
};

BrowserApi.prototype = {
	i18nLoaded: false,

	config: function() {
		return BrowserApi.prototype._config;
	},

	isDebug: function() {
		return this.config().devMode;
	},

	isBrowser: function() {
		return true;
	},

	isNode: function() {
		return false;
	},

	assetsUrl: function(packageName, path) {
		if (arguments.length === 1) {
			path = packageName;
			packageName = this.packageName;
		}
		return resolveUrl(this.config, packageName, path);
	},
	/*
	loadLocaleBundles: function(locale, waitCallback) {
		BrowserApi.prototype.lastLoadedLocale = locale;

		var self = this;
		var prefix = this.config().staticAssetsURL;
		var localeBundles = this.localeBundlesMap[locale];

		if (!localeBundles)
			return waitCallback();
		var localeBundleJsUrls = _.map(localeBundles.js, function(bundle) {
			return prefix + '/' + bundle;
		});
		if (localeBundles.css && localeBundles.css.length > 0) {
			this._loadCssBundles(localeBundles.css);
		}

		if (!localeBundleJsUrls || localeBundleJsUrls.length === 0)
			return waitCallback();
		window.$LAB.script(localeBundleJsUrls).wait(function() {
			BrowserApi.prototype.i18nLoaded = true;
			self.markBundleLoaded(localeBundles.js);
			self.markBundleLoaded(localeBundles.css);
			waitCallback();
		});
	},
	*/

	_loadCssBundles: function(paths) {
		return loadCssBundles(paths, this.config().staticAssetsURL);
	},
	/*
	loadPrefLocaleBundles: function(waitCallback) {
		var pref = this.getPrefLanguage();
		if (this.config().devMode && console) {
			console.log('preferred language ' + pref);
		}
		this.‘loadLocaleBundles’(pref, function() {
			waitCallback(pref);
		});
	},

	isLocaleBundleLoaded: function() {
		return this.i18nLoaded;
	},
	*/

	extend: function(obj) {
		_.assign(BrowserApi.prototype, obj);
	},

	isPackageLoaded: function(packageName) {
		return _.has(this.loadedPackage, packageName);
	},

	markBundleLoaded: function(bundles) {
		var self = this;
		if (!self.loadedBundleFileSet) {
			// if loadedBundleFileSet is undefined, it means that there is no
			// split points, no need to track loaded bundles
			return;
		}
		bundles = [].concat(bundles);
		_.each(bundles, function(b) {
			self.loadedBundleFileSet[b] = 1;
		});
	},

	/**
	 * Parse window.location.search to a hash object
	 */
	urlSearchParam: function(searchString) {
		var searchMap = {};
		var search = searchString ? searchString : window.location.search;
		if (search && search.length > 0) {
			if (_.startsWith(search, '?'))
				search = search.substring(1);
			_.each(search.split('&'), function(qs) {
				var pair = qs.split('=');
				searchMap[pair[0]] = pair[1];
			});
		}
		return searchMap;
	}
};

BrowserApi.prototype.config.set = function(path, value) {
	_.set(BrowserApi.prototype._config, path, value);
	return BrowserApi.prototype._config;
};

BrowserApi.prototype.config.get = function(propPath, defaultValue) {
	return _.get(BrowserApi.prototype._config, propPath, defaultValue);
};

_.assign(BrowserApi.prototype, require('./i18n-api'));
