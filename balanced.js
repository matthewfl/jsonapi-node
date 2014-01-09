var jsonapi = require('./lib');

var balanced = new jsonapi('https://api.balancedpayments.com', {
    'headers': {
	'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json',
	'User-Agent': 'balanced-node/1.0.0a'
    }
});

module.exports = balanced;

balanced.configure = function (api_key) {
    balanced.request_args.auth = {'user': api_key, 'pass': ''};
};


balanced._reg_type('api_key');
balanced._reg_type('marketplace', {
    'debits': '_',
    'reversals': '_',
    'customers': '_',
    'credits': '_',
    'cards': '_',
    'card_holds': '_',
    'refunds': '_',
    'transactions': '_',
    'bank_accounts': '_',
    'callbacks': '_',
    'events': '_'
});
var marketplace_href; // by keeping the href, the cache is manage by the jsonapi client
Object.defineProperty(balanced, 'marketplace', {
    'get': function () {
	return marketplace_href ? balanced.get(marketplace_href) : balanced.get('marketplaces').then(function (mp) {
	    marketplace_href = mp.href;
	    return mp;
	});
    }
});

function set_customer(obj) {
    if(typeof obj == 'string') {
	// assume it is a href
	var self = this;
	return balanced.get(obj).then(function (c) {
	    c.links.customer = self.id;
	}).save().thenResolve(this);
    }
    obj.links.customer = this.id;
    return obj.save().thenResolve(this);
}

balanced._reg_type('customer', {
    add_card: set_customer,
    add_bank_account: set_customer
});

balanced._reg_type('card', {
    debit: function(args) {
	if(typeof args == 'number') args = {amount: args};
	return this.create('debit', args);
    },
    hold: function (args) {
	if(typeof args == 'number') args = {amount: args};
	return this.create('card_hold', args);
    },
});
balanced._reg_type('bank_account', {
    debit: function (args) {
	if(typeof args == 'number') args = {amount: args};
	return this.create('debit', args);
    },
    credit: function (args) {
	if(typeof args == 'number') args = {amount: args};
	return this.create('credit', args);
    }
});
balanced._reg_type('card_hold', {
    debit: function () {
	if(typeof args == 'number') args = {amount: args};
	return this.create('debit', args);
    }
});
