/**
 * Do not require this file until wfh dependencies is installed and config.yaml file is generated
 */
var PackageInstall = require('./packageInstallMgr');
var config = require('../config');
var shell = require('shelljs');
var jsYaml = require('js-yaml');
var Path = require('path');
var fs = require('fs');
var _ = require('lodash');
var chalk = require('chalk');
//var buildUtils = require('./buildUtils');
require('../logConfig')(config().rootPath);
var packageUtils = require('../packageMgr/packageUtils');

//exports.writeProjectDep = writeProjectDep;
exports.listCompDependency = listCompDependency;
exports.addupConfigs = addupConfigs;
exports.cleanPackagesWalkerCache = cleanPackagesWalkerCache;
exports.clean = clean;

// function writeProjectDep(projDir) {
// 	var installer = new PackageInstall(projDir);
// 	var srcDirs = [];
// 	recipeManager.eachRecipeSrc(projDir, function(src, recipe) {
// 		srcDirs.push(src);
// 	});
// 	return installer.scanSrcDeps(srcDirs)
// 	.then(() => {
// 		return installer.printDep();
// 	});
// }

function listCompDependency(pkJsonFiles, write) {
	var installer = new PackageInstall();
	installer.scanSrcDeps(pkJsonFiles);
	return installer.printComponentDep(write);
}

function addupConfigs() {
	var componentConfigs = {outputPathMap: {}, vendorBundleMap: {}, browserSideConfigProp: []};
	var vendorBundleMap = componentConfigs.vendorBundleMap;
	var browserSideConfigProp = componentConfigs.browserSideConfigProp;
	//var entryPageMapping = componentConfigs.entryPageMapping;
	var componentConfigs4Env = {}; // key is env:string, value is componentConfigs
	var trackOutputPath = {}; // For checking conflict
	packageUtils.findAllPackages((name, entryPath, parsedName, json, packagePath) => {
		var dr = json.dr;
		if (!dr)
			return;
		// if (dr.globalConfig) {
		// 	Object.assign(componentConfigs, dr.globalConfig.public);
		// 	browserSideConfigProp.push(..._.keys(dr.globalConfig.public));
		// }

		// component customized configuration properties
		_addupCompConfigProp(componentConfigs, name, browserSideConfigProp, dr.config);
		_.each(dr, (value, key) => {
			var m = /^config\.(.*)$/.exec(key);
			if (!m)
				return;
			var env = m[1];
			if (!_.has(componentConfigs4Env, env))
				componentConfigs4Env[env] = {browserSideConfigProp: []};
			_addupCompConfigProp(componentConfigs4Env[env], name, componentConfigs4Env[env].browserSideConfigProp, value);
		});

		// outputPath
		var outputPath = dr.outputPath || _.get(json, 'dr.output.path') || parsedName.name;
		if (_.has(trackOutputPath, outputPath)) {
			console.log(chalk.yellow('[Warning] Conflict outputPath setting "%s" for both %s and %s, resolve conflict by adding a config file,'), outputPath, trackOutputPath[outputPath], name);
			console.log(chalk.yellow('%s\'s "outputPath" will be changed to %s', name, parsedName.name));
			outputPath = parsedName.name;
		}
		trackOutputPath[outputPath] = name;
		// if (dr.entryPage || dr.entryView) {
		// 	entryPageMapping[name] = componentConfigs.outputPathMap[name] = outputPath;
		// } else {
		componentConfigs.outputPathMap[name] = outputPath;
		//}
		// chunks
		var chunk = _.has(json, 'dr.chunk') ? dr.chunk : dr.bundle;
		if (chunk) {
			if (_.has(vendorBundleMap, chunk))
				vendorBundleMap[chunk].push(name);
			else
				vendorBundleMap[chunk] = [name];
		}
	});

	var superConfig = require('dr-comp-package/config.yaml');
	deeplyMergeJson(superConfig, componentConfigs);
	var res = {'config.yaml': jsYaml.safeDump(superConfig)};
	_.each(componentConfigs4Env, (configs, env) => {
		var tmplFile = Path.join(__dirname, 'templates', 'config.' + env + '-template.yaml');
		if (fs.existsSync(tmplFile)) {
			configs = Object.assign(jsYaml.safeLoad(fs.readFileSync(tmplFile, 'utf8'), {filename: tmplFile}), configs);
		}
		res['config.' + env + '.yaml'] = jsYaml.safeDump(configs);
	});
	cleanPackagesWalkerCache();
	return Promise.resolve(res);
}

/**
 * @param {object} setting hash object to be added to
 * @param {object} configJson component's package.json -> "dr.config.<environment>"
 */
function _addupCompConfigProp(componentConfigs, compName, browserSideConfigProp, configJson) {
	if (!configJson)
		return;
	// component customized configuration properties
	var componentConfig = _.assign({}, configJson.public, configJson.server);
	if (_.size(componentConfig) > 0 )
		componentConfigs[compName] = componentConfig;

	// browserSideConfigProp
	browserSideConfigProp.push(..._.map(_.keys(configJson.public), key => compName + '.' + key));
}

function cleanPackagesWalkerCache() {
	var packageInfoCacheFile = config.resolve('destDir', 'packageInfo.json');
	if (fs.existsSync(packageInfoCacheFile))
		fs.unlink(packageInfoCacheFile);
}

function clean() {
	return new Promise((resolve, reject) => {
		require('./recipeManager').clean()
		.on('end', resolve)
		.on('error', err => {
			console.error(err);
			reject(new Error(err));
		});
	})
	.then(()=> {
		shell.rm('-rf', config().staticDir);
		shell.rm('-rf', config().destDir);
	});
}

function deeplyMergeJson(target, src, customizer) {
	_.each(src, (sValue, key) => {
		var tValue = target[key];
		var c = customizer ? customizer(tValue, sValue, key) : undefined;
		if (c !== undefined)
			target[key] = c;
		else if (Array.isArray(tValue) && Array.isArray(sValue))
			target[key] = _.union(tValue, sValue);
		else if (_.isObject(tValue) && _.isObject(sValue))
			deeplyMergeJson(tValue, sValue);
		else
			target[key] = sValue;
	});
}
