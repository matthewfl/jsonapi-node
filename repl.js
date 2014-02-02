var jsonapi = require('./lib');
var repl = require('repl');

var r = repl.start("balanced> ");

balanced = new jsonapi('https://api.balancedpayments.com', {
    'headers': {
	'Accept': 'application/vnd.balancedpayments+json; version=1.1, application/vnd.api+json',
	'User-Agent': 'node-jsonapi-repl/0'
    }
});

r.context.balanced = balanced;

function dump(err, value) {
    console.log('dump '+dump.len+' recieved');
    dump.last = dump[dump.len++] = value;
}

dump.len = 0;

r.context.dump = dump;

balanced.request_args.auth = {'user': balanced.create('api_keys').get('secret'), 'pass': ''};
r.context.marketplace = balanced.create('marketplaces');
