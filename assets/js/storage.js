const KEY='branqex_demo_v1';
const seed=()=>({products:[{id:'p-001',name:'Fitas Clareadoras BRANQUEX',description:'1 par de fitas, superior e inferior. Conteúdo para uma aplicação.',price:2000,promoPrice:null,category:'Cuidados orais',stock:35,minStock:5,active:true,published:true,featured:true,image:'',createdAt:new Date().toISOString()}],municipalities:[{id:'m-001',name:'Viana',province:'Luanda',fee:1000,active:true},{id:'m-002',name:'Maianga',province:'Luanda',fee:1500,active:true},{id:'m-003',name:'Belas',province:'Luanda',fee:1800,active:true}],orders:[],movements:[],expenses:[],payments:[],settings:{storeName:'BRANQUEX',phone:'',email:'',location:'Angola',description:'Fitas clareadoras dentárias',adminName:'Administrador'},notifications:[]});
export function read(){try{return JSON.parse(localStorage.getItem(KEY))||seed()}catch{return seed()}}
export function write(data){localStorage.setItem(KEY,JSON.stringify(data));window.dispatchEvent(new CustomEvent('branqex:update',{detail:data}));return data}
export function init(){if(!localStorage.getItem(KEY))write(seed());return read()}
export function update(mutator){const data=read();mutator(data);return write(data)}
export function money(n){return new Intl.NumberFormat('pt-AO',{maximumFractionDigits:0}).format(Number(n)||0)+' Kz'}
export function uid(prefix='id'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6)}
export function effectivePrice(p){return p.promoPrice&&Number(p.promoPrice)>0&&Number(p.promoPrice)<Number(p.price)?Number(p.promoPrice):Number(p.price)}
