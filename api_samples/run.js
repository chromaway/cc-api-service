var request = require('request');
var fs = require('fs')

var base_uri = "http://localhost:4444/api/";

if (process.argv.length < 3) { throw new Error('command not provided') }

var command = process.argv[2];
var filename = command + ".json";

if (process.argv.length >= 4)
  filename = process.argv[3];

var data = fs.readFileSync(filename);

request({method: 'post', uri: base_uri + command, body: data},
  function (err, response, body) {
    if (err) console.log(err);
    else if (response.statusCode !== 200) {
      console.log('ERROR', response.statusCode, body);
    } else {
      console.log(body)
    }
    process.exit(0)
  })
  

