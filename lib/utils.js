'use strict';

var http = require('http'),
	path = require('path'),
	util = require('util'),
	when = require('when'),
	timeout = require('when/timeout'),
	request = require('request'),
	fs = require('graceful-fs'),
	_  = require('underscore'),
	ACCESS = parseInt('0755', 8);

exports.logger = function logger(){
	if(!_.isFunction(process.getLogger)){
		return {
			'info': _.bind(console.log, console),
			'debug': _.bind(console.log, console)
		};
	}
	return process.getLogger(__filename);
};

exports.decorateEmitter = function decorateEmitter(emitter){
    
    if(!emitter.to){//if it's a normal EventEmitter, we simply add 'to' function to return the emitter itself which will allow a following #emit call
        emitter.to = function(){
            return emitter;
        };
    }
    
    return emitter;
};

exports.rejectIfPortBusy = function rejectIfPortBusy(host, port){
    
    var deferred = when.defer(),
    	server = http.createServer(function(req, res){

    		res.writeHead(200, {'Content-Type': 'text/plain'});
    		res.end(port.toString(10));
    	});

	server.once('error', function(e){
    	deferred.reject(new Error('Port is in use:' + port));
    });

    server.listen(port, host, function(){ //'listening' listener

    	request.get(util.format('http://%s:%d/', host, port), function(err, response, body){
    		
    		if(!err && response && response.statusCode === 200 && parseInt(body, 10) === port){
    			server.close(function(){
    				process.nextTick(function(){
	    				deferred.resolve(port);
	    			});
    			});
    		}
    		else{
    			deferred.reject(new Error('Port is in use:' + port));
    		}
    	});
    });

    return timeout(3000, deferred.promise);
};

global.portsAlreadyPicked = [];

exports.pickAvailablePort = function pickAvailablePort(min, max){

	function checkAvailability(deferred, port){

		if(port > max){
			deferred.reject(new Error('no port available'));
		}
		else if(_.contains(global.portsAlreadyPicked, port)){
			checkAvailability(deferred, port + 1);
		}
		else{
			exports.rejectIfPortBusy('localhost', port)
				.then(function(port){
					deferred.resolve(port);
					global.portsAlreadyPicked.push(port);
				})
				.otherwise(function(){
					checkAvailability(deferred, port + 1);
				});
		}
	}

	var available = when.defer();

	checkAvailability(available, min);

	return available.promise;
};

exports.pickAvailablePorts = function pickAvailablePorts(min, max, count){

	return when.map(_.range(0, count), function(ith){
		
		return exports.pickAvailablePort(min, max);
	});
};

exports.ensureDir = function ensureDir(dir, clean) {
    try {
        var paths = fs.readdirSync(dir);
        if(clean) {
            paths.forEach(function(filename) {
                try {
                    fs.unlinkSync(path.join(dir, filename));
                }
                catch(e) {

                }
            });
        }
    }
    catch(e) {
        fs.mkdirSync(dir, ACCESS);
    }
};
