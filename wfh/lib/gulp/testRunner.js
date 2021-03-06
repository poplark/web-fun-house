var Path = require('path');
var Jasmine = require('jasmine');
//var _ = require('lodash');
var packageUtils = require('../packageMgr/packageUtils');
var fileExists = require('./packageInstallMgr').fileExists;
var log = require('log4js').getLogger('test.' + Path.basename(__filename, '.js'));
var chalk = require('chalk');
var config = require('../config');
var Package = require('../packageMgr/packageNodeInstance');
var NodeApi = require('../nodeApi');
var rj = require('../injectorFactory');
var injector = rj(require.resolve);

exports.runUnitTest = runUnitTest;
exports.runE2eTest = runE2eTest;

function defaultConfig() {
	return {
		spec_dir: Path.relative(process.cwd(), config().rootPath),
		spec_files: [],
		helpers: [],
		stopSpecOnExpectationFailure: false,
		random: false
	};
}

function runUnitTest(argv) {
	if (argv.f) {
		return runJasmine(defaultConfig(), [].concat(argv.f), argv.spec);
	}
	var jasmineSetting = defaultConfig();
	var wfhPath = config().wfhSrcPath;
	if (wfhPath && (!argv.p || argv.p.indexOf('wfh') >= 0)) {
		jasmineSetting.spec_files.push(wfhPath + '/spec/**/*[sS]pec.js');
		jasmineSetting.helpers.push(wfhPath + 'spec/helpers/**/*.js');
	}
	var packages = argv.p ? [].concat(argv.p) : null;
	packageUtils.findAllPackages(packages, (name, entryPath, parsedName, json, packagePath) => {
		// inject global modules start
		var pkInstance = new Package({
			moduleName: parsedName.name,
			name: name,
			longName: name,
			scope: parsedName.scope,
			path: packagePath,
			priority: json.dr ? json.dr.builderPriority : null
		});
		injector.fromPackage(name, packagePath)
			.value('__injectorFactory', rj)
			.value('__injector', injector)
			.factory('__api', function() {
				return getApiForPackage(pkInstance);
			});
		// inject end
		if (!fileExists(Path.join(packagePath, 'spec'))) {
			return;
		}
		log.info('Found test for package: ' + name);
		var relativePkPath = Path.relative(Path.resolve(), packagePath);
		jasmineSetting.spec_files.push(relativePkPath.replace(/\\/g, '/') + '/spec/**/*[sS]pec.js');
		jasmineSetting.helpers.push(relativePkPath.replace(/\\/g, '/') + '/spec/helpers/**/*[sS]pec.js');
	}, 'src');
	log.debug(jasmineSetting.spec_files);
	return runJasmine(jasmineSetting);
}

function runE2eTest(argv) {
	var rj = require('../injectorFactory');
	var injector = rj(require.resolve);
	var factoryMap = injector.fromDir(Path.resolve(config().rootPath, 'e2etest'));
	factoryMap.value('__injector', injector);
	factoryMap.value('__config', config);

	var helper = require('@dr/e2etest-helper');
	return helper.run(require('../config'), argv.browser, argv.server, argv.dir, () => {
		if (argv.f) {
			return runJasmine(defaultConfig(), [].concat(argv.f), argv.spec);
		}
		var jasmineSetting = defaultConfig();
		packageUtils.findNodePackageByType('e2etest', (name, entryPath, parsedName, json, packagePath) => {
			jasmineSetting.spec_files.push(packagePath + '/spec/**/*[sS]pec.js');
			jasmineSetting.helpers.push(packagePath + '/spec/helpers/**/*.js');
		});
		log.info('jasmineSetting.spec_files: %s', jasmineSetting.spec_files.join('\n'));
		return runJasmine(jasmineSetting);
	});
}

function runJasmine(jasmineSetting, files, spec) {
	var jasmine = new Jasmine();
	var prom = new Promise((resolve, reject) => {
		jasmine.onComplete(function(passed) {
			return passed ? resolve() : reject(new Error('Jasmine test failed'));
		});
	});
	jasmine.configureDefaultReporter({});
	jasmine.addReporter(simpleReporter);
	if (files) {
		jasmine.execute(files, spec);
	} else {
		jasmine.loadConfig(jasmineSetting);
		jasmine.execute();
	}
	return prom;
}

var simpleReporter = {
	jasmineStarted: function(suiteInfo) {
		log.info(chalk.cyan('Total specs defined: ' + suiteInfo.totalSpecsDefined));
	},
	specStarted: function(result) {
		log.info(chalk.cyan.underline(result.fullName));
	},
	specDone: function(result) {
		result.failedExpectations.forEach(ex => {
			log.error('spec done with Failed expectation: ', ex.stack);
		});
	}
};

function getApiForPackage(pkInstance) {
	// if (_.has(apiCache, pkInstance.longName)) {
	// 	return apiCache[pkInstance.longName];
	// }

	var api = new NodeApi(pkInstance.longName, pkInstance);
	api.constructor = NodeApi;
	pkInstance.api = api;
	// NodeApi.prototype.buildUtils = buildUtils;
	// NodeApi.prototype.packageUtils = packageUtils;
	// NodeApi.prototype.argv = argv;
	NodeApi.prototype.compileNodePath = [config().rootPath];
	//apiCache[pkInstance.longName] = api;
	return api;
}
