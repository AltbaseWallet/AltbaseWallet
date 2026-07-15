import bitcoin from './bitcoin'
import bitcoin2 from './bitcoin2'
import bitcoincashii from './bitcoincashii'
import btgs from './btgs'
import capstash from './capstash'
import ckb from './ckb'
import epic from './epic'
import firo from './firo'
import hypercoin from './hypercoin'
import junkcoin from './junkcoin'
import kaspa from './kaspa'
import kerrigan from './kerrigan'
import litecoinii from './litecoinii'
import mydogecoin from './mydogecoin'
import neoxa from './neoxa'
import pearl from './pearl'
import pepecoin from './pepecoin'
import quai from './quai'
import qubic from './qubic'
import raptoreum from './raptoreum'
import scash from './scash'
import terracoin from './terracoin'
import zano from './zano'
import type { CoinModule } from './types'

export const coinModules: readonly CoinModule[] = [
  bitcoin,
  bitcoin2,
  bitcoincashii,
  firo,
  btgs,
  capstash,
  hypercoin,
  mydogecoin,
  pepecoin,
  kerrigan,
  scash,
  litecoinii,
  neoxa,
  terracoin,
  junkcoin,
  raptoreum,
  zano,
  epic,
  quai,
  pearl,
  qubic,
  kaspa,
  ckb,
]

const modulesById = new Map(coinModules.map((module) => [module.id, module]))

export const coinModuleRegistry = {
  get(coinId: string) {
    return modulesById.get(coinId)
  },

  require(coinId: string) {
    const module = modulesById.get(coinId)
    if (!module) throw new Error(`Unsupported coin module: ${coinId}`)
    return module
  },

  all() {
    return [...coinModules]
  },
}

export type { CoinModule, NativeCoinRoute } from './types'
