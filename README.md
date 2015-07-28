# cc-api-service

Provides a REST API for ChromaWallet colored coin libraries: construct transactions, broadcast transactions, query data.

Run:

    npm install
    node api-service.js --port 4444 --testnet


## Command-line options

Parameter | Meaning
-------------------
port      | service port, defaults to 4444
testnet   | testnet or mainnet mode, defaults to mainnet
chromanode| chromanode URL, defaults to v1.livenet.bitcoin.chromanode.net

## API calls

### General conventions

Methods should be called using HTTP POST. Data should be encoded in JSON. Response is JSON-encoded. Transaction ids and transactions are hex-encoded. Server will respond with HTTP status 400 if request is not understood and HTTP status 500 in case of an error.

Call which construct transactions (`createIssueTx`, `createTransferTx`) accept 'transaction spec' which includes source addresses and targets.

Colors are identified using color descriptors such as `epobc:<txid>:0:0`, an empty string "" stands for uncolored bitcoins.

`source_addresses` is an associative array providing a list of addresses for each color, e.g.

     "source_addresses": {
        "": ["mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo"],
        "epobc:b95323a763fa507110a89ab857af8e949810cf1e67e91104cd64222a04ccd0bb:0:180679": 
             ["mz6WNJtK5UKGWP4L7Fp2wH25SbMzrxyM3k"]
      }

Indicates that uncolored coins should be taken from address `mpBEGSTSuNeGtKiXqo3V4CocHx8vWSF3Mo`, while colored ones should come from `mz6WNJtK5UKGWP4L7Fp2wH25SbMzrxyM3k`.
Both P2KH (ordinary) and P2SH addresses are supported. (At least I hope so, never tried...)

`change_address` should provide a single address for each color used in a transaction. Change address needs to be provided only in case of a partial spend.

