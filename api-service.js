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

api.post('/createIssueTx', function (req, res) {
  jsonBody(req, function (error, body) {
      if (error) res.status(400).json({error: 'JSON required'})
      else {
          backend.issueCoins(body).done(
            function (txHex) { res.json({tx: txHex})},
            function (err) { res.status(500).json({error: err.toString()}) }
          );
      }
  })
})
