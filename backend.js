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
var tsmbackend = require('./tsmbackend')

var wallet = null;
var scannerUrl;
var chromaNodeUrl;
var coin_cache = {};

function add_coin_to_cache(coin) {
  // txId:outIndex is the key
  coin_cache[coin.toString()] = coin;
}

function find_cached_coin(txId, outIndex) {
  return coin_cache[txId + ":" + outIndex.toString()];
}

function initializeWallet(opts, done) {
  var systemAssetDefinitions = [];

  wallet = new WalletCore.Wallet(opts);
  wallet.on('error', function (error) {
    console.log(error.stack || error);
  });
  tsmbackend.setWallet(wallet)
  wallet.once('syncStop', function () { done(wallet); })
}

function initializeScanner(url) {
  console.log("cc-scanner url: " + url);

  scannerUrl = url;
}

function initialize(opts, done) {
  initializeScanner(opts.scannerUrl);
  initializeWallet(opts.walletOpts, done);

  // Temporary solution until v2 of api is deployed correctly.
  // Then we could do something like this instead
  // Add a package dependency:
  //     "blockchain-js": "git://github.com/chromaway/blockchainjs.git",
  //
  // var urlList = require('blockchainjs').connector.Chromanode.getSources('livenet')
  // chromaNodeUrl = urlList[0];
  //
  chromaNodeUrl = 'http://136.243.23.208:25002'; //TODO DO THIS FOR REAL
  if (opts.testnet)
    chromaNodeUrl = 'http://136.243.23.208:25001'; //TODO DO THIS FOR REAL

  console.log('WARNING and TODO: This version hase a hardcoded chromaNodeUrl: ' + chromaNodeUrl);

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
      var colorDesc = target.color
      var colordef = wallet.getColorDefinitionManager().resolveByDesc(colorDesc)

      var colorValue = new ColorValue(colordef, parseInt(target.value, 10))
      var colorTarget = new ColorTarget(getScriptFromTargetData(target), colorValue)
      self.targets.push(colorTarget)
    })
}

inherits(CustomOperationalTx, OperationalTx);

CustomOperationalTx.prototype.getChangeAddress = function (colordef) {
  var color_desc = colordef.getDesc();
  var address = this.spec.changeAddress[color_desc];
  if (!address)
    throw Error('Change address is not specified for color: "' + color_desc + '"');
  return address;
};

CustomOperationalTx.prototype._getCoinsForColor = function (colordef) {
  var color_desc = colordef.getDesc();
  var self = this;

  var sourceAddresses = this.spec.sourceAddresses || {}
  var sourceCoins = this.spec.sourceCoins || {}

  if (!sourceAddresses[color_desc] && 
      !sourceCoins[color_desc])
    throw new Error('source addresses/coins are not provided for "' + color_desc + '"');

  if (sourceCoins[color_desc] && sourceAddresses[color_desc])
    throw new Error('either source addresses or coins need to be specified, not both, for "' + color_desc + '"');

  if (sourceCoins[color_desc]) {
    var coinsQ = Q.all(sourceCoins[color_desc].map(
      function (outpoint) {
        return fetchCoin(self.wallet, color_desc, outpoint).then(function (coin) {
          if (!coin) throw new Error('color mismatch in source coins for  "' + color_desc + '"');
          return coin
        })
      }))
    return coinsQ.then(function (coins) {
      return new CoinList(coins)
    })    
  } 
  else return getUnspentCoins(this.wallet,
    sourceAddresses[color_desc],
    color_desc)
  .then(function (coins) {
    console.log('got coins:', coins)
    return new CoinList(coins)
  })
};

function makeCoin(context, colordef, rawCoin) {
  if (!rawCoin.address) { // let's try to figure out address
    var script = bitcoin.Script.fromHex(rawCoin.script)
    var addresses = bitcoin.util.getAddressesFromScript(
      script, context.getBitcoinNetwork());
    if (addresses.length === 1)
      rawCoin.address = addresses[0];
  }
  // figure out color value
  var cvQ = null;
  if (colordef.getColorType() === 'uncolored')
    cvQ = Q(new ColorValue(colordef, rawCoin.value))
  else {
    var bc = context.getBlockchain()
    var cd = context.getColorData()
    function getTxFn(txId, cb) {
      function onFulfilled(txHex) { cb(null, bitcoin.Transaction.fromHex(txHex)) }
      function onRejected(error) { cb(error) }
      bc.getTx(txId).then(onFulfilled, onRejected)
    }
    cvQ = Q.ninvoke(cd, 'getCoinColorValue',
      rawCoin, colordef, getTxFn);
  }
  
  return cvQ.then(function (cv) {
    if (cv === null) return null;
    var coin = new Coin(rawCoin, { 
      isAvailable: true,
      getCoinMainColorValue: cv
    });
    
    // check if coins are colored when uncolored requested
    if (colordef.getColorType() === 'uncolored') {
      return getTxColorValues({txId: rawCoin.txId, 
                               outputs: [rawCoin.outIndex]})
        .then(function (result) {
            if (result.colorvalues) {
              return null
            } else {
              add_coin_to_cache(coin)
              return coin
            }
        })
    } else {
      add_coin_to_cache(coin)
      return coin
    }
  })  
}

function fetchCoin(context, color_desc, outpoint) {
  var bc = context.getBlockchain();
  var colordef = context.getColorDefinitionManager().resolveByDesc(color_desc);
  return bc.getTx(outpoint.txId).then(function (rawtx) {
    var tx = bitcoin.Transaction.fromHex(rawtx)
    var output = tx.outs[outpoint.outIndex]
    return makeCoin(context, colordef,
                    {txId: outpoint.txId,
                     outIndex: outpoint.outIndex,
                     value: output.value,
                     script: output.script.toHex()
                    })
  })
}

function getUnspentCoins(context, addresses, color_desc) {
  var bc = context.getBlockchain();
  var colordef = context.getColorDefinitionManager().resolveByDesc(color_desc);
  return bc.addressesQuery(addresses, {status: 'unspent'}).then(function (res) {
    return Q.all(res.unspent.map(function (unspent) {
      return makeCoin(context, colordef, {
              txId: unspent.txid,
              outIndex: unspent.vount,
              value: parseInt(unspent.value, 10),
              script: unspent.script
            })
    })).then(function (coins) {
      return _.filter(coins);
    })
  })
}


function validateParams(data, paramCheck) {
  var deferred = Q.defer()
  var callback = deferred.makeNodeResolver()
  paramCheck.validate(data, callback)
  return deferred.promise;
}


var getUnspentCoinsParamCheck = parambulator(
  {
    required$: ['color', 'addresses'],
    addresses: {
      type$: 'array',
      '*': {type$: 'string'}
    },
    color: {
      type$: 'string'
    }
  }
)

function getUnspentCoinsData (data) {
  return validateParams(data, getUnspentCoinsParamCheck)
  .then(function () {
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
    required$: ['targets'],
    targets: {
      type$:'array',
      '**': {
        'address': { type$:'string' },
        'color': { type$:'string' },
        'value': {  type$:'integer' }
      }
    },
    sourceCoins: {
      type$: 'object',
      '*': {type$: 'array'}
    },
    sourceAddresses: {
      type$: 'object',
      '*': {type$: 'array'}
    },
    changeAddress: {
      type$: 'object',
      '*': {type$: 'string'}
    }
  }
)

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

var createIssueTxParamCheck = parambulator(
  {
    required$: ['target', 'colorKernel'],
    target: {
      required$: ['value'],
      'address': { type$:'string' },
      'script': { type$:'string' },
      'value': {  type$:'integer' }
    },
    sourceAddresses: {
      type$: 'object',
      '*': {type$: 'array'}
    },
    sourceCoins: {
      type$: 'object',
      '*': {type$: 'array'}
    },
    changeAddress: {
      type$: 'object',
      '*': {type$: 'string'}
    },
    colorKernel: {
      type$:'string',
      eq$: 'epobc'
    }
  }
)

function createIssueTx(data) {
  return validateParams(data, createIssueTxParamCheck)
  .then(function () {
    if (data.targets && !data.target) {
      if (data.targets.length > 1 || data.targets.length == 0) throw new Error('issuance transaction should have a single target');
      data.target = data.targets[0];
      delete data['targets'];
    }
    if (data.targets) throw new Error('both target and targets fields are set');
    if (!data.target) throw new Error('no target provided');

    var opTxS = new CustomOperationalTx(wallet, data);
    opTxS.addTarget(new ColorTarget(
        getScriptFromTargetData(data.target),
        new ColorValue(cclib.ColorDefinitionManager.getGenesis(), // genesis output marker
                       parseInt(data.target.value, 10))));
    if (data.colorKernel !== 'epobc') throw new Error('only epobc kernel is supported')
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

function checkUnspent(tx) {
  var txId = tx.txId;
  var outIndex = tx.outIndex;
  var value = tx.colorValue;

  var path = '/v2/transactions/spent'
  var query = '?otxid=' + txId +'&oindex=' + outIndex;
  var url = chromaNodeUrl + path + query;

  var deferred = Q.defer()

  request(url,
    function (error, response, body) {
      if (error) {
        deferred.reject(error);
      }
      if (response.statusCode == 200) {
        var answer = JSON.parse(body)
        if (answer.status !== 'fail') {
          var spent = answer.data.spent
          deferred.resolve(spent ? null : tx);
          return
        }
      }
      deferred.reject(
        new Error('ChromaNode error at:' + url
                 + ' , code:' + response.statusCode))
    })
  return deferred.promise;
}

function filterUnspent(data) {
  var txList = data.coins || [];
  return Q.all(_.map(txList, checkUnspent))
  .then(function(newTxList) {
    return {
      coins: _.compact(newTxList)
    }
  })
};

var getTxColorValuesParamCheck = parambulator(
  {
    required$: ['txId'],
    txId: {type$: 'string'},
    outputs: {type$:'array'}
  }
)

function getTxColorValues(data) {
  //  getTxColorValues, basically just call cc-scanner API getTxColorValues.
  return validateParams(data, getTxColorValuesParamCheck)
  .then(function () {
    var deferred = Q.defer()

    request({
        method: 'post', 
        uri: scannerUrl + 'getTxColorValues', 
        body: data, json: true
    }, function (error, response, body){
      if (error) {
        deferred.reject(error);
        return
      }
      if (response.statusCode == 200) {
        deferred.resolve(body);
      } else {
        console.error('cc-scanner returned this:' + body);
        deferred.reject(
          new Error('cc-scanner returned status:' + response.statusCode))
      }
    })
    return deferred.promise;
  })
}
var getAllColoredCoinsParamCheck = parambulator(
  {
    required$: ['color'],
    color: {type$: 'string'},
    unspent: {type$: 'string', enum$:['true','false']}
  }
)

function getAllColoredCoins(data) {
//  getAllColoredCoins, basically just call cc-scanner API getAllColoredCoins.
//
//  Additionally, caller might request only unspent coins (using 'unspent' parameter),
//  in that case we need to additionally filter coins using chromanode /transactions/spent API
//
  return validateParams(data, getAllColoredCoinsParamCheck)
  .then(function () {
           var color_desc = data.color
           var deferred = Q.defer()
           var url = scannerUrl + 'getAllColoredCoins?color_desc=' + color_desc
           request(url,
             function (error, response, body) {
               if (error) {
                 deferred.reject(error);
               }
               if (response.statusCode == 200) {
                 var unspent = (data.unspent === 'true')
                 var answer = JSON.parse(body)
                 if (unspent) {
                   filterUnspent(answer)
                   .fail(function (reason) {
                     deferred.reject(reason)
                   })
                   .done(function (filtered) {
                     deferred.resolve(filtered);
                   })
                 } else {
                   deferred.resolve(answer);
                 }
               } else {
                 console.error('cc-scanner returned this:' + body);
                 deferred.reject(
                   new Error('cc-scanner returned status:' + response.statusCode))
               }
             })
           return deferred.promise;
  })
}

var broadcastTxParamCheck = parambulator(
  {
    required$: ['tx'],
    tx: {type$: 'string'}
  }
)

function getTx(data) {
  return wallet.getBlockchain().getTx(data.txId)
}


function broadcastTx(data) {
  // chromanode returns from transaction/send sooner than it adds
  // transaction to database, which is undesirable for a high-level API,
  // so we wait until it is added to chromanode's DB
  return validateParams(data, broadcastTxParamCheck)
  .then(function () {
      var bc = wallet.getBlockchain();
      var txId = bitcoin.Transaction.fromHex(data.tx).getId();
      return bc.sendTx(data.tx).then(function () {
          console.log('sent tx to chromanode, waiting for it to appear...')
          return Q.Promise(function (resolve, reject) {
              var tries = 0;
              function dotry () {
                console.log("polling " + txId + " " + tries);
                tries += 1;
                if (tries > 120) { // give up after 2 minutes
                  reject(new Error('timeout waiting for chromanode to accept ' + txId))
                  return
                }
                bc.getTxBlockHash(txId).done(resolve, function () {
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
  getTxColorValues: getTxColorValues,
  getTx: getTx,
  broadcastTx: broadcastTx
}
