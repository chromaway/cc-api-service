// We use the faucet kindly provided by blockcyper to get some test btc



var Q = require('q')
var request = require('request')
var WebSocket = require('ws')

var bitcoin = require("bitcoinjs-lib");
var bigi    = require("bigi");
var buffer  = require('buffer');

var rootUrl = "https://api.blockcypher.com/v1/btc/test3";
// please do not drain our test account, if you need testnet BTC use a faucet
// https://tpfaucet.appspot.com/
var source = {
  private : "1af97b1f428ac89b7d35323ea7a68aba8cad178a04eddbbf591f65671bae48a2",
  public  : "03bb318b00de944086fad67ab78a832eb1bf26916053ecd3b14a3f48f9fbe0821f",
  address : "mtWg6ccLiZWw2Et7E5UqmHsYgrAi5wqiov"
}
var key   = new bitcoin.ECKey(bigi.fromHex(source.private), true);
var dest  = null;

var post = function (url, dataString) {
  var param = {method: 'post', uri: url, body: dataString, json: false};

  var deferred = Q.defer();
  request(param,
  function (err, response, body) {
    if (err) deferred.reject(err)
    else if (response.statusCode > 203) {
      console.log('ERROR', response.statusCode, body)
      deferred.reject(body);
    } else {
      console.log('Got response:', body);
      deferred.resolve(JSON.parse(body));
    }
  })

  return deferred.promise;
  //return Q.nfcall(request, param);
};


// 0. We get a newly generated address
function logAddr(addr) {
  dest = addr;
  log("Generated new address " + dest.address)
}

// 1. Post our simple transaction information to get back the fully built transaction,
//    includes fees when required.
function newTransaction() {
  var newtx = {
    "inputs": [{"addresses": [source.address]}],
    "outputs": [{"addresses": [dest.address], "value": 12000}]
  }
  return post(rootUrl+"/txs/new", JSON.stringify(newtx));
}

// 2. Sign the hexadecimal strings returned with the fully built transaction and include
//    the source public address.
function signAndSend(newtx) {
  if (checkError(newtx)) return;

  newtx.pubkeys     = [];
  newtx.signatures  = newtx.tosign.map(function(tosign) {
    newtx.pubkeys.push(source.public);
    return key.sign(new buffer.Buffer(tosign, "hex")).toDER().toString("hex");
  });
  return post(rootUrl+"/txs/send", JSON.stringify(newtx));
}

// 3. Open a websocket to wait for confirmation the transaction has been accepted in a block.
function waitForConfirmation(finaltx) {
  if (checkError(finaltx)) return;
  var deferred = Q.defer();

  log("Transaction " + finaltx.tx.hash + " to " + dest.address + " of " +
        finaltx.tx.outputs[0].value/100000000 + " BTC sent.");

  var ws = new WebSocket("wss://socket.blockcypher.com/v1/btc/test3");

  // We keep pinging on a timer to keep the websocket alive
  var ping = pinger(ws);

  ws.onmessage = function (event) {
    if (JSON.parse(event.data).confirmations > 0) {
      log("Transaction confirmed.");
      deferred.resolve()
      ping.stop();
      ws.close();
    }
  }
  ws.onopen = function(event) {
    ws.send(JSON.stringify({filter: "event=new-block-tx&hash="+finaltx.tx.hash}));
  }
  log("Waiting for confirmation... (may take > 10 min)");
  return deferred.promise;
}

function checkError(msg) {
  if (msg.errors && msg.errors.length) {
    log("Errors occured!!/n" + msg.errors.join("/n"));
    return true;
  }
}

function pinger(ws) {
  var timer = setInterval(function() {
    if (ws.readyState == 1) {
      ws.send(JSON.stringify({event: "ping"}));
    }
  }, 5000);
  return {stop: function() { clearInterval(timer); }};
}

function log(msg) {
  console.log(msg);
}

// Chaining
// post(rootUrl+"/addrs")
//   .then(logAddr)
//   .then(newTransaction)
//   .then(signAndSend)
//   .then(waitForConfirmation);

function getSomeBTC(address) {
  dest = {
    address:address
  }
  return newTransaction()
  .then(signAndSend)
  .then(waitForConfirmation)
}

module.exports = getSomeBTC