'use strict'
const {networks}=require('@bitgo/utxo-lib')
const {createRemoteUtxoAdapter}=require('./adapters/remoteUtxo.cjs')
const {createNexaRemoteAdapter}=require('./adapters/nexaRemote.cjs')
const bitcoinLike=(pubKeyHash,scriptHash,wif,bech32)=>({...networks.bitcoin,pubKeyHash,scriptHash,wif,bech32})
const createGrandpoolAdapters=()=>[
  createRemoteUtxoAdapter({coin:'bitcoincash',network:networks.bitcoincash,cashaddr:true,minimumFee:0.00001,
    endpoints:[{host:'bch.imaginary.cash',port:50002},{host:'bch0.kister.net',port:50002},{host:'bch.loping.net',port:50002}]}),
  createRemoteUtxoAdapter({coin:'digibyte',network:bitcoinLike(30,63,128,'dgb'),minimumFee:0.00001,maturity:100,
    endpoints:[{host:'dgb.electrum1.cipig.net',port:20059},{host:'dgb.electrum2.cipig.net',port:20059}]}),
  createRemoteUtxoAdapter({coin:'peercoin',network:bitcoinLike(55,117,183,'pc'),decimals:6,minimumFee:0.01,maturity:500,
    // Official peercoin_flutter mainnet servers; Blockbook can lag behind its node.
    genesisHash:'0000000032fe677166d54963b62a4677d8957e87c508eaa4fd7eb1c880cd27e3',
    endpoints:[{url:'wss://electrum.peercoinexplorer.net:50004'},{url:'wss://allingas.peercoinexplorer.net:50004'}]}),
  createRemoteUtxoAdapter({coin:'zcash',network:networks.zcash,minimumFee:0.0001,maturity:100,
    endpoints:[{host:'zec.electrum1.cipig.net',port:20058},{host:'zec.electrum2.cipig.net',port:20058}]}),
  createNexaRemoteAdapter(),
]
module.exports={createGrandpoolAdapters}
