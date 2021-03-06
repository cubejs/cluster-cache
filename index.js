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

module.exports = process.clusterCache = process.clusterCache || {

	get logger(){

		if(!_.isFunction(process.getLogger)){
            return {
                'info': _.bind(console.log, console),
                'debug': _.bind(console.log, console)
            };
        }

        return process.getLogger(__filename);
	},

	'enable': _.once(function(options, emitter){

		options = options || {};
		emitter = emitter || require('cluster-emitter');
		emitter = require('./lib/utils').decorateEmitter(emitter);

		emitter.once('CLUSTER-ENABLE-CACHE', function(options){

			var master = options.master,
				mode = options.mode || 'master';

			if(!master || mode === 'master'){
				var mgr = require('./lib/cache-mgr'),
					svr = mgr.createServer(mgr.app);

				svr.listen(mgr.port, mgr.afterServerStarted);
			}
			else{
				//it's master's job to fork another worker specificly as the cache manager
				master.fork(master.options, {
					'CACHE_MANAGER': true
				});
			}
		});

		//if it's none cluster mode, above registered cache initialization will take effect
		//otherwise, in cluster mode, master will be responsible instead
		emitter.to(['master']).emit('CLUSTER-ENABLE-CACHE', options);
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
			
			function(domain){

				logger.debug('[cache] using domain:%s', domain);
				return _this.user.use(domain);
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
		], actualOptions.domain));//optional
	},

	'manager': require('./lib/cache-mgr'),
	'user': require('./lib/cache-usr')
};
