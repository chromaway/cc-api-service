var server = require('./server')
var nopt = require('nopt')
var args = nopt({testnet: Boolean,
                 port: Number,
                 chromanode: String,
                 scanner: String,
		 minfee: Number,
		 maxfee: Number,
		 feeurl: String,
		 feeinterval: Number
})
server.startService(args)

