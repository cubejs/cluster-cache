'use strict';

var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	pipeline = require('when/pipeline');

var Cache = exports.Cache = function(namespace, usrAndMetaPromise){

	_.extend(this, {

		'namespace': namespace,
		
		'getUsrAndMeta': function(){

			return usrAndMetaPromise;
		},
		
		'pipeKeys': function(usrAndMeta){
		
			return usrAndMeta.usr.keys(namespace);
		},
		
		'getPipeGet': function(key, loader, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.get(namespace, key, loader, options);
			};
		},
		
		'getPipeSet': function(key, value, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.set(namespace, key, value, options);
			};
		},
		
		'getPipeDel': function(key, options){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.del(namespace, key, value, usrAndMeta.meta);
			};
		},
		
		'getPipeWatch': function(key, onChange){
			
			return function(usrAndMeta){
			
				return usrAndMeta.usr.watch(namespace, key, onChange);
			};
		},

		'getPipeUnwatch': function(key, onChange){

			return function(usrAndMeta){
			
				return usrAndMeta.usr.unwatch(namespace, key, onChange)
			};
		},

		'pipeStat': function(usrAndMeta){

			return usrAndMeta.usr.stat(namespace);
		},

		'pipeDestroy': function(usrAndMeta){

			return usrAndMeta.usr.del('', namespace);
		}
	});
};

Cache.prototype.meta = function(){

	return this.getUsrAndMeta().then(function(usrAndMeta){

		return usrAndMeta.meta;
	});
}

Cache.prototype.keys = function keys(){

	return pipeline([this.getUsrAndMeta, this.pipeKeys]);
};

Cache.prototype.get = function get(key, loader, options){

	return pipeline([this.getUsrAndMeta, this.getPipeGet(key, loader, options)]);
};

Cache.prototype.set = function set(key, value, options){

	return pipeline([this.getUsrAndMeta, this.getPipeSet(key, value, options)]);
};

Cache.prototype.del = function del(key, options){

	return pipeline([this.getUsrAndMeta, this.getPipeDel(key, options)]);
};

Cache.prototype.watch = function watch(key, onChange){

	return pipeline([this.getUsrAndMeta, this.getPipeWatch(key, onChange)]);
};

Cache.prototype.unwatch = function unwatch(key, onChange){

	return pipeline([this.getUsrAndMeta, this.getPipeUnwatch(key, onChange)]);
};

Cache.prototype.stat = function stat(){

	return pipeline([this.getUsrAndMeta, this.pipeStat]);
};

Cache.prototype.destroy = function destroy(){

	return pipeline([this.getUsrAndMeta, this.pipeDestroy]);
};

module.exports = {

	get logger(){

		if(!_.isFunction(process.getLogger)){
            return {
                'info': _.bind(console.log, console),
                'debug': _.bind(console.log, console)
            };
        }

        return process.getLogger(__filename);
	},

    // this will return a promise, which will be resolved after getting two available ports
	'enable': _.once(function(options, emitter){

		options = options || {};
		emitter = emitter || require('cluster-emitter');
		emitter = require('./lib/utils').decorateEmitter(emitter);
        //var tillCacheServerStarted = when.defer();

		emitter.once('CLUSTER-ENABLE-CACHE', function(options){
			var master = options.master,
				mode = options.mode || 'master';

			if(!master || mode === 'master'){
                process.env.CACHE_BASE_PORT = master ? master.port + 10 : 9190;
				var mgr = require('./lib/cache-mgr');
                mgr.configApp(mgr.app).then(function (ports) {
                    mgr.port = ports;
				    var svr = mgr.createServer(mgr.app);
                    process.cacheServer = svr;

				    svr.listen(ports, mgr.afterServerStarted);
                }, function (error) {
                    logger.error('[cache] start server error %j', error); 
                });
			}
			else{
				//it's master's job to fork another worker specificly as the cache manager
				master.fork(master.options, {
					'CACHE_MANAGER': true,
                    'CACHE_BASE_PORT': master.port + 10
				});
			}
		});

		//if it's none cluster mode, above registered cache initialization will take effect
		//otherwise, in cluster mode, master will be responsible instead
		emitter.to(['master']).emit('CLUSTER-ENABLE-CACHE', options);
        //return tillCacheServerStarted.promise;
	}),

	'use': function(namespace, options){

		var _this = this,
			logger = _this.logger,
			actualOptions = options || {};
		
		_.defaults(actualOptions, {
			'persist': false,
			'expire': 0,
			'timeout': 3000,
			'lastPersisted': -1
		});

		return new Cache(namespace, pipeline([
			
			function(ports){

				logger.debug('[cache] using ports: %j', ports);
				return _this.user.use(ports);
			}, 

			function(usr){

				logger.debug('[cache] usr ready, and using namespace:%s & options:%j', namespace, actualOptions);
				return when.join(usr, usr.get('', namespace, function(){

					return actualOptions;
				}));
			},
			
			function(resolve){

				var usr = resolve[0],
					meta = resolve[1];

				logger.debug('[cache] namespace:%s reserved with meta:%j', namespace, meta);
				return {
					'usr': usr, 
					'meta': meta
				};
			}
		], actualOptions.ports));//optional
	},

	'manager': require('./lib/cache-mgr'),
	'user': require('./lib/cache-usr')
};
