/* global describe, it, afterEach, beforeEach */

var expect = require('chai').expect
var tsmb = require('../tsmbackend')
var blockchainjs = require('blockchainjs')
var errors = blockchainjs.errors
var Q = require('q')

/**
 * @param {Error} error
 * @throws {Error}
 */
function ignoreConnectorErrors (err) {
  if (err instanceof errors.Connector.NotConnected ||
      err instanceof errors.Connector.Unreachable) {
    return
  }

  throw err
}


describe('TSM backend', function () {
  this.timeout(30 * 1000)

  var connector
  var blockchain

  beforeEach(function (done) {
    connector = new blockchainjs.connector.Chromanode({networkName: 'testnet'})
    connector.on('error', ignoreConnectorErrors)
    connector.connect()
    blockchain = new blockchainjs.blockchain.Naive(connector, {networkName: 'testnet'})
    blockchain.on('error', ignoreConnectorErrors)
    tsmb.setWallet({getBlockchain: function () {return blockchain}})
    blockchain.on('newBlock', function () { done() })
  })

  afterEach(function (done) {
    connector.once('disconnect', function () {
      connector.removeAllListeners()
      connector.on('error', function () {})

      blockchain.removeAllListeners()
      blockchain.on('error', function () {})

      connector = blockchain = null

      done()
    })
    connector.disconnect()
  })

  it('basic', function (done) {
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (groupId) {
      expect(groupId).to.be.a('string')
      return Q.all([
        tsmb.addTx({groupId: groupId, txId: '75a22bdb38352ba6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e'}),
        tsmb.addAddress({groupId: groupId, address: 'n1YYm9uXWTsjd6xwSEiys7aezJovh6xKbj'})
      ]).then(function () {return})
    }).done(done, done)              
  })

  it('empty getLog', function (done) {
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (groupId) {
      return tsmb.getLog({groupId: groupId}).then(function (log) {
        expect(log).to.deep.equal({lastPoint: 0, txStates: [], lastBlock: null})
        return
      })
    }).done(done, done)
  })

  it('single getLog', function (done) {
    var groupId
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (_groupId) {
      groupId = _groupId
      return tsmb.addTx({groupId: groupId, 
                         txId: '75a22bdb38352ba6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e'})
    }).then(function () {
      return tsmb.getLog({groupId: groupId}).then(function (log) {
          expect(log.txStates).to.eql([ { 
            txId: '75a22bdb38352ba6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e',
            status: 'confirmed',
            blockHeight: 159233,
            blockHash: '0000000010e57aa253fbeead71e9a9dfc7e16e67643653902453367d1d0ad8ec' } ] )
          expect(log.lastPoint).to.be.above(0)
          return log.lastPoint
      })
    }).then(function (lastPoint) {
      return tsmb.getLog({groupId: groupId, fromPoint: lastPoint})
    }).then(function (log) {
      expect(log.txStates).to.be.empty;
      return
    }).done(done, done)
  })

  it('getLog invalid transaction', function (done) {
    var groupId
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (_groupId) {
      groupId = _groupId
      return tsmb.addTx({groupId: groupId,
                         // this is an txid of a transaction which doesn't exit
                         txId: 'aaaaaaaaaaaaaaa6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e'})
    }).then(function () {
      return tsmb.getLog({groupId: groupId}).then(function (log) {
          expect(log.txStates).to.eql([ { 
            txId: 'aaaaaaaaaaaaaaa6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e',
            status: 'invalid'}])
          expect(log.lastPoint).to.be.above(0)
          return log.lastPoint
      })
    }).then(function (lastPoint) {
      return tsmb.getLog({groupId: groupId, fromPoint: lastPoint})
    }).then(function (log) {
      expect(log.txStates).to.be.empty;
      return
    }).done(done, done)
  })

  it('more getLog', function (done) {
    var groupId, lastPoint
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (_groupId) {
      groupId = _groupId
      return tsmb.addTx({groupId: groupId, txId: '75a22bdb38352ba6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e'})
    }).then(function () {
      return tsmb.getLog({groupId: groupId}).then(function (log) {
        expect(log.txStates.length).to.equal(1)
        expect(log.lastPoint).to.be.above(0)
        lastPoint = log.lastPoint
        return tsmb.addAddress({groupId: groupId, address: 'miASVwyhoeFqoLodXUdbDC5YjrdJPwxyXE'})
      })
    }).then(function () {
      return tsmb.getLog({groupId: groupId, fromPoint: lastPoint})
    }).then(function (log) {
      expect(log.txStates.length).to.equal(2)
      expect(log.lastBlock.height).to.be.above(0)
      return tsmb.getLog({groupId: groupId})
    }).then(function (log) {
      expect(log.txStates.length).to.equal(3)
    }).done(done, done)
  })


  it('concurrent getLog', function (done) {
    var groupId, lastPoint
    Q.try(function () {
      return tsmb.newMonitoringGroup()
    }).then(function (_groupId) {
      groupId = _groupId
      var op1 = tsmb.addTx({groupId: groupId, txId: '75a22bdb38352ba6deb7495631335616a308a2db8eb1aa596296d3be5f34f01e'})
              .then(function () {
                return tsmb.getLog({groupId: groupId})
              })
      var op2 = tsmb.addAddress({groupId: groupId, address: 'miASVwyhoeFqoLodXUdbDC5YjrdJPwxyXE'})
              .then(function () {
                return tsmb.getLog({groupId: groupId})
              })
      return Q.all([op1, op2])
    }).then(function (logs) {
      return tsmb.getLog({groupId: groupId})
    }).then(function (log) {
      expect(log.txStates.length).to.equal(3)
    }).done(done, done)
  })  
})