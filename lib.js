var request = require("request");

// helper functions

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

// base functions

function jsonapi(base_url, args) {
    this.base_url = base_url;
    this.request_args = args || {}
    this.routes = {};
    this.cache = {};
}

function obj (api, type, obj) {
    this._api = api;
    this._raw_obj = obj;
    this.type = type;
    this.links = {};
    for(var n in obj)
	this[n] = obj[n]; // TODO: make this copy stuff?
}


module.exports = jsonapi;

// methods


jsonapi.prototype._req = function (path, method, callback) {
    var self = this;
    if(typeof method == 'string')
	method = { 'method': method };
    request(combine_obj(this.request_args, {
	'uri': this.base_url + path
    }, method), function(err, req, body) {
	if(err) {
	    return callback(err, null);
	}
	if(req.statusCode >= 400) {
	    return callback(new Error('http error code: \n' + body), null);
	}
	var json = JSON.parse(body || '{}');
	self.processLinks(json.links);
	callback(null, json);
	//callback(null, new obj(self, json));
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
	callback(null, _list === true ? list : list[0]);
    });
};

jsonapi.prototype._processResult = function (json) {
    var list = [];
    for(var name in json) {
	if(name == "links" || name == "meta") continue;
	for(var i=0; i < json[name].length; i++) {
	    var o = json[name][i];
	    if(o.href && self.cache[o.href]) {
		self.cache[o.href]._update(o);
		list.push(self.cache[o.href]);
	    } else {
		o = new obj(self, name, o);
		if(o.href)
		    self.cache[o.href] = o;
		list.push(o);
	    }
	}
    }
    return list;
};

obj.prototype.list = jsonapi.prototype.list = function(path, callback) {
    return this.get(path, callback, true);
};

jsonapi.prototype.processLinks = function (links) {
    if(typeof links != "object") return;
    for(var link in links) {
	var dat = /(\w+)\.(\w+)/.exec(link);
	if(!dat) continue;
	this.routes[dat[1]] = this.routes[dat[1]] || {};
	this.routes[dat[1]][dat[2]] = links[link];
    }
};

jsonapi.prototype.getLink = function (obj, link) {
    //if(!obj.type || !this.routes[obj.type] && !this.routes[obj.type][link]) return null;
    return this.routes[obj.type+'s'][link].replace(/\{(\w+)}\}/g, function (match, what) {
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



obj.prototype.save = function () {

};

obj.prototype.get = function (what, callback, _list) {
    if(this[what]) {
	return callback(null, this[what]);
    }
    if(this.links[what]) {
	return this._api.get(this.links[what], callback);
    }
    var link = this._api.getLink(this, what);
    if(!link) return callback(new Error('could not compute link '+what+' for '+obj.type), null);
    this._api.get(link, callback, _list);
};

obj.prototype.create = function (what, data, callback) {
    var self = this;
    var link;
    if(this.links[what]) {
	link = this.links[what];
    }else{
	link = this._api.getLink(this, what);
    }
    if(!link) return callback(new Error('could not find link for '+what+' from '+this.type), null);
    this._req(link, { 'json': data, 'method': 'POST' }, function (err, json) {
	if(err) return callback(err, null);
	var list = self._api._processResult(json);
	callback(null, list[0]);
    });
}

obj.prototype.toJSON = function () {
    var obj = {};
    for(var n in this) {
	if(n[0] == '_' || n == 'type' || n == 'links') continue;
	obj[n] = this[n];
    }
    return obj;
};
