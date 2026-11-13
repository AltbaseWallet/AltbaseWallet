'use strict'
const { test }=require('node:test'),assert=require('node:assert/strict')
const path=require('node:path'),{spawnSync}=require('node:child_process')
test('privileged IPC accepts only the main frame of the current window',()=>{
  const trusted=require('../electron/trusted-frame.cjs'), mainFrame={},webContents={mainFrame},window={isDestroyed:()=>false,webContents}
  assert.equal(trusted({sender:webContents,senderFrame:mainFrame},window),true)
  assert.equal(trusted({sender:webContents,senderFrame:{}},window),false)
  assert.equal(trusted({sender:{},senderFrame:mainFrame},window),false)
  assert.equal(trusted({sender:webContents,senderFrame:mainFrame},{...window,isDestroyed:()=>true}),false)
})
test('build CPU overrides cannot enable multiple cores',()=>{
  const file=path.resolve(__dirname,'../scripts/build-limits.cjs')
  for(const [value,success] of [['0',true],['3',true],['0,1',false],['0-3',false],['all',false]]){
    const result=spawnSync(process.execPath,[file],{env:{...process.env,ALTBASE_BUILD_CPU:value},stdio:'pipe'})
    assert.equal(result.status===0,success,value)
  }
})
