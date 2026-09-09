import { defineConfig, mergeConfig } from 'vite'
import base from '../../../vite.config'
export default mergeConfig(base, defineConfig({
  server:{watch:null},
  optimizeDeps:{entries:['tests/gui/technical/index.html']},
}))
