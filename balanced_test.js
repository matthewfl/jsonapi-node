var jsonapi = require('./lib');

var test = require('./simple_tests')

balanced = require('./balanced');

// balanced = new jsonapi('https://api.balancedpayments.com', {
//     'headers': {
// 	'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json'
//     }
// });

// function back(debug, cb) {
//     return function (err, obj) {
// 	if(debug === true) {
// 	    debugger;
// 	    if(err)
// 		console.error(err);
// 	    else
// 		cb(obj);
// 	}else{
// 	    if(err)
// 		console.error(err);
// 	    else
// 		debug(obj); // debug is type object
// 	}
//     }
// }




test('api_key', function () {
    return balanced.api_key.create().then(function(obj) {
	balanced.configure(obj.secret);
	return obj;
    });
});

test('marketplace', function (api_key) {
    return balanced.marketplace.create();
});

test('customer_create', function(marketplace) {
    //r cb = this;
    //var cus = marketplace.customers.
    //debugger;
    //return marketplace.customers.create()
    //return marketplace.create('customer');
    return marketplace.customers.create();
});

test('card_create', function (marketplace){
    return marketplace.cards.create({
	'number': '4111111111111111',
	'expiration_year': '2016',
	'expiration_month': '12'
    });
});


test('bank_account_create', function (marketplace) {
    return marketplace.bank_accounts.create({
	'routing_number': '021000021',
	'account_number': '9900000002',
	'name': 'what up',
	'type': 'checking'
    });
});


test('update_customer', function (customer_create) {
    var cb = this; customer_create.name = "testing name";
    return customer_create.save().then(function (c) {
	cb.assert(c.name == 'testing name');
    });
});

test('add_card_to_customer', function(customer_create, card_create) {
    var cb = this;
    return customer_create.add_card(card_create).then(function () {
	cb.assert(card_create.links.customer == customer_create.id);
	return card_create;
    });
});


test('add_bank_account_to_customer', function(bank_account_create, customer_create) {
    var cb = this;
    return customer_create.add_bank_account(bank_account_create)
    .then(function () {
	cb.assert(bank_account_create.links.customer == customer_create.id);
    });
});

test('debit_card', function (add_card_to_customer){
    var cb = this;
    return add_card_to_customer.debit({amount: 500});
});


test('hold_card', function (add_card_to_customer) {
    var cb = this;
    return add_card_to_customer.hold({amount: 400});
});

// test('capture_hold', function(hold_card) {
//     return hold_card.debit({});
// });
