var request = require("request");
var Q = require('q');
var url= require('url');
var util = require('util');

var version = require('./package.json').version;

// helper functions

var log = function () {};

//Q.longStackSupport = true;

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
    this.cache_time_limit = (this.request_args.cache_time_limit || 120) * 1000;
    this.objects = {};
    this.action_names = {};
    this.request_args.headers['User-Agent'] += ' node-jsonapi/'+version+' node/'+process.version;
}


module.exports = jsonapi;

// errors

function jsonapiError(human_readable, req) {
    update_obj(this, Error.call(this));
    Error.captureStackTrace(this, this.constructor);
    this._raw = req;
    this.message = human_readable;
    if(req && req.errors && req.errors[0])
        update_obj(this, req.errors[0]);
}

util.inherits(jsonapiError, Error);

jsonapi.prototype.ERROR = jsonapiError;

jsonapiError.prototype.toString = function () {
    return JSON.stringify(this._raw, null, 4);
};

// methods


jsonapi.prototype._req = function (path, method) {
    var self = this;
    if(typeof method == 'string')
        method = { 'method': method };
    var params = combine_obj(this.request_args, {
        'uri': Q(path).then(function (p) {
            return (self.base_url + p).replace(/([^:])\/+/g, '$1/');
        })
    }, method);
    var ret = Q.defer();
    Q.JSONpromise(params).then(function (params) {
        log('Making request: ', JSON.stringify(params, null, 4));
        request(params, function(err, req, body) {
            if(err) {
                return ret.reject(err);
            }
            if(req.statusCode >= 400) {
                var e = new jsonapiError('http error code: \n' + typeof body == 'string' ? body : JSON.stringify(body, null, 4), body);
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
            return Q.reject(new jsonapiError('Can not resolve undefined path'));
        if(_list !== true && self.cache[path])
            return Q(self._new_obj(self.cache[path]._type, self.cache[path]));
        self._manage_cache();
        if(_list === true)
            return Q(new page_obj(self, path));
        return self._req(path, 'GET').then(function(json) {
            var list = self._processResult(json);
            for(var a = 0; a < list.length; a++) {
                if(list[a].href == path) {
                    return list[a];
                }
                return list[0];
            }
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
            var type = name.replace(/s$/, '');
            o._type = type;
            if(o.href) {
                self.cache[o.href] = o;
                self.cache[o.href]._load_time = new Date;
            }
            list.push(this._new_obj(type, o));
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

jsonapi.prototype.registerType= function(type, func) {
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

Q.makePromise.prototype.save = function (f) {
    return this.invoke('save', f);
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

Q.makePromise.prototype.range = function (start, end) {
    return this.invoke('range', start, end);
};

Q.makePromise.prototype.get = function (name) {
    return this.then(function(val) {
        name = (name+'').split('.');
        var base = name.shift(), rest = name.join('.'), ret;
        if(typeof val.get === 'function') {
            ret = val.get.call(val, base);
        }else
            ret = val[base];
        if(rest)
            return Q(ret).get(rest);
        return ret;
    });
};

Q.makePromise.prototype.set = function(path, value) {
    // simply a smarter set method
    var p = path.split('.'),
    f = p.pop(), self = this,
    o = this;
    if(p.length)
        o = o.get(p);
    return o.then(function (obj) {
        if(typeof obj.set === 'function')
            obj.set(f, value);
        else
            obj[f] = value;
        return self;
    });
};

Q.JSONpromise = function JSONpromise(json) {
    if(json instanceof Array) {
        for(var a =0; a < json.length; a++)
            json[a] = JSONpromise(json[a]);
        return Q.all(json);
    }
    if(typeof json === 'object' && json != null && !(json instanceof Q.makePromise)) {
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
            'get': _promise_something_container(name)
        });
    }
}

function _promise_something_container(name) {
    return function () {
        if(this === Q.makePromise.prototype)
            return true; // we are not operating on a object

        var self = this;
        var gotten;
        function act() {
            return Q.spread([self, Q.all(arguments)], function(self, args) {
                return self[name].apply(self, args);
            });
        }
        act._promised_something = name;
        var props = Object.getOwnPropertyNames(Q.makePromise.prototype);
        for(var a=0; a < props.length; a++) {
            (function (elem) {
                Object.defineProperty(act, elem, {
                    'get': function () {
                        if(!gotten) gotten = self.get(name);
                        if(typeof gotten[elem] == 'function') {
                            if(gotten[elem]._promised_something) {
                                // this is another promise, so we can just return it
                                return gotten[elem];
                            }else{
                                return function () {
                                    return gotten[elem].apply(gotten, arguments);
                                };
                            }
                        }else
                            return gotten[elem];
                    }
                });
            })(props[a]);
        }
        return act;
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
        this.last_cache_clean = now;
    }
};

function make_obj(api, type) {

    function obj (from) {
        var self = this;
        this._api = api; // TODO: remove this ?
        this._href = from.href;
        this._set_values = {};
        this._deferred = from._deferred || false;

        for(var n in api.routes[type+'s']) {
            if(obj.prototype[n]) continue;
            (function (name) {
                Object.defineProperty(obj.prototype, name, {
                    'get': function () {
                        if(this === obj.prototype) return true;
                        var link = self._api._getLink(this, name);
                        if(!link) return Q.reject(new jsonapiError('could not find link for '+name+' from '+this._type));
                        return this._api.get(link, !this._raw_obj.links[name]);
                    }
                });
            })(n);
        }

        if(!this._href) {
            // if this object does not have a link
            // then fallback on just copying over the fields
            for(var n in from)
                this[n] = from[n]; // TODO: make this copy stuff?
        }else{
            for(var n in from) {
                if(n == 'href' || n == 'links' || obj.prototype[n]) continue;
                (function (name) {
                    Object.defineProperty(obj.prototype, name, {
                        'get': function () {
                            if(this === obj.prototype) return true; // not working on an object
                            if(this._deferred)
                                return this.get(name);
                            return this._set_values[name] || this._api.cache[this._href][name];
                        },
                        'set': function (value) {
                            this._set_values[name] = value;
                        }
                    });
                })(n);
            }
        }
    }

    obj.prototype._type = type;

    Object.defineProperty(obj.prototype, 'href', {
        'get': function () {
            return this._href;
        }
    });

    Object.defineProperty(obj.prototype, 'links', {
        'get': function () {
            var self = this;
            if(!this._deferred)
                return this._api.cache[this._href].links;
            if(this._api.cache[this._href])
                return Q(this._api.cache[this._href].links);
            return this._loaded().then(function () {
                return self._api.cache[self._href].links;
            })
        }
    });

    Object.defineProperty(obj.prototype, '_raw_obj', {
        'get': function () {
            if(this._api.cache[this._href])
                return this._api.cache[this._href];
            throw new jsonapiError('JSONAPI Object '+this._href+' not yet loaded, can not access the _raw_obj');
        }
    });

    obj.prototype._loaded = function () {
        var self = this;
        if(this._api.cache[this._href])
            return Q(this._api.cache[this._href]);
        return this.refresh().then(function () {
            return self._api.cache[self._href];
        });
    };

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
        return this._loaded().then(function() {
            if(self._set_values[what])
                return self._set_values[what];
            if(self._api.cache[self._href][what])
                return Q(self._api.cache[self._href][what]);
            var link = self._api._getLink(self, what);
            if(!link) return Q.reject(new jsonapiError('could not compute link '+what+' for '+obj._type), null);
            if(typeof _list == 'undefined')
                _list = !self._raw_obj.links[what];
            return self._api.get(link, _list);
        });
    };

    obj.prototype.set = function (path, value) {

        return this._loaded().set(path, value).thenResolve(this);
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
        return this._loaded().then(function () {
            var link;
            what += 's';
            if(!data) data = {};
            if(self.links[what]) {
                link = self.links[what];
            }else{
                link = self._api._getLink(self, what);
            }
            if(!link) return Q.reject(new jsonapiError('could not find link for '+what+' from '+self._type), null);
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

    obj.prototype.toJSON = function () {
        var ret = {}, obj = combine_obj(this._raw_obj, this, this._set_values);
        for(var n in obj) {
            if(n[0] == '_') continue;
            if(typeof obj[n] == 'function') continue;
            ret[n] = obj[n];
        }
        return ret;
    };

    obj.prototype._add_action = function (act) {
        if(!obj.prototype[act])
            obj.prototype[act] = function (args) {
                return this.do(act, args);
            };
    };

    obj.prototype.refresh = function () {
        var self = this;
        return this._api._req(this._href, 'GET').then(function (json) {
            var list = self._api._processResult(json);
            return list[0];
        });
    };

    obj.find = function(href) {
        return api._new_obj(type, {
            href: href,
            _deferred: true
        });
    };

    obj.prototype.toString = function () {
        return '[object jsonapi-'+this._type+']';
    };

    Object.defineProperty(obj, 'query', {
        'get': function () {
            return api.list(type + 's');
        }
    });

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
            return this.first().then(function () {
                return self._meta.total;
            });
    }
});

page_obj.prototype.create = function (args) {
    var query = url.parse(this._url, true);
    return this._api.create(query.pathname, args);
};

page_obj.prototype.get = function (index, _catch_err) {
    var self = this;
    index *= 1;
    if(this._objs[index]) {
        if(typeof this._objs[index] === 'string')
            return this._api.get(this._objs[index]);
        else
            // if the object is being requested, but has not resolved yet
            // the object will be a promise, which will resolve once the
            // object is ready
            return this._objs[index].then(function () {
                return self._objs[index] ? self._api.get(self._objs[index]) : undefined;
            }).catch(function (err) {
                if(_catch_err === true && typeof self._objs[index] !== 'string')
                    return null;
                return Q.reject(err);
            });
    }
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
    }).catch(function (err) {
        if(_catch_err === true && typeof self._objs[index] !== 'string')
            return null;
        return Q.reject(err);
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
    query.search = null;
    return new page_obj(this._api, url.format(query));
};

page_obj.prototype.range = function (start, finish) {
    var ret = [];
    for(var a=start; a < finish; a++) {
        ret.push(this.get(a, true));
    }
    return Q.all(ret);
};

page_obj.prototype.first = function () {
    var self = this;
    return this.get(0, true);
};

page_obj.prototype.one = function () {
    var self = this;
    return this.length(function (length) {
        if(length !== 1)
            return Q.reject(new jsonapiError('Page '+self._url+' does not have exactly one item, it has '+length));
        return self.get(0);
    });
};

page_obj.prototype.all = function () {
    var self = this;
    return this.length.then(function (length) {
        var ret = [];
        for(var a = 0; a < length; a++) {
            ret.push(self.get(a));
        }
        return Q.all(ret);
    });
};

page_obj.prototype.refresh = function () {
    this._objs = {};
    this._meta = null;
    return this;
};
