// ── ORDERS PAGE LOGIC ─────────────────────────────────────────
// Este script va dentro de orders.html — NO redeclara nada de app.js

const PAGE_SIZE = 10;
let allOrders  = [];
let filteredOr = [];
let currentPage= 0;
let totalPages = 0;
let activeTab  = 'ALL';
let isLoading  = false;

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!token) { showNotAuth(); return; }
  loadOrders();
});

// ── LOAD ORDERS ───────────────────────────────────────────────
async function loadOrders(page = 0) {
  if (isLoading) return;
  isLoading = true;
  if (page === 0) renderSkelOrders();

  try {
    // ← apiFetch maneja el 401 automáticamente
    const r = await apiFetch(`/orders/my?page=${page}&size=${PAGE_SIZE}`);
    if (!r.ok) throw new Error('Error al cargar pedidos');
    const d = await r.json();

    const items = d.content || d.orders || (Array.isArray(d) ? d : []);
    totalPages  = d.totalPages || 1;
    currentPage = page;

    allOrders = page === 0 ? items : [...allOrders, ...items];

    applyTab();
    renderStats();
    showControls();
    document.getElementById('load-more-wrap').style.display =
      currentPage + 1 < totalPages ? 'block' : 'none';

  } catch(e) {
    if (e.message === 'Sesión expirada') return; // apiFetch ya manejó el logout
    if (page === 0) renderError(e.message);
    else toast('Error al cargar más pedidos', '⚠️');
  } finally {
    isLoading = false;
  }
}

function loadMore() { loadOrders(currentPage + 1); }

// ── FILTER TABS ───────────────────────────────────────────────
function filterOrders(status, el) {
  activeTab = status;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  applyTab();
}
function applyTab() {
  filteredOr = activeTab === 'ALL' ? allOrders : allOrders.filter(o => o.status === activeTab);
  renderOrders(filteredOr);
}

// ── STATS ─────────────────────────────────────────────────────
function renderStats() {
  if (!allOrders.length) return;
  document.getElementById('stat-total').textContent = allOrders.length;
  document.getElementById('stat-spent').textContent = fmt(allOrders.reduce((s,o) => s+(o.totalAmount||0), 0));
  document.getElementById('stat-last').textContent  = allOrders[0]?.createdAt ? fmtDate(allOrders[0].createdAt) : '—';
  document.getElementById('stats-bar').style.display = 'grid';
}
function showControls() { document.getElementById('filter-tabs').style.display = 'flex'; }

// ── RENDER ────────────────────────────────────────────────────
function renderOrders(orders) {
  const el = document.getElementById('orders-content');
  if (!orders.length) {
    el.innerHTML = `
      <div class="state-box">
        <div class="state-icon">📦</div>
        <div class="state-title">${activeTab==='ALL' ? 'Aún no tienes pedidos' : 'Sin pedidos '+tabLabel(activeTab).toLowerCase()}</div>
        <div class="state-sub">${activeTab==='ALL' ? 'Cuando realices tu primera compra aparecerá aquí.' : 'No tienes pedidos con este estado.'}</div>
        ${activeTab==='ALL' ? `<button class="btn-primary-sm" onclick="window.location.href='index.html'">Explorar productos</button>` : ''}
      </div>`;
    return;
  }
  el.innerHTML = `<div class="order-list">${orders.map(renderOrderCard).join('')}</div>`;
}

function renderOrderCard(o) {
  const sCls   = {PAID:'status-paid',PENDING:'status-pending',CANCELLED:'status-cancelled'}[o.status]||'status-pending';
  const sLabel = {PAID:'Pagado',PENDING:'Pendiente',CANCELLED:'Cancelado'}[o.status]||o.status;
  const date   = o.createdAt ? fmtDate(o.createdAt) : '—';
  const items  = o.items || [];
  const itemsHtml = items.length
    ? items.map(i=>`
        <div class="oi">
          <div class="oi-thumb">${ICONS[i.category]||guessIcon(i.productName)}</div>
          <div class="oi-info">
            <div class="oi-name">${i.productName||'Producto'}</div>
            <div class="oi-qty">Cantidad: ${i.quantity}</div>
          </div>
          <div class="oi-price">${fmt(i.subtotal||i.unitPrice*i.quantity||0)}</div>
        </div>`).join('')
    : `<div style="font-size:13px;color:var(--ink4);padding:.5rem 0">Haz clic en "Ver detalle" para ver los productos.</div>`;

  return `
  <div class="order-card" id="oc-${o.orderId}">
    <div class="order-card-hd" onclick="toggleOrder(${o.orderId})">
      <div class="order-hd-left">
        <span class="order-num">Orden #${o.orderId}</span>
        <span class="order-date">${date}</span>
        <span class="order-status ${sCls}"><span class="status-dot"></span>${sLabel}</span>
      </div>
      <div class="order-hd-right">
        <span class="order-total">${fmt(o.totalAmount||0)}</span>
        <svg class="order-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
    </div>
    <div class="order-body" id="ob-${o.orderId}">
      <div class="order-items" id="oi-${o.orderId}">${itemsHtml}</div>
      <div class="order-summary">
        <div class="order-summary-total">
          <span>Total pagado</span>
          <strong>${fmt(o.totalAmount||0)}</strong>
        </div>
        <div style="display:flex;gap:.625rem;flex-wrap:wrap">
          <button class="btn-reorder" onclick="reorder(${o.orderId},event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
            Volver a pedir
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── TOGGLE & DETAIL ───────────────────────────────────────────
function toggleOrder(id) {
  const card = document.getElementById(`oc-${id}`);
  const wasOpen = card.classList.contains('open');
  card.classList.toggle('open');
  if (!wasOpen) loadOrderDetail(id);
}

async function loadOrderDetail(id, e) {
  if (e) e.stopPropagation();
  const existing = allOrders.find(o => o.orderId === id);
  if (existing?.items?.length) return;
  const itemsEl = document.getElementById(`oi-${id}`); if (!itemsEl) return;
  itemsEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;padding:.5rem 0;font-size:13px;color:var(--ink4)">
      <div style="width:16px;height:16px;border:2px solid var(--paper3);border-top-color:var(--ink);border-radius:50%;animation:spin .8s linear infinite"></div>
      Cargando productos...
    </div>`;
  try {
    // ← apiFetch maneja el 401 automáticamente
    const r = await apiFetch(`/orders/${id}`);
    if (!r.ok) throw new Error();
    const d = await r.json();
    const order = allOrders.find(o => o.orderId === id);
    if (order) order.items = d.items || [];
    const items = d.items || [];
    itemsEl.innerHTML = items.length
      ? items.map(i=>`
          <div class="oi">
            <div class="oi-thumb">${ICONS[i.category]||guessIcon(i.productName)}</div>
            <div class="oi-info">
              <div class="oi-name">${i.productName}</div>
              <div class="oi-brand">${i.productBrand||''}</div>
              <div class="oi-qty">${i.quantity} × ${fmt(i.unitPrice)}</div>
            </div>
            <div class="oi-price">${fmt(i.subtotal)}</div>
          </div>`).join('')
      : `<div style="font-size:13px;color:var(--ink4);padding:.5rem 0">Sin items registrados.</div>`;
  } catch(e) {
    if (e.message !== 'Sesión expirada')
      itemsEl.innerHTML = `<div style="font-size:13px;color:var(--ink4);padding:.5rem 0">No se pudo cargar el detalle.</div>`;
  }
}

// ── REORDER ───────────────────────────────────────────────────
async function reorder(orderId, e) {
  if (e) e.stopPropagation();
  if (!token) { openModal('login'); return; }
  const order = allOrders.find(o => o.orderId === orderId);
  if (!order?.items?.length) {
    try {
      // ← apiFetch maneja el 401 automáticamente
      const r = await apiFetch(`/orders/${orderId}`);
      const d = await r.json();
      if (order) order.items = d.items || [];
    } catch(e) {
      if (e.message !== 'Sesión expirada') toast('No se pudo cargar el detalle del pedido', '⚠️');
      return;
    }
  }
  const items = allOrders.find(o => o.orderId === orderId)?.items || [];
  if (!items.length) { toast('Este pedido no tiene productos', '⚠️'); return; }
  items.forEach(i => {
    const ex = cart.find(c => c.id === i.productId);
    if (ex) ex.qty += i.quantity;
    else cart.push({id:i.productId, name:i.productName, price:i.unitPrice, cat:i.category||'', qty:i.quantity});
  });
  updateBadge();
  toast(`${items.length} producto${items.length>1?'s':''} agregado${items.length>1?'s':''} al carrito`, '🛒');
  openCart();
}

// ── STATES ────────────────────────────────────────────────────
function showNotAuth() {
  document.getElementById('orders-content').innerHTML = `
    <div class="state-box">
      <div class="state-icon">🔒</div>
      <div class="state-title">Inicia sesión para ver tus pedidos</div>
      <div class="state-sub">Tu historial de compras estará disponible después de iniciar sesión.</div>
      <button class="btn-primary-sm" onclick="openModal('login')">Iniciar sesión</button>
    </div>`;
}
function renderSkelOrders() {
  document.getElementById('orders-content').innerHTML = Array(4).fill(0).map(()=>`
    <div class="order-skel">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem">
        <div style="display:flex;gap:.875rem;align-items:center;flex:1">
          <div class="sk" style="height:14px;width:80px"></div>
          <div class="sk" style="height:12px;width:90px"></div>
          <div class="sk" style="height:20px;width:70px;border-radius:20px"></div>
        </div>
        <div class="sk" style="height:15px;width:70px"></div>
      </div>
    </div>`).join('');
}
function renderError(msg) {
  document.getElementById('orders-content').innerHTML = `
    <div class="state-box">
      <div class="state-icon">⚠️</div>
      <div class="state-title">Error al cargar pedidos</div>
      <div class="state-sub">${msg||'Intenta de nuevo en unos momentos.'}</div>
      <button class="btn-primary-sm" onclick="loadOrders(0)">Reintentar</button>
    </div>`;
}

// ── HELPERS ───────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  // El backend devuelve UTC sin 'Z' — se la agregamos para que el navegador
  // sepa que debe convertir a la zona horaria local del usuario (ej: UTC-5 Perú)
  const utc = iso.endsWith('Z') ? iso : iso + 'Z';
  return new Date(utc).toLocaleDateString('es-PE', {day:'2-digit', month:'short', year:'numeric'});
}
function tabLabel(s) { return {ALL:'Todos',PAID:'Pagados',PENDING:'Pendientes',CANCELLED:'Cancelados'}[s]||s; }
function guessIcon(name='') {
  const n=name.toLowerCase();
  if(n.includes('shoe')||n.includes('boot')||n.includes('run')||n.includes('trail')||n.includes('speed')||n.includes('cloud')) return '👟';
  if(n.includes('shirt')||n.includes('tee')||n.includes('hoodie')||n.includes('short')||n.includes('sock')||n.includes('jacket')) return '👕';
  return '🏋️';
}
