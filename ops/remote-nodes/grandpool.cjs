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
    baseUrls:['https://explorer.peercoin.net/api/v2','https://blockbook.peercoin.net/api/v2']}),
  createRemoteUtxoAdapter({coin:'zcash',network:networks.zcash,minimumFee:0.0001,maturity:100,
    endpoints:[{host:'zec.electrum1.cipig.net',port:20058},{host:'zec.electrum2.cipig.net',port:20058}]}),
  createNexaRemoteAdapter(),
]
module.exports={createGrandpoolAdapters}
