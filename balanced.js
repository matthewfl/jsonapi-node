var jsonapi = require('./lib');

var balanced = new jsonapi('https://api.balancedpayments.com', {
    'headers': {
	'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json'
    }
});

module.exports = balanced;

balanced.configure = function (api_key) {
    console.log('asdfasdf', arguments);
    balanced.request_args.auth = {'user': api_key, 'pass': ''};
};


balanced._reg_type('api_key');
balanced._reg_type('marketplace');
balanced._reg_type('customer', {
    add_card: function(card) {
	card.customer = this;
	return card.save();
    },
    add_bank_account: function(bank_account) {
	bank_account.customer = this;
	return bank_account.save();
    }
});
balanced._reg_type('card', {
    debit: function(args) {
	return this.create('debit', args);
    }
});
