'use strict';

var _ = require('underscore'),
	when = require('when'),
	timeout = require('when/timeout'),
	fs = require('graceful-fs'),
	common = require('./cache-common'),
	logger = require('./utils').logger,
    cacheSocket = require('./cache-socket/cache-socket-factory').getCacheSocket('user', 'json');
    
var success = common.status.success,
	NS = common.types.NS,
	ALL = common.types.ALL,
	GET = common.types.GET,
	SET = common.types.SET,
	DEL = common.types.DEL,
    LOCK = common.types.LOCK,
	INSPECT = common.types.INSPECT,
	PONG = common.types.PONG,
	CHN = common.changeToken,
	userDeferred = when.defer(),
	changes = {

	},
	anyChanges = {

	},
    stats = {
        
    },
    ports = null,
	//TODO, support connection pooling to speed up the cache operations if needed.
	reconnect = function reconnect(error) {

        cacheSocket.on('error', function (error) {
            logger().error('[cache-usr] cacheSocket error %j', error);
        });

        cacheSocket.connect(ports, function (error) {
            logger().info('[cache-usr] connected to cache server on %j', ports);
            if (error) {
                logger().error('[cache-usr] connect error %j', error);
                userDeferred.reject(error);
            }else if (!userDeferred.hasBeenResolved) {
                userDeferred.resolve(process.user = user);
                userDeferred.hasBeenResolved = true;
            }
        });

        cacheSocket.on('message', function (msg) {
            // Only CHN and PONG msg will enter here
            var token = msg.token,
                namespace = msg.ns,
                key = msg.key,
                value = msg.value;

            if (token === CHN) {
                // get notified from cache-mgr
                changes[namespace] = changes[namespace] || {};
                _.each(changes[namespace][key] || [], function(whenChange){
                    whenChange(value, key);
                });

                _.invoke(anyChanges[namespace] || [], 'call', null, value, key);
            }else if(token === PONG) {
                // get ping from cache-mgr
                cacheSocket.send({
                    'type': PONG,
                }, function () {
                    // do not need to reply
                });
            }
        });

        cacheSocket.once('close', function (error) {
            reconnect(error);
        });
	};

var user = process.user || {

	'ns': function(options){
		
		options = options || {};

		var	wait = options.wait,
			tillNs = when.defer(),
			reply = function(response){

				if(success === response.status){

					tillNs.resolve(response.namespaces || []);
				}
				else{

					tillNs.reject(new Error('failed to get namespaces'));
				}
			};

		cacheSocket.send({
			'type': NS,
		}, reply);

		return (wait > 0 ? timeout(wait, tillNs.promise) : tillNs.promise);
	},

	'keys': function(namespace, options){

		options = options || {};

		var	wait = options.wait,
			tillKeys = when.defer(),
			reply = function(response){

				if(success === response.status){

					tillKeys.resolve(response.keys || []);
				}
				else{

					tillKeys.reject(new Error('failed to get keys'));
				}
			};

		cacheSocket.send({
			'type': ALL,
			'ns': namespace
		}, reply);

		return (wait > 0 ? timeout(wait, tillKeys.promise) : tillKeys.promise);
	},

	'get': function(namespace, key, loader, options){

		options = options || {};

		var	wait = options.wait,
			tillGet = when.defer(),
			reply = function (response){

				if(success === response.status && response.value !== undefined){//got the value
					
                    user.stat(namespace, 'hit');
					tillGet.resolve(response.value);
				}
				else if(loader){//must atomically load the value

					var watchOthers = function watchOthers(changed){
						//unregister itself immediately
						user.unwatch(namespace, key, watchOthers);
						
						if(changed !== undefined){
                            user.stat(namespace, 'hit');
							tillGet.resolve(changed);
						}
						else{
                            user.stat(namespace, 'error');
							tillGet.reject(new Error('loader failed'));
						}
					};

					user.watch(namespace, key, watchOthers);
					user.lock(namespace, key, {
							'wait': wait
						})
						.then(function(locked){
							//only one of the concurrent writers will be given the set===true
							if(locked){
								
								var handleError = function handleError(error){
									throw error;
								};
                                
                                user.stat(namespace, 'miss');
								user.unwatch(namespace, key, watchOthers);//unregister immediately as i'm about to write the value
								try{
									//promise or value
									when(loader(), function(value){
                                        
	                                        user.stat(namespace, 'load');
											//success value loaded
											user.set(namespace, key, value, { 
												'wait': wait
											})
											.then(
												_.bind(tillGet.resolve, tillGet, value), 
												handleError
											);

										}, 
										handleError);
								}
								catch(e){
									//in case loaded fail
									user.stat(namespace, 'error');
									user.del(namespace, key).ensure(function(){
                                        tillGet.reject(e);
                                    });
								}	
							}
						});
				}
				else{
					//got nothing
                    user.stat(namespace, 'miss');
					tillGet.resolve(null);//no value, but resolved
				}
			};

		cacheSocket.send({
			'type': GET,
			'ns': namespace,
			'key': key
        }, reply);

		return (wait > 0 ? timeout(wait, tillGet.promise) : tillGet.promise);
	},

	'inspect': function(namespace, key, options){
	
		options = options || {};

		var	wait = options.wait,
			tillInspect = when.defer(),
			reply = function(response){

				if(success === response.status && response.value !== undefined){

					tillInspect.resolve([response.value, response.persist, response.expire]);
				}
				else{
					tillInspect.reject(new Error('no value found for key'));
				}
			};

		cacheSocket.send({
			'type': INSPECT,
			'ns': namespace,
			'key': key
		}, reply);

		return (wait > 0 ? timeout(wait, tillInspect.promise) : tillInspect.promise);
	},

	/**
	 * @param key string
	 * @param value Object
	 * @param options {
	 		persist boolean (whether should survice cache-mgr failure)
	 		expire number (time to live, default null, won't expire)
			wait number (timeout after wait expired)
	 		leaveIfNonNull boolean (true means the set will backout if the value exists, default as false, which will overwrite the value)
	 * }
	 */
	'set': function(namespace, key, value, options){//must guarantee that value has no '\r\n' in it (if it's a string or any complex type)

		options = options || {};

		var	wait = options.wait,
			tillSet = when.defer(),
			reply = function(response){

                tillSet.resolve(success === response.status);
			};

		cacheSocket.send({
			'type': SET,
			'ns': namespace,
			'key': key,
			'value': value,
			'leaveIfNonNull': options.leaveIfNonNull
		}, reply);

		return (wait > 0 ? timeout(wait, tillSet.promise) : tillSet.promise);
	},

    'lock': function(namespace, key, options){//must guarantee that value has no '\r\n' in it (if it's a string or any complex type)

        options = options || {};

        var wait = options.wait,
            tillLock = when.defer(),
            reply = function(response){

                tillLock.resolve(success === response.status);
            };

        cacheSocket.send({
            'type': LOCK,
            'ns': namespace,
            'key': key,
            'value': process.pid
        }, reply);

        return (wait > 0 ? timeout(wait, tillLock.promise) : tillLock.promise);
    },

	/**
	 * @param key string
	 * @param wait number (timeout after wait expired)
	 */
	'del': function(namespace, key, options){

		options = options || {};

		var	wait = options.wait,
			tillDel = when.defer(),
			reply = function(response){

                tillDel.resolve(success === response.status ? response.value : null);
			};

		cacheSocket.send({
			'type': DEL,
			'ns': namespace,
			'key': key
		}, reply);

		return (wait > 0 ? timeout(wait, tillDel.promise) : tillDel.promise);
	},

	'watch': function(namespace, key, callback){

		if(!key){
			anyChanges[namespace] = anyChanges[namespace] || [];
			anyChanges[namespace].push(callback);
		}
		else{
			changes[namespace] = changes[namespace] || {};
			changes[namespace][key] = changes[namespace][key] || [];
			changes[namespace][key].push(callback);
		}
	},

	'unwatch': function(namespace, key, callback){

		if(!key){
			anyChanges[namespace] = _.without(anyChanges[namespace] || [], callback);
		}
		else{
			changes[namespace] = changes[namespace] || {};
			changes[namespace][key] = _.without(changes[namespace][key] || [], callback);
		}
	},
    
    'stat': function(namespace, action){
        
        var stat = stats[namespace] = stats[namespace] || {
        
            'hit': 0,
            'miss': 0,
            'load': 0,
            'error': 0
        };
		
        if(action){
            stat[action] += 1;
        }
        
        return stat;
	},

	'switchPorts': function(p) {//only in case of cache-mgr down and needs to switch to a new one
		
		if(p && JSON.stringify(ports) !== p){
			ports = JSON.parse(p);
			reconnect();
		}
    }
};

//when the cache-mgr is created by a replacement process, the new domain will be written to the same file being watched below
var tillExists = function(path){
	fs.exists(path, function(exists){
		if(exists){
            user.switchPorts(fs.readFileSync(path, {'encoding': 'utf-8'}));
			fs.watchFile(path, 
				function(){
					fs.readFile(path, {
							'encoding': 'utf-8'
						}, 
						function(err, p){
							logger().info('[cache-usr] switching ports:%s', p);
							user.switchPorts(p);
						});
				});
		}
		else{
			process.nextTick(function(){
				tillExists(path);
			});
		}
	});
};

exports.use = function(p){

	if(!process.userPromise){//each process needs at most one cache user

		logger().info('[cache-usr] created');

		tillExists(common.domainPath);

        if (p) {
		    user.switchPorts(p);
        }

		process.userPromise = userDeferred.promise;
	}

	return process.userPromise;
};

