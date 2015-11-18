// Transaction state monitoring

var Q = require('q')
var crypto = require('crypto')
var Promise = require('bluebird')
var TxStateSet = require('blockchainjs').TxStateSet
var _ = require('lodash')
var fs = require('fs')

var makeConcurrent = require('make-concurrent')(Promise)

var wallet = null

exports.setWallet = function (_wallet) {
  wallet = _wallet
}

// helper
function makeRandomId() {
  return crypto.randomBytes(8).toString('hex')
}

function validateGroupId (groupId) {
  if (!groupId.match(/^[01-9a-f]{16}$/))
    throw new Error("groupId doesn't look good")
}

function getMGFileName(groupId) {
  validateGroupId(groupId)
  return 'mgs/' + groupId
}

// in-memory backend prototype

var monitoringGroups = {}

function MonitoringGroup (groupId, storedState) {
  this.groupId = groupId

  if (storedState) {
    if (storedState.groupId !== groupId)
      throw new Error("internal error: groupId")
    this.tss = new TxStateSet(storedState.tssState)
    this.pendingTxIds = storedState.pendingTxIds
    this.pendingAddresses = storedState.pendingAddresses
    this.log = storedState.log
  } else {
    this.tss = new TxStateSet()
    this.pendingTxIds = []
    this.pendingAddresses = []
    this.log = []    
  }
}

MonitoringGroup.prototype.addTxId = function (txId) {
  this.pendingTxIds.push(txId)
  return this.saveState()
}

MonitoringGroup.prototype.addAddress = function (address) {
  this.pendingAddresses.push(address)
  return this.saveState()
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
      return self.saveState()
    })
}

MonitoringGroup.prototype.getLastBlock = function () {
  return this.tss.latest
}

MonitoringGroup.prototype.getState = function () {
  return {
    tssState: this.tss.getState(),
    pendingTxIds: this.pendingTxIds,
    pendingAddresses: this.pendingAddresses,
    log: this.log,
    groupId: this.groupId
  }
}

MonitoringGroup.prototype.saveState = function () {
  return Q.nfcall(fs.writeFile,
                  getMGFileName(this.groupId),
                  JSON.stringify(this.getState()))
}

MonitoringGroup.loadState = function (groupId) {
  return Q.nfcall(fs.readFile,
                  getMGFileName(groupId))
  .then(function (data) {
      return new MonitoringGroup(groupId, JSON.parse(data))
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

    var lentry = _.omit(entry, 'txid')
    lentry.txId = entry.txid
    log.push(lentry)
  })
  return log.reverse()
}

function getMonitoringGroup (groupId) {
  return Q.try(function () {
    if (monitoringGroups[groupId])
      return monitoringGroups[groupId]
    else 
      return MonitoringGroup.loadState(groupId)
        .then(function (mg) {
          monitoringGroups[groupId] = mg
          return mg
        }).catch(function (error) {
          console.log(error.state || error)
          throw new Error('groupId not found')
        })
  })
}

var withLock = makeConcurrent(
  function (fn) {  return fn()  }, { concurency: 1 }
)

exports.newMonitoringGroup = function () {
  var groupId = null
  return Q.try(function () {
    groupId = makeRandomId()

    // TODO: also try loading it
    if (monitoringGroups[groupId])
      throw new Error('internal error: duplicate groupId')

    monitoringGroups[groupId] = new MonitoringGroup(groupId)
    return monitoringGroups[groupId].saveState()
  }).then(function () {
    return groupId
  })
}

exports.addTx = function (params) {
  return withLock(function() {
    var groupId = params.groupId,
        txId = params.txId
    return getMonitoringGroup(groupId)
      .then(function (mg) {
        return mg.addTxId(txId)
      }).then(function () {
        return true
      })
  })
}

exports.addAddress = function (params) {
return withLock(function() {
  var groupId = params.groupId,
      address = params.address
  return getMonitoringGroup(groupId)
    .then(function (mg) {
      return mg.addAddress(address)
    }).then(function () {
      return true
    })
})
}

exports.getLog = function (params) {
return withLock(function() {
  var mg
  var groupId = params.groupId,
      fromPoint = params.fromPoint
  return getMonitoringGroup(groupId)
    .then(function (_mg) {
      mg = _mg
      return mg.sync()
  }).then(function () {
    return {
      lastPoint: mg.log.length,
      txStates: mg.getLog(fromPoint),
      lastBlock: mg.getLastBlock()
    }
  })  
})
}
