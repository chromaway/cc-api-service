var server = require('./server')
var nopt = require('nopt')
var args = nopt({testnet: Boolean,
                 port: Number,
                 chromanode: String,
                 scanner: String,
                 testnetScanner: String
})
server.startService(args)

