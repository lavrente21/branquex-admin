import { supabase } from './supabase-config.js';

let current = 'dashboard', toastTimer, appState = { products: [], orders: [], movements: [], municipalities: [], payments: [], expenses: [], settings: {} };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statuses = ['Aguardando confirmação', 'Confirmada', 'Em preparação', 'Em distribuição', 'Entregue', 'Levantada', 'Cancelada'];
const statusClass = s => ({ 'Aguardando confirmação': 'pending', 'Confirmada': 'confirmed', 'Em preparação': 'processing', 'Em distribuição': 'distribution', 'Entregue': 'delivered', 'Levantada': 'delivered', 'Cancelada': 'cancelled' }[s] || '');
const money = n => new Intl.NumberFormat('pt-AO', { maximumFractionDigits: 0 }).format(Number(n) || 0) + ' Kz';
const num = v => Number(v) || 0;
const must = async p => { const r = await p; if (r.error) throw r.error; return r; };
const errMsg = e => e?.code === '23503' ? 'Existem registos associados (ex.: encomendas). Oculte ou desative em vez de eliminar.' : (e?.message || 'Operação falhou.');
const fail = e => toast('Erro: ' + errMsg(e));
const effectivePrice = p => p.promo_price && Number(p.promo_price) > 0 && Number(p.promo_price) < Number(p.price) ? Number(p.promo_price) : Number(p.price);

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function showLogin() { $('#login-screen').hidden = false; $('#admin-app').hidden = true; }
function enter(user) { $('#login-screen').hidden = true; $('#admin-app').hidden = false; $('#admin-user-email').textContent = user.email; loadState(); }

async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return showLogin();
  const { data: admin } = await supabase.from('admin_users').select('user_id').eq('user_id', session.user.id).single();
  if (!admin) {
    await supabase.auth.signOut();
    $('#login-error').textContent = 'Conta sem permissões administrativas.';
    return showLogin();
  }
  enter(session.user);
}

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const btn = $('#login-btn'); btn.disabled = true; $('#login-error').textContent = '';
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) throw error;
    const { data: admin } = await supabase.from('admin_users').select('user_id').eq('user_id', data.user.id).single();
    if (!admin) {
      await supabase.auth.signOut();
      throw new Error('Esta conta não tem permissões administrativas.');
    }
    enter(data.user);
  } catch (err) {
    $('#login-error').textContent = err.message || 'Falha na autenticação.';
  } finally { btn.disabled = false; }
});

$('#logout-btn').addEventListener('click', async () => { await supabase.auth.signOut(); showLogin(); });
$('#side-nav').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (!b) return; current = b.dataset.view; $('#side-nav').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b)); $('.sidebar').classList.remove('open'); render(); });
$('#mobile-nav-toggle').addEventListener('click', () => $('.sidebar').classList.toggle('open'));

async function loadState() {
  try {
    const [p, o, m, mun, pay, exp, set] = await Promise.all([
      supabase.from('products').select('*').order('created_at', { ascending: false }),
      supabase.from('orders').select('*, customer:customers(*), items:order_items(*)').order('created_at', { ascending: false }),
      supabase.from('stock_movements').select('*').order('created_at', { ascending: false }),
      supabase.from('municipalities').select('*').order('name'),
      supabase.from('payments').select('*').order('created_at', { ascending: false }),
      supabase.from('expenses').select('*').order('created_at', { ascending: false }),
      supabase.from('store_settings').select('*').eq('id', 1).maybeSingle()
    ]);
    const bad = [p, o, m, mun, pay, exp, set].find(r => r.error);
    if (bad) toast('Erro ao carregar: ' + errMsg(bad.error));
    appState = {
      products: p.data || [],
      orders: (o.data || []).map(ord => ({ ...ord, createdAt: ord.created_at, referencePoint: ord.reference_point, deliveryFee: ord.delivery_fee })),
      movements: m.data || [],
      municipalities: mun.data || [],
      payments: pay.data || [],
      expenses: exp.data || [],
      settings: set.data || {}
    };
    render();
  } catch (err) {
    toast('Erro ao carregar dados do Supabase');
  }
}

function pageHead(title, desc, action = '') { return `<div class="page-head"><div><h2>${title}</h2><p>${desc}</p></div>${action}</div>`; }
function stat(label, value, note, icon = '◈') { return `<div class="stat-card"><span class="stat-icon">${icon}</span><div class="stat-label">${label}</div><strong>${value}</strong><small>${note}</small></div>`; }

function render() {
  const d = appState;
  const titles = { dashboard: 'Dashboard', products: 'Produtos', orders: 'Encomendas', customers: 'Clientes', stock: 'Stock', deliveries: 'Entregas', finance: 'Finanças', settings: 'Configurações' };
  $('#view-title').textContent = titles[current];
  $('#new-order-count').textContent = d.orders.filter(o => o.status === 'Aguardando confirmação').length || '';
  const root = $('#view-root');
  root.innerHTML = ({ dashboard: dashboard, products: products, orders: orders, customers: customers, stock: stock, deliveries: deliveries, finance: finance, settings: settings }[current])(d);
  bindView();
}

function dashboard(d) {
  const pending = d.orders.filter(o => ['Aguardando confirmação', 'Confirmada', 'Em preparação', 'Em distribuição'].includes(o.status));
  const delivered = d.orders.filter(o => ['Entregue', 'Levantada'].includes(o.status));
  const revenue = d.payments.reduce((a, x) => a + Number(x.amount), 0);
    const DAYS = 14, today = new Date();
  const bars = Array.from({ length: DAYS }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DAYS - 1 - i));
    const key = date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    const day = d.orders.filter(o => o.status !== 'Cancelada' && orderDay(o) === key);
    return { label: pad2(date.getDate()) + '/' + pad2(date.getMonth() + 1), sum: day.reduce((a, o) => a + Number(o.total), 0), count: day.length };
  });
  const max = Math.max(1, ...bars.map(x => x.sum));
  return `${pageHead('Visão geral', 'Resumo da atividade da sua loja.')}<div class="stats-grid">${stat('Total de encomendas', d.orders.length, 'Registos em base de dados', '▤')}${stat('Novas encomendas', d.orders.filter(o => o.status === 'Aguardando confirmação').length, 'Aguardam confirmação', '✦')}${stat('Encomendas pendentes', pending.length, 'Em processamento', '◷')}${stat('Encomendas entregues', delivered.length, 'Entregues ou levantadas', '✓')}${stat('Stock disponível', d.products.reduce((a, p) => a + Number(p.stock || 0), 0), 'Unidades registadas', '▥')}${stat('Valores recebidos', money(revenue), 'Pagamentos registados', '◫')}${stat('Produtos ativos', d.products.filter(p => p.active && p.published).length, 'Visíveis na loja', '◇')}${stat('Stock baixo', d.products.filter(p => p.stock <= p.min_stock).length, 'No limite ou abaixo', '!')}${dupCard()}</div><div class="dashboard-grid"><section class="panel"><h3>Volume de encomendas · últimos 14 dias</h3><div class="bar-chart">${bars.map(x => `<div class="bar-col"><small>${x.count || ''}</small><div class="bar" title="${x.label} · ${x.count} encomenda(s) · ${money(x.sum)}" style="height:${Math.max(4, x.sum / max * 100)}%"></div><small>${x.label}</small></div>`).join('')}</div></section><section class="panel"><h3>Encomendas recentes</h3><div class="simple-list">${d.orders.slice(0, 5).map(o => `<div class="list-row"><div><strong>${esc(o.reference)}</strong><small>${esc(o.customer?.name || 'Cliente')}</small></div><div style="text-align:right"><strong>${money(o.total)}</strong><small>${esc(o.status)}</small></div></div>`).join('') || '<div class="empty-state">Ainda não existem encomendas.</div>'}</div></section></div><section class="panel" style="margin-top:15px"><h3>Alertas de stock baixo</h3><div class="simple-list">${d.products.filter(p => p.stock <= p.min_stock).map(p => `<div class="list-row"><div><strong>${esc(p.name)}</strong><small>Stock mínimo: ${p.min_stock}</small></div><span class="status ${p.stock <= 0 ? 'out' : 'pending'}">${p.stock <= 0 ? 'Esgotado' : p.stock + ' unidades'}</span></div>`).join('') || '<div class="empty-state">Não existem alertas de stock.</div>'}</div></section>`;
}

function products(d) { return `${pageHead('Gestão de produtos', 'Adicione, edite e publique produtos na loja.', '<button class="btn btn-primary" data-action="add-product">＋ Adicionar produto</button>')}<section class="table-panel"><div class="table-toolbar"><input id="product-search" placeholder="Pesquisar produto..."><select id="product-filter"><option value="all">Todos os estados</option><option value="active">Ativos e publicados</option><option value="hidden">Ocultos ou inativos</option><option value="out">Esgotados</option></select><span class="toolbar-spacer"></span><small class="muted">${d.products.length} produto(s)</small></div><div class="table-wrap"><table><thead><tr><th>PRODUTO</th><th>PREÇO</th><th>STOCK</th><th>VISIBILIDADE</th><th>DESTAQUE</th><th>AÇÕES</th></tr></thead><tbody id="products-body">${d.products.map(p => productRow(p)).join('') || '<tr><td colspan="6" class="empty-state">Nenhum produto registado.</td></tr>'}</tbody></table></div></section>`; }
function productRow(p) { return `<tr data-product-row="${esc(p.id)}" data-search="${esc((String(p.name) + ' ' + (p.category || '')).toLowerCase())}" data-state="${p.active && p.published ? 'active' : 'hidden'}${p.stock <= 0 ? ' out' : ''}"><td><div style="display:flex;align-items:center;gap:10px"><span class="product-thumb">${p.image ? `<img src="${esc(p.image)}" style="width:100%;height:100%;object-fit:cover;border-radius:7px">` : 'B'}</span><div><strong>${esc(p.name)}</strong><small class="muted" style="display:block;margin-top:3px">${esc(p.category || 'Sem categoria')}</small></div></div></td><td><strong>${money(effectivePrice(p))}</strong>${p.promo_price ? `<small class="muted" style="display:block;text-decoration:line-through">${money(p.price)}</small>` : ''}</td><td>${p.stock} un.</td><td><span class="status ${p.active && p.published ? 'active' : 'inactive'}">${p.active && p.published ? 'Publicado' : 'Oculto'}</span></td><td>${p.featured ? 'Sim' : '—'}</td><td><button class="action-btn" data-action="edit-product" data-id="${p.id}">Editar</button><button class="action-btn" data-action="toggle-product" data-id="${p.id}">${p.published ? 'Ocultar' : 'Publicar'}</button><button class="action-btn danger" data-action="delete-product" data-id="${p.id}">Eliminar</button></td></tr>`; }
// ===== Encomendas: filtros, ordenação e agrupamento (hora · zona · quantidade) =====
const orderDefaults = { q: '', status: 'all', zone: 'all', from: '', to: '', hFrom: '', hTo: '', qMin: '', qMax: '', sort: 'recent', group: 'none', alert: 'all' };
const orderUI = { ...orderDefaults };
const pad2 = n => String(n).padStart(2, '0');
const orderQty = o => (o.items || []).reduce((a, i) => a + num(i.quantity), 0);
const orderHour = o => new Date(o.createdAt).getHours();
const orderMins = o => { const d = new Date(o.createdAt); return d.getHours() * 60 + d.getMinutes(); };
const orderDay = o => { const d = new Date(o.createdAt); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const orderZoneId = o => o.municipality_id || '__none';
const orderZone = o => appState.municipalities.find(m => m.id === o.municipality_id)?.name || 'Sem zona';
const orderProvince = o => appState.municipalities.find(m => m.id === o.municipality_id)?.province || '';
const orderPaid = o => appState.payments.filter(x => x.order_id === o.id).reduce((a, x) => a + num(x.amount), 0);
const orderPayment = o => {
  const paid = orderPaid(o), total = num(o.total);
  if (o.status === 'Cancelada') return { label: '—', cls: '', paid };
  if (paid >= total && total > 0) return { label: 'Pago', cls: 'active', paid };
  if (paid > 0) return { label: 'Parcial', cls: 'pending', paid };
  return { label: 'Por pagar', cls: 'inactive', paid };
};
const phoneKey = o => { const d = String(o.customer?.phone || '').replace(/\D/g, ''); return d.length > 9 ? d.slice(-9) : d; };
const orderSig = o => (o.items || []).map(i => (i.product_id || i.product_name) + 'x' + i.quantity).sort().join('|');
let orderFlagMap = new Map();
// Marca encomendas ativas do mesmo telefone no mesmo dia: "dup" = mesmos produtos e quantidades; senão, "multi".
function orderFlags() {
  const groups = new Map(), flags = new Map();
  appState.orders.filter(o => o.status !== 'Cancelada' && phoneKey(o)).forEach(o => {
    const k = phoneKey(o) + '#' + orderDay(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  groups.forEach(list => {
    if (list.length < 2) return;
    list.forEach(o => {
      const others = list.filter(x => x !== o);
      flags.set(o.id, { dup: others.filter(x => orderSig(x) === orderSig(o)).map(x => x.reference), others: others.map(x => x.reference) });
    });
  });
  return flags;
}
// Duplicadas = mesmo telefone, mesmo dia e mesmos produtos/quantidades. O montante conta só a 1.ª de cada grupo.
function duplicateSummary() {
  const flags = orderFlags(), groups = new Map();
  appState.orders.forEach(o => {
    if (!flags.get(o.id)?.dup.length) return;
    const k = phoneKey(o) + '#' + orderDay(o) + '#' + orderSig(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  let orders = 0, amount = 0;
  groups.forEach(g => { g.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)); orders += g.length; amount += num(g[0].total); });
  return { orders, groups: groups.size, amount };
}
function dupCard() {
  const r = duplicateSummary();
  const html = stat('Possíveis duplicadas', r.orders, r.orders ? `Montante: ${money(r.amount)} · só a 1.ª de cada grupo` : 'Nenhuma encomenda duplicada', '≈');
  return r.orders ? html.replace('<div class="stat-card">', '<div class="stat-card stat-link" data-goto-dup title="Ver as duplicadas em Encomendas">') : html;
}
const flagBadge = f => !f ? '' : f.dup.length
  ? `<small style="display:block;margin-top:4px"><span class="status inactive" title="Igual a: ${esc(f.dup.join(', '))}">Duplicada</span></small><small class="muted" style="display:block">Igual a ${esc(f.dup.join(', '))}</small>`
  : `<small style="display:block;margin-top:4px"><span class="status pending" title="Outras: ${esc(f.others.join(', '))}">${f.others.length + 1} encomendas hoje</span></small><small class="muted" style="display:block">Com ${esc(f.others.join(', '))}</small>`;
const byRecent = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const orderSorters = {
  recent: byRecent,
  oldest: (a, b) => -byRecent(a, b),
  hour: (a, b) => orderMins(a) - orderMins(b) || byRecent(a, b),
  zone: (a, b) => orderZone(a).localeCompare(orderZone(b), 'pt') || byRecent(a, b),
  qtyDesc: (a, b) => orderQty(b) - orderQty(a) || byRecent(a, b),
  qtyAsc: (a, b) => orderQty(a) - orderQty(b) || byRecent(a, b),
  total: (a, b) => num(b.total) - num(a.total) || byRecent(a, b)
};
const orderGroupers = {
  hour: { key: o => pad2(orderHour(o)), label: k => `${k}:00 – ${k}:59`, cmp: (a, b) => a.localeCompare(b) },
  zone: { key: orderZone, label: k => k, cmp: (a, b) => a.localeCompare(b, 'pt') },
  qty: { key: o => String(orderQty(o)), label: k => `${k} unidade${k === '1' ? '' : 's'}`, cmp: (a, b) => num(a) - num(b) },
  day: { key: orderDay, label: k => k.split('-').reverse().join('/'), cmp: (a, b) => b.localeCompare(a) }
};
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
const hourOpts = (cur, first, suffix) => `<option value="" ${cur === '' ? 'selected' : ''}>${first}</option>` + Array.from({ length: 24 }, (_, h) => opt(String(h), pad2(h) + suffix, cur)).join('');

function filteredOrders() {
  const u = orderUI, q = u.q.trim().toLowerCase();
  const hasHours = u.hFrom !== '' || u.hTo !== '';
  const hf = u.hFrom === '' ? 0 : num(u.hFrom), ht = u.hTo === '' ? 23 : num(u.hTo);
  const inHours = h => hf <= ht ? (h >= hf && h <= ht) : (h >= hf || h <= ht);
  orderFlagMap = orderFlags();
  const qmin = u.qMin === '' ? -Infinity : num(u.qMin), qmax = u.qMax === '' ? Infinity : num(u.qMax);
  return appState.orders.filter(o => {
    const qty = orderQty(o), day = orderDay(o);
    if (q && ![o.reference, o.customer?.name, o.customer?.phone, orderZone(o), orderProvince(o), o.referencePoint, o.notes].join(' ').toLowerCase().includes(q)) return false;
    if (u.status !== 'all' && o.status !== u.status) return false;
    if (u.zone !== 'all' && orderZoneId(o) !== u.zone) return false;
    if (u.from && day < u.from) return false;
    if (u.to && day > u.to) return false;
    if (hasHours && !inHours(orderHour(o))) return false;
    if (qty < qmin || qty > qmax) return false;
    const fl = orderFlagMap.get(o.id);
    if (u.alert === 'any' && !fl) return false;
    if (u.alert === 'dup' && !fl?.dup.length) return false;
    if (u.alert === 'multi' && (!fl || fl.dup.length)) return false;
    return true;
  });
}

function orders(d) {
  const u = orderUI, zoneCount = {};
  d.orders.forEach(o => { const k = orderZoneId(o); zoneCount[k] = (zoneCount[k] || 0) + 1; });
  const zoneOpts = opt('all', 'Todas as zonas', u.zone) + d.municipalities.map(m => opt(m.id, `${esc(m.name)} (${zoneCount[m.id] || 0})`, u.zone)).join('') + (zoneCount.__none ? opt('__none', `Sem zona (${zoneCount.__none})`, u.zone) : '');
  const tf = (label, control) => `<label class="tf">${label}${control}</label>`;
  return `${pageHead('Gestão de encomendas', 'Organize os pedidos por hora, zona e quantidade.')}
  <div id="orders-stats" class="stats-grid"></div>
  <section class="table-panel">
    <div class="table-toolbar order-filters">
      ${tf('Pesquisar', `<input id="of-q" placeholder="Referência, cliente, telefone, local ou notas..." value="${esc(u.q)}">`)}
      ${tf('Estado', `<select id="of-status">${opt('all', 'Todos os estados', u.status)}${statuses.map(s => opt(s, s, u.status)).join('')}</select>`)}
      ${tf('Zona', `<select id="of-zone">${zoneOpts}</select>`)}
      ${tf('Data de', `<input id="of-from" type="date" value="${esc(u.from)}">`)}
      ${tf('Data até', `<input id="of-to" type="date" value="${esc(u.to)}">`)}
      ${tf('Hora de', `<select id="of-hfrom">${hourOpts(u.hFrom, 'Qualquer', ':00')}</select>`)}
      ${tf('Hora até', `<select id="of-hto">${hourOpts(u.hTo, 'Qualquer', ':59')}</select>`)}
      ${tf('Qtd. mín.', `<input id="of-qmin" type="number" min="0" step="1" placeholder="0" value="${esc(u.qMin)}">`)}
      ${tf('Qtd. máx.', `<input id="of-qmax" type="number" min="0" step="1" placeholder="∞" value="${esc(u.qMax)}">`)}
      ${tf('Alertas', `<select id="of-alert">${opt('all', 'Todas', u.alert)}${opt('any', 'Só marcadas', u.alert)}${opt('dup', 'Duplicadas', u.alert)}${opt('multi', 'Cliente com 2+ encomendas', u.alert)}</select>`)}
      ${tf('Ordenar por', `<select id="of-sort">${opt('recent', 'Mais recentes', u.sort)}${opt('oldest', 'Mais antigas', u.sort)}${opt('hour', 'Hora do dia (cedo → tarde)', u.sort)}${opt('zone', 'Zona (A–Z)', u.sort)}${opt('qtyDesc', 'Quantidade (maior → menor)', u.sort)}${opt('qtyAsc', 'Quantidade (menor → maior)', u.sort)}${opt('total', 'Total (maior → menor)', u.sort)}</select>`)}
      ${tf('Agrupar por', `<select id="of-group">${opt('none', 'Sem agrupamento', u.group)}${opt('hour', 'Hora', u.group)}${opt('zone', 'Zona', u.group)}${opt('qty', 'Quantidade', u.group)}${opt('day', 'Dia', u.group)}</select>`)}
      <button type="button" class="btn btn-outline" id="of-clear">Limpar filtros</button>
      <span class="toolbar-spacer"></span><small class="muted" id="orders-count"></small>
    </div>
    <div class="table-wrap"><table class="orders-table"><thead><tr><th>REFERÊNCIA</th><th>CLIENTE</th><th>LOCALIZAÇÃO</th><th>PRODUTO(S)</th><th>QTD.</th><th>ENTREGA</th><th>TOTAL</th><th>PAGAMENTO</th><th>OBSERVAÇÕES</th><th>HORA</th><th>ESTADO</th><th>AÇÕES</th></tr></thead><tbody id="orders-body"></tbody></table></div>
  </section>`;
}

function orderRow(o) {
  const d = new Date(o.createdAt), pay = orderPayment(o), prov = orderProvince(o), fl = orderFlagMap.get(o.id);
  const digits = String(o.customer?.phone || '').replace(/\D/g, '');
  const wa = digits ? 'https://wa.me/' + (digits.length === 9 ? '244' + digits : digits) : '';
  const phone = digits ? `<a href="tel:${esc(digits)}">${esc(o.customer.phone)}</a> · <a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '';
  return `<tr class="${fl ? (fl.dup.length ? 'flagged-dup' : 'flagged-multi') : ''}"><td><strong>${esc(o.reference)}</strong>${flagBadge(fl)}</td><td>${esc(o.customer?.name || 'Desconhecido')}<small class="muted" style="display:block">${phone}</small></td><td class="wrap-cell"><span class="zone-tag">${esc(orderZone(o))}</span>${prov ? `<small class="muted"> ${esc(prov)}</small>` : ''}<small class="muted" style="display:block;margin-top:4px">${o.referencePoint ? esc(o.referencePoint) : 'Sem ponto de referência'}</small></td><td>${(o.items || []).map(i => esc(i.product_name) + ' × ' + esc(i.quantity)).join('<br>')}</td><td><span class="qty-pill">${orderQty(o)}</span></td><td>${o.deliveryFee != null ? money(o.deliveryFee) : '—'}</td><td><strong>${money(o.total)}</strong></td><td><span class="status ${pay.cls}">${pay.label}</span>${pay.paid ? `<small class="muted" style="display:block;margin-top:3px">${money(pay.paid)}</small>` : ''}</td><td class="wrap-cell">${o.notes ? esc(o.notes) : '<span class="muted">—</span>'}</td><td><strong>${pad2(d.getHours())}:${pad2(d.getMinutes())}</strong><small class="muted" style="display:block">${d.toLocaleDateString('pt-AO')}</small></td><td><span class="status ${statusClass(o.status)}">${esc(o.status)}</span></td><td>${waPhone(o) ? `<a class="action-btn wa-btn" href="${esc(waLink(o, waMessage(o)))}" target="_blank" rel="noopener noreferrer" title="Mensagem pronta para o estado: ${esc(o.status)}">WhatsApp</a>` : ''}<button class="action-btn" data-action="order-detail" data-id="${o.id}">Detalhes</button><button class="action-btn" data-action="next-status" data-id="${o.id}">Avançar</button></td></tr>`;
}

function ordersStats(list) {
  const live = list.filter(o => o.status !== 'Cancelada');
  const units = live.reduce((a, o) => a + orderQty(o), 0), value = live.reduce((a, o) => a + num(o.total), 0);
  const top = fn => { const c = {}; live.forEach(o => { const k = fn(o); c[k] = (c[k] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; };
  const th = top(o => pad2(orderHour(o))), tz = top(orderZone);
  return stat('Encomendas', list.length, `${list.length - live.length} cancelada(s)`, '▤')
    + stat('Unidades', units, 'Sem canceladas', '▥')
    + stat('Valor', money(value), 'Sem canceladas', '◫')
    + stat('Hora de pico', th ? `${th[0]}h` : '—', th ? `${th[1]} encomenda(s)` : 'Sem dados', '◷')
    + stat('Zona principal', tz ? esc(tz[0]) : '—', tz ? `${tz[1]} encomenda(s)` : 'Sem dados', '⌁');
}

function refreshOrders() {
  const body = $('#orders-body'); if (!body) return;
  const list = filteredOrders().sort(orderSorters[orderUI.sort] || byRecent);
  $('#orders-stats').innerHTML = ordersStats(list);
  $('#orders-count').textContent = `${list.length} de ${appState.orders.length} encomenda(s)` + (orderFlagMap.size ? ` · ${orderFlagMap.size} marcada(s)` : '');
  const g = orderGroupers[orderUI.group];
  let html;
  if (!list.length) html = `<tr><td colspan="12" class="empty-state">${appState.orders.length ? 'Nenhuma encomenda corresponde aos filtros.' : 'Ainda não existem encomendas.'}</td></tr>`;
  else if (!g) html = list.map(orderRow).join('');
  else {
    const groups = new Map();
    list.forEach(o => { const k = g.key(o); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
    html = [...groups.keys()].sort(g.cmp).map(k => {
      const rows = groups.get(k), live = rows.filter(o => o.status !== 'Cancelada');
      return `<tr class="group-row"><td colspan="12"><strong>${esc(g.label(k))}</strong><small>${rows.length} encomenda(s) · ${live.reduce((a, o) => a + orderQty(o), 0)} un. · ${money(live.reduce((a, o) => a + num(o.total), 0))}</small></td></tr>` + rows.map(orderRow).join('');
    }).join('');
  }
  body.innerHTML = html;
  bindActions(body);
}

function bindOrderFilters() {
  const map = { 'of-q': 'q', 'of-status': 'status', 'of-zone': 'zone', 'of-from': 'from', 'of-to': 'to', 'of-hfrom': 'hFrom', 'of-hto': 'hTo', 'of-qmin': 'qMin', 'of-qmax': 'qMax', 'of-sort': 'sort', 'of-group': 'group', 'of-alert': 'alert' };
  Object.entries(map).forEach(([id, k]) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { orderUI[k] = el.value; refreshOrders(); }); });
  $('#of-clear')?.addEventListener('click', () => { Object.assign(orderUI, orderDefaults); render(); });
  refreshOrders();
}
// ===== fim Encomendas =====
function stock(d) { const pn = id => d.products.find(p => p.id === id)?.name || 'Produto'; return `${pageHead('Gestão de stock', 'Controle quantidades e reposições.')}<section class="table-panel"><div class="table-toolbar"><input id="stock-search" placeholder="Pesquisar produto..."><button class="btn btn-primary" data-action="stock-move">＋ Registar movimento</button></div><div class="table-wrap"><table><thead><tr><th>PRODUTO</th><th>STOCK ATUAL</th><th>STOCK MÍNIMO</th><th>ESTADO</th><th>AÇÕES</th></tr></thead><tbody id="stock-body">${d.products.map(p => `<tr data-search="${esc(String(p.name).toLowerCase())}"><td><strong>${esc(p.name)}</strong></td><td>${p.stock} unidades</td><td>${p.min_stock}</td><td><span class="status ${p.stock <= 0 ? 'out' : p.stock <= p.min_stock ? 'pending' : 'active'}">${p.stock <= 0 ? 'Esgotado' : p.stock <= p.min_stock ? 'Stock baixo' : 'Disponível'}</span></td><td><button class="action-btn" data-action="stock-move" data-id="${esc(p.id)}">Movimentar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Sem produtos.</td></tr>'}</tbody></table></div></section><section class="panel" style="margin-top:15px"><h3>Movimentos recentes</h3><div class="simple-list">${d.movements.slice(0, 10).map(m => `<div class="list-row"><div><strong>${esc(pn(m.product_id))}</strong><small>${esc(m.type || '')}${m.note ? ' · ' + esc(m.note) : ''} · ${new Date(m.created_at).toLocaleDateString('pt-AO')}</small></div><strong>${esc(m.quantity)}</strong></div>`).join('') || '<div class="empty-state">Sem movimentos registados.</div>'}</div></section>`; }
function deliveries(d) { return `${pageHead('Entregas e zonas', 'Configure municípios e taxas de entrega.', '<button class="btn btn-primary" data-action="add-zone">＋ Adicionar município</button>')}<section class="table-panel"><div class="table-toolbar"><strong style="font-size:11px">Zonas de entrega</strong></div><div class="table-wrap"><table><thead><tr><th>MUNICÍPIO</th><th>PROVÍNCIA</th><th>TAXA</th><th>ESTADO</th><th>AÇÕES</th></tr></thead><tbody>${d.municipalities.map(m => `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(m.province)}</td><td>${money(m.fee)}</td><td><span class="status ${m.active ? 'active' : 'inactive'}">${m.active ? 'Ativo' : 'Inativo'}</span></td><td><button class="action-btn" data-action="edit-zone" data-id="${m.id}">Editar</button><button class="action-btn" data-action="toggle-zone" data-id="${m.id}">${m.active ? 'Desativar' : 'Ativar'}</button><button class="action-btn danger" data-action="delete-zone" data-id="${m.id}">Eliminar</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty-state">Ainda não existem municípios.</td></tr>'}</tbody></table></div></section>`; }
function finance(d) { const received = d.payments.reduce((a, p) => a + num(p.amount), 0), sales = d.orders.filter(o => o.status !== 'Cancelada').reduce((a, o) => a + num(o.total), 0), expenses = d.expenses.reduce((a, x) => a + num(x.amount), 0); const refOf = id => d.orders.find(o => o.id === id)?.reference || 'Pagamento'; const acts = '<div class="head-actions"><button class="btn btn-outline" data-action="add-payment">＋ Registar pagamento</button><button class="btn btn-primary" data-action="add-expense">＋ Registar despesa</button></div>'; return `${pageHead('Gestão financeira', 'Registe pagamentos e despesas.', acts)}<div class="stats-grid">${stat('Faturação registada', money(sales), 'Encomendas válidas', '◫')}${stat('Valores recebidos', money(received), 'Pagamentos efetuados', '✓')}${stat('Despesas', money(expenses), 'Despesas operacionais', '−')}${stat('Saldo', money(received - expenses), 'Recebido − despesas', '＝')}</div><div class="dashboard-grid"><section class="panel"><h3>Pagamentos recentes</h3><div class="simple-list">${d.payments.slice(0, 8).map(p => `<div class="list-row"><div><strong>${esc(refOf(p.order_id))}</strong><small>${esc(p.method || '')}</small></div><strong>${money(p.amount)}</strong></div>`).join('') || '<div class="empty-state">Sem pagamentos.</div>'}</div></section><section class="panel"><h3>Despesas recentes</h3><div class="simple-list">${d.expenses.slice(0, 8).map(x => `<div class="list-row"><div><strong>${esc(x.description || 'Despesa')}</strong><small>${new Date(x.created_at).toLocaleDateString('pt-AO')}</small></div><strong>${money(x.amount)}</strong></div>`).join('') || '<div class="empty-state">Sem despesas.</div>'}</div></section></div>`; }
function settings(d) { return `${pageHead('Configurações', 'Atualize os dados comerciais da loja.')}<form id="settings-form" class="setting-card"><h3>Informações da loja</h3><div class="setting-row"><label class="field">Nome da loja<input name="store_name" value="${esc(d.settings.store_name || 'BRANQUEX')}" required></label><label class="field">Telefone<input name="phone" value="${esc(d.settings.phone || '')}"></label><label class="field">Email<input name="email" type="email" value="${esc(d.settings.email || '')}"></label><label class="field">Localização<input name="location" value="${esc(d.settings.location || 'Angola')}"></label></div><button class="btn btn-primary">Guardar configurações</button></form>`; }

function openModal(html) { $('#modal-content').innerHTML = html; $('#app-modal').showModal(); }
$('.modal-close').addEventListener('click', () => $('#app-modal').close());

async function uploadFileToStorage(file) {
  if (!file.type.startsWith('image/')) throw new Error('O ficheiro tem de ser uma imagem.');
  if (file.size > 3 * 1024 * 1024) throw new Error('A imagem não pode exceder 3 MB.');
  const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  const filePath = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { data, error } = await supabase.storage.from('product-images').upload(filePath, file);
  if (error) throw error;
  const { data: pubUrl } = supabase.storage.from('product-images').getPublicUrl(filePath);
  return pubUrl.publicUrl;
}

function productModal(p) {
  const x = p || { name: '', description: '', price: 2000, promo_price: '', category: 'Cuidados orais', stock: 0, min_stock: 5, active: true, published: true, featured: false, image: '' };
  openModal(`<div class="eyebrow">CATÁLOGO</div><h2>${p ? 'Editar produto' : 'Adicionar produto'}</h2><form id="product-form"><input type="hidden" name="id" value="${x.id || ''}"><div class="modal-grid"><label class="field full">Nome do produto<input name="name" required value="${esc(x.name)}"></label><label class="field full">Descrição<textarea name="description" rows="3">${esc(x.description)}</textarea></label><label class="field">Preço (Kz)<input name="price" type="number" min="0" required value="${x.price}"></label><label class="field">Preço Promo (Kz)<input name="promo_price" type="number" min="0" value="${x.promo_price || ''}"></label><label class="field">Stock<input name="stock" type="number" min="0" value="${x.stock}"></label><label class="field">Stock Mínimo<input name="min_stock" type="number" min="0" value="${x.min_stock}"></label><label class="field full">Carregar Imagem (Supabase Storage)<input type="file" id="prod-file-input" accept="image/*"><input type="hidden" name="image" value="${esc(x.image || '')}"></label><div class="image-preview" id="image-preview">${x.image ? `<img src="${esc(x.image)}" alt="Imagem atual">` : 'B'}</div></div><label class="check-row"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Ativo</label><label class="check-row"><input type="checkbox" name="published" ${x.published ? 'checked' : ''}> Publicado</label><label class="check-row"><input type="checkbox" name="featured" ${x.featured ? 'checked' : ''}> Destacado</label><div class="modal-actions"><button type="button" class="btn btn-outline" data-close-modal>Cancelar</button><button class="btn btn-primary" id="save-prod-btn">Guardar produto</button></div></form>`);
  
  $('#modal-content').querySelector('[data-close-modal]').onclick = () => $('#app-modal').close();
  $('#product-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget, fd = new FormData(f), id = fd.get('id');
    const saveBtn = $('#save-prod-btn'); saveBtn.disabled = true; saveBtn.textContent = 'A guardar...';
    try {
      let imageUrl = f.elements.image.value;
      const fileInput = $('#prod-file-input');
      if (fileInput.files && fileInput.files.length > 0) {
        imageUrl = await uploadFileToStorage(fileInput.files[0]);
      }
      const payload = {
        name: fd.get('name').trim(),
        description: fd.get('description'),
        price: Number(fd.get('price')),
        promo_price: fd.get('promo_price') ? Number(fd.get('promo_price')) : null,
        stock: Number(fd.get('stock')),
        min_stock: Number(fd.get('min_stock')),
        active: f.elements.active.checked,
        published: f.elements.published.checked,
        featured: f.elements.featured.checked,
        image: imageUrl
      };
      if (id) await must(supabase.from('products').update(payload).eq('id', id));
      else await must(supabase.from('products').insert([payload]));
      $('#app-modal').close(); toast('Produto guardado com sucesso.'); loadState();
    } catch (err) {
      fail(err);
    } finally { saveBtn.disabled = false; saveBtn.textContent = 'Guardar produto'; }
  });
}

function formModal(eyebrow, title, fields, onSubmit, label = 'Guardar') {
  openModal(`<div class="eyebrow">${eyebrow}</div><h2>${title}</h2><form id="gen-form">${fields}<div class="modal-actions"><button type="button" class="btn btn-outline" data-close-modal>Cancelar</button><button class="btn btn-primary">${label}</button></div><div class="feedback" id="gen-err" role="alert"></div></form>`);
  $('#modal-content').querySelector('[data-close-modal]').onclick = () => $('#app-modal').close();
  $('#gen-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget, btn = f.querySelector('.btn-primary'); btn.disabled = true; $('#gen-err').textContent = '';
    try { await onSubmit(new FormData(f)); $('#app-modal').close(); toast('Guardado com sucesso.'); loadState(); }
    catch (err) { $('#gen-err').textContent = errMsg(err); }
    finally { btn.disabled = false; }
  });
}
const fld = (label, name, type = 'text', val = '', extra = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(val)}" ${extra}></label>`;

// ===== WhatsApp e Clientes =====
const SHOP_NAME = 'BRANQUEX';
const waPhone = o => { const d = String(o.customer?.phone || '').replace(/\D/g, ''); return !d ? '' : (d.length === 9 ? '244' + d : d); };
const waLink = (o, text) => 'https://wa.me/' + waPhone(o) + (text ? '?text=' + encodeURIComponent(text) : '');

// Mensagem pronta consoante o estado da encomenda (nome, referência, total e hora do pedido).
function waMessage(o, status = o.status) {
  const d = new Date(o.createdAt), when = `${d.toLocaleDateString('pt-AO')} às ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const nome = String(o.customer?.name || '').trim().split(/\s+/)[0] || 'cliente';
  const itens = (o.items || []).map(i => `${i.quantity}× ${i.product_name}`).join(', ');
  const local = [o.municipality_id ? orderZone(o) : '', o.referencePoint].filter(Boolean).join(' · ');
  const due = Math.max(0, num(o.total) - orderPaid(o));
  const base = `Olá, ${nome}! `, ref = `*${o.reference}*`;
  const m = {
    'Aguardando confirmação': `${base}Recebemos a sua encomenda ${ref} (${itens}), feita a ${when}, no valor de ${money(o.total)}. Estamos a confirmá-la e entramos em contacto consigo em breve.`,
    'Confirmada': `${base}A sua encomenda ${ref} está confirmada.\nPedido feito a ${when}.\nProdutos: ${itens}\nTotal: ${money(o.total)}${local ? '\nEntrega: ' + local : ''}\nVamos combinar consigo o melhor horário de entrega.`,
    'Em preparação': `${base}A sua encomenda ${ref} está a ser preparada. Avisamos assim que sair para entrega.`,
    'Em distribuição': `${base}A sua encomenda ${ref} já saiu para entrega${local ? ' (' + local + ')' : ''} e está a caminho.${due > 0 ? '\nValor por pagar: ' + money(due) + '.' : ''}\nPor favor, mantenha o telemóvel por perto.`,
    'Entregue': `${base}Confirmamos a entrega da sua encomenda ${ref}. Obrigado pela preferência! Se precisar de alguma coisa, é só responder a esta mensagem.`,
    'Levantada': `${base}Confirmamos o levantamento da sua encomenda ${ref}. Obrigado pela preferência!`,
    'Cancelada': `${base}A sua encomenda ${ref} (${when}) foi cancelada. Se quiser refazer o pedido ou tiver alguma dúvida, é só responder a esta mensagem.`
  };
  return (m[status] || m[o.status] || m['Aguardando confirmação']) + `\n\n— ${SHOP_NAME}`;
}

function waBox(o) {
  if (!waPhone(o)) return `<div class="wa-box"><small class="muted">Esta encomenda não tem número de telefone para enviar mensagem por WhatsApp.</small></div>`;
  return `<div class="wa-box"><label class="field">Mensagem por WhatsApp<select id="wa-template">${statuses.map(st => `<option value="${st}" ${st === o.status ? 'selected' : ''}>${st}</option>`).join('')}</select></label><label class="field"><textarea id="wa-text" rows="7"></textarea></label><a class="btn btn-primary wa-open" id="wa-open" target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a></div>`;
}
function bindWaBox(o) {
  const sel = $('#wa-template'), txt = $('#wa-text'), a = $('#wa-open');
  if (!sel || !txt || !a) return;
  const sync = () => { a.href = waLink(o, txt.value); };
  sel.addEventListener('input', () => { txt.value = waMessage(o, sel.value); sync(); });
  txt.addEventListener('input', sync);
  txt.value = waMessage(o, sel.value); sync();
}

// ----- Clientes -----
const CUSTOMER_FREQUENT_MIN = 3;                      // encomendas válidas para ser "Frequente"
const CUSTOMER_CANCEL_MIN = 2, CUSTOMER_CANCEL_RATE = 0.4; // "Cancela muito": 2+ canceladas e 40%+ do total
const customerDefaults = { q: '', tag: 'all', sort: 'orders' };
const customerUI = { ...customerDefaults };
const sumBy = (list, fn) => list.reduce((a, x) => a + fn(x), 0);
const daysSince = iso => { const a = new Date(), b = new Date(iso); return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000); };
const agoLabel = n => n <= 0 ? 'hoje' : n === 1 ? 'ontem' : `há ${n} dias`;
const tagInfo = { frequent: ['active', 'Frequente'], new: ['distribution', 'Novo'], cancel: ['out', 'Cancela muito'] };
const customerSorters = {
  orders: (a, b) => b.valid - a.valid || new Date(b.last) - new Date(a.last),
  spent: (a, b) => b.spent - a.spent,
  last: (a, b) => new Date(b.last) - new Date(a.last),
  name: (a, b) => a.name.localeCompare(b.name, 'pt'),
  cancelled: (a, b) => b.cancelled - a.cancelled || b.total - a.total
};

// Junta as encomendas por cliente (telefone; os últimos 9 dígitos são o identificador).
function buildCustomers() {
  const map = new Map();
  appState.orders.forEach(o => {
    const key = phoneKey(o) || o.customer_id || o.customer?.id || o.id;
    if (!map.has(key)) map.set(key, { key, orders: [] });
    map.get(key).orders.push(o);
  });
  return [...map.values()].map(c => {
    c.orders.sort(byRecent);
    const last = c.orders[0], live = c.orders.filter(o => o.status !== 'Cancelada');
    c.name = last.customer?.name || 'Desconhecido';
    c.phone = last.customer?.phone || '';
    c.wa = waPhone(last);
    c.total = c.orders.length; c.valid = live.length; c.cancelled = c.total - c.valid;
    c.spent = sumBy(live, o => num(o.total)); c.units = sumBy(live, orderQty);
    c.avg = c.valid ? c.spent / c.valid : 0;
    c.due = sumBy(live, o => Math.max(0, num(o.total) - orderPaid(o)));
    c.first = c.orders[c.total - 1].createdAt; c.last = last.createdAt;
    const zc = {}; (live.length ? live : c.orders).forEach(o => { const z = orderZone(o); zc[z] = (zc[z] || 0) + 1; });
    c.zone = Object.entries(zc).sort((a, b) => b[1] - a[1])[0][0];
    c.tags = [];
    if (c.valid >= CUSTOMER_FREQUENT_MIN) c.tags.push('frequent');
    if (c.total === 1) c.tags.push('new');
    if (c.cancelled >= CUSTOMER_CANCEL_MIN && c.cancelled / c.total >= CUSTOMER_CANCEL_RATE) c.tags.push('cancel');
    return c;
  });
}
const tagBadges = c => c.tags.map(t => `<span class="status ${tagInfo[t][0]}">${tagInfo[t][1]}</span>`).join(' ') || '<span class="muted">—</span>';
const phoneLinks = c => c.wa ? `<a href="tel:${esc(c.wa)}">${esc(c.phone)}</a> · <a href="https://wa.me/${esc(c.wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : esc(c.phone);

function customers() {
  const u = customerUI;
  const tf = (label, control) => `<label class="tf">${label}${control}</label>`;
  return `${pageHead('Clientes', 'Histórico de encomendas e reconhecimento de clientes frequentes.')}
  <div id="cust-stats" class="stats-grid"></div>
  <section class="table-panel">
    <div class="table-toolbar order-filters">
      ${tf('Pesquisar', `<input id="cf-q" placeholder="Nome, telefone ou zona..." value="${esc(u.q)}">`)}
      ${tf('Etiqueta', `<select id="cf-tag">${opt('all', 'Todos os clientes', u.tag)}${opt('frequent', 'Frequentes', u.tag)}${opt('new', 'Novos (1 encomenda)', u.tag)}${opt('cancel', 'Cancelam muito', u.tag)}</select>`)}
      ${tf('Ordenar por', `<select id="cf-sort">${opt('orders', 'Mais encomendas', u.sort)}${opt('spent', 'Maior valor gasto', u.sort)}${opt('last', 'Última encomenda', u.sort)}${opt('cancelled', 'Mais canceladas', u.sort)}${opt('name', 'Nome (A–Z)', u.sort)}</select>`)}
      <button type="button" class="btn btn-outline" id="cf-clear">Limpar filtros</button>
      <span class="toolbar-spacer"></span><small class="muted" id="cust-count"></small>
    </div>
    <div class="table-wrap"><table class="orders-table customers-table"><thead><tr><th>CLIENTE</th><th>ZONA PRINCIPAL</th><th>ENCOMENDAS</th><th>TOTAL GASTO</th><th>TICKET MÉDIO</th><th>ÚLTIMA ENCOMENDA</th><th>ETIQUETAS</th><th>AÇÕES</th></tr></thead><tbody id="cust-body"></tbody></table></div>
  </section>`;
}

function refreshCustomers() {
  const body = $('#cust-body'); if (!body) return;
  const all = buildCustomers(), u = customerUI, q = u.q.trim().toLowerCase();
  const list = all.filter(c => (!q || [c.name, c.phone, c.zone].join(' ').toLowerCase().includes(q)) && (u.tag === 'all' || c.tags.includes(u.tag))).sort(customerSorters[u.sort] || customerSorters.orders);
  const repeat = all.filter(c => c.valid >= 2).length;
  $('#cust-stats').innerHTML = stat('Clientes', all.length, 'Com pelo menos 1 encomenda', '☺')
    + stat('Frequentes', all.filter(c => c.tags.includes('frequent')).length, `${CUSTOMER_FREQUENT_MIN}+ encomendas válidas`, '★')
    + stat('Voltam a comprar', all.length ? Math.round(repeat / all.length * 100) + '%' : '—', `${repeat} com 2+ encomendas`, '↻')
    + stat('Cancelam muito', all.filter(c => c.tags.includes('cancel')).length, `${CUSTOMER_CANCEL_MIN}+ canceladas e ${Math.round(CUSTOMER_CANCEL_RATE * 100)}%+ do total`, '!');
  $('#cust-count').textContent = `${list.length} de ${all.length} cliente(s)`;
  body.innerHTML = list.length ? list.map(c => `<tr><td><strong>${esc(c.name)}</strong><small class="muted" style="display:block">${phoneLinks(c)}</small></td><td><span class="zone-tag">${esc(c.zone)}</span></td><td><span class="qty-pill">${c.valid}</span>${c.cancelled ? `<small class="muted"> + ${c.cancelled} cancelada(s)</small>` : ''}</td><td><strong>${money(c.spent)}</strong>${c.due ? `<small class="muted" style="display:block">Por pagar: ${money(c.due)}</small>` : ''}</td><td>${money(c.avg)}</td><td><strong>${new Date(c.last).toLocaleDateString('pt-AO')}</strong><small class="muted" style="display:block">${agoLabel(daysSince(c.last))}</small></td><td>${tagBadges(c)}</td><td><button class="action-btn" data-cust="${esc(c.key)}">Ficha</button></td></tr>`).join('')
    : `<tr><td colspan="8" class="empty-state">${all.length ? 'Nenhum cliente corresponde aos filtros.' : 'Ainda não existem clientes.'}</td></tr>`;
  body.querySelectorAll('[data-cust]').forEach(b => b.addEventListener('click', () => customerDetail(b.dataset.cust)));
}

function bindCustomerFilters() {
  const map = { 'cf-q': 'q', 'cf-tag': 'tag', 'cf-sort': 'sort' };
  Object.entries(map).forEach(([id, k]) => { const el = $('#' + id); if (el) el.addEventListener('input', () => { customerUI[k] = el.value; refreshCustomers(); }); });
  $('#cf-clear')?.addEventListener('click', () => { Object.assign(customerUI, customerDefaults); render(); });
  refreshCustomers();
}

function customerDetail(key) {
  const c = buildCustomers().find(x => String(x.key) === String(key)); if (!c) return;
  const cell = (l, v, wide) => `<div class="detail-item${wide ? ' detail-wide' : ''}"><small>${l}</small><strong>${v || '—'}</strong></div>`;
  const rate = c.total ? Math.round(c.cancelled / c.total * 100) : 0;
  const history = c.orders.map(o => { const d = new Date(o.createdAt); return `<div class="list-row"><div><strong>${esc(o.reference)}</strong><small>${d.toLocaleDateString('pt-AO')} · ${pad2(d.getHours())}:${pad2(d.getMinutes())} · ${esc(orderZone(o))}</small><small>${(o.items || []).map(i => esc(i.product_name) + ' × ' + esc(i.quantity)).join(', ')}</small></div><div style="text-align:right"><strong>${money(o.total)}</strong><span class="status ${statusClass(o.status)}" style="display:block;margin:3px 0">${esc(o.status)}</span><button class="action-btn" data-order="${o.id}">Ver</button></div></div>`; }).join('');
  openModal(`<div class="eyebrow">FICHA DO CLIENTE</div><h2>${esc(c.name)}</h2><p style="margin:-4px 0 14px">${tagBadges(c)}</p><div class="detail-grid">${cell('TELEFONE', phoneLinks(c))}${cell('ZONA PRINCIPAL', esc(c.zone))}${cell('ENCOMENDAS VÁLIDAS', c.valid)}${cell('CANCELADAS', `${c.cancelled} (${rate}%)`)}${cell('TOTAL GASTO', money(c.spent))}${cell('TICKET MÉDIO', money(c.avg))}${cell('UNIDADES COMPRADAS', c.units)}${cell('POR PAGAR', money(c.due))}${cell('PRIMEIRA ENCOMENDA', esc(new Date(c.first).toLocaleDateString('pt-AO')))}${cell('ÚLTIMA ENCOMENDA', esc(new Date(c.last).toLocaleDateString('pt-AO')) + ' · ' + agoLabel(daysSince(c.last)))}${cell('HISTÓRICO DE ENCOMENDAS (' + c.total + ')', `<div class="simple-list cust-history">${history}</div>`, true)}</div><div class="modal-actions"><button class="btn btn-outline" data-close-modal>Fechar</button></div>`);
  $('#modal-content').querySelector('[data-close-modal]').onclick = () => $('#app-modal').close();
  $('#modal-content').querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => orderDetail(b.dataset.order)));
}
// ===== fim WhatsApp e Clientes =====

function orderDetail(id) {
  const o = appState.orders.find(x => x.id === id); if (!o) return;
  const mun = appState.municipalities.find(x => x.id === o.municipality_id);
  const digits = String(o.customer?.phone || '').replace(/\D/g, '');
  const wa = digits ? 'https://wa.me/' + (digits.length === 9 ? '244' + digits : digits) : '';
  const cell = (l, v, wide) => `<div class="detail-item${wide ? ' detail-wide' : ''}"><small>${l}</small><strong>${v || '—'}</strong></div>`;
  const items = (o.items || []).map(i => `<li>${esc(i.product_name)} × ${esc(i.quantity)}</li>`).join('');
  openModal(`<div class="eyebrow">DETALHES DA ENCOMENDA</div><h2>${esc(o.reference)}</h2><div class="detail-grid">${cell('CLIENTE', esc(o.customer?.name))}${cell('TELEFONE', digits ? `<a href="tel:${esc(digits)}">${esc(o.customer.phone)}</a> · <a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : '')}${cell('MUNICÍPIO', mun ? esc(mun.name + ' — ' + mun.province) : '')}${cell('DATA', esc(new Date(o.createdAt).toLocaleString('pt-AO')))}${cell('REFERÊNCIA DO LOCAL', esc(o.referencePoint), true)}${cell('OBSERVAÇÕES', esc(o.notes), true)}${cell('PRODUTOS', items ? `<ul class="detail-list">${items}</ul>` : '', true)}${cell('TAXA DE ENTREGA', o.deliveryFee != null ? money(o.deliveryFee) : '')}${cell('TOTAL', money(o.total))}${cell('ESTADO', `<span class="status ${statusClass(o.status)}">${esc(o.status)}</span>`)}${cell('PAGAMENTO', `${orderPayment(o).label}${orderPayment(o).paid ? ' · ' + money(orderPayment(o).paid) : ''}`)}${(() => { const f = orderFlags().get(o.id); return f ? cell('ALERTA', f.dup.length ? 'Duplicada · igual a ' + esc(f.dup.join(', ')) : f.others.length + 1 + ' encomendas do mesmo cliente hoje · ' + esc(f.others.join(', '))) : ''; })()}</div>${waBox(o)}<div class="modal-actions"><button class="btn btn-outline" data-close-modal>Fechar</button><label class="field">Alterar estado<select id="modal-order-status">${statuses.map(st => `<option value="${st}" ${st === o.status ? 'selected' : ''}>${st}</option>`).join('')}</select></label><button class="btn btn-primary" id="btn-save-order-status">Guardar estado</button></div>`);
  $('#modal-content').querySelector('[data-close-modal]').onclick = () => $('#app-modal').close();
  bindWaBox(o);
  $('#btn-save-order-status').onclick = async ev => {
    const btn = ev.currentTarget, status = $('#modal-order-status').value; btn.disabled = true;
    try {
      if (status === o.status) { $('#app-modal').close(); return; }
      if (status === 'Cancelada') await must(supabase.rpc('cancel_order', { p_order_id: id }));
      else await must(supabase.rpc('set_order_status', { p_order_id: id, p_status: status }));
      $('#app-modal').close(); toast('Estado da encomenda atualizado.'); loadState();
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  };
}

function stockModal(pid) {
  const opts = appState.products.map(p => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} (${p.stock})</option>`).join('');
  formModal('STOCK', 'Registar movimento', `<div class="modal-grid"><label class="field full">Produto<select name="product_id" required>${opts}</select></label><label class="field">Tipo<select name="type"><option value="entrada">Entrada</option><option value="saida">Saída</option><option value="ajuste">Ajuste (definir stock)</option></select></label>${fld('Quantidade', 'quantity', 'number', '', 'min="0" step="1" required')}<label class="field full">Nota<input name="note"></label></div>`, async fd => {
    const p = appState.products.find(x => x.id === fd.get('product_id')), q = Math.floor(num(fd.get('quantity'))), t = fd.get('type');
    if (!p) throw new Error('Produto inválido.');
    const next = t === 'entrada' ? p.stock + q : t === 'saida' ? p.stock - q : q;
    if (next < 0) throw new Error('O stock não pode ficar negativo.');
    await must(supabase.from('products').update({ stock: next }).eq('id', p.id));
    const mv = await supabase.from('stock_movements').insert([{ product_id: p.id, type: t, quantity: q, note: fd.get('note') || null }]);
    if (mv.error) toast('Stock atualizado, mas o movimento não foi registado: ' + errMsg(mv.error));
  });
}

function zoneModal(z) {
  const x = z || { name: '', province: 'Luanda', fee: 0, active: true };
  formModal('ENTREGAS', z ? 'Editar município' : 'Adicionar município', `<div class="modal-grid">${fld('Município', 'name', 'text', x.name, 'required')}${fld('Província', 'province', 'text', x.province, 'required')}${fld('Taxa (Kz)', 'fee', 'number', x.fee, 'min="0" required')}</div><label class="check-row"><input type="checkbox" name="active" ${x.active ? 'checked' : ''}> Ativo</label>`, async fd => {
    const row = { name: fd.get('name').trim(), province: fd.get('province').trim(), fee: num(fd.get('fee')), active: fd.has('active') };
    await must(z ? supabase.from('municipalities').update(row).eq('id', z.id) : supabase.from('municipalities').insert([row]));
  });
}

function expenseModal() {
  formModal('FINANÇAS', 'Registar despesa', `<div class="modal-grid"><label class="field full">Descrição<input name="description" required></label>${fld('Valor (Kz)', 'amount', 'number', '', 'min="1" required')}</div>`, async fd => {
    await must(supabase.from('expenses').insert([{ description: fd.get('description').trim(), amount: num(fd.get('amount')) }]));
  });
}

function paymentModal() {
  const open = appState.orders.filter(o => o.status !== 'Cancelada');
  if (!open.length) return toast('Não existem encomendas para associar um pagamento.');
  const opts = open.map(o => `<option value="${esc(o.id)}">${esc(o.reference)} — ${esc(o.customer?.name || '')} (${money(o.total)})</option>`).join('');
  formModal('FINANÇAS', 'Registar pagamento', `<div class="modal-grid"><label class="field full">Encomenda<select name="order_id" required>${opts}</select></label>${fld('Valor (Kz)', 'amount', 'number', open[0].total, 'min="1" required')}<label class="field">Método<select name="method"><option>Dinheiro</option><option>Transferência</option><option>Multicaixa Express</option><option>Outro</option></select></label></div>`, async fd => {
    await must(supabase.from('payments').insert([{ order_id: fd.get('order_id'), amount: num(fd.get('amount')), method: fd.get('method') }]));
  });
}

function applyFilters() {
  const v = id => ($(id)?.value || '').trim().toLowerCase();
  const show = (sel, fn) => $('#view-root').querySelectorAll(sel).forEach(r => { r.hidden = !fn(r.dataset); });
  const ps = v('#product-search'), pf = v('#product-filter') || 'all';
  show('#products-body tr[data-search]', d => d.search.includes(ps) && (pf === 'all' || d.state.split(' ').includes(pf)));
  const ss = v('#stock-search');
  show('#stock-body tr[data-search]', d => d.search.includes(ss));
}

function bindActions(scope) {
  scope.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.id, act = b.dataset.action, get = k => appState[k].find(x => x.id === id);
    try {
      if (act === 'add-product') return productModal();
      if (act === 'edit-product') return productModal(get('products'));
      if (act === 'order-detail') return orderDetail(id);
      if (act === 'stock-move') return stockModal(id);
      if (act === 'add-zone') return zoneModal();
      if (act === 'edit-zone') return zoneModal(get('municipalities'));
      if (act === 'add-expense') return expenseModal();
      if (act === 'add-payment') return paymentModal();
      b.disabled = true;
      if (act === 'toggle-product') { const p = get('products'); await must(supabase.from('products').update({ published: !p.published }).eq('id', id)); }
      else if (act === 'delete-product') { if (!confirm('Eliminar este produto?')) { b.disabled = false; return; } await must(supabase.from('products').delete().eq('id', id)); toast('Produto eliminado.'); }
      else if (act === 'toggle-zone') { const z = get('municipalities'); await must(supabase.from('municipalities').update({ active: !z.active }).eq('id', id)); }
      else if (act === 'delete-zone') { if (!confirm('Eliminar este município?')) { b.disabled = false; return; } await must(supabase.from('municipalities').delete().eq('id', id)); toast('Município eliminado.'); }
      else if (act === 'next-status') {
        const o = get('orders'), flow = statuses.filter(s => s !== 'Cancelada' && s !== 'Levantada'), i = flow.indexOf(o.status);
        if (i < 0 || i >= flow.length - 1) { b.disabled = false; return toast('Esta encomenda já está no estado final.'); }
        await must(supabase.rpc('set_order_status', { p_order_id: id, p_status: flow[i + 1] })); toast('Estado: ' + flow[i + 1]);
      }
      loadState();
    } catch (err) { b.disabled = false; fail(err); }
  }));
}

function bindView() {
  const root = $('#view-root');
  bindActions(root);
  if (current === 'orders') bindOrderFilters();
  if (current === 'customers') bindCustomerFilters();
  $('[data-goto-dup]')?.addEventListener('click', () => { Object.assign(orderUI, orderDefaults, { alert: 'dup' }); current = 'orders'; $('#side-nav').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.view === 'orders')); render(); });
  ['#product-search', '#product-filter', '#stock-search'].forEach(s => $(s)?.addEventListener('input', applyFilters));
  const sf = $('#settings-form');
  if (sf) sf.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(sf), btn = sf.querySelector('.btn-primary'); btn.disabled = true;
    try {
      await must(supabase.from('store_settings').upsert({ id: 1, store_name: fd.get('store_name').trim(), phone: fd.get('phone').trim(), email: fd.get('email').trim(), location: fd.get('location').trim() }));
      toast('Configurações guardadas.'); loadState();
    } catch (err) { fail(err); } finally { btn.disabled = false; }
  });
}

checkAuth();
