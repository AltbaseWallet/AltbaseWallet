import { coinApiService } from '../../services/coinApiService'
import type { Coin } from '../../types/coin'
import type { WalletEngine, WalletMaxSendResult } from '../types'

type SdkReply = WalletMaxSendResult & { address?: string; valid?: boolean; secret?: string; hex?: string; txid?: string }
const sdk = async (coin: Coin, method: string, params: Record<string, unknown>): Promise<SdkReply> => {
  const bridge=window.altbaseWallet?.coinSdk
  if(!bridge)throw new Error('This coin requires the Altbase desktop wallet')
  const response=await bridge({coin:coin.id,method,params})
  if(!response.ok || !response.result)throw new Error(response.error || 'Local wallet module failed')
  return response.result as SdkReply
}
const context = async (coin: Coin, fromAddress: string, force=false) => {
  const [utxos,network,fee]=await Promise.all([
    coinApiService.getUtxos(coin.id,fromAddress,{force,priority:true}),
    coinApiService.getNetwork(coin.id),
    coin.id==='nexa' ? coinApiService.getFeeRate(coin.id,6,12000,{force,priority:true}) : null,
  ])
  if(network.initialBlockDownload)throw new Error('The remote node is still synchronizing')
  return {utxos,height:network.blocks,feeRate:fee ? Math.max(3,fee.feerate*(coin.satsPerCoin||100)/1000) : undefined,fromAddress}
}
export const createSdkUtxoEngine = (id: 'zcash-utxo' | 'nexa-utxo'): WalletEngine => ({
  id,kind:'utxo',
  deriveAddress:async(coin,mnemonic)=>(await sdk(coin,'derive',{mnemonic})).address,
  getAddressVariants:async(coin,address)=>[{id:coin.id==='zcash'?'legacy':'cashaddr',label:coin.id==='zcash'?'Transparent':'Nexa',address,scriptKind:'p2pkh'}],
  validateAddress:async(coin,address)=>(await sdk(coin,'validate',{address})).valid===true,
  async estimateFee(coin,options={}){
    if(!options.fromAddress)return null
    const c=await context(coin,options.fromAddress,options.force)
    const result=await sdk(coin,'plan',{...c,toAddress:options.toAddress||options.fromAddress,
      amountCoin:options.amountCoin,sendMax:!options.amountCoin})
    return{satoshis:result.feeSatoshis||0,coin:result.feeCoin,exact:Boolean(options.amountCoin)}
  },
  async estimateMaxSend(coin,address,feeCoin,toAddress){
    return sdk(coin,'plan',{...await context(coin,address,true),toAddress:toAddress||address,feeCoin,sendMax:true})
  },
  async send({coin,mnemonic,fromAddress,toAddress,amountCoin,feeCoin,maxFeeCoin,sendMax}){
    if(!fromAddress)throw new Error('The source address is not available')
    const result=await sdk(coin,'sign',{...await context(coin,fromAddress,true),mnemonic,toAddress,amountCoin,feeCoin,maxFeeCoin,sendMax})
    if(!result.hex || !result.txid)throw new Error('The local wallet module returned an incomplete transaction')
    const txid=await coinApiService.broadcast(coin.id,result.hex,result.txid)
    return{txid,amountCoin:result.amountCoin,feeCoin:result.feeCoin}
  },
  exportSecret:async(coin,mnemonic)=>{
    const result=await sdk(coin,'export',{mnemonic})
    if(!result.secret)throw new Error('Private key export failed')
    return result.secret
  },
})
