'use strict'
const mapConcurrent=async(items,limit,mapper)=>{
  const output=new Array(items.length);let next=0,failed=false
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){
    if(failed)return
    const index=next++;if(index>=items.length)return
    try{output[index]=await mapper(items[index],index)}catch(error){failed=true;throw error}
  }}))
  return output
}
module.exports={mapConcurrent}
