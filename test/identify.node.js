/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)
const parallel = require('async/parallel')
const TCP = require('libp2p-tcp')
const multiplex = require('libp2p-mplex')
const pull = require('pull-stream')
const secio = require('libp2p-secio')
const PeerBook = require('peer-book')
const identify = require('libp2p-identify')
const lp = require('pull-length-prefixed')

const utils = require('./utils')
const createInfos = utils.createInfos
const Switch = require('../src')

describe('Identify', () => {
  let switchA
  let switchB
  let switchC

  before((done) => createInfos(3, (err, infos) => {
    expect(err).to.not.exist()

    const peerA = infos[0]
    const peerB = infos[1]
    const peerC = infos[2]

    peerA.multiaddrs.add('/ip4/127.0.0.1/tcp/9001')
    peerB.multiaddrs.add('/ip4/127.0.0.1/tcp/9002')
    peerC.multiaddrs.add('/ip4/127.0.0.1/tcp/9003')

    switchA = new Switch(peerA, new PeerBook())
    switchB = new Switch(peerB, new PeerBook())
    switchC = new Switch(peerC, new PeerBook())

    switchA.transport.add('tcp', new TCP())
    switchB.transport.add('tcp', new TCP())
    switchC.transport.add('tcp', new TCP())

    switchA.connection.crypto(secio.tag, secio.encrypt)
    switchB.connection.crypto(secio.tag, secio.encrypt)
    switchC.connection.crypto(secio.tag, secio.encrypt)

    switchA.connection.addStreamMuxer(multiplex)
    switchB.connection.addStreamMuxer(multiplex)
    switchC.connection.addStreamMuxer(multiplex)

    switchA.connection.reuse()
    switchB.connection.reuse()
    switchC.connection.reuse()

    parallel([
      (cb) => switchA.transport.listen('tcp', {}, null, cb),
      (cb) => switchB.transport.listen('tcp', {}, null, cb),
      (cb) => switchC.transport.listen('tcp', {}, null, cb)
    ], done)
  }))

  after(function (done) {
    this.timeout(3 * 1000)
    parallel([
      (cb) => switchA.stop(cb),
      (cb) => switchB.stop(cb),
      (cb) => switchC.stop(cb)
    ], done)
  })

  afterEach(function (done) {
    // Hangup everything
    parallel([
      (cb) => switchA.hangUp(switchB._peerInfo, cb),
      (cb) => switchA.hangUp(switchC._peerInfo, cb),
      (cb) => switchB.hangUp(switchA._peerInfo, cb),
      (cb) => switchB.hangUp(switchC._peerInfo, cb),
      (cb) => switchC.hangUp(switchA._peerInfo, cb),
      (cb) => switchC.hangUp(switchB._peerInfo, cb)
    ], done)
  })

  it('should identify a good peer', (done) => {
    switchA.handle('/id-test/1.0.0', (protocol, conn) => pull(conn, conn))
    switchB.dial(switchA._peerInfo, '/id-test/1.0.0', (err, conn) => {
      expect(err).to.not.exist()
      let data = Buffer.from('data that cant be had')
      pull(
        pull.values([data]),
        conn,
        pull.collect((err, values) => {
          expect(err).to.not.exist()
          expect(values).to.deep.equal([data])
          done()
        })
      )
    })
  })

  it('should require crypto and identify to have the same peerId', (done) => {
    identify.listener = (conn) => {
      conn.getObservedAddrs((err, observedAddrs) => {
        if (err) { return }
        observedAddrs = observedAddrs[0]

        // pretend to be another peer
        let publicKey = switchC._peerInfo.id.pubKey.bytes

        const msgSend = identify.message.encode({
          protocolVersion: 'ipfs/0.1.0',
          agentVersion: 'na',
          publicKey: publicKey,
          listenAddrs: switchC._peerInfo.multiaddrs.toArray().map((ma) => ma.buffer),
          observedAddr: observedAddrs ? observedAddrs.buffer : Buffer.from('')
        })

        pull(
          pull.values([msgSend]),
          lp.encode(),
          conn
        )
      })
    }

    switchA.handle('/id-test/1.0.0', (protocol, conn) => pull(conn, conn))
    switchB.dial(switchA._peerInfo, '/id-test/1.0.0', (err, conn) => {
      expect(err).to.not.exist()
      pull(
        pull.values([Buffer.from('data that cant be had')]),
        conn,
        pull.collect((err, values) => {
          expect(err).to.exist()
          expect(values).to.have.length(0)
          done()
        })
      )
    })
  })
})
