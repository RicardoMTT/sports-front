// ============================================================
//  app.js — Soundstore shared logic
//  Usado por: index.html, product.html y orders.html
// ============================================================

//const API = 'http://localhost:8080/api/v1';
const API = 'https://sports-api-back-zd0c.onrender.com/api/v1';
const ICONS = { VINYL:'🎵', CD:'💿', CLOTHING:'👕', ACCESSORIES:'🎸', INSTRUMENTS:'🎹', POSTERS:'🖼️', BOOKS:'📖' };
const fmt = n => 'S/ ' + Number(n).toFixed(2);
const rng = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const stars = n => Array.from({length:5},(_,i)=>`<span class="star${i>=n?' off':''}">★</span>`).join('');

// ── STATE ─────────────────────────────────────────────────────
let token = localStorage.getItem('ss_token') || null;
let user  = JSON.parse(localStorage.getItem('ss_user') || 'null');
let cart  = JSON.parse(localStorage.getItem('ss_cart') || '[]');
let allProds=[], filtered=[], _countsCache=[];
let activeFilter='ALL', activeSort='', maxPrice=Infinity, onlyStock=false;
let sliderMax = 300; // se actualiza dinámicamente tras cargar productos
let _coldTimer=null, _retryCount=0;
const MAX_RETRY=3, COLD_DELAY=3000, FETCH_TIMEOUT=12000;

// Páginas que requieren auth — redirigen a index al expirar
const PROTECTED_PAGES = ['orders.html'];
let _refreshing = null; // evita múltiples llamadas simultáneas al refresh

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderAuth();
  updateBadge();
  checkTokenExpiry();
  handleRedirectAfterLogin();       // ← si venimos de una redirección por sesión expirada
  if (document.getElementById('pgrid')) loadProducts();
});

// ══════════════════════════════════════════════════════════════
//  apiFetch — wrapper central para todos los fetch autenticados
//
//  - Agrega Authorization: Bearer <token> automáticamente
//  - Detecta 401 → logout automático + redirect o modal
//  - Lanza Error('Sesión expirada') para que el caller no procese la respuesta
// ══════════════════════════════════════════════════════════════
async function apiFetch(path, options = {}) {
  if (!token) {
    openModal('login');
    toast('Inicia sesión para continuar.', '🔒');
    throw new Error('No autenticado');
  }

  const url = path.startsWith('http') ? path : `${API}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers          // permite sobreescribir (ej: Idempotency-Key)
  };

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    const refreshed = await tryRefresh();
        if (refreshed) {
          // Reintentar la petición original con el nuevo token
          headers['Authorization'] = `Bearer ${token}`;
          response = await fetch(url, { ...options, headers });
          if (response.status === 401) {
            handleTokenExpired(); throw new Error('Sesión expirada');
          }
        } else {
          handleTokenExpired(); throw new Error('Sesión expirada');
        }
  }

  return response;
}


async function tryRefresh() {
  const refreshToken = localStorage.getItem('ss_refresh');
  if (!refreshToken) return false;

  // Si ya hay un refresh en progreso, esperar al mismo
  if (_refreshing) return _refreshing;

  _refreshing = (async () => {
    try {
      const r = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!r.ok) return false;
      const d = await r.json();
      token = d.token;
      localStorage.setItem('ss_token', token);
      localStorage.setItem('ss_refresh', d.refreshToken);  // ← nuevo
      return true;
    } catch { return false; }
    finally { _refreshing = null; }
  })();

  return _refreshing;
}

// ── TOKEN EXPIRY ───────────────────────────────────────────────
function handleTokenExpired() {
  // 1. Limpiar todo el estado local
  token = null; user = null; cart = [];
  localStorage.removeItem('ss_token');
  localStorage.removeItem('ss_user');
  localStorage.removeItem('ss_cart');
  renderAuth();
  updateBadge();

  // 2. Avisar al usuario
  toast('Tu sesión expiró. Inicia sesión de nuevo.', '🔒');

  // 3. Decidir comportamiento según la página actual
  const currentPage = window.location.pathname.split('/').pop();
  const isProtected = PROTECTED_PAGES.some(p => currentPage.includes(p));

  if (isProtected) {
    // En páginas protegidas: guardar URL actual y redirigir a index
    sessionStorage.setItem('ss_redirect', window.location.href);
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1500);                  // 1.5s para que el usuario lea el toast
  } else {
    // En index o product: abrir modal directamente sin redirigir
    setTimeout(() => {
      openModal('login');
      showMsg('le', 'Tu sesión ha expirado. Vuelve a iniciar sesión.', 'err');
    }, 500);
  }
}

// Redirigir al destino guardado después de un login exitoso
function handleRedirectAfterLogin() {
  const redirect = sessionStorage.getItem('ss_redirect');
  if (redirect && token) {
    sessionStorage.removeItem('ss_redirect');
    window.location.href = redirect;
  }
}

// Verificar expiración al cargar la página (sin esperar una petición)
function checkTokenExpiry() {
  if (!token) return;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const remainingMs = payload.exp * 1000 - Date.now();

    if (remainingMs <= 0) {
      // Ya expiró — limpiar silenciosamente
      token = null; user = null; cart = [];
      localStorage.removeItem('ss_token');
      localStorage.removeItem('ss_user');
      localStorage.removeItem('ss_cart');
      renderAuth(); updateBadge();
      toast('Tu sesión anterior expiró. Inicia sesión de nuevo.', '🔒');
      return;
    }

    // Programar logout automático exactamente cuando expire el JWT
    const delay = Math.min(remainingMs, 24 * 60 * 60 * 1000);
    setTimeout(() => { if (token) handleTokenExpired(); }, delay);

  } catch {
    localStorage.removeItem('ss_token');
    token = null;
  }
}

// ── NAVIGATION ────────────────────────────────────────────────
function goToProduct(id) { window.location.href = `product.html?id=${id}`; }
function scrollToGrid() { const el=document.getElementById('grid-anchor'); if(el) el.scrollIntoView({behavior:'smooth'}); }

// ── TOAST ─────────────────────────────────────────────────────
let _tt;
function toast(msg, icon='✓') {
  const el=document.getElementById('toast'); if(!el) return;
  const iEl=document.getElementById('t-icon'), mEl=document.getElementById('t-msg');
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
      // Guardar caché de TODOS los productos para los conteos por categoría
      if(!name && (!cat || cat==='ALL')) _countsCache=allProds;
      success=true; _retryCount=0; break;
    } catch {
      _retryCount++; if(_retryCount>MAX_RETRY) break;
      showColdBanner(_retryCount);
      await new Promise(res=>setTimeout(res,2000));
    }
  }
  clearTimeout(_coldTimer); _coldTimer=null;
  if(success){ hideColdBanner(); _retryCount=0; } else { loadMock(); _countsCache=[]; showFallbackBanner(); }
  updateCounts(); updatePriceSlider(); applyFilters();
}

function loadMock() {
  allProds=[
    {id:1,name:'The Dark Side of the Moon',brand:'Pink Floyd',price:29.99,stock:6,category:'VINYL'},
    {id:2,name:'Abbey Road',brand:'The Beatles',price:27.99,stock:3,category:'VINYL'},
    {id:3,name:'Led Zeppelin IV',brand:'Led Zeppelin',price:28.99,stock:10,category:'VINYL'},
    {id:4,name:'Nevermind',brand:'Nirvana',price:14.99,stock:0,category:'CD'},
    {id:5,name:'OK Computer',brand:'Radiohead',price:13.99,stock:18,category:'CD'},
    {id:6,name:'Black Album Tour Tee',brand:'Metallica',price:34.99,stock:12,category:'CLOTHING'},
    {id:7,name:'Dark Side Hoodie',brand:'Pink Floyd',price:59.99,stock:5,category:'CLOTHING'},
    {id:8,name:'Guitar Pick Set 12pcs',brand:'Dunlop',price:8.99,stock:22,category:'ACCESSORIES'},
    {id:9,name:'Leather Guitar Strap',brand:"Levy's",price:45.99,stock:4,category:'ACCESSORIES'},
    {id:10,name:'Acoustic Guitar',brand:'Fender',price:299.99,stock:0,category:'INSTRUMENTS'},
    {id:11,name:'Nevermind Poster A2',brand:'Nirvana',price:12.99,stock:8,category:'POSTERS'},
    {id:12,name:'Guitar for Beginners',brand:'Hal Leonard',price:24.99,stock:25,category:'BOOKS'},
  ].map(p=>({...p,_stars:rng(3,5),_reviews:rng(15,280)}));
}

// Ajusta el slider al precio más alto de los productos cargados
function updatePriceSlider() {
  const sl  = document.getElementById('price-slider');
  const lbl = document.getElementById('price-lbl');
  if (!sl || !allProds.length) return;

  const highest = Math.max(...allProds.map(p => p.price));
  const newMax  = Math.ceil(highest / 50) * 50;  // redondea al siguiente múltiplo de 50

  if (newMax !== sliderMax) {
    sliderMax = newMax;
    maxPrice  = Infinity;  // resetear filtro al cambiar el rango
    sl.max    = sliderMax;
    sl.value  = sliderMax;
    if (lbl) lbl.textContent = fmt(sliderMax);
  }
}

function updateCounts() {
  // Usar la caché de todos los productos para los conteos;
  // si aún no existe (primera carga fallida), usar allProds como fallback
  const src = _countsCache.length ? _countsCache : allProds;
  const safe=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  safe('cnt-all',src.length);
  safe('cnt-vinyl',src.filter(p=>p.category==='VINYL').length);
  safe('cnt-cd',src.filter(p=>p.category==='CD').length);
  safe('cnt-cl',src.filter(p=>p.category==='CLOTHING').length);
  safe('cnt-acc',src.filter(p=>p.category==='ACCESSORIES').length);
  safe('cnt-inst',src.filter(p=>p.category==='INSTRUMENTS').length);
  safe('cnt-post',src.filter(p=>p.category==='POSTERS').length);
  safe('cnt-book',src.filter(p=>p.category==='BOOKS').length);
}

function applyFilters() {
  let res=[...allProds];
  if(onlyStock) res=res.filter(p=>p.stock>0);
  if(maxPrice<Infinity) res=res.filter(p=>p.price<=maxPrice);
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
function onPrice(v){
  const val = +v;
  // Si el slider está al máximo, no hay filtro activo
  maxPrice = (val >= sliderMax) ? Infinity : val;
  document.getElementById('price-lbl').textContent = fmt(val);
  applyFilters();
}
function toggleStock(){
  onlyStock = !onlyStock;
  // Sincronizar ambos toggles (sidebar desktop + sheet móvil)
  ['toggle-track-v','toggle-track-v-m'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.classList.toggle('on',onlyStock);
  });
  ['toggle-thumb-v','toggle-thumb-v-m'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.classList.toggle('on',onlyStock);
  });
  applyFilters();
}
function onStockToggle(){toggleStock();}
function toggleSz(el){el.classList.toggle('on');}
let _st;
function onSearch(v){clearTimeout(_st);_st=setTimeout(()=>{v.length>1?loadProducts(v,''):loadProducts('',activeFilter);},380);}

// ── CHIPS ─────────────────────────────────────────────────────
const CAT_NAMES={ALL:'Todos',VINYL:'Vinilos',CD:'CDs',CLOTHING:'Ropa & Merch',ACCESSORIES:'Accesorios',INSTRUMENTS:'Instrumentos',POSTERS:'Posters',BOOKS:'Libros'};
let _chips=[];
function renderChips(){
  const row=document.getElementById('chips-row');if(!row)return;_chips=[];
  if(activeFilter!=='ALL')_chips.push({label:CAT_NAMES[activeFilter],clear:()=>{activeFilter='ALL';document.querySelectorAll('#cat-list .cat-opt,#cat-list-m .cat-opt').forEach((c,i)=>c.classList.toggle('on',i===0));loadProducts('','ALL');}});
  if(onlyStock)_chips.push({label:'En stock',clear:()=>{onlyStock=false;['toggle-track-v','toggle-track-v-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});['toggle-thumb-v','toggle-thumb-v-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});applyFilters();}});
  if(maxPrice<Infinity)_chips.push({label:`Precio ≤ ${fmt(maxPrice)}`,clear:()=>{maxPrice=Infinity;const sl=document.getElementById('price-slider');if(sl)sl.value=sliderMax;const pl=document.getElementById('price-lbl');if(pl)pl.textContent=fmt(sliderMax);applyFilters();}});
  row.innerHTML=_chips.length?_chips.map((c,i)=>`<div class="chip">${c.label}<button class="chip-x" onclick="_chips[${i}].clear()">×</button></div>`).join('')+`<button class="clear-btn" onclick="clearAll()">Limpiar todo</button>`:'';
}
function clearAll(){activeFilter='ALL';onlyStock=false;maxPrice=Infinity;activeSort='';const sl=document.getElementById('price-slider');if(sl)sl.value=sliderMax;const pl=document.getElementById('price-lbl');if(pl)pl.textContent=fmt(sliderMax);['toggle-track-v','toggle-track-v-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});['toggle-thumb-v','toggle-thumb-v-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('on');});['stock-toggle','stock-toggle-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.checked=false;});document.querySelectorAll('#cat-list .cat-opt,#cat-list-m .cat-opt').forEach((c,i)=>c.classList.toggle('on',i===0));loadProducts('','ALL');}

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
// ── CHECKOUT — 2 pasos: confirmación + loading ──────────────

// Paso 1: abrir modal de confirmación con resumen
function doCheckout(){
  if(!token){closeCart();openModal('login');return;}
  if(!cart.length){toast('Tu carrito está vacío','⚠️');return;}

  // Renderizar items en el modal
  const total = cart.reduce((s,i)=>s+i.price*i.qty, 0);
  document.getElementById('confirm-items').innerHTML = cart.map(i=>`
    <div class="confirm-item">
      <div class="confirm-item-left">
        <span class="confirm-item-icon">${ICONS[i.cat]||'📦'}</span>
        <div>
          <div class="confirm-item-name">${i.name}</div>
          <div class="confirm-item-qty">${i.qty} unidad${i.qty>1?'es':''} × ${fmt(i.price)}</div>
        </div>
      </div>
      <span class="confirm-item-price">${fmt(i.price*i.qty)}</span>
    </div>`).join('');
  document.getElementById('confirm-total').textContent = fmt(total);

  // Resetear estado del botón
  const btn = document.getElementById('btn-confirm-ok');
  if(btn){ btn.classList.remove('loading'); btn.disabled = false; }

  // Abrir modal
  document.getElementById('confirm-ov').classList.add('open');
}

function cancelCheckout(e){
  if(!e || e.target===document.getElementById('confirm-ov')) closeConfirm();
}
function closeConfirm(){
  document.getElementById('confirm-ov').classList.remove('open');
}

// Paso 2: confirmar y procesar con loading
async function confirmCheckout(){
  const btn = document.getElementById('btn-confirm-ok');

  // Activar estado loading
  btn.classList.add('loading');
  btn.disabled = true;

  try{
    const r = await apiFetch('/shopping/checkout',{
      method:'POST',
      headers:{'Idempotency-Key':`ck-${Date.now()}-${Math.random().toString(36).slice(2)}`}
    });
    const d = await r.json();
    if(!r.ok) throw new Error(d.message||'Error al procesar el pedido');

    // Éxito
    cart=[]; updateBadge(); closeConfirm(); closeCart();
    toast(`¡Pedido confirmado! 🎉 Orden #${d.orderId}`,'🎉');

  }catch(e){
    // Restaurar botón
    btn.classList.remove('loading');
    btn.disabled = false;
    if(e.message!=='Sesión expirada') toast(`Error: ${e.message}`,'⚠️');
  }
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
  const btn=document.getElementById('btn-login');
  if(btn){btn.classList.add('loading');btn.disabled=true;}
  try{
    const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});
    const d=await r.json();if(!r.ok)throw new Error(d.message||'Credenciales incorrectas');
    token=d.token;
    user=d.user||{};
    // Garantizar que el email siempre esté guardado en el objeto user
    if(!user.email) user.email=em;
    if(!user.firstName) user.firstName=em.split('@')[0];
    localStorage.setItem('ss_token',token);localStorage.setItem('ss_user',JSON.stringify(user));
    checkTokenExpiry();
    closeOverlay('auth-ov');
    renderAuth();
    toast(`¡Bienvenido, ${user.firstName||''}!`,'👋');
    const redirect=sessionStorage.getItem('ss_redirect');
    if(redirect){ sessionStorage.removeItem('ss_redirect'); window.location.href=redirect; return; }
    if(typeof loadOrders==='function') loadOrders(0);
  }catch(e){showMsg('le',e.message);}
  finally{if(btn){btn.classList.remove('loading');btn.disabled=false;}}
}

async function doRegister(){
  const fn=document.getElementById('r-fn').value.trim(),ln=document.getElementById('r-ln').value.trim();
  const em=document.getElementById('r-em').value.trim(),pw=document.getElementById('r-pw').value;
  if(!fn||!ln||!em||!pw){showMsg('re','Completa todos los campos');return;}
  const btn=document.getElementById('btn-register');
  if(btn){btn.classList.add('loading');btn.disabled=true;}
  try{
    const r=await fetch(`${API}/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:fn,lastName:ln,email:em,password:pw})});
    const d=await r.json();if(!r.ok)throw new Error(d.message||'Error al registrar');
    showMsg('rs','¡Cuenta creada! Ahora inicia sesión.','ok');
    setTimeout(()=>switchForm('login'),1800);
  }catch(e){showMsg('re',e.message);}
  finally{if(btn){btn.classList.remove('loading');btn.disabled=false;}}
}

function logout(){
  token=null;user=null;cart=[];
  localStorage.removeItem('ss_token');localStorage.removeItem('ss_user');localStorage.removeItem('ss_cart');
  renderAuth();updateBadge();toast('Sesión cerrada','👋');
}
