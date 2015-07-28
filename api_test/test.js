var WalletCore = require('cc-wallet-core')
var cclib = WalletCore.cclib
var bitcoin = cclib.bitcoin
var BigInteger = require('bigi')
var request = require('request')
var nopt = require('nopt')

var args = nopt({url: String, seed: String, command: String})

var seed = args.argv.remain.shift() || args.seed
var command = args.argv.remain.shift() || args.command || 'show'

var base_uri = args.url || 'http://localhost:4444/api/'

if (!seed) {
  console.log('USAGE:')
  console.log(require('fs').readFileSync('usage.txt').toString())
  process.exit(1)
}


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
    if (err) console.log(err)
    else if (response.statusCode !== 200) {
      console.log('ERROR', response.statusCode, body)
      process.exit(1)
    } else {
      cb(null, body)
    }
  })
}

var address_key_map = {}
for (var i = 0; i < 5; i++)
  address_key_map[getaddress(i)] = genkey(i)

if (command === 'show') {
  console.log(getaddress(0))
  api_call('getUnspentCoins', {addresses: [getaddress(0)], color: ""},
    function (err, data) {
      console.log(data)
      if (data.coins.length === 0) console.log('please send some testnet bitcoins to address above')
      process.exit(0)
    })
} else {
  var params = {
    source_addresses: { "": [getaddress(0)] },
    change_address: { "": getaddress(1) },
    target: {address: getaddress(2), value: 1000},
    color_kernel: 'epobc'
  }
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

    res.input_coins.forEach(function (coin, index) {
      var key = address_key_map[coin.address]
      if (!key) {
        console.log('lack key for address ' + coin.address)
        process.exit(0)
      }
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
        process.exit(0)
      }
      console.log('broadcastTx returned this result:')
      console.log(res)
    })
  })
}
