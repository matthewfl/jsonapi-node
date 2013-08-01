var request = require("request");

var version = '0.0.1a';

// helper functions

var log = console.log; //function () {};

function update_obj(obj, with_what) {
    for(var k in with_what)
	obj[k] = with_what[k];
}

function combine_obj() {
    var ret = {};
    for(var a = 0; a < arguments.length; a++) {
	update_obj(ret, arguments[a]);
    }
    return ret;
}

function get_member(obj, name) {
    if(typeof name == 'string')
	name = name.split('.');
    if(name.length == 0)
	return obj;
    if(!obj[name[0]]) return null;
    return get_member(obj[name.shift()], name);
}

function handle_bars(obj, elem){
    if(typeof elem == 'string') {
	return elem.replace(/\{([\.\w]+)\}/g, function(match, what) {
	    return get_member(obj, what);
	});
    }
    if(typeof elem == 'object') {
	elem = combine_obj(elem);
	for(var n in elem) {
	    elem[n] = handle_bars(obj, elem[n]);
	}
    }
}


// base functions

function jsonapi(base_url, args) {
    this.base_url = base_url + '/';
    this.request_args = args || { 'headers': {'User-Agent': ''} };
    this.routes = {};
    this.cache = {};
    this.objects = {};
    this.request_args.headers['User-Agent'] += ' node-jsonapi/'+version+' node/'+process.version;
}


module.exports = jsonapi;

// methods


jsonapi.prototype._req = function (path, method, callback) {
    var self = this;
    if(typeof method == 'string')
	method = { 'method': method };
    var params = combine_obj(this.request_args, {
	'uri': this.base_url + path
    }, method);
    params.uri = params.uri.replace(/([^:])\/+/g, '$1/');
    log('Making request: ', JSON.stringify(params, null, 4));
    request(params, function(err, req, body) {
	if(err) {
	    console.error(err);
	    debugger;
	    return callback(err, null);
	}
	if(req.statusCode >= 400) {
	    return callback(new Error('http error code: \n' + typeof body == 'string' ? body : JSON.stringify(body, null, 4)), null);
	}
	log('result: ', body);
	try {
	    var json = typeof body == 'string' ? JSON.parse(req.body) : body;
	    self.processLinks(json.links);
	    callback(null, json);
	} catch(e) {
	    console.error(e);
	    debugger;
	    throw e;
	}
    });
};

jsonapi.prototype.get = function(path, callback, _list) {
    var self = this;
    // TODO check the cache
    /*
      if(_list !== true) {
      if(self.cache[path])
      return callback(null, self.cache[path])
      }
    */
    self._req(path, 'GET', function(err, json) {
	if(err) return callback(err, null);
	var list = self._processResult(json);
	if(_list === true)
	    callback(null, list);
	else {
	    callback(null, list[0]);
	}
    });
};

jsonapi.prototype._processResult = function (json) {
    var self = this;
    var list = [];
    for(var name in json) {
	if(name == "links" || name == "meta") continue;
	for(var i=0; i < json[name].length; i++) {
	    var o = json[name][i];
	    if(o.href && self.cache[o.href]) {
		self.cache[o.href]._update(o);
		list.push(self.cache[o.href]);
	    } else {
		var type = name.replace(/s$/, '');
		o = this._new_obj(type, o);
		if(o.href)
		    self.cache[o.href] = o;
		list.push(o);
	    }
	}
    }
    return list;
};

jsonapi.prototype.list = function(path, callback) {
    return this.get(path, callback, true);
};

jsonapi.prototype.processLinks = function (links) {
    if(typeof links != "object") return;
    for(var link in links) {
	var dat = /(\w+)\.(\w+)/.exec(link);
	if(!dat) continue;
	this.routes[dat[1]] = this.routes[dat[1]] || {};
	var route;
	if(typeof links[link] == 'string') {
	    route = this.routes[dat[1]][dat[2]] = {'method': 'GET', 'href': links[link] };
	}else if(typeof links[link] == 'object') {
	    route = this.routes[dat[1]][dat[2]] = links[link];
	    route.fields = route.fields || {};
	    for(var n in route.fields) {
		if(!Array.isArray(route.fields[n]))
		    route.fields[n] = [route.fields[n]];
	    }
	}
	if(route.fields) {
	    this._new_obj(dat[1].replace(/s$/, ''), {})._add_action(dat[2]);
	}
    }
};

jsonapi.prototype.getLink = function (obj, link) {
    //if(!obj._type || !this.routes[obj._type] && !this.routes[obj._type][link]) return null;
    log(this, arguments);
    return this.routes[obj._type+'s'][link].href.replace(/\{([\.\w]+)\}/g, function (match, what) {
	var dat = /(\w+)\.(\w+)/.exec(what);
	return obj[dat[2]];
    });
};

jsonapi.prototype.create = function(url, data, callback) {
    var self = this;
    if(typeof data == 'function') {
	callback = data;
	data = {};
    }
    this._req(url, { 'json': data, 'method': 'POST' }, function (err, json) {
	if(err) return callback(err, null);
	var list = self._processResult(json);
	callback(null, list[0]);
    });
};

jsonapi.prototype._new_obj = function(type, dat) {
    if(this.objects[type])
	return new this.objects[type](dat);
    else {
	var a = this.objects[type] = make_obj(this, type);
	return new a(dat);
    }
};

function make_obj(api, type) {

    function obj (obj) {
	this._api = api; // TODO: remove this
	this._type = type;
	this._raw_obj = obj;
	this.links = {};
	for(var n in obj)
	    this[n] = obj[n]; // TODO: make this copy stuff?
    }

    //obj.prototype._type = function () { return type; };
    /*
      Object.defineProperties(obj, {
	type: { get: function () { return type; } }
    });
    */

    obj.prototype.save = function (callback) {
	var self = this;
	callback = callback || function (err) { if(err) throw err; };
	this._api._req(this.href, { 'json': this.toJSON(), 'method': 'PUT' }, function (err, json) {
	    if(err) return callback(err, null);
	    var list = self._api._processResult(json);
	    callback(null, list[0]);
	});
    };

    obj.prototype.get = function (what, callback, _list) {
	if(typeof this[what] != 'undefined') {
	    return callback(null, this[what]);
	}
	if(typeof this.links[what] != 'undefined') {
	    if(this.links[what])
		return this._api.get(this.links[what], callback);
	    else
		return callback(new Error(this._type + ' ' + this.href + ' does not have a '+what+' associated'));
	}
	var link = this._api.getLink(this, what);
	if(!link) return callback(new Error('could not compute link '+what+' for '+obj._type), null);
	this._api.get(link, callback, _list);
    };

    obj.prototype.create = function (what, data, callback) {
	var self = this;
	var link;
	what += 's';
	if(typeof data == 'function') {
	    callback = data;
	    data = {};
	}
	if(this.links[what]) {
	    link = this.links[what];
	}else{
	    link = this._api.getLink(this, what);
	}
	if(!link) return callback(new Error('could not find link for '+what+' from '+this._type), null);
	this._api._req(link, { 'json': data, 'method': 'POST' }, function (err, json) {
	    if(err) return callback(err, null);
	    var list = self._api._processResult(json);
	    callback(null, list[0]);
	});
    };

    obj.prototype.delete = function (callback) {
	var self = this, href = this.href;
	this._api._rev(href, { 'method': 'DELETE' }, function (err, json){
	    if(err) return callback(err);
	    delete self._api.cache[href];
	    callback(null);
	});
    };

    obj.prototype.do = function (what, args, callback) {
	var self = this;
	var act = this._api.routes[this._type+'s'][what];
	var collect = {};
	collect[this._type+'s'] = this;
	for(var n in act.fields) {
	    var itm = act.fields[n];
	    for(var a=0; a < itm.length; a++) {
		if(typeof args[n] != 'undefined' && (typeof args[n] == itm[a]._type || args[n]._type == itm[a].type)) {
		    args[itm[a].name || n] = itm[a].value ? handle_bars(args[n], itm[a].value) : args[n];
		    if(itm[a].name && itm[a].name != n) delete args[n];
		    break;
		}
	    }
	}
	//var url = this._api.getLink(this, act.href)
	var url = handle_bars(collect, act.href);
	this._api._req(url, { 'json': args, method: act.method }, function (err, json){
	    if(err) return callback(err, null);
	    var list = self._api._processResult(json);
	    callback(null, list[0] || null);
	});
    };

    obj.prototype._update = function (dat) {
	// clear the object
	for(var n in this)
	    if(this.hasOwnProperty(n) && n != '_api' && n != '_type')
		delete this[n];

	// same as init in copying over object
	this.links = {};
	this._raw_obj = dat;
	for(var n in dat)
	    this[n] = dat[n];
    };

    obj.prototype.toJSON = function () {
	var obj = {};
	for(var n in this) {
	    if(n[0] == '_' || n == 'type' || n == 'links') continue;
	    if(typeof this[n] == 'function') continue;
	    obj[n] = this[n];
	}
	return obj;
    };

    obj.prototype._add_action = function (act) {
	if(!obj.prototype[act])
	    obj.prototype[act] = function (args, callback) {
		return this.do(act, args, callback);
	    };
    };

    obj.prototype.list = jsonapi.prototype.list;

    obj.prototype.refresh = function (callback) {
	this._api.get(this.href, callback || function () {});
    };

    return obj;

}
