import type { CoinBalance, CoinNetwork, HistoryResponse, WalletSnapshotRequest, WalletSnapshotResponse } from './coinApiService'
import { localWalletRequest } from '../wallet-engines/sdk/localWalletEngine'
export const isLocalWalletCoin=(coin:string)=>coin==='xelis'||coin==='mwc'
export type LocalWalletSnapshot={syncing:boolean;scanPercent?:number;height:number;targetHeight:number;balance?:CoinBalance;history?:HistoryResponse}
export const readLocalWalletSnapshot=(coin:string,address:string,network:CoinNetwork,options:Record<string,unknown>={})=>
  localWalletRequest<LocalWalletSnapshot>(coin,'snapshot',{address,network,...options})
export const mergeLocalWalletSnapshots=async(request:WalletSnapshotRequest,response:WalletSnapshotResponse)=>{
  await Promise.all(request.coins.filter(item=>isLocalWalletCoin(item.coin)).map(async item=>{
    const entry=response.coins[item.coin]??={coin:item.coin,network:null,balances:{},histories:{}}
    // Remote public nodes cannot decrypt these balances. Never keep a remote
    // placeholder balance, even if an older gateway returned one.
    entry.balances={};entry.histories={};entry.walletBalance=null
    try{
      if(!entry.network)throw new Error('Remote node status is unavailable')
      const address=item.addresses[0]
      const local=address
        ?await readLocalWalletSnapshot(item.coin,address,entry.network,{includeHistory:request.includeHistory!==false,historyLimit:request.historyLimit,historyOffset:request.historyOffset})
        :await localWalletRequest<LocalWalletSnapshot>(item.coin,'status',{network:entry.network})
      if(local.syncing){
        entry.network={...entry.network,blocks:local.height,headers:local.targetHeight,initialBlockDownload:true,walletScanPercent:local.scanPercent,verificationProgress:local.targetHeight>0?Math.min(1,local.height/local.targetHeight):0}
        entry.errors={...entry.errors,[`balance:${address}`]:'Local wallet scan is still in progress'}
        return
      }
      if(address&&request.includeBalances!==false&&local.balance){entry.balances[address]=local.balance;entry.walletBalance=local.balance}
      if(address&&request.includeHistory!==false&&local.history)entry.histories[address]=local.history
    }catch(error){
      entry.network=null
      entry.errors={...entry.errors,localWallet:error instanceof Error?error.message:'Local wallet is unavailable'}
    }
  }))
  return response
}
