var request = require("request");
var Q = require('q');

var version = '0.0.1b';

Q.longStackSupport = true;

// helper functions

var log = function () {};

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
    this.action_names = {};
    this.request_args.headers['User-Agent'] += ' node-jsonapi/'+version+' node/'+process.version;
}


module.exports = jsonapi;

// methods


jsonapi.prototype._req = function (path, method) {
    var self = this;
    if(typeof method == 'string')
        method = { 'method': method };
    var params = combine_obj(this.request_args, {
        'uri': this.base_url + path
    }, method);
    params.uri = params.uri.replace(/([^:])\/+/g, '$1/');
    log('Making request: ', JSON.stringify(params, null, 4));
    var ret = Q.defer();
    request(params, function(err, req, body) {
        if(err) {
            console.error(err);
            debugger;
            ret.reject(err);
            return;
        }
        if(req.statusCode >= 400) {
            var e = new Error('http error code: \n' + typeof body == 'string' ? body : JSON.stringify(body, null, 4));
            return ret.reject(e);
        }
        log('result: ', body);
        try {
            var json = typeof body == 'string' ? JSON.parse(req.body) : body;
            self.processLinks(json.links);
            return ret.resolve(json);
        } catch(e) {
            console.error(e);
            debugger;
            throw e;
        }
    });
    return ret.promise;
};

jsonapi.prototype.get = function(path, _list) {
    var self = this;
    // TODO check the cache
    /*
      if(_list !== true) {
      if(self.cache[path])
      return callback(null, self.cache[path])
      }
    */
    return self._req(path, 'GET').then(function(json) {
        var list = self._processResult(json);
        if(_list === true)
            return new page_obj(json.meta, list, self);
        return list[0];
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

jsonapi.prototype.list = function(path) {
    return this.get(path, true);
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
        }else{
	    this._promise_item(dat[2]);
	}
    }
};

jsonapi.prototype.getLink = function (obj, link) {
    return this.routes[obj._type+'s'][link].href.replace(/\{([\.\w]+)\}/g, function (match, what) {
        var dat = /(\w+)\.(\w+)/.exec(what);
        return obj.links[dat[2]] || obj[dat[2]];
    });
};

jsonapi.prototype.create = function(url, data) {
    var self = this;
    if(!data) data = {};

    return this._req(url, { 'json': data, 'method': 'POST' }).then(function(json) {
	var list = self._processResult(json);
	return Q(list[0]);
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

jsonapi.prototype._reg_type = function(type, func) {
    var a = this[type] = this.objects[type] = make_obj(this, type);
    for(var f in func) {
        if(typeof func[f] == 'function') {
            this._promise_action(f);
	    a.prototype[f] = Q.promised(func[f]);
        }else {
            // TODO:
	    if(func[f] == '_') {
		this._promise_item(f);
	    }
        }
    }
};

jsonapi.prototype.Q = Q;

var Q_reserved_names = ['source'];

Q.makePromise.prototype.create = function (args) {
    return this.invoke('create', args);
};

Q.makePromise.prototype.save = function () {
    return this.invoke('save');
};

Q.makePromise.prototype.get = function (name) {
    return this.then(function(val) {
        if(typeof val.get == 'function') {
            return val.get.call(val, name);
        }
        return val[name];
    });
};

Q.makePromise.prototype.set = function(path, value) {
    // simply a smarter set method
    return this.then(function (ret) {
	var p = path.split('.');
	var f = p.pop();
	var at = ret;
	while(p.length)
	    at = at[p.shift()];
	at[f] = value;
	return ret;
    });
};

jsonapi.prototype._promise_action = function (name) {
    if(!Q.makePromise.prototype[name] &&
       Q_reserved_names.indexOf(name) == -1)
	Q.makePromise.prototype[name] = function () {
            return Q.spread([this, Q.all(arguments)], function(self, args) {
		return self[name].apply(self, args);
            });
	};
};

jsonapi.prototype._promise_item = function (name) {
    if(!Q.makePromise.prototype[name] &&
      Q_reserved_names.indexOf(name) == -1)
	Object.defineProperty(Q.makePromise.prototype, name, {
	    'get': function () {
		return this === Q.makePromise.prototype ? true : this.get(name);
	    },
	    'set': function (val) {
		// we should never be setting a value on a promise
		throw new Error('Attempted setting field '+name+' on balanced promise');
	    }
	});
};

function make_obj(api, type) {

    function obj (obj) {
        var self = this;
        this._api = api; // TODO: remove this
        this._type = type;
        this._raw_obj = obj;
        this._loaded = true;
        this.links = {};
        for(var n in obj)
            this[n] = obj[n]; // TODO: make this copy stuff?
        for(var n in api.routes[type+'s']) {
            (function (name) {
                var val=null;
                Object.defineProperty(self, name, {
                    'get': function () {
                        if(val) return Q(val);
                        var link = self._api.getLink(self, name);
                        if(!link) return Q.reject(new Error('could not find link for '+name+' from '+self._type));
                        return self._api.get(link, !self.links[name])
                            .then(function (ret) {
                                return val = ret;
                            });
                    }
                });
            })(n);
        }
    }

    obj.prototype.save = function () {
        var self = this;
        return this._api._req(this.href, { 'json': this.toJSON(), 'method': 'PUT' }).then(function (json) {
            var list = self._api._processResult(json);
            return list[0];
        });
    };

    obj.prototype.get = function (what, _list) {
        var self = this;
        var pre = this._loaded ? Q() : this.refresh();
        return pre.then(function() {
            if(self[what]) {
                return Q(self[what]);
            }
            var link = self._api.getLink(self, what);
            if(!link) return Q.reject(new Error('could not compute link '+what+' for '+obj._type), null);
            return self._api.get(link, _list);
        });
    };

    obj.prototype.create = function (what, data) {
        var self = this;
        if(typeof what != 'string') {
            data = what || {};
            return this._api._req(this.href, { 'json': data, 'method': 'POST' }).then(function (json) {
                var list = self._api._processResult(json);
                return list[0];
            });
        }
        var pre = this._loaded ? Q() : this.refresh();
        return pre.then(function () {
            var link;
            what += 's';
            if(!data) data = {};
            if(self.links[what]) {
                link = self.links[what];
            }else{
                link = self._api.getLink(self, what);
            }
            if(!link) return Q.reject(new Error('could not find link for '+what+' from '+self._type), null);
            return self._api._req(link, { 'json': data, 'method': 'POST' }).then(function (json) {
                var list = self._api._processResult(json);
                return list[0];
            });
        });
    };

    obj.create = function (data) {
        return api.create(type + 's', data);
    };

    obj.prototype.delete = function () {
        var self = this, href = this.href;
        return this._api._req(href, { 'method': 'DELETE' }).then(function (json) {
            delete self._api.cache[href];
        });
    };

    obj.prototype.do = function (what, args) {
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
        return this._api._req(url, { 'json': args, method: act.method }).then(function (json){
            var list = self._api._processResult(json);
            return list[0] || null;
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
        this._loaded = true;
        for(var n in dat)
            this[n] = dat[n];
    };

    obj.prototype.toJSON = function () {
        var obj = {};
        for(var n in this) {
            if(n[0] == '_' || n == 'type') continue;
            if(typeof this[n] == 'function') continue;
            obj[n] = this[n];
        }
        return obj;
    };

    obj.prototype._add_action = function (act) {
        if(!obj.prototype[act])
            obj.prototype[act] = function (args) {
                return this.do(act, args);
            };
    };

    obj.prototype.list = jsonapi.prototype.list;

    obj.prototype.refresh = function () {
        return this._api.get(this.href);
    };

    return obj;

}


// this page object is balanced specific atm
// todo: fix that???

function page_obj(meta, objs, api) {
    //     "meta": {
    // <     "last": "/customers?limit=10&offset=0",
    // <     "next": null,
    // <     "href": "/customers?limit=10&offset=0",
    // <     "limit": 10,
    // <     "offset": 0,
    // <     "previous": null,
    // <     "total": 1,
    // <     "first": "/customers?limit=10&offset=0"
    // <   },
    this._api = api;
    this._objs = {};
    //debugger;
    this._load(meta, objs);
}

page_obj.prototype._load = function (meta, list) {
    this._meta = meta;
    this._base_url = this._meta.href.split('?')[0];
    for(var n in list) {
        this._objs[n*1 + this._meta.offset*1] = list[n];
    }
};

page_obj.prototype.total = function () {
    return this._meta.total;
};

page_obj.prototype.create = function (args) {
    return this._api.create(this._base_url, args);
};

page_obj.prototype.get = function (index) {
    if(this._objs[index])
        return Q(this._objs[index]);
    var self = this;
    var look = index - index % 10;
    var href = this._base_url + '?limit=10&offset=' + look;
    return this._api._req(href, 'GET').then(function (json) {
        var list = self._api._processResult(json);
        self._load(json.meta, list);
        return self._objs[index];
    });
};
