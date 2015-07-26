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
          function (err) { res.status(500).json({error: err.toString()}) }
        );
      }
    })
  })
}

defineAPIcall('/createIssueTx', backend.createIssueTx, function (txHex) { return {tx: txHex} });
defineAPIcall('/getUnspentCoins', backend.getUnspentCoinsData, function (coins) { return {coins: coins} });
defineAPIcall('/createTransferTx', backend.createTransferTx, function (txHex) { return {tx: txHex} });

app.use('/api', api);


var nopt = require('nopt')
var args = nopt({testnet: Boolean,
                 port: Number,
                 chromanode: String});
if (!args.port) args.port = 4444;
if (!args.testnet) args.testnet = false;

var walletOpts = {
  testnet: args.testnet,
  blockchain: {name: 'Naive'},
  storageSaveTimeout: 0
};

if (args.chromanode) {
  walletOpts.connector = {opts: {url: args.chromanode}}
}

backend.initializeWallet(walletOpts, function () {
    var server = app.listen(args.port, function () {
        console.log('Listening on port %d', server.address().port);
    })
})