import fs from 'node:fs'
const root = new URL('./browser/', import.meta.url)
const pages = JSON.parse(fs.readFileSync(new URL('h5-three-pages.json', root), 'utf8'))
const baseline = {89:[[5.225,.191],[5.198,.192],[6.025,.166],[5.998,.167]],90:[[5.369,.186],[5.369,.186],[6.169,.162],[6.169,.162]],75:[[6.916,.145],[7.540,.133],[8.516,.117],[9.140,.109]]}
const rows = pages.flatMap(page => page.groups.flatMap((group,index) => [20,25].map(thicknessMm => {
  const actual = group.cells.filter(cell => cell.column==='3' && Number(cell.text)===thicknessMm).flatMap(cell => {
    const r=group.cells.find(item=>item.row===cell.row && item.column==='8'), k=group.cells.find(item=>item.row===cell.row && item.column==='9')
    return r?.text.trim() && k?.text.trim() ? [{r:Number(r.text),k:Number(k.text)}] : []
  })
  const [r,k]=baseline[page.page][(thicknessMm===20?0:2)+index]
  return {page:page.page,group:group.label,groupId:group.id,thicknessMm,expectedR:r,expectedK:k,actual,status:actual.length===1&&actual[0].r===r&&actual[0].k===k?'PASS':'FAIL'}
})))
const images=JSON.parse(fs.readFileSync(new URL('h5-images.json',root),'utf8'))
const failed=rows.filter(row=>row.status!=='PASS')
const imagePass=images.length===3&&images.every(row=>row.images.length===1&&row.images[0].loaded&&row.images[0].width===2048&&row.images[0].height===1471)
fs.writeFileSync(new URL('validation.json',root),JSON.stringify({scope:'正式UniApp表格组件+本次隔离已确认人工基线+真实HTTP/OSS浏览器解码；非Vision自动确认、非原生App',rows,images,tableStatus:rows.length===12&&!failed.length?'PASS':'FAIL',imageStatus:imagePass?'PASS':'FAIL'},null,2))
console.log(JSON.stringify({rows:rows.length,failed,images:imagePass?'PASS':'FAIL'}))
if(rows.length!==12||failed.length||!imagePass)process.exitCode=1
