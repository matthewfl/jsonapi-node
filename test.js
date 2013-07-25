var jsonapi = require('./lib');


balanced = new jsonapi('http://localhost:5000', {
    'auth': { 'user': '05c5fb90f3c611e2865c247703d288e8' },
    'headers': {'Accept-Type': 'application/vnd.balancedpayments+json; version=1.1' }
});


balanced.list('/marketplaces', function (err, obj) {
    console.log(arguments);
    obj[0].list('customers', function (err, cust) {
	console.log(arguments);
	debugger;
	console.log(JSON.stringify(cust, null, 2));
    });
    debugger;
});


/*
balanced.get('/marketplaces', function(err, obj) {
    console.log(obj.raw_obj)
    debugger;
})
*/

/*
balanced.create('/api_keys', function (err, obj) {
    console.log(arguments);
    debugger;
});
*/
