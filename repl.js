var jsonapi = require('./lib');
var repl = require('repl');

var r = repl.start("balanced> ");

balanced = new jsonapi('http://localhost:5000', {
			       'headers': {
				   'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json'
			       }
});

r.context.balanced = balanced;

function dump(err, value) {
    console.log('dump '+dump.len+' recieved');
    dump.last = dump[dump.len++] = value;
}

dump.len = 0;

r.context.dump = dump;


balanced.create('api_keys', function (err, obj) {
    if(err) throw err;
    balanced.request_args.auth = {'user': obj.secret};
    balanced.create('marketplaces', function(err, obj) {
	if(err) throw err;
	r.context.marketplace = obj;
    });
});
