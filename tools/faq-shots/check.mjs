import puppeteer from 'puppeteer-core'
import { execSync } from 'node:child_process'
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
execSync(`cd /Users/ct/Documents/kokodocs/backend; pkill -f "uvicorn app.main"; sleep 1; rm -rf data; (nohup .venv/bin/python -m uvicorn app.main:app --port 8000 >/tmp/koko.log 2>&1 &); sleep 4`,{shell:'/bin/zsh'})
const br=await puppeteer.launch({executablePath:'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',headless:'new',args:['--no-sandbox']})
const p=await br.newPage(); await p.setViewport({width:1280,height:900}); p.on('pageerror',e=>console.log('PAGEERR',e.message))
await p.goto('http://127.0.0.1:8000/faq#share-folders'); await sleep(2500)
console.log('open from hash:', await p.evaluate(()=>[...document.querySelectorAll('.faq-item.open')].map(x=>x.id).join(',')), '| items', await p.evaluate(()=>document.querySelectorAll('.faq-item').length))
await p.screenshot({path:'/tmp/faq1.png'})
// toggle another, check aria + height animation
await p.evaluate(()=>document.querySelector('#share-files .faq-q').click()); await sleep(900)
console.log('share-files open/aria', await p.evaluate(()=>[document.querySelector('#share-files').classList.contains('open'), document.querySelector('#share-files .faq-q').getAttribute('aria-expanded'), document.querySelector('#share-files .faq-panel').hasAttribute('inert')]))
await p.evaluate(()=>document.querySelector('#share-files .faq-q').click()); await sleep(900)
console.log('closed again', await p.evaluate(()=>[document.querySelector('#share-files').classList.contains('open'), document.querySelector('#share-files .faq-panel').hasAttribute('inert'), Math.round(document.querySelector('#share-files').getBoundingClientRect().height)]))
// search
await p.type('.faq-search input','voice'); await sleep(900)
console.log('search voice ->', await p.evaluate(()=>[...document.querySelectorAll('.faq-item h3 .faq-qt')].map(x=>x.textContent)))
await p.screenshot({path:'/tmp/faq2.png'})
await p.evaluate(()=>document.querySelector('.faq-search button').click()); await sleep(300)
await p.evaluate(()=>[...document.querySelectorAll('.faq-cats button')].find(b=>b.textContent==='History').click()); await sleep(600)
console.log('History ->', await p.evaluate(()=>[...document.querySelectorAll('.faq-item h3 .faq-qt')].map(x=>x.textContent)))
// dark + mobile
await p.evaluate(()=>{localStorage.setItem('koko.theme','dark');window.dispatchEvent(new Event('koko:theme'))}); await p.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true}); await p.goto('http://127.0.0.1:8000/faq#request-access'); await sleep(2500)
await p.screenshot({path:'/tmp/faq3.png'})
console.log('broken images', await p.evaluate(()=>[...document.querySelectorAll('.faq-item.open img')].filter(i=>i.offsetParent&&!i.naturalWidth).length))
await br.close(); execSync('pkill -f "uvicorn app.main"',{shell:'/bin/zsh'}); process.exit(0)
