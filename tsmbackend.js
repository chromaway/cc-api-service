// Transaction state monitoring

var crypto = require('crypto')
var Q = require('q')
var TxStateSet = require('blockchainjs').TxStateSet
var _ = require('lodash')


var wallet = null

exports.setWallet = function (_wallet) {
  wallet = _wallet
}

// helper
function makeRandomId() {
  return crypto.randomBytes(8).toString('hex')
}

// in-memory backend prototype

var monitoringGroups = {}

function MonitoringGroup () {
  this.tss = new TxStateSet()
  this.pendingTxIds = []
  this.pendingAddresses = []
  this.log = []
}

MonitoringGroup.prototype.addTxId = function (txId) {
  this.pendingTxIds.push(txId)
}

MonitoringGroup.prototype.addAddress = function (address) {
  this.pendingAddresses.push(address)
}

MonitoringGroup.prototype.sync = function () {
  var self = this
  return this.tss.autoSync(wallet.getBlockchain(), 
                           this.pendingAddresses,
                           this.pendingTxIds)
    .then(function (newTSS) {
      self.pendingTxIds = []
      self.pendingAddresses = []
      self.tss = newTSS
      var changes = newTSS.getChanges()
      if (changes.length > 0) self.log.push(changes)
    })
}

MonitoringGroup.prototype.getLog = function (fromPoint) {
  var entries = _.flatten(this.log.slice(fromPoint).reverse())
  var log = []
  var txIds = {}

  entries.forEach(function (entry) {
    // skip old entries
    if (txIds[entry.txid]) return 
    txIds[entry.txid] = true
    
    entry = _.clone(entry)
    entry.txId = entry.txid
    delete entry.txid

    log.push(entry)    
  })
  return log.reverse()
}

exports.newMonitoringGroup = function () {
  var groupId = makeRandomId()
  monitoringGroups[groupId] = new MonitoringGroup()
  return groupId
}

exports.addTx = function (groupId, txId) {
  return Q.try(function () {
    var mg = monitoringGroups[groupId]
    if (typeof mg === 'undefined') throw new Error('groupId not found')
    mg.addTxId(txId)
    return true
  })
}

exports.addAddress = function (groupId, address) {
  return Q.try(function () {
    var mg = monitoringGroups[groupId]
    if (mg === undefined) throw new Error('groupId not found')
    mg.addAddress(address)
    return true
  })
}

exports.getLog = function (groupId, fromPoint) {
  var mg
  return Q.try(function () {
    mg = monitoringGroups[groupId]
    if (mg === undefined) throw new Error('groupId not found')
    return mg.sync()
  }).then(function () {
    return {
      lastPoint: mg.log.length,
      txStates: mg.getLog(fromPoint)
    }
  })  
}