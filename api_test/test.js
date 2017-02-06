var WalletCore = require('cc-wallet-core')
var cclib = WalletCore.cclib
var bitcoin = cclib.bitcoin
var BigInteger = require('bigi')
var request = require('request')
var nopt = require('nopt')

var Q = require('q')
var getBtc = require('./get-btc')


var args = nopt({url: String, seed: String, command: String})

var seed = args.argv.remain.shift() || args.seed
var command = args.argv.remain.shift() || args.command || 'show'

var base_uri = args.url || 'http://localhost:4444/api/'

var address_key_map

function genkey(i) {
  var d = BigInteger.fromBuffer(bitcoin.crypto.sha256(seed + i.toString()))
  var k = new bitcoin.ECKey(d)
  return k
}

function getaddress(i) {
  return genkey(i).pub.getAddress(bitcoin.networks.testnet).toBase58Check()
}

function api_call(method, data, cb) {
  request({method: 'post', uri: base_uri + method, body: data, json: true},
  function (err, response, body) {
    if (err) {
      console.log("Post to api error:", err)
      cb(err, null);
    }
    else if (response.statusCode !== 200) {
      console.log('ERROR', response.statusCode, body)
      cb(err, null);
    } else {
      cb(null, body)
    }
  })
}

function init() {
  address_key_map = {}
  for (var i = 0; i < 5; i++)
    address_key_map[getaddress(i)] = genkey(i)
}

function show() {
  console.log(getaddress(0))
  var deferred = Q.defer()
  api_call('getUnspentCoins', {addresses: [getaddress(0)], color: ""},
    function (err, data) {
      if (err) {
        console.log('ERROR', err)
        deferred.reject(err)
      }
      else {
      console.log(data)
      if (data.coins.length === 0) console.log('please send some testnet bitcoins to address above')
      deferred.resolve(data)
      }
    })
  return deferred.promise
}

var run = function () {
  var params = {
    sourceAddresses: { "": [getaddress(0)] },
    changeAddress: { "": getaddress(1) },
    target: {address: getaddress(2), value: 1000},
    colorKernel: 'epobc'
  }
  var deferred = Q.defer()
  console.log('Create Issue Transaction:')
  console.log(params)

  api_call('createIssueTx', params, function (err, res) {
    if (err) {
      console.log('CreateIssueTx returned error:', err)
      process.exit(0)
    }
    console.log('CreateIssueTx result:', res)

    var transaction = bitcoin.Transaction.fromHex(res.tx)

    var txb = bitcoin.TransactionBuilder.fromTransaction(transaction)

    res.inputCoins.forEach(function (coin, index) {
      var key = address_key_map[coin.address]
      if (!key) {
        console.log('lack key for address ' + coin.address)
        process.exit(0)
      }
      console.log("Signing, " + coin.address, + 'at index ' + index);
      txb.sign(index, key)
    })
    var tx = txb.build()
    console.log('Transaction builder created transaction:')
    console.log(tx.toHex())

    console.log('Now broadcasting the transaction')
    api_call('broadcastTx', {tx: tx.toHex() }, function (err, res) {
      if (err) {
        console.log('broadcastTx returned an error')
        console.log(err)
        deferred.reject(err)
      } else {
        console.log('broadcastTx returned this result:')
        console.log(res)
        deferred.resolve();
      }
    })
  })
  return deferred.promise;
}

function usage() {
  console.log('USAGE:')
  console.log(require('fs').readFileSync('usage.txt').toString())
  process.exit(1)
}

function main() {
  if (!seed) {
    usage()
  }

  init()

  console.log('command:' + command);

  if (command === 'show') {
    show()
  } else {
    if (command === 'autotest') {
      return show()
             .then(function (data) {
               if (!data.coins.length) {
                 console.log('Loading BTC to ' + getaddress(0));
                 console.log(getBtc);
                 return getBtc(getaddress(0))
               }
             })
             .then(function () {
               return run()
             });
    } else {
      run()
    }
  }
}

if (global.describe) {
  describe('API-test', function() {
    this.timeout(1000 * 60 * 40); //40 minutes
    var server;
    it('main functional test', function (done) {
      var args = {
        port: 5555,
        testnet: true
      }
      server = require('../server')

      base_uri = 'http://localhost:' + args.port + '/api/';
      command = 'autotest';
      seed = 'hello' + Date.now()

      server.startService(args)
      .then(main)
      .done(function () {
        done()
      },
      function () {
        throw(new Error("Build failed"));
      }
      )
    });
    after(function () {
      server.stopService();
    });
  });
}

if (require.main === module) {
  main()
}

