var request = require("request");
var Q = require('q');
var url= require('url');

var version = require('./package.json').version;

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
    this.last_cache_clean = new Date;
    this.cache_time_limit = (this.request_args.request_time_limit || 60) * 1000;
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
    Q.JSONpromise(params).then(function (params) {
        request(params, function(err, req, body) {
            if(err) {
                ret.reject(err);
                return;
            }
            if(req.statusCode >= 400) {
                var e = new Error('http error code: \n' + typeof body == 'string' ? body : JSON.stringify(body, null, 4));
                return ret.reject(e);
            }
            if(req.statusCode == 204) { // no content
                return ret.resolve(null);
            }
            log('result: ', body);
            try {
                var json = typeof body == 'string' ? JSON.parse(req.body) : body;
                self._processLinks(json.links);
                return ret.resolve(json);
            } catch(e) {
                ret.reject(e);
            }
        });
    });
    return ret.promise;
};

jsonapi.prototype.get = function(path, _list) {
    var self = this;
    return Q(path).then(function (path) {
        if(!path)
            return Q.reject(new Error('Can not resolve undefined path'));
        if(_list !== true && self.cache[path])
            return Q(self.cache[path]);
        self._manage_cache();
        if(_list === true)
            return Q(new page_obj(self, path));
        return self._req(path, 'GET').then(function(json) {
            var list = self._processResult(json);
            for(var a = 0; a < list.length; a++) {
                if(list[a].href == path) {
                    return list[a];
                }
            }
            return list[0];
        });
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

jsonapi.prototype._processLinks = function (links) {
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
            _promise_something(dat[2]);
        }
    }
};

jsonapi.prototype._getLink = function (obj, link) {
    return this.routes[obj._type+'s'][link].href.replace(/\{([\.\w]+)\}/g, function (match, what) {
        var dat = /(\w+)\.(\w+)/.exec(what);
        return obj._raw_obj.links[dat[2]] || obj._raw_obj[dat[2]];
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
    if(!this.objects[type])
        this[type] = this.objects[type] = make_obj(this, type);
    var a = this.objects[type];
    for(var f in func) {
        _promise_something(f);
        if(typeof func[f] == 'function') {
            a.prototype[f] = Q.promised(func[f]);
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

Q.makePromise.prototype.refresh = function () {
    return this.invoke('refresh');
};

Q.makePromise.prototype.unstore = function () {
    return this.invoke('unstore');
};

Q.makePromise.prototype.first = function () {
    return this.invoke('first');
};

Q.makePromise.prototype.one = function () {
    return this.invoke('one');
};

Q.makePromise.prototype.get = function (name) {
    if(!this.then || !this.promiseDispatch)
        debugger;
    return this.then(function(val) {
        name = (name+'').split('.');
        var base = name.shift(), rest = name.join('.'), ret
        if(typeof val.get == 'function') {
            ret = val.get.call(val, base);
        }else
            ret = val[name];
        if(rest)
            return Q(ret).get(rest);
        return ret;
    });
};

Q.makePromise.prototype.set = function(path, value) {
    // simply a smarter set method
    return this.then(function (ret) {
        var p = path.split('.');
        var f = p.pop();
        return (p ? ret.get(p.join('.')) : Q(ret)).then(function (obj) {
            obj[f] = value;
            return ret;
        });
    });
};

Q.JSONpromise = function JSONpromise(json) {
    if(json instanceof Array) {
        return Q.all(json);
    }
    if(typeof json == 'object' && json != null && !(json instanceof Q.makePromise)) {
        var w = [], q = [];
        for(var name in json) {
            q.push(JSONpromise(json[name]));
            w.push(name);
        }
        return Q.all(q).then(function (q) {
            var ret = {};
            for(var a = 0; a < q.length; a++) {
                ret[w[a]] = q[a];
            }
            return ret;
        });
    }
    return json;
};

function _promise_something(name) {
    if(!Q.makePromise.prototype[name] &&
       Q_reserved_names.indexOf(name) == -1) {
        Object.defineProperty(Q.makePromise.prototype, name, {
            'get': function () {
                if(this === Q.makePromise.prototype)
                    return true; // we are not operating on a object

                var self = this;
                var gotten;
                function act() {
                    return Q.spread([self, Q.all(arguments)], function(self, args) {
                        return self[name].apply(self, args);
                    });
                }
                for(var elem in Q.makePromise.prototype) {
                    (function (elem) {
                        Object.defineProperty(act, elem, {
                            'get': function () {
                                // not working
                                if(!gotten) gotten = self.get(name);
                                if(typeof gotten[elem] == 'function') {
                                    return function () {
                                        return gotten[elem].apply(gotten, arguments);
                                    };
                                }else
                                    return gotten[elem];
                            }
                        });
                    })(elem);
                }
                return act;
            }
        });

    }
}

_promise_something('filter');

jsonapi.prototype._manage_cache = function () {
    var now = new Date;
    if(now - this.last_cache_clean > this.cache_time_limit) {
        for(var k in this.cache) {
            if(now - this.cache[k]._load_time > this.cache_time_limit) {
                delete this.cache[k];
            }
        }
    }
    this.last_cache_clean = now;
};

function make_obj(api, type) {

    function obj (obj) {
        var self = this;
        this._api = api; // TODO: remove this ?
        this._type = type;
        this._raw_obj = obj;
        this._loaded = true;
        this._load_time = new Date;
        this.links = {};
        for(var n in obj)
            this[n] = obj[n]; // TODO: make this copy stuff?
        for(var n in api.routes[type+'s']) {
            (function (name) {
                var val=null;
                Object.defineProperty(self, name, {
                    'get': function () {
                        if(val) return Q(val);
                        var link = self._api._getLink(self, name);
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

    obj.prototype.save = function (cb) {
        var self = this;
        cb = cb || function () {};
        return this._api._req(this.href, { 'json': this.toJSON(), 'method': 'PUT' }).then(function (json) {
            var list = self._api._processResult(json);
            cb(null, self);
            return self;
        }, function(err) {
            cb(err);
            return Q.reject(err);
        });
    };

    obj.prototype.get = function (what, _list) {
        var self = this;
        var pre = this._loaded ? Q() : this.refresh();
        return pre.then(function() {
            if(self[what]) {
                return Q(self[what]);
            }
            var link = self._api._getLink(self, what);
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
                link = self._api._getLink(self, what);
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

    obj.prototype.unstore = obj.prototype.delete = function () {
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
        this._load_time = new Date;
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
        var self = this;
        return this._api._req(this.href, 'GET').then(function (json) {
            var list = self._api._processResult(json);
            return list[0];
        });
    };

    return obj;

}


// this page object is balanced specific atm
// todo: fix that???

function page_obj(api, url) {
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
    this._url = url;
    this._objs = {};
    this._meta = null;
}

page_obj.prototype._load = function (meta, list) {
    this._meta = meta;
    for(var n in list) {
        this._objs[n*1 + this._meta.offset*1] = list[n].href;
    }
};

Object.defineProperty(page_obj.prototype, 'length', {
    get: function () {
        var self = this;
        if(this._meta)
            return Q(this._meta.total);
        else
            return this.get(0).then(function () {
                return self._meta.total;
            });
    }
});

page_obj.prototype.create = function (args) {
    var query = url.parse(this._url, true);
    return this._api.create(query.pathname, args);
};

page_obj.prototype.get = function (index) {
    index *= 1;
    if(this._objs[index]) {
        if(typeof this._objs[index] == 'string')
            return this._api.get(this._objs[index]);
        else
            // if the object is being requested, but has not resolved yet
            // the object will be a promise, which will resolve once the
            // object is ready
            return this._objs[index].then(function () {
                return this._api.get(this._objs[index]);
            });
    }
    var self = this;
    var look = index - index % 10;
    var query = url.parse(this._url, true);
    query.query.limit = 10;
    query.query.offset = look;
    var href = url.format(query);
    var defered = Q.defer();
    for(var a = look; a < look + 10; a++ ) {
        this._objs[a] = defered.promise;
    }
    return this._api._req(href, 'GET').then(function (json) {
        var list = self._api._processResult(json);
        self._load(json.meta, list);
        defered.resolve();
        return self._objs[index] ? self._api.get(self._objs[index]) : undefined;
    });
};

page_obj.prototype.filter = function (name_or_dict, value) {
    var dict = {};
    if(typeof name_or_dict == 'string')
        dict[name_or_dict] = value;
    else
        dict = name_or_dict;
    var query = url.parse(this._url, true);
    update_obj(query.query, dict);
    return new page_obj(this._api, url.format(query));
};

page_obj.prototype.first = function () {
    var self = this;
    return this.get(0).catch(function (err) {
        if(typeof self._objs[0] != 'string')
            return null;
        return Q.reject(err); // not our error to catch
    });
};

page_obj.prototype.one = function () {
    var self = this;
    return this.length(function (length) {
        if(length != 1)
            return Q.reject(new Error('Page '+self._url+' does not have exactly one item, it has '+length));
        return self.get(0);
    });
};


Object.defineProperty(page_obj.prototype, 'all', {
    get: function () {
        var self = this;
        return this.length.then(function (length) {
            var ret = [];
            for(var a = 0; a < length; a++) {
                ret.push(self.get(a));
            }
            return Q.all(ret);
        });
    }
});
