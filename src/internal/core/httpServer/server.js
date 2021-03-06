var http = require('http');
var https = require('https');
var fs = require('fs');
var Promise = require('bluebird');
var config, log;

exports.activate = function(api) {
	log = require('@dr/logger').getLogger(api.packageName);
	config = api.config;

	if (config().ssl && config().ssl.enabled) {
		if (!config().ssl.key) {
			config().ssl.key = 'key.pem';
		}
		if (!config().ssl.cert) {
			config().ssl.cert = 'cert.pem';
		}
		if (!fileAccessable(config.resolve('ssl.key'))) {
			log.error('There is no file available referenced by config.yaml property "ssl"."key" ' + config().ssl.key);
			return;
		}
		if (!fileAccessable(config.resolve('ssl.cert'))) {
			log.error('There is no file available referenced by config.yaml property "ssl"."cert" ' + config().ssl.cert);
			return;
		}
		log.debug('SSL enabled');
		api.eventBus.on('appCreated', startHttpsServer);
	} else {
		api.eventBus.on('appCreated', startHttpServer);
	}

	function startHttpServer(app) {
		log.info('start HTTP');
		var port = config().port ? config().port : 80;
		var server = http.createServer(app);
		server.listen(port);
		server.on('error', err => {
			onError(server, port, err);
		});
		server.on('listening', () => {
			onListening(server, 'HTTP Server');
			api.eventBus.emit('serverStarted', {});
		});
	}

	function startHttpsServer(app) {
		log.info('start HTTPS');
		var startPromises = [];
		var port = config().ssl.port ? config().ssl.port : 433;
		port = normalizePort(port);
		var server = https.createServer({
			key: fs.readFileSync(config.resolve('ssl.key')),
			cert: fs.readFileSync(config.resolve('ssl.cert'))
		}, app);
		server.listen(port);
		server.on('error', (error) => {
			onError(server, port, error);
		});
		startPromises.push(new Promise(resolve => {
			server.on('listening', () => resolve(server));
		}));

		if (api.config().ssl.httpForward !== false) {
			var redirectHttpServer = http.createServer((req, res) => {
				log.debug('req.headers.host: %j', req.headers.host);
				var url = 'https://' + /([^:]+)(:[0-9]+)?/.exec(req.headers.host)[1] + ':' + port;
				log.debug('redirect to ' + url);
				res.writeHead(307, {
					Location: url,
					'Content-Type': 'text/plain'
				});
				res.end('');
			});
			redirectHttpServer.listen(config().port ? config().port : 80);
			redirectHttpServer.on('error', error => {
				onError(server, port, error);
			});

			startPromises.push(new Promise(resolve => {
				redirectHttpServer.on('listening', () => resolve(redirectHttpServer));
			}));
		}
		Promise.all(startPromises)
		.then(servers => {
			onListening(servers[0], 'HTTPS server');
			if (servers.length > 1)
				onListening(servers[1], 'HTTP Forwarding server');
			api.eventBus.emit('serverStarted', {});
		});
	}

	function normalizePort(val) {
		var port = parseInt(val, 10);

		if (isNaN(port)) {
			// named pipe
			return val;
		}

		if (port >= 0) {
			// port number
			return port;
		}
		return false;
	}

	/**
	 * Event listener for HTTP server "listening" event.
	 */
	function onListening(server, title) {
		var addr = server.address();
		var bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + JSON.stringify(addr, null, '\t');
		log.info('%s is listening on %s', title ? title : '', bind);
	}

	/**
	 * Event listener for HTTP server "error" event.
	 */
	function onError(server, port, error) {
		log.error(error);
		if (error.syscall !== 'listen') {
			throw error;
		}

		var bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

		// handle specific listen errors with friendly messages
		switch (error.code) {
			case 'EACCES':
				log.error(bind + ' requires elevated privileges');
				process.exit(1);
				break;
			case 'EADDRINUSE':
				log.error(bind + ' is already in use');
				process.exit(1);
				break;
			default:
				throw error;
		}
	}
};

function fileAccessable(file) {
	try {
		fs.accessSync(file, fs.R_OK);
		return true;
	} catch (e) {
		return false;
	}
}
