import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Send from '../../../src/pages/Send/Send'
import Dashboard from '../../../src/pages/Dashboard/Dashboard'
import CoinDetails from '../../../src/pages/CoinDetails/CoinDetails'
import TransactionDetails from '../../../src/pages/TransactionDetails/TransactionDetails'
import { useCoinStore } from '../../../src/store/coinStore'
import { useTransactionStore } from '../../../src/store/transactionStore'
import { useAuthStore } from '../../../src/store/authStore'
import { useSettingsStore } from '../../../src/store/settingsStore'
import { allCoins } from '../../../src/services/coinService'
import { walletService } from '../../../src/services/walletService'
import { coinApiService, mapHistoryResponseToTransactions } from '../../../src/services/coinApiService'
import { privacyWalletService } from '../../../src/services/privacyWalletService'
import { walletEngineRegistry } from '../../../src/wallet-engines/registry'
import { nonsenseWalletService } from '../../../src/services/nonsenseWalletService'
import { walletSnapshotService } from '../../../src/services/walletSnapshotService'
import { normalizeQubicTransaction } from '../../../src/utils/qubicTransactionStatus'
import '../../../src/styles/globals.css'

const state = { maxCalls:0, sends:0, networkWaiting:false, raceFinished:false, error:'', ckbWait:false }
let releaseNetwork: (() => void) | undefined
let releaseCkb: (() => void) | undefined
const nnnAddress = 'nonsense:qr8jdslgp7k5jhcz2uq8fxnpdpr4hghth8kp32t693gmhtc2usvjgkj7su3c8'
const ids = ['nonsense','pepecoin','ckb','bitcoincashii','kaspa','qubic','zano']
const coins = allCoins().filter(c => ids.includes(c.id)).map(c => ({...c,
  balance:c.id === 'bitcoincashii' ? '0' : '1000', spendableBalance:c.id === 'bitcoincashii' ? '0' : '1000',
  status:'active' as const, enabled:true, address:c.id === 'nonsense' ? nnnAddress : `fixture-public-${c.id}`, fiatValue:0,
}))
useSettingsStore.getState().updateSettings({language:'en',hideBalances:false})
useAuthStore.setState({sessionMnemonic:'fixture-session-invalid-as-mnemonic'})
walletService.getSessionMnemonic = () => 'fixture-session-invalid-as-mnemonic'
walletService.getWalletStorageScope = () => 'technical-fixture'
walletService.getWalletAddresses = () => Object.fromEntries(coins.map(c => [c.id,c.address]))
useCoinStore.setState({coins,loading:false,refreshing:false,loadCoins:async () => {},selectCoin:(id) => useCoinStore.setState({selectedCoinId:id})})
useTransactionStore.setState({transactions:[],loading:false,allHistoryLoaded:true,
  loadTransactions:async () => ({pageLoaded:true,pageKey:'fixture',pageItemCount:0}),
  loadAllTransactions:async () => {},
  sendTransaction:async () => {state.sends++;throw Error('Transfer confirmation is forbidden in this fixture')},
})
coinApiService.getUtxos = async (id) => {
  if(id !== 'nonsense') throw Error('Unexpected UTXO request')
  return Array.from({length:1000},(_,i) => ({txid:(i+1).toString(16).padStart(64,'0'),outputIndex:0,satoshis:'100000000',script:'20'+'11'.repeat(32)+'ac'}))
}
coinApiService.getFeeRate = async () => ({feerate:0.00001,relayFee:0.00001})
coinApiService.broadcast = async () => {state.sends++;throw Error('Broadcast is forbidden')}
for (const coin of coins) {
  const engine = walletEngineRegistry.get(coin)
  engine.send = async () => {state.sends++;throw Error('Signing is forbidden')}
  engine.validateAddress = async () => true
  engine.estimateFee = async () => ({coin:'0.01',satoshis:1000000,exact:true})
  engine.estimateMinimumFee = async () => ({coin:'0.00001',satoshis:1000,exact:true})
  if (coin.id === 'nonsense') engine.estimateMaxSend = async (c,a,_f,to) => {state.maxCalls++;return nonsenseWalletService.estimateMaxSend(c.id,a,to)}
  if (coin.id === 'pepecoin') engine.estimateMaxSend = async () => {
    state.maxCalls++
    return state.maxCalls === 1 ? {amountCoin:'999.99',feeCoin:'0.01',feeSatoshis:1000000}
      : {amountCoin:'999.98',feeCoin:'0.02',feeSatoshis:2000000}
  }
  if (coin.id === 'ckb') engine.estimateMaxSend = async () => {
    state.maxCalls++;state.ckbWait=true
    await new Promise<void>(resolve => {releaseCkb=resolve})
    state.ckbWait=false
    return {amountCoin:'999.99999',feeCoin:'0.00001',feeSatoshis:1000}
  }
}
privacyWalletService.getNativeReadiness = () => 'ready'
privacyWalletService.getCachedSnapshot = async () => null
const snapshot = {ok:true,code:'zano-native-wallet',address:'fixture-public-zano',balance:'0',spendableBalance:'0',transactions:[],lastScannedHeight:100}
privacyWalletService.getSnapshot = async () => snapshot
privacyWalletService.rescan = async () => snapshot
coinApiService.tryGetNetwork = async () => {
  state.networkWaiting=true
  await new Promise<void>(resolve => {releaseNetwork=resolve})
  state.networkWaiting=false
  return {chain:'fixture',blocks:100,headers:100,initialBlockDownload:false,verificationProgress:1,connections:8}
}
const qa = {
  snapshotItems: async () => {
    const address='bitcoincashii:qq7ty96yha3waz7vsf32wastmag47k283y3jfk4q9m';
    const original=walletService.getWalletAddresses;
    walletService.getWalletAddresses=()=>({bitcoincashii:address});
    try{return await walletSnapshotService.buildItems([{...coins.find(c=>c.id==='bitcoincashii')!,address}])}finally{walletService.getWalletAddresses=original}
  },
  privacyCase: (balance:string, readiness:'unknown'|'ready'|'syncing'|'error') => {
    privacyWalletService.getNativeReadiness = () => readiness;
    useCoinStore.setState({coins:useCoinStore.getState().coins.map(c=>c.id==='zano'?{...c,balance,spendableBalance:balance,status:'active',recoveryProgress:undefined}:c)});
  },
  state,
  go: (route:string) => {state.maxCalls=0;location.hash=route},
  releaseCkb: () => releaseCkb?.(),
  releaseNetwork: () => releaseNetwork?.(),
  setBalance: (balance:string) => useCoinStore.setState({coins:useCoinStore.getState().coins.map(c => c.id === 'bitcoincashii' ? {...c,balance,spendableBalance:balance} : c)}),
  balances: () => useCoinStore.getState().coins.map(({id,balance}) => ({id,balance})),
  race: (kind:string) => {
    state.raceFinished=false;state.error=''
    const p=kind === 'background' ? useCoinStore.getState().refreshPrivacyBalances() : useCoinStore.getState().rescanPrivacyCoin('zano',0)
    void p.then(() => {state.raceFinished=true}).catch(e => {state.error=e.message;state.raceFinished=true})
  },
  history: () => {
    const history={deltas:[{txid:'kaspa-fixture',satoshis:'100000000',height:120,timestamp:1700000000}],transactions:[{txid:'kaspa-fixture',confirmations:6,vout:[{value:'1',n:0,scriptPubKey:{address:'fixture-public-kaspa'}}]}]}
    const kaspa=mapHistoryResponseToTransactions(history,'kaspa','fixture-public-kaspa',100000000,undefined,2000125)[0]
    const qubic=normalizeQubicTransaction({id:'qubic-fixture',coinId:'qubic',txHash:'qubic-fixture',type:'outgoing',amount:'998',createdAt:'2026-09-07T18:00:00Z',status:'confirmed',confirmations:999})
    useTransactionStore.setState({transactions:[kaspa,qubic]})
    return {kaspa,qubic}
  },
}
Object.assign(window,{qa})
createRoot(document.getElementById('root')!).render(<HashRouter><div className="min-h-screen bg-slate-950 p-6 text-white"><p className="mb-4 text-amber-200">LOCAL FIXTURES — signing and broadcast disabled</p><Routes><Route path="/app/send" element={<Send/>}/><Route path="/app/coin/:coinId" element={<CoinDetails/>}/><Route path="/app/tx/:txId" element={<TransactionDetails/>}/><Route path="*" element={<Dashboard/>}/></Routes></div></HashRouter>)
