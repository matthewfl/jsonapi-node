var jsonapi = require('./lib');

var test = require('./simple_tests')

balanced = new jsonapi('http://localhost:5000', {
    'headers': {
	'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json'
    }
});

function back(debug, cb) {
    return function (err, obj) {
	if(debug === true) {
	    debugger;
	    if(err)
		console.error(err);
	    else
		cb(obj);
	}else{
	    if(err)
		console.error(err);
	    else
		debug(obj); // debug is type object
	}
    }
}


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
	if(err) console.error(err)
	else cb(obj);
    });
});

test('customer_create', function(marketplace) {
    var cb = this;
    marketplace.create('customer', function(err, obj) {
	if(err) console.error(err)
	else cb(obj);
    });
});

test('card_create', function (marketplace){
    var cb = this;
    marketplace.create('card',
		       {
			   'number': '4111111111111111',
			   'year': '2016',
			   'month': '12'
		       },
		       function (err, obj){
			   if(err) console.error(err)
			   else cb(obj);
    });
});


test('bank_account_create', function (marketplace) {
    var cb = this;
    marketplace.create('bank_account', {
	'routing_number': '021000021',
	'account_number': '9900000002',
	'name': 'what up',
	'type': 'checking'
    }, function (err, obj){
	if(err) console.log(err);
	else cb(obj)
    });
});


test('update_customer', function (customer_create) {
    var cb = this;
    customer_create.name = "testing name";
    debugger;
    customer_create.save(function(err, obj) {
	cb.assert(obj.name == "testing name");
	cb();
    });
});

test('add_card_to_customer', function(customer_create, card_create) {
    var cb = this;
    customer_create.add_card({card: card_create}, function(err, obj) {
	// debugger;
	// the obj is the card that was added
	if(err) console.error(err)
	else cb(customer_create);
    });
});


test('add_bank_account_to_customer', function(bank_account_create, customer_create) {
    var cb = this;
    customer_create.add_bank_account({bank_account: bank_account_create}, function (err, obj){
	if(err) console.error(err);
	else cb();
    });

});

test('debit_customer', function (add_card_to_customer){
    var cb = this;
    add_card_to_customer.debit({amount: 500}, function (err, obj){
	//debugger;
	if(err)
	    console.error(err);
	else
	    cb(obj);
    });
});


test('hold_customer', function (add_card_to_customer) {
    var cb = this;
    add_card_to_customer.hold({amount: 400}, back(cb));
});

test('capture_hold', function(hold_customer) {
    var cb = this;
    debugger;
    hold_customer.debit({}, back(true, cb));
});
