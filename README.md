# cc-api-service


Provides a REST API for ChromaWallet colored coin libraries: construct transactions, broadcast transactions, query data.

Run:

    npm install
    node api-service.js --port 4444 --testnet

Test:

See [instructions](#test-script)


[![Build Status](https://travis-ci.org/chromaway/cc-api-service.svg?branch=master)](https://travis-ci.org/chromaway/cc-api-service) [![Coverage Status](https://coveralls.io/repos/chromaway/cc-api-service/badge.svg?branch=master&service=github)](https://coveralls.io/github/chromaway/cc-api-service?branch=master) [![Dependency status](https://david-dm.org/chromaway/cc-api-service/status.png)](https://david-dm.org/chromaway/cc-api-service#info=dependencies&view=table) [![Dev Dependency Status](https://david-dm.org/chromaway/cc-api-service/dev-status.png)](https://david-dm.org/chromaway/cc-api-service#info=devDependencies&view=table)

Developer fork:

* Hankhero

[![Build Status](https://travis-ci.org/hankhero/cc-api-service.svg?branch=master)](https://travis-ci.org/hankhero/cc-api-service) [![Coverage Status](https://coveralls.io/repos/hankhero/cc-api-service/badge.svg?branch=master&service=github)](https://coveralls.io/r/hankhero/cc-api-service?branch=master) [![Dependency status](https://david-dm.org/hankhero/cc-api-service/status.png)](https://david-dm.org/hankhero/cc-api-service#info=dependencies&view=table) [![Dev Dependency Status](https://david-dm.org/hankhero/cc-api-service/dev-status.png)](https://david-dm.org/chromaway/cc-api-service#info=devDependencies&view=table)


## Command-line options

Parameter      | Meaning
---------------|------------------------------------
port           | service port, defaults to 4444
testnet        | testnet or mainnet mode, defaults to mainnet
chromanode     | chromanode URL, defaults to v1.livenet.bitcoin.chromanode.net
scanner        | cc-scanner URL, defaults to http://scanner-btc.chromanode.net/api/ or http://scanner-tbtc.chromanode.net/api/ for the testnet


## API calls

### General conventions

Methods should be called using HTTP POST. Data should be encoded in JSON. Response is JSON-encoded. Transaction ids and transactions are hex-encoded. Server will respond with HTTP status 400 if request is not understood and HTTP status 500 in case of an error.

Call which construct transactions (`createIssueTx`, `createTransferTx`) accept 'transaction spec' which includes source addresses (or source coins) and targets.

Colors are identified using color descriptors such as `epobc:<txid>:0:0`, an empty string "" stands for uncolored bitcoins.

`sourceAddresses` is an associative array providing a list of addresses for each color, e.g.

     "sourceAddresses": {
        "": ["mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo"],
        "epobc:b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb:0:180679": 
             ["mz6WNJtK5UKGWP4L7Fp2wH25SbMzrxyM3k"]
      }

Indicates that uncolored coins should be taken from address `mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo`, while colored ones should come from `mz6WNJtK5UKGWP4L7Fp2wH25SbMzrxyM3k`.
Both P2KH (ordinary) and P2SH addresses are supported. (At least I hope so, never tried...)

Alternatively, inputs can be specified using `sourceCoins`, which gives more fine-grained control compared `sourceAddresses`, which might be relevant to applications which manage their own wallet UTXO set. For each color involved in the transaction either `sourceCoins` or `sourceAddresses` should be provided, it is not permissible to provide both of them for a single color. A coin can be identified by txId and outIndex:

     "sourceCoins": {
        "epobc:b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb:0:0": 
             [{txId: "b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb", outIndex: 0}]
        }
      

`changeAddress` should provide a single address for each color used in a transaction. Change address needs to be provided only in case of a partial spend.

`targets` is an array of targets, that is, outputs transaction should have. Each target should include following fields:

name | description
-----|------------
color| color descriptor, use "" for uncolored bitcoins
value| number of atoms which should be sent (satoshis in case of uncolored coins)
address| receiver's address (if script is not provided)
script | (optional) output's scriptPubKey, can be used instead of address

`createIssueTx` and `createTransferTx` return a list of used coins for convenience (in addition to an hex-encoded unsigned transaction). E.g:

     "inputCoins":
    [{"txId":"c7995236f2a7bf163c03e1bbf6207eee9586a5a7986e796529111dfaf8ce9721",
      "outIndex":1,
      "value":1535290,
      "script":"76a9145efe254d5f7ba5fafdcdba1b5cc1d4a0887279b088ac",
      "address":"mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo"}]}


### createIssueTx

`POST /api/createIssueTx`

Creates an unsigned issue transaction.

Necessary fields:

name | description
-----|------------
sourceAddresses | bitcoin source
changeAddress | address used for a change if coins are not spent fully
target | should include "address" (or "script") and "value"
colorKernel | should be "epobc"

[Sample input](api_samples/createIssueTx.json).

Sample output  (shortened):

     {"tx":"01000.....ac00000000",
      "inputCoins":[{
        "txId":"4ce9c88ac9efe6a8552d583af80d9473c88a3f74ae48f19a61719facf8ce3a43",
        "outIndex":1,
        "value":1639175,
        "script":"76a9145efe254d5f7ba5fafdcdba1b5cc1d4a0887279b088ac",
        "address":"mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo"
     }]}

### createTransferTx

`POST /api/createTransferTx`

Creates an unsigned transfer transaction.

Necessary fields:

name | description
-----|------------
sourceAddresses | source for bitcoins and colored coins
changeAddress | address used for a change if coins are not spent fully
targets | see description in 'General conventions' section

[Sample input](api_samples/createTransferTx.json).

Sample output: similar to output of `createIssueTx`.

Note: createTransferTx might take significant amount of time as service will compute coloring on demand. Make sure that HTTP client timeouts are high enough. Future versions of API will be faster due to pre-computing of coloring.

### broadcastTx

`POST /api/broadcastTx`

Broadcast a signed transaction.  Returns only when transaction is sent
to bitcoind and indexed by chromanode. Might take up to 15 seconds
(current chromanode limitations), time outs after 2 minutes.

Parameters:

name | description
-----|------------
tx   | a transaction in hex

Sample input (shortened): `{"tx":"01000.....ac00000000"}`
Sample output: `{"success": true}`

### getUnspentCoins

`POST /api/getUnspentCoins``

Can be used to obtain information about unspent coins for a specific address and color. Useful for computing current balance.

Parameters:

name | description
-----|------------
addresses | a list of addresses
color | color descriptor, "" for uncolored bitcoins

Note: When a proper color descriptor is provided, returns only coins of that color (TODO).
If "" is provided, returns _all_ coins, both colored and uncolored, and reports uncolored value.

This can be a problem if applications uses same address both for colored and uncolored coins.

Future versions will allow retrieving data for all colors at once, also correctly differentiate colored/uncolored coins. (Requires migration to coloredcoinjs-lib v4).

[Sample input](api_samples/getUnspentCoins.json)

Sample output:

    {"coins":
       [{"txId":"749699eca1f0ec58d9cc770e52f1efc3bb690bbee84ea728c700f877c90f340f",
         "outIndex":1,
         "value":818000,
         "address":"mz6WNJtK5UKGWP4L7Fp2wH25SbMzrxyM3k",
         "script":"76a914cbcac3ac056fbfddab68ff4c6cae976ad74e238d88ac",
         "color":"epobc:b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb:0:180679",
         "colorValue":818000}]}
         
Note: "value" is bitcoin value of output, "colorValue" is colorvalue
for "color".

### getTxColorValues

`POST /api/getTxColorValues`

Get information about colors of outputs of a specific transaction.

Parameters:

name       | description
-----------|------------
txId      | transaction id
outIndices | (optional) query specific output indices only
outIndex | (optiona) query specific output index

[Sample input](api_samples/getTxColorValues.json)


Sample output: 

     {"colorValues":
       [null,
        {"color":"epobc:b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb:0:0","value":818000},
        null]
     }

Output is either an array with one element for each of transaction's outputs, or null (in case there none of requested outputs are colored).
`null` is used for uncolored outputs and outputs which weren't requested.

(In the example above, output `0` is actually colored, but it is returned as `null` because only data for output `1` was requested.

### getTx

`GET /api/getTx?txId=<...>`

Returns a transaction in hex form. Output is of form `{"tx": "<tx hex>"}`.


### getAllColoredCoins

`GET /api/getAllColoredCoins?color=<...>`

Get all colored-coins, or get all unspent colored-coins

Parameters:

name       | description
-----------|------------
color      | color descriptor
unspent    | 'true' or 'false', optional.

If unspent=true is specified, then we remove spent transactions.

Sample query:

    http://localhost:4444/api/getAllColoredCoins?color=epobc:a254bd1a4f30d3319b8421ddeb2c2fd17893f7c6d704115f2cb0f5f37ad839af:0:0&unspent=true
    
Sample output:

    {"coins":[
      {"txid":"76e021a920439bdb237fd259642524f335dc2ff60422f57a2e851c63a236976a","oidx":1,"value":"900"},
      {"txid":"e2ee8713507898e41d20cbd10fb617b57e3f7bca127a5ac8c1198277a4a67eec","oidx":0,"value":"1000"}]}



## Samples

In `api_samples` directory you can find sample input data and a script to run it against the service. E.g.

    $ node run.js createIssueTx
    
You can also provide custom JSON file:

    $ node run.js createIssueTx my-issue-tx-spec.json
    
Script assumes that service is accessible via http://localhost:4444/

## Test script

Test script contains code which issues new colors, signs and broadcasts transactions, etc.

See [usage](https://github.com/chromaway/cc-api-service/blob/master/api_test/usage.txt).

Script assumes that service is accessible via http://localhost:4444/
