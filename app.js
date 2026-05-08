// ============================================================
//  app.js — Sportsstore shared logic
//  Usado por: index.html, product.html y orders.html
// ============================================================

//const API = 'http://localhost:8080/api/v1';
const API = 'https://sports-api-back-zd0c.onrender.com/api/v1';
const ICONS = { FOOTWEAR:'👟', CLOTHING:'👕', EQUIPMENT:'🏋️' };
const fmt = n => 'S/ ' + Number(n).toFixed(2);
const rng = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const stars = n => Array.from({length:5},(_,i)=>`<span class="star${i>=n?' off':''}">★</span>`).join('');

// ── STATE ─────────────────────────────────────────────────────
let token = localStorage.getItem('ss_token') || null;
let user  = JSON.parse(localStorage.getItem('ss_user') || 'null');
let cart  = JSON.parse(localStorage.getItem('ss_cart') || '[]');
let allProds=[], filtered=[];
let activeFilter='ALL', activeSort='', maxPrice=300, onlyStock=false;
let _coldTimer=null, _retryCount=0;
const MAX_RETRY=3, COLD_DELAY=3000, FETCH_TIMEOUT=12000;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderAuth();
  updateBadge();
  checkTokenExpiry();
  if (document.getElementById('pgrid')) loadProducts();
});

// ── apiFetch ──────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  if (!token) {
    openModal('login');
    toast('Inicia sesión para continuar.', '🔒');
    throw new Error('No autenticado');
  }
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const headers = { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}`, ...options.headers };
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) { handleTokenExpired(); throw new Error('Sesión expirada'); }
  return response;
}

// ── TOKEN EXPIRY ───────────────────────────────────────────────
function handleTokenExpired() {
  token=null; user=null; cart=[];
  localStorage.removeItem('ss_token');
  localStorage.removeItem('ss_user');
  localStorage.removeItem('ss_cart');
  renderAuth(); updateBadge();
  toast('Tu sesión expiró. Por favor inicia sesión de nuevo.', '🔒');
  setTimeout(() => { openModal('login'); showMsg('le','Tu sesión ha expirado. Vuelve a iniciar sesión.','err'); }, 500);
}

function checkTokenExpiry() {
  if (!token) return;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const remainingMs = payload.exp * 1000 - Date.now();
    if (remainingMs <= 0) {
      token=null; user=null; cart=[];
      localStorage.removeItem('ss_token'); localStorage.removeItem('ss_user'); localStorage.removeItem('ss_cart');
      renderAuth(); updateBadge();
      toast('Tu sesión anterior expiró. Inicia sesión de nuevo.', '🔒');
      return;
    }
    setTimeout(() => { if (token) handleTokenExpired(); }, Math.min(remainingMs, 24*60*60*1000));
  } catch { localStorage.removeItem('ss_token'); token=null; }
}

// ── NAVIGATION ────────────────────────────────────────────────
function goToProduct(id) { window.location.href=`product.html?id=${id}`; }
function scrollToGrid() { const el=document.getElementById('grid-anchor'); if(el) el.scrollIntoView({behavior:'smooth'}); }

// ── TOAST ─────────────────────────────────────────────────────
let _tt;
function toast(msg, icon='✓') {
  const el=document.getElementById('toast'); if(!el) return;
  const iEl=document.getElementById('t-icon'); const mEl=document.getElementById('t-msg');
  if(iEl) iEl.textContent=icon; if(mEl) mEl.textContent=msg;
  el.classList.add('show'); clearTimeout(_tt);
  _tt=setTimeout(()=>el.classList.remove('show'), 3200);
}

// ── COLD START BANNER ─────────────────────────────────────────
function showColdBanner(attempt) {
  const el=document.getElementById('cold-banner'); if(!el) return;
  const isRetry=attempt>1;
  el.innerHTML=`
    <div class="cold-inner">
      <div class="cold-spinner"></div>
      <div class="cold-body">
        <div class="cold-title">${isRetry?`Reintentando... (${attempt}/${MAX_RETRY})`:'☕ El servidor está despertando'}</div>
        <div class="cold-sub">${isRetry?'Intentando de nuevo automáticamente.':'Render apaga el servidor tras 15 min de inactividad. La primera carga puede tomar hasta 30s.'}</div>
      </div>
      <button class="cold-retry" onclick="manualRetry()">Reintentar</button>
      <button class="cold-close" onclick="hideColdBanner()">×</button>
    </div>
    <div class="cold-progress"><div class="cold-progress-bar" id="cold-progress-bar"></div></div>`;
  el.classList.add('show');
  const bar=document.getElementById('cold-progress-bar');
  if(bar){ bar.style.transition='none'; bar.style.width='0%'; requestAnimationFrame(()=>{ bar.style.transition=`width ${FETCH_TIMEOUT}ms linear`; bar.style.width='100%'; }); }
}
function hideColdBanner() {
  const el=document.getElementById('cold-banner');
  if(el){ el.classList.remove('show'); el.classList.remove('error'); }
  clearTimeout(_coldTimer); _coldTimer=null;
}
function manualRetry() { _retryCount=0; hideColdBanner(); loadProducts(activeFilter==='ALL'?'':activeFilter); }
function showFallbackBanner() {
  const el=document.getElementById('cold-banner'); if(!el) return;
  el.innerHTML=`<div class="cold-inner"><span style="font-size:18px">⚠️</span><div class="cold-body"><div class="cold-title">No se pudo conectar</div><div class="cold-sub">Mostrando productos de ejemplo.</div></div><button class="cold-retry" onclick="manualRetry()">Reintentar</button><button class="cold-close" onclick="hideColdBanner()">×</button></div>`;
  el.classList.add('show'); el.classList.add('error');
}

// ── PRODUCTS ──────────────────────────────────────────────────
async function loadProducts(name='', cat='') {
  renderSkeleton(); hideColdBanner();
  _coldTimer=setTimeout(()=>showColdBanner(_retryCount+1), COLD_DELAY);
  let success=false;
  while (_retryCount<=MAX_RETRY) {
    try {
      let url=`${API}/products?size=24`;
      if(name) url=`${API}/products?name=${encodeURIComponent(name)}&size=24`;
      else if(cat&&cat!=='ALL') url=`${API}/products?category=${cat}&size=24`;
      const r=await fetch(url,{signal:AbortSignal.timeout(FETCH_TIMEOUT)});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d=await r.json();
      allProds=(d.content||d.products||(Array.isArray(d)?d:[])).map(p=>({...p,_stars:rng(3,5),_reviews:rng(18,340)}));
      success=true; _retryCount=0; break;
    } catch { _retryCount++; if(_retryCount>MAX_RETRY) break; showColdBanner(_retryCount); await new Promise(res=>setTimeout(res,2000)); }
  }
  clearTimeout(_coldTimer); _coldTimer=null;
  if(success){ hideColdBanner(); _retryCount=0; } else { loadMock(); showFallbackBanner(); }
  updateCounts(); applyFilters();
}

function loadMock() {
  allProds=[
    {id:1,name:'Air Sprint Pro',brand:'RunTech',price:129.99,stock:8,category:'FOOTWEAR'},
    {id:2,name:'TrailBlazer X2',brand:'Merrell',price:159.99,stock:4,category:'FOOTWEAR'},
    {id:3,name:'Cloud Runner Elite',brand:'On Running',price:189.99,stock:12,category:'FOOTWEAR'},
    {id:4,name:'Speed Boost 3.0',brand:'Puma',price:109.99,stock:0,category:'FOOTWEAR'},
    {id:5,name:'Compression Tee',brand:'Under Form',price:34.99,stock:20,category:'CLOTHING'},
    {id:6,name:'Dry-Fit Shorts',brand:'SweatLess',price:44.99,stock:15,category:'CLOTHING'},
    {id:7,name:'Performance Hoodie',brand:'Under Form',price:79.99,stock:7,category:'CLOTHING'},
    {id:8,name:'Sport Socks 3pk',brand:'SweatLess',price:12.99,stock:50,category:'CLOTHING'},
    {id:9,name:'Adjustable Power Rack',brand:'IronGrip',price:249.99,stock:2,category:'EQUIPMENT'},
    {id:10,name:'Resistance Bands Set',brand:'FlexCore',price:19.99,stock:0,category:'EQUIPMENT'},
    {id:11,name:'Foam Roller Pro',brand:'RecoverX',price:29.99,stock:11,category:'EQUIPMENT'},
    {id:12,name:'Speed Jump Rope',brand:'SpeedLine',price:14.99,stock:30,category:'EQUIPMENT'},
  ].map(p=>({...p,_stars:rng(3,5),_reviews:rng(15,280)}));
}

function updateCounts() {
  const safe=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  safe('cnt-all',allProds.length); safe('cnt-fw',allProds.filter(p=>p.category==='FOOTWEAR').length);
  safe('cnt-cl',allProds.filter(p=>p.category==='CLOTHING').length); safe('cnt-eq',allProds.filter(p=>p.category==='EQUIPMENT').length);
}

function applyFilters() {
  let res=[...allProds];
  if(onlyStock) res=res.filter(p=>p.stock>0);
  if(maxPrice<300) res=res.filter(p=>p.price<=maxPrice);
  if(activeSort==='price-asc') res.sort((a,b)=>a.price-b.price);
  else if(activeSort==='price-desc') res.sort((a,b)=>b.price-a.price);
  else if(activeSort==='name') res.sort((a,b)=>a.name.localeCompare(b.name));
  else if(activeSort==='stock') res.sort((a,b)=>b.stock-a.stock);
  filtered=res;
  const rn=document.getElementById('res-n'); if(rn) rn.textContent=filtered.length;
  renderChips(); renderGrid(filtered);
}

function renderSkeleton() {
  const g=document.getElementById('pgrid'); if(!g) return;
  g.innerHTML=Array(8).fill(0).map(()=>`<div class="pcard"><div class="pcard-img sk" style="aspect-ratio:1;background:var(--paper2)"></div><div class="pcard-body" style="gap:.5rem"><div class="sk" style="height:11px;width:35%"></div><div class="sk" style="height:17px;width:75%"></div><div class="sk" style="height:13px;width:50%"></div><div class="sk" style="height:32px;width:100%;margin-top:.25rem"></div></div></div>`).join('');
}

function renderGrid(prods) {
  const g=document.getElementById('pgrid'); if(!g) return;
  if(!prods.length){g.innerHTML=`<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">Sin resultados</div><div class="empty-sub">Prueba con otros filtros o una búsqueda diferente.</div></div>`;return;}
  g.innerHTML=prods.map(p=>{
    const low=p.stock>0&&p.stock<=3, isNew=p.id%5===0, isSale=p.id%4===0;
    let badge='';
    if(!p.stock) badge=`<div class="badge badge-out">Agotado</div>`;
    else if(low) badge=`<div class="badge badge-low">⚡ Últimas ${p.stock}</div>`;
    else if(isNew) badge=`<div class="badge badge-new">Nuevo</div>`;
    else if(isSale) badge=`<div class="badge badge-sale">Oferta</div>`;
    return `<div class="pcard" onclick="goToProduct(${p.id})" style="cursor:pointer">
      ${badge}
      <div class="pcard-img"><span>${ICONS[p.category]||'📦'}</span></div>
      <button class="wish-btn" onclick="event.stopPropagation();toast('Guardado en favoritos','❤️')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></button>
      <div class="pcard-body">
        <div class="pcard-cat">${p.category}</div>
        <div class="pcard-name">${p.name}</div>
        <div class="pcard-brand">${p.brand}</div>
        <div class="pcard-stars"><div class="stars">${stars(p._stars)}</div><span class="review-n">(${p._reviews})</span></div>
        ${low?`<div class="stock-warn">⚡ Solo ${p.stock} disponibles</div>`:''}
        <div class="pcard-foot">
          <div class="pcard-price">${fmt(p.price)}</div>
          ${p.stock>0
            ?`<button class="add-btn" onclick="addToCart(event,${p.id},'${p.name.replace(/'/g,"\\'")}',${p.price},'${p.category}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Agregar</button>`
            :`<span class="out-txt">Agotado</span>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── FILTERS ───────────────────────────────────────────────────
function setFilter(cat,el,isMobile=false){activeFilter=cat;const listId=isMobile?'cat-list-m':'cat-list';document.querySelectorAll(`#${listId} .cat-opt`).forEach(c=>c.classList.remove('on'));el.classList.add('on');const si=document.getElementById('search-in');if(si)si.value='';loadProducts('',cat);if(isMobile)closeSheet();}
function onSort(v){activeSort=v;applyFilters();}
function onPrice(v){maxPrice=+v;document.getElementById('price-lbl').textContent=`S/ ${v}`;applyFilters();}
function onStockToggle(){const d=document.getElementById('stock-toggle'),m=document.getElementById('stock-toggle-m');onlyStock=(d&&d.checked)||(m&&m.checked);if(d)d.checked=onlyStock;if(m)m.checked=onlyStock;applyFilters();}
function toggleSz(el){el.classList.toggle('on');}
let _st;
function onSearch(v){clearTimeout(_st);_st=setTimeout(()=>{v.length>1?loadProducts(v,''):loadProducts('',activeFilter);},380);}

// ── CHIPS ─────────────────────────────────────────────────────
const CAT_NAMES={ALL:'Todos',FOOTWEAR:'Calzado',CLOTHING:'Ropa',EQUIPMENT:'Equipamiento'};
let _chips=[];
function renderChips(){
  const row=document.getElementById('chips-row');if(!row)return;_chips=[];
  if(activeFilter!=='ALL')_chips.push({label:CAT_NAMES[activeFilter],clear:()=>{activeFilter='ALL';document.querySelectorAll('#cat-list .cat-opt,#cat-list-m .cat-opt').forEach((c,i)=>c.classList.toggle('on',i===0));loadProducts('','ALL');}});
  if(onlyStock)_chips.push({label:'En stock',clear:()=>{onlyStock=false;['stock-toggle','stock-toggle-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});applyFilters();}});
  if(maxPrice<300)_chips.push({label:`Precio ≤ ${fmt(maxPrice)}`,clear:()=>{maxPrice=300;const sl=document.getElementById('price-slider');if(sl)sl.value=300;document.getElementById('price-lbl').textContent='S/ 300';applyFilters();}});
  row.innerHTML=_chips.length?_chips.map((c,i)=>`<div class="chip">${c.label}<button class="chip-x" onclick="_chips[${i}].clear()">×</button></div>`).join('')+`<button class="clear-btn" onclick="clearAll()">Limpiar todo</button>`:'';
}
function clearAll(){activeFilter='ALL';onlyStock=false;maxPrice=300;activeSort='';const sl=document.getElementById('price-slider');if(sl)sl.value=300;const pl=document.getElementById('price-lbl');if(pl)pl.textContent='S/ 300';['stock-toggle','stock-toggle-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});document.querySelectorAll('#cat-list .cat-opt,#cat-list-m .cat-opt').forEach((c,i)=>c.classList.toggle('on',i===0));loadProducts('','ALL');}

// ── MOBILE SHEET ──────────────────────────────────────────────
function openSheet(){document.getElementById('sheet-bg').classList.add('open');document.getElementById('filter-sheet').classList.add('open');}
function closeSheet(){document.getElementById('sheet-bg').classList.remove('open');document.getElementById('filter-sheet').classList.remove('open');}

// ── CART ──────────────────────────────────────────────────────
function updateBadge(){
  const n=cart.reduce((s,i)=>s+i.qty,0);
  const cc=document.getElementById('cart-count'),cn=document.getElementById('cart-badge-n');
  if(cc)cc.textContent=n; if(cn)cn.textContent=`${n} item${n!==1?'s':''}`;
  localStorage.setItem('ss_cart',JSON.stringify(cart));
}
function addToCart(e,id,name,price,cat,qty=1){
  e.stopPropagation();
  if(!token){openModal('login');toast('Inicia sesión para agregar al carrito','🔒');return;}
  const ex=cart.find(i=>i.id===id);
  if(ex)ex.qty+=qty;else cart.push({id,name,price,cat,qty});
  updateBadge(); toast(`${name} agregado al carrito`,'✓');
  apiFetch('/shopping/cart/items',{method:'POST',body:JSON.stringify({productId:id,quantity:ex?ex.qty:qty})}).catch(()=>{});
}
function openCart(){document.getElementById('cart-bg').classList.add('open');document.getElementById('cart-panel').classList.add('open');renderCart();}
function closeCart(){document.getElementById('cart-bg').classList.remove('open');document.getElementById('cart-panel').classList.remove('open');}
function renderCart(){
  const body=document.getElementById('cart-body'),ft=document.getElementById('cart-ft');if(!body)return;
  if(!cart.length){body.innerHTML=`<div class="cart-empty"><div class="cart-empty-icon">🛒</div><div class="cart-empty-title">Tu carrito está vacío</div><div class="cart-empty-sub">Agrega productos para comenzar tu pedido.</div></div>`;if(ft)ft.style.display='none';return;}
  body.innerHTML=cart.map(i=>`<div class="ci"><div class="ci-thumb">${ICONS[i.cat]||'📦'}</div><div class="ci-body"><div class="ci-name">${i.name}</div><div class="ci-brand">${fmt(i.price)} c/u</div><div class="ci-row"><div class="qty-ctrl"><button class="q-btn" onclick="chgCartQty(${i.id},-1)">−</button><span class="q-n">${i.qty}</span><button class="q-btn" onclick="chgCartQty(${i.id},1)">+</button></div><div class="ci-price">${fmt(i.price*i.qty)}</div></div><button class="ci-del" onclick="removeItem(${i.id})"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>Eliminar</button></div></div>`).join('');
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const sub=document.getElementById('ct-sub');if(sub)sub.textContent=fmt(total);
  const tot=document.getElementById('ct-total');if(tot)tot.textContent=fmt(total);
  if(ft)ft.style.display='block';
}
function chgCartQty(id,d){
  const it=cart.find(i=>i.id===id);if(!it)return;
  it.qty+=d;if(it.qty<=0)cart=cart.filter(i=>i.id!==id);
  updateBadge();renderCart();
  if(it.qty>0)apiFetch(`/shopping/cart/items/${id}`,{method:'PUT',body:JSON.stringify({quantity:it.qty})}).catch(()=>{});
  else apiFetch(`/shopping/cart/items/${id}`,{method:'DELETE'}).catch(()=>{});
}
function removeItem(id){cart=cart.filter(i=>i.id!==id);updateBadge();renderCart();toast('Producto eliminado','🗑️');apiFetch(`/shopping/cart/items/${id}`,{method:'DELETE'}).catch(()=>{});}
async function doCheckout(){
  if(!token){closeCart();openModal('login');return;}
  if(!cart.length){toast('Tu carrito está vacío','⚠️');return;}
  try{
    const r=await apiFetch('/shopping/checkout',{method:'POST',headers:{'Idempotency-Key':`ck-${Date.now()}-${Math.random().toString(36).slice(2)}`}});
    const d=await r.json();if(!r.ok)throw new Error(d.message||'Error al procesar el pedido');
    cart=[];updateBadge();closeCart();toast(`¡Pedido confirmado! 🎉 Orden #${d.orderId}`,'🎉');
  }catch(e){if(e.message!=='Sesión expirada')toast(`Error: ${e.message}`,'⚠️');}
}

// ── AUTH ──────────────────────────────────────────────────────
function renderAuth(){
  const el=document.getElementById('auth-area');if(!el)return;
  if(user){
    el.innerHTML=`
      <div class="auth-chip">
        <div class="dot"></div>
        <span class="auth-chip-name">${user.firstName||'Usuario'}</span>
        <a href="orders.html" class="auth-chip-orders">Mis pedidos</a>
        <button class="auth-chip-logout" onclick="logout()">salir</button>
      </div>`;
  }else{
    el.innerHTML=`
      <button class="nav-btn" onclick="openModal('login')" title="Iniciar sesión">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      </button>`;
  }
}

function openModal(t){document.getElementById('auth-ov').classList.add('open');switchForm(t);}
function closeOverlay(id){document.getElementById(id).classList.remove('open');}
function overlayClick(e,id){if(e.target===document.getElementById(id))closeOverlay(id);}
function switchForm(f){
  document.getElementById('frm-login').style.display=f==='login'?'':'none';
  document.getElementById('frm-register').style.display=f==='register'?'':'none';
  ['le','re','rs'].forEach(i=>{const el=document.getElementById(i);if(el)el.style.display='none';});
}
function showMsg(id,txt,type){const el=document.getElementById(id);if(!el)return;el.textContent=txt;el.className='modal-msg '+(type||'err');el.style.display='block';}

async function doLogin(){
  const em=document.getElementById('l-em').value.trim(),pw=document.getElementById('l-pw').value;
  if(!em||!pw){showMsg('le','Completa todos los campos');return;}
  try{
    const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});
    const d=await r.json();if(!r.ok)throw new Error(d.message||'Credenciales incorrectas');
    token=d.token;user=d.user||{firstName:em.split('@')[0]};
    localStorage.setItem('ss_token',token);localStorage.setItem('ss_user',JSON.stringify(user));
    checkTokenExpiry();closeOverlay('auth-ov');renderAuth();
    toast(`¡Bienvenido, ${user.firstName||''}!`,'👋');
    if(typeof loadOrders==='function')loadOrders(0);
  }catch(e){showMsg('le',e.message);}
}

async function doRegister(){
  const fn=document.getElementById('r-fn').value.trim(),ln=document.getElementById('r-ln').value.trim();
  const em=document.getElementById('r-em').value.trim(),pw=document.getElementById('r-pw').value;
  if(!fn||!ln||!em||!pw){showMsg('re','Completa todos los campos');return;}
  try{
    const r=await fetch(`${API}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:fn,lastName:ln,email:em,password:pw})});
    const d=await r.json();if(!r.ok)throw new Error(d.message||'Error al registrar');
    showMsg('rs','¡Cuenta creada! Ahora inicia sesión.','ok');
    setTimeout(()=>switchForm('login'),1800);
  }catch(e){showMsg('re',e.message);}
}

function logout(){
  token=null;user=null;cart=[];
  localStorage.removeItem('ss_token');localStorage.removeItem('ss_user');localStorage.removeItem('ss_cart');
  renderAuth();updateBadge();toast('Sesión cerrada','👋');
}
