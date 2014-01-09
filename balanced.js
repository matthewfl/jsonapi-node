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
balanced._reg_type('marketplace');
balanced._reg_type('customer', {
    add_card: function(card) {
	card.links.customer = this.id;
	return card.save();
    },
    add_bank_account: function(bank_account) {
	bank_account.links.customer = this.id;
	return bank_account.save();
    }
});
balanced._reg_type('card', {
    debit: function(args) {
	return this.create('debit', args);
    },
    hold: function (args) {
	return this.create('card_hold', args);
    },
});
balanced._reg_type('bank_account', {
    debit: function (args) {
	return this.create('debit', args);
    },
    credit: function (args) {
	return this.create('credit', args);
    }
});
balanced._reg_type('card_hold', {
    debit: function () {
	return this.create('debit', args);
    }
});
