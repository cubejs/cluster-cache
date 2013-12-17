cluster-cache
=============

cache service to share data across workers/master

* **`cache`** 

```javascript
var cache = require('cluster-cache').use('cache-name', {
  'persist': true,//default false
  'expire': 60000 //in ms, default 0, meaning no expiration
});

```
* **`keys`**

```javascript
var cache;//assume the cache is in use as above

cache.keys({
  'wait': 100//this is a timeout option
})
.then(function(keys){
//the keys resolved is an array of all cached keys:string[] from the cache-manager's view
});

//to use the cache, we assume u've started the cluster2 with caching enabled, and you can select how cache manager should be run
listen({

  'noWorkers': 1, //default number of cpu cores
	'createServer': require('http').createServer,
	'app': app,
	'port': 9090,
	'monPort': 9091,
	'debug': { //node-inspector integration
		'webPort': 9092,
		'saveLiveEdit': true
	},
	'ecv': {
	  'mode': 'control',
	  'root': '/ecv'
	},
	'cache': {
		'enable': true,//true by default
		'mode': 'standalone'//as a standalone worker process by default, otherwise will crush with the master process
	},
	'heartbeatInterval': 5000 //heartbeat rate
})
```

Note that, we allow you to use caching w/o cluster2, if you want to enable caching from none cluster2 runtime, the feature could be enabled via:

```javascript

//you can use this in unit test too as we did
require('cluster-cache').enable();

```

* **`get`** 
* with the loader, if concurrent `get` happens across the workers in a cluster, only one will be allowed to **load** while the rest will be in fact `watch` till that one finishes loading.
* this will reduce the stress upon the backend services which loads exact same data nicely

```javascript
var cache;

cache.get('cache-key-1', //key must be string
  function(){
    return 'cache-value-loaded-1'; //value could be value or promise
  },
  {
    'wait': 100//this is a timeout option
  })
  .then(function(value){
    //the value resolved is anything already cached or the value newly loaded
    //note, the loader will be called once and once only, if it failed, the promise of get will be rejected.
  },
  function(error){
  
  });
```
* **`set`**

```javascript
var cache;

cache.set('cache-key-1', //key must be string
  'cache-value-loaded-1', //value could be any json object
  {
    'leaveIfNotNull': false,//default false, which allows set to overwrite existing values
    'wait': 100
  })
  .then(function(happens){
    //the happens resolved is a true/false value indicating if the value has been accepted by the cache manager
  },
  function(error){
  
  });
```
* **`del`**

```javascript
var cache;

cache.del('cache-key-1', //key must be string
  {
    'wait': 100//this is a timeout option
  })
  .then(function(value){
    //the old value deleted
  });
```
* **`watch`**

```javascript
var cache;

cache.watch('cache-key-1', //key must be string or null (indicating watch everything)
  function watching(value, key){
    //this is a callback which will be called anytime the associatd key has an updated value
  });
```
* **`unwatch`**

```javascript
var cache;

cache.unwatch('cache-key-1', watching);//stop watching
```