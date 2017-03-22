var fs = require('fs');
var Path = require('path');
const mkdirp = require('mkdirp');
var _ = require('lodash');
var chalk = require('chalk');
var shell = require('shelljs');

var Promise = require('bluebird');
var glob = require('glob');
var buildUtils = require('../lib/gulp/buildUtils');

module.exports = function(rootPath) {
	function init() {
		maybeCopyTemplate(Path.resolve(__dirname, 'templates/config.local-template.yaml'), rootPath + '/config.local.yaml');
		maybeCopyTemplate(Path.resolve(__dirname, 'templates/log4js.json'), rootPath + '/log4js.json');
		maybeCopyTemplate(Path.resolve(__dirname, 'templates/app-template.js'), rootPath + '/app.js');
		maybeCopyTemplate(Path.resolve(__dirname, '../.jscsrc'), rootPath + '/.jscsrc');
		maybeCopyTemplate(Path.resolve(__dirname, '../.jshintrc'), rootPath + '/.jshintrc');
		maybeCopyTemplate(Path.resolve(__dirname, 'templates', 'module-resolve.server.tmpl.js '), rootPath + '/module-resolve.server.js');
		maybeCopyTemplate(Path.resolve(__dirname, 'templates', 'module-resolve.browser.tmpl.js'), rootPath + '/module-resolve.browser.js');

		var initProm = Promise.resolve(_initWorkspace(Path.resolve(__dirname, '..')));
		return initProm.then(() => _drawPuppy());
		// if (fs.existsSync(Path.resolve('.git/hooks'))) {
		// 	cp('-f', Path.resolve(__dirname, 'git-hooks', '*'), rootPath + '/.git/hooks/');
		// 	console.info('git hooks are copied');
		// 	if (os.platform().indexOf('win32') <= 0) {
		// 		shell.chmod('-R', '+x', rootPath + '/.git/hooks/*');
		// 	}
		// }
	}

	function _initWorkspace(wfhPath) {
		mkdirp(Path.join(rootPath, 'node_modules'));
		// package.json
		if (!fs.existsSync(Path.join(rootPath, 'package.json'))) {
			var packageJsonTmp = getPackageJsonTemplate();

			var jsonStr = packageJsonTmp({
				project: {name: Path.basename(rootPath), desc: 'Dianrong component workspace', author: 'noone@dianrong.com'},
				version: getVersion()
			});
			writeFile(Path.join(rootPath, 'package.json'), jsonStr);
		}
		// gulp file
		var gulpfile = Path.join(rootPath, 'gulpfile.js');
		if (!fs.existsSync(gulpfile)) {
			var content = fs.readFileSync(Path.join(__dirname, 'templates', 'gulpfile-template.js'), 'utf8');
			var relativePath = Path.relative(rootPath, wfhPath);
			if (!_.startsWith(relativePath, '.')) {
				relativePath = './' + relativePath;
			}
			content = content.replace('<plateformFolder>', relativePath.replace(/\\/g, '/'));
			writeFile(gulpfile, content);
		}

		// logs
		shell.mkdir('-p', Path.join(rootPath, 'logs'));
		return _initProjects(rootPath);
	}

	function _initProjects() {
		var projectListFile = Path.join(rootPath, 'dr.project.list.json');
		if (!fs.existsSync(projectListFile))
			return;
		var helper = require('./cliHelper');
		var projects = require(projectListFile);
		console.log(_.pad(' Projects directory ', 40, '-'));
		//var nameLen = _.maxBy(projects, dir => dir.length).length + 3;
		var promises = _.map(projects, (dir, i) => {
			dir = Path.resolve(rootPath, dir);
			console.log(_.padEnd(i + 1 + '. ', 5, ' ') + dir);
			return _initProject(dir);
		});
		return Promise.coroutine(function*() {
			yield Promise.all(promises);
			yield helper.listCompDependency(true);
			yield require('../lib/gulp/recipeManager').linkComponentsAsync();
			var configFileContents = yield helper.addupConfigs();
			_.each(configFileContents, (configContent, file) => {
				writeFile(file, '\n# DO NOT MODIFIY THIS FILE!\n' + configContent);
			});
		})()
		.catch(err => {
			console.error(chalk.red(err), err.stack);
		});
	}

	function _initProject(dir) {
		// Move all config.*.yaml to <project>/conf
		var cfDir = Path.resolve(dir, 'conf');
		mkdirp(cfDir);
		var cf = Path.resolve(dir, 'config.yaml');
		if (fs.existsSync(cf))
			shell.mv(cf, cfDir);
		return Promise.promisify(glob)(Path.resolve(dir, 'config.*.yaml'))
		.then(files => {
			_.each(files, cf => {
				var file = Path.resolve(cfDir, Path.basename(cf));
				shell.mv(cf, file);
				console.log('move %s', file);
			});

			// create package.json
			// if (!fs.existsSync(Path.join(dir, 'package.json'))) {
			// 	var pkjson = getPackageJsonTemplate()({
			// 		project: {name: Path.basename(dir), desc: 'Do not publish me', author: 'noone@dianrong.com'},
			// 		version: '0.1.0'
			// 	});
			// 	pkjson = JSON.parse(pkjson);
			// 	pkjson.dependencies = {};
			// 	pkjson.devDependencies = {};
			// 	writeFile(Path.join(dir, 'package.json'), JSON.stringify(pkjson, null, '  ') + '\n');
			// }

			// write dependency list to project package.json
		})
		.then(() => {
			// TODO: install project dep
		})
		.catch(err => {
			console.error(chalk.red(err).message, err);
		});
	}

	function addProject(dirs) {
		var projectListFile = Path.join(rootPath, 'dr.project.list.json');
		var prj;
		if (fs.existsSync(projectListFile)) {
			prj = require(projectListFile);
			prj.push(...dirs);
		} else {
			prj = [...dirs];
		}
		writeFile(projectListFile, JSON.stringify(prj, null, '  '));
		init();
	}

	function install() {
		return Promise.all([
			buildUtils.promisifyExe('npm', 'install', {cwd: rootPath})])
		.then(() => {
			console.log('Done');
		});
	}

	function clean() {
		if (!fs.existsSync(rootPath + '/config.yaml'))
			return;
		return require('./cliHelper').clean();
	}

	function writeFile(file, content) {
		fs.writeFileSync(file, content);
		console.log('%s is written', chalk.cyan(Path.relative(rootPath, file)));
	}

	function cp(from, to) {
		if (_.startsWith(from, '-')) {
			from = arguments[1];
			to = arguments[2];
		}
		shell.cp(...arguments);
		if (/[\/\\]$/.test(to))
			to = Path.basename(from); // to is a folder
		else
			to = Path.relative(rootPath, to);
		console.log('copy to %s', chalk.cyan(to));
	}

	function maybeCopyTemplate(from, to) {
		if (!fs.existsSync(Path.resolve(rootPath, to))) {
			cp(Path.resolve(__dirname, from), to);
		}
	}

	var packageJsonTmpl;
	function getPackageJsonTemplate() {
		if (packageJsonTmpl)
			return packageJsonTmpl;
		else
			packageJsonTmpl = _.template(fs.readFileSync(Path.resolve(__dirname, 'templates/package.json.template'), 'utf8'));
		return packageJsonTmpl;
	}

	function _drawPuppy(slogon, message) {
		if (!slogon)
			slogon = 'Congrads! Remember, all your packages are belong to us!';

		console.log(chalk.magenta('   ' + _.repeat('-', slogon.length)));
		console.log(chalk.magenta(' < Congrads! Remember, all your packages are belong to us! >'));
		console.log(chalk.magenta('   ' + _.repeat('-', slogon.length)));
		console.log(chalk.magenta('\t\\   ^__^\n\t \\  (oo)\\_______\n\t    (__)\\       )\\/\\\n\t        ||----w |\n\t        ||     ||'));
		if (message)
			console.log(message);
	}

	function getVersion() {
		var path = Path.dirname(__dirname);
		return require(Path.join(path, 'package.json')).version;
	}

	return {
		init: init,
		clean: clean,
		install: install,
		addProject: addProject
	};
};
