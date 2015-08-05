var Q = require('q');
var WalletCore = require('cc-wallet-core');
var cclib = WalletCore.cclib;
var ColorTarget = cclib.ColorTarget;
var ColorValue = cclib.ColorValue;
var bitcoin = cclib.bitcoin;
var OperationalTx = WalletCore.tx.OperationalTx;
var RawTx = WalletCore.tx.RawTx;
var CoinList = WalletCore.coin.CoinList;
var transformTx = WalletCore.tx.transformTx;
var Coin = WalletCore.coin.Coin;
var inherits = require('util').inherits;
var BIP39 = require('bip39');
var _ = require('lodash')
var fs = require('fs')
var parambulator = require('parambulator')
var request = require('request')


var wallet = null;
var scannerUrl;
var coin_cache = {};

function add_coin_to_cache(coin) {
  // txid:outindex is the key
  coin_cache[coin.toString()] = coin;
}

function find_cached_coin(txid, outindex) {
  return coin_cache[txid + ":" + outindex.toString()];
}

function initializeWallet(opts, done) {
  var systemAssetDefinitions = [];

  wallet = new WalletCore.Wallet(opts);
  wallet.on('error', function (error) {
    console.log(error.stack || error);
  });
  wallet.once('syncStop', function () { done(wallet); })
}

function initializeScanner(url) {
  console.log("cc-scanner url: " + url);
  scannerUrl = url;
}

function initialize(opts, done) {
  initializeScanner(opts.scannerUrl);
  initializeWallet(opts.walletOpts, done);
}


function getScriptFromTargetData(target) {
  var target_script = target.script;
  if (!target_script) {
    var target_addr = target.address;
    if (!target_addr)
      throw new Error('neither target.script nor target.address is provided');
    target_script = bitcoin.Address.fromBase58Check(target_addr).toOutputScript().toHex();
  }
  return target_script;
}

function CustomOperationalTx(wallet, spec) {
  this.wallet = wallet
  this.spec = spec
  this.targets = []
  var self = this
  if (spec.targets)
    spec.targets.forEach(function (target) {
      var color_desc = target.color
      var colordef = wallet.getColorDefinitionManager().resolveByDesc(color_desc)

      var colorValue = new ColorValue(colordef, parseInt(target.value, 10))
      var colorTarget = new ColorTarget(getScriptFromTargetData(target), colorValue)
      self.targets.push(colorTarget)
    })
}

inherits(CustomOperationalTx, OperationalTx);

CustomOperationalTx.prototype.getChangeAddress = function (colordef) {
  var color_desc = colordef.getDesc();
  var address = this.spec.change_address[color_desc];
  if (!address)
    throw Error('Change address is not specified for color: "' + color_desc + '"');
  return address;
};

CustomOperationalTx.prototype._getCoinsForColor = function (colordef) {
  var color_desc = colordef.getDesc();

  if (!this.spec.source_addresses[color_desc])
    throw new Error('source addresses not provided for "' + color_desc + '"');

  return getUnspentCoins(this.wallet,
    this.spec.source_addresses[color_desc],
    color_desc)
  .then(function (coins) {
    console.log('got coins:', coins)
    return new CoinList(coins)
  })
};

function getUnspentCoins(context, addresses, color_desc) {
  var bc = context.getBlockchain();
  var cd = context.getColorData();

  function getTxFn(txId, cb) {
    function onFulfilled(txHex) { cb(null, bitcoin.Transaction.fromHex(txHex)) }
    function onRejected(error) { cb(error) }
    bc.getTx(txId).then(onFulfilled, onRejected)
  }

  var colordef = wallet.getColorDefinitionManager().resolveByDesc(color_desc);
  return bc.addressesQuery(addresses, {status: 'unspent'}).then(function (res) {
    return Q.all(res.unspent.map(function (unspent) {
      var cvQ = null;
      if (colordef.getColorType() === 'uncolored')
        cvQ = Q(new ColorValue(colordef, parseInt(unspent.value, 10)))
      else
        cvQ = Q.ninvoke(cd, 'getCoinColorValue',
          {txId: unspent.txid, outIndex: unspent.vount},
          colordef, getTxFn);


      var script = bitcoin.Script.fromHex(unspent.script);
      var addresses = bitcoin.util.getAddressesFromScript(script,
                                                          context.getBitcoinNetwork());
      var address = '';
      if (addresses.length === 1)
        address = addresses[0];

      return cvQ.then(function (cv) {
        if (cv === null) return null;
        var coin = new Coin({
                txId: unspent.txid,
                outIndex: unspent.vount,
                value: parseInt(unspent.value, 10),
                script: unspent.script,
                address: address
            }, {
              isAvailable: true,
              getCoinMainColorValue: cv
            });
        add_coin_to_cache(coin);
        return coin;
      })
    })).then(function (coins) {
      return _.filter(coins);
    })
  })
}

function getUnspentCoinsData (data) {
  return Q.try(function () {
    if (!data.addresses) throw new Error("requires addresses")
    if (typeof data.color === 'undefined')
      throw new Error("requires color");
    return getUnspentCoins(wallet, data.addresses, data.color);
  }).then(function (coins) {
    return Q.all(coins.map(function (coin) {
        return Q.ninvoke(coin, 'getMainColorValue', null, null).then(
          function (cv) {
            var rawCoin = coin.toRawCoin();
            delete rawCoin['address']; // TODO: detect address properly
            rawCoin.color = data.color;
            rawCoin.color_value = cv.getValue();
            return rawCoin
          })
    }))
  })
}


var createTransferTxParamCheck = parambulator(
  {
    required$: ['targets','source_addresses', 'change_address'],
    targets: {
      type$:'array',
      '**': {
        'address': { type$:'string' },
        'color': { type$:'string' },
        'value': {  type$:'integer' }
      }
    },
    source_addresses: {
      '*': {type$: 'array'}
    },
    change_address: {
      '*': {type$: 'string'}
    }
  }
)

function validateParams(data, paramCheck) {
  var deferred = Q.defer()
  var callback = deferred.makeNodeResolver()
  paramCheck.validate(data, callback)
  return deferred.promise;
}

function createTransferTx(data) {
  return validateParams(data, createTransferTxParamCheck)
  .then(function () {
      var opTxS = new CustomOperationalTx(wallet, data);
      return Q.nfcall(transformTx, opTxS, 'composed', {})
    })
  .then(function (composedTx) {
      return Q.nfcall(transformTx, composedTx, 'raw', {}).then(function (tx) {
               return {
                 tx: tx.toHex(true),
                 input_coins: composedTx.getTxIns().map(function (txin) {
                   var coin = find_cached_coin(txin.txId, txin.outIndex);
                   if (coin) return coin.toRawCoin();
                   else return null;
               })
             }
    })
  })
}

function createIssueTx(data) {
  return Q.try(function () {
    if (data.targets && !data.target) {
      if (data.targets.length > 1 || data.targets.length == 0) throw new Error('issuance transaction should have a single target');
      data.target = data.targets[0];
      delete data['targets'];
    }
    if (data.targets) throw new Error('both target and targets fields are set');
    if (!data.target) throw new Error('no target provided');

    var opTxS = new CustomOperationalTx(wallet, {
        source_addresses: data.source_addresses,
        change_address: data.change_address
    });
    opTxS.addTarget(new ColorTarget(
        getScriptFromTargetData(data.target),
        new ColorValue(cclib.ColorDefinitionManager.getGenesis(), // genesis output marker
                       parseInt(data.target.value, 10))));
    if (data.color_kernel !== 'epobc') throw new Error('only epobc kernel is supported')
    var cdefCls = cclib.ColorDefinitionManager.getColorDefenitionClsForType('epobc');
    console.log('compose...')
    return Q.nfcall(cdefCls.composeGenesisTx, opTxS).then(function (composedTx) {
        console.log('transforming to raw...')
        return Q.nfcall(transformTx, composedTx, 'raw', {}).then(function (tx) {
          console.log('done');
          return { tx: tx.toHex(true),
                   input_coins: composedTx.getTxIns().map(function (txin) {
                       var coin = find_cached_coin(txin.txId, txin.outIndex);
                       if (coin) return coin.toRawCoin();
                       else return null;
                   })
                 }
        })
    })
  })
}

var getAllColoredCoinsParamCheck = parambulator(
  {
    required$: ['color_desc'],
    color_desc: {type$: 'string'},
    unspent: {type$: 'boolean'}
  }
)

function getAllColoredCoins(data) {
//  getAllColoredCoins, basically just call cc-scanner API getAllColoredCoins.
//
//  Additionally, caller might request only unspent coins (using 'unspent' parameter), in that case we need to additionally filter coins using chromanode /transactions/unspent API
//
//  cc-scanner API example (all Cuber transactions):
//
//  http://scanner-btc.chromanode.net/api/getAllColoredCoins?color_desc=epobc:a254bd1a4f30d3319b8421ddeb2c2fd17893f7c6d704115f2cb0f5f37ad839af:0:0
  return validateParams(data, getAllColoredCoinsParamCheck)
  .then(function () {
           var color_desc = data.color_desc
           var deferred = Q.defer()
           var url = scannerUrl + 'getAllColoredCoins?color_desc=' + color_desc
           request(url,
             function (error, response, body) {
               if (error) {
                 deferred.reject(error);
               }
               if (response.statusCode == 200) {
                 var unspent = data.unspent
                 if (unspent) {
                   deferred.reject(
                     new Error('NOT IMPLEMENTED YET'))
                 }
                 deferred.resolve(JSON.parse(body));
               } else {
                 console.error('cc-scanner returned this:' + body);
                 deferred.reject(
                   new Error('cc-scanner returned status:' + response.statusCode))
               }
             })
           return deferred.promise;
  })
}

function broadcastTx(data) {
  // chromanode returns from transaction/send sooner than it adds
  // transaction to database, which is undesirable for a high-level API,
  // so we wait until it is added to chromanode's DB

  return Q.try(function () {
      var bc = wallet.getBlockchain();
      var txid = bitcoin.Transaction.fromHex(data.tx).getId();
      return bc.sendTx(data.tx).then(function () {
          console.log('sent tx to chromanode, waiting for it to appear...')
          return Q.Promise(function (resolve, reject) {
              var tries = 0;
              function dotry () {
                console.log("polling " + txid + " " + tries);
                tries += 1;
                if (tries > 120) { // give up after 2 minutes
                  reject(new Error('timeout waiting for chromanode to accept ' + txid))
                  return
                }
                bc.getTxBlockHash(txid).done(resolve, function () {
                    Q.delay(1000).done(dotry)
                })
              }
              dotry();
          })
      })
  })
}

module.exports = {
  initialize: initialize,
  createIssueTx: createIssueTx,
  createTransferTx: createTransferTx,
  getUnspentCoinsData: getUnspentCoinsData,
  getAllColoredCoins: getAllColoredCoins,
  broadcastTx: broadcastTx
}