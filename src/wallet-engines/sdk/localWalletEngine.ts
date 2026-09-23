import type { Coin } from '../../types/coin'
import type { WalletEngine, WalletMaxSendResult } from '../types'

type LocalReply=WalletMaxSendResult & {address?:string;valid?:boolean;secret?:string;txid?:string}
export const localWalletRequest=async<T>(coin:string,method:string,params:Record<string,unknown>):Promise<T>=>{
  const bridge=window.altbaseWallet?.coinSdk
  if(!bridge)throw new Error('This coin requires the Altbase desktop wallet')
  const response=await bridge({coin,method,params})
  if(!response.ok||!response.result)throw new Error(response.error||'Local wallet module failed')
  return response.result as T
}
const call=(coin:Coin,method:string,params:Record<string,unknown>)=>localWalletRequest<LocalReply>(coin.id,method,params)
export const createLocalWalletEngine=(id:'xelis-local'|'mwc-local'):WalletEngine=>({
  id,kind:'account',
  deriveAddress:async(coin,mnemonic)=>(await call(coin,'derive',{mnemonic})).address,
  getAddressVariants:async(coin,address)=>[{id:'privacy',label:coin.id==='mwc'?'MWC MQS (recipient must be online)':'Xelis',address,scriptKind:'privacy'}],
  validateAddress:async(coin,address)=>(await call(coin,'validate',{address})).valid===true,
  async estimateFee(coin,options={}){
    if(!options.fromAddress)return null
    const result=await call(coin,'plan',{fromAddress:options.fromAddress,toAddress:options.toAddress||options.fromAddress,amountCoin:options.amountCoin,sendMax:!options.amountCoin})
    return{satoshis:result.feeSatoshis||0,coin:result.feeCoin,exact:true}
  },
  estimateMaxSend:async(coin,address,feeCoin,toAddress)=>call(coin,'plan',{fromAddress:address,toAddress:toAddress||address,feeCoin,sendMax:true}),
  async send({coin,fromAddress,toAddress,amountCoin,feeCoin,maxFeeCoin,sendMax}){
    const result=await call(coin,'send',{fromAddress,toAddress,amountCoin,feeCoin,maxFeeCoin,sendMax})
    if(!result.txid)throw new Error('The local wallet returned no transaction identifier; check history before retrying')
    return{txid:result.txid,amountCoin:result.amountCoin,feeCoin:result.feeCoin}
  },
  exportSecret:async(coin,mnemonic)=>{
    const result=await call(coin,'export',{mnemonic})
    if(!result.secret)throw new Error('Local private key export failed')
    return result.secret
  },
})
