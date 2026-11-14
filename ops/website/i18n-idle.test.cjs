const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test')
const code=fs.readFileSync(__dirname+'/public/assets/js/main.js','utf8')
test('unchanged language selector performs zero DOM writes',()=>{
 let writes=0,activeLanguage='en'
 function node(text,attributes={}){return {textContent:text,attributes,dataset:{languageOption:'en'},active:true,classList:{contains:()=>true,toggle:()=>{writes++}},getAttribute:key=>attributes[key],setAttribute:(key,value)=>{writes++;attributes[key]=value}}}
 const selectors={'[data-language-current]':[node('EN')],'[data-language-title]':[node('Language')],'[data-language-subtitle]':[node('Choose interface language')],'[data-language-option]':[node('',{'aria-pressed':'true'})],'.language-toggle':[node('',{'aria-label':'Switch language'})]}
 for(const list of Object.values(selectors))for(const n of list){let value=n.textContent;Object.defineProperty(n,'textContent',{get:()=>value,set:v=>{writes++;value=v}})}
 const scope={LANGUAGE_OPTIONS:[{code:'en',short:'EN'}],activeLanguage,translatePhrase:x=>x,document:{querySelectorAll:key=>selectors[key]||[]}};vm.createContext(scope)
 const start=code.indexOf('function renderLanguageSelectorState()'),end=code.indexOf('\nfunction initLanguageSelector()',start);vm.runInContext(code.slice(start,end)+'\nrenderLanguageSelectorState();renderLanguageSelectorState();',scope)
 assert.equal(writes,0)
 selectors['[data-language-current]'][0].textContent='outdated';writes=0;vm.runInContext('renderLanguageSelectorState()',scope);assert.equal(writes,1);writes=0;vm.runInContext('renderLanguageSelectorState()',scope);assert.equal(writes,0)
})
