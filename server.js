var Q = require('q');
var express = require('express');
var jsonBody = require('body/json');
var sendJson = require('send-data/json');
var cors = require('cors');
var logger = require('morgan');
var backend = require('./backend')

var app = express();

var cors_options = {origin: true, credentials: true};
app.use(logger());
app.use(cors(cors_options));
app.options('*', cors(cors_options));

var api = express.Router();

function defineAPIcall(name, computeFn, formatFn) {
  api.post(name, function (req, res) {
    jsonBody(req, function (error, body) {
      if (error) res.status(400).json({error: 'JSON required'})
      else {
        computeFn(body).done(
          function (result) { res.json(formatFn(result))},
          function (err) {
            console.error("Error in api-call:" + name, err)
            res.status(500).json({error: err.toString()}) 
          }
        );
      }
    })
  })
}

function identity (x) { return x }

defineAPIcall('/createIssueTx', backend.createIssueTx, identity);
defineAPIcall('/getUnspentCoins', backend.getUnspentCoinsData, function (coins) { return {coins: coins} });
defineAPIcall('/createTransferTx', backend.createTransferTx, identity);
defineAPIcall('/broadcastTx', backend.broadcastTx, function () { return {success: true} });

app.use('/api', api);

var startService = function (args) {
  var deferred = Q.defer()
  var walletOpts = {
    testnet: args.testnet,
    blockchain: {name: 'Naive'},
    storageSaveTimeout: 0
  };

  if (!args.port) args.port = 4444;
  if (!args.testnet) args.testnet = false;

  if (args.chromanode) {
    walletOpts.connector = {opts: {url: args.chromanode}}
  }

  backend.initializeWallet(walletOpts, function () {
    var server = app.listen(args.port, function () {
                   console.log('Listening on port %d', server.address().port);
                   deferred.resolve();
                 })
  })
  return deferred.promise
}

module.exports = {
  startService: startService
}