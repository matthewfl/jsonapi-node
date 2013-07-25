var jsonapi = require('./lib');

var test = require('./simple_tests')

balanced = new jsonapi('http://localhost:5000', {
    'headers': {'Accept-Type': 'application/vnd.balancedpayments+json; version=1.1' }
});


test('api_key', function () {
    var cb = this;
    balanced.create('api_keys', function(err, obj) {
	balanced.request_args.auth = {'user': obj.secret};
	if(err) throw err;
	cb(obj);
    });
});

test('marketplace', function (api_key) {
    var cb = this;
    balanced.create('marketplaces', function (err, obj) {
	if(err) throw err;
	cb(obj);
    });
});

test('customer_create', function(marketplace) {
    var cb = this;
    marketplace.create('customers', function(err, obj) {
	if(err) throw err;
	cb(obj);
    });
});

test('card_create', function (marketplace){
    var cb = this;
    marketplace.create('cards',
		       {
			   'number': '4111111111111111',
			   'year': '2016',
			   'month': '12'
		       },
		       function (err, obj){
			   if(err) throw err;
			   cb(obj);
    });
});


test('add_card_to_customer', function(customer_create, card_create) {
    var cb = this;
    customer_create.card_uri = card_create.href;
    debugger;
    customer_create.save(function(err, obj) {
	debugger;
	if(err) throw err;
	cb(obj);
    });
});
