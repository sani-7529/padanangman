import { CONFIG } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = (n) => n.toLocaleString('ko-KR') + '원';
const man = (n) => (n / 10000).toFixed(1).replace(/\.0$/, '') + '만';

const state = window.__app = {
  stays: [], trip: {}, tab: 'map',
  source: 'all', type: 'all', showArch: false, ocean: false,
  compare: [], hearts: {}, name: null, sb: null,
  map: null, overlays: [], acts: [], showAct: true,
};
try { state.name = localStorage.getItem('who'); state.compare = JSON.parse(localStorage.getItem('cmp') || '[]'); } catch {}

const perPerson = (s) => (s.price?.total ? Math.round(s.price.total / CONFIG.headcount) : null);
const isBad = (s) => s.status !== 'ok';
const meters = (n) => (n == null ? null : n.toLocaleString('ko-KR') + 'm');
const transit = (d, name) => (d == null ? null : `${name} · ${meters(d)}`);
const nearTransit = (s) => [s.distBus, s.distTrain].some((d) => d != null && d <= 3000);
// 거리 기준으로 자동 +/- (가까우면 +, 멀면 -)
function auto(s) {
  const pros = [], cons = [], m = (n) => n.toLocaleString('ko-KR') + 'm';
  if (s.type === 'sea' && s.distSea != null) {
    if (s.distSea <= 1000) pros.push(`바다 가까움 (${m(s.distSea)})`);
    else if (s.distSea > 3000) cons.push(`바다에서 멀음 (${m(s.distSea)})`);
  }
  if (s.distStore != null) {
    if (s.distStore <= 1000) pros.push(`편의점 가까움 (${m(s.distStore)})`);
    else if (s.distStore > 3000) cons.push(`편의점 멀음 (${m(s.distStore)})`);
  }
  const t = [s.distBus, s.distTrain].filter((d) => d != null);
  if (t.length) {
    const d = Math.min(...t);
    if (d <= 5000) pros.push(`버스터미널/기차역 가까움 (${m(d)})`);
    else if (d > 10000) cons.push(`버스터미널·기차역 멀음 (${m(d)})`);
  }
  return { pros, cons };
}
// 필수 조건: 독채 · 바비큐 · 다 같이 쓸 공간 · 역/터미널 가까움(5km 이내 또는 픽업)
function criteria(s) {
  const d = [s.distBus, s.distTrain].filter((x) => x != null);
  const transit = s.pickup ? true : d.length ? Math.min(...d) <= 5000 : null;
  const wc = s.rooms && s.rooms.bathrooms != null ? s.rooms.bathrooms >= 2 : null; // 화장실 1개면 탈락
  return [['독채', s.detached], ['바비큐', s.bbq], ['다 같이 쓸 공간', s.space], ['역·터미널', transit], ['화장실 2개 이상', wc]];
}
function isBest(s) {
  if (s.status !== 'ok' || s.archived) return false;
  const v = criteria(s).map((x) => x[1]);
  return !v.includes(false) && v.filter((x) => x === true).length >= 3;
}
const bestBadge = (s) => (isBest(s) ? '<span class="badge b-best">THE BEST</span>' : '');
const capText = (s) => (s.capacity && s.capacity.max != null ? `${s.capacity.base}~${s.capacity.max}명` : null);
const seaText = (s) => meters(s.distSea);
const typeLabel = (t) => (t === 'sea' ? '바다' : t === 'mountain' ? '산' : '–');
const typeBadge = (s) => (s.type ? `<span class="badge ${s.type === 'sea' ? 'b-sea' : 'b-mtn'}">${typeLabel(s.type)}</span>` : '');
const newBadge = (s) => (s.isNew ? '<span class="badge b-new">NEW</span>' : '');
const oceanBadge = (s) => (s.oceanView ? '<span class="badge b-ocean">오션뷰</span>' : '');
const archBadge = (s) => (s.archived ? '<span class="badge b-bad" style="background:#eee;color:#666">보관함</span>' : '');
const badBadge = (s) => (isBad(s) ? `<span class="badge b-bad">${s.status === 'unavailable' ? '예약 불가' : '조건 미달'}</span>` : '');

function visible() {
  return state.stays.filter((s) =>
    (state.source === 'all' || (state.source === 'new' ? s.isNew : state.source === 'best' ? isBest(s) : s.source === state.source)) &&
    (state.type === 'all' || s.type === state.type) &&
    (!state.ocean || s.oceanView === true) &&
    (state.showArch || !s.archived));
}

/* ---------- data / hearts ---------- */
async function loadData() {
  const r = await fetch('data/stays.json', { cache: 'no-cache' });
  const d = await r.json();
  state.stays = d.stays; state.trip = d.trip;
  try { state.acts = (await (await fetch('data/activities.json', { cache: 'no-cache' })).json()).activities; } catch {}
  $('#tripInfo').textContent = `${d.trip.dates} · ${d.trip.people}명`;
}

async function initHearts() {
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    state.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    await refreshHearts();
  } catch (e) { console.warn('hearts disabled', e); }
}
async function refreshHearts() {
  if (!state.sb) return;
  const { data, error } = await state.sb.from('hearts').select('stay_id,name');
  if (error) { console.warn(error); return; }
  state.hearts = {};
  for (const h of data) (state.hearts[h.stay_id] ||= []).push(h.name);
  render();
}
async function toggleHeart(id) {
  if (!state.name) { askName(); if (!state.name) return; }
  if (!state.sb) { alert('하트 서버에 연결되지 않았어요.'); return; }
  const mine = (state.hearts[id] || []).includes(state.name);
  const t = state.sb.from('hearts');
  const { error } = mine
    ? await t.delete().eq('stay_id', id).eq('name', state.name)
    : await t.insert({ stay_id: id, name: state.name });
  if (error) { console.warn(error); alert('저장에 실패했어요.'); return; }
  await refreshHearts();
}
function askName() {
  const n = (prompt('이름을 입력해 주세요 (하트에 표시돼요)', state.name || '') || '').trim().slice(0, 12);
  if (!n) return;
  state.name = n;
  try { localStorage.setItem('who', n); } catch {}
  renderWho();
}
function renderWho() { $('#who').textContent = state.name ? `👤 ${state.name}` : '이름 설정'; }

/* ---------- list ---------- */
const heartBtn = (s) => {
  const names = state.hearts[s.id] || [];
  const on = state.name && names.includes(state.name);
  return `<button class="heart ${on ? 'on' : ''}" data-heart="${s.id}" title="${esc(names.join(', '))}">${on ? '♥' : '♡'} ${names.length}</button>`;
};
const cmpBtn = (s) => `<button class="cmp ${state.compare.includes(s.id) ? 'on' : ''}" data-cmp="${s.id}">${state.compare.includes(s.id) ? '비교 중' : '+ 비교'}</button>`;

function facts(s) {
  const r = s.rooms || {};
  const f = (label, v) => `<span class="f ${v == null ? 'q' : ''}">${label} ${v == null ? '–' : esc(v)}</span>`;
  return [
    f('방', r.bedrooms),
    f('화장실', r.bathrooms),
    `<span class="f ${capText(s) ? '' : 'q'}">${capText(s) || '인원 –'}</span>`,
  ].join('');
}
function priceHtml(s) {
  const pp = perPerson(s);
  return pp
    ? `<div class="price">${won(pp)}<small>1인 · 총 ${won(s.price.total)}${s.price.estimated ? ' (추정)' : ''}</small></div>`
    : `<div class="price q">가격 –</div>`;
}
function thumb(s) {
  const p = s.photos?.[0];
  return `<div class="thumb" ${p ? `style="background-image:url('${esc(p)}')"` : ''}>${p ? '' : '사진 준비 중'}</div>`;
}
function gallery(s) {
  const ph = s.photos || [];
  if (!ph.length) return thumb(s);
  return `<div class="gal">${ph.map((u) => `<img src="${esc(u)}" loading="lazy" alt="">`).join('')}</div>${ph.length > 1 ? `<div class="galn">${ph.length}장 · 옆으로 넘겨 보세요</div>` : ''}`;
}
function sources(s) {
  const l = s.sources || [];
  if (!l.length) return '';
  return `<div class="sec"><h3>출처 · 직접 확인하기 (${esc(s.checkedAt || '')} 기준)</h3><ul class="src">${l.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.label)} ↗</a></li>`).join('')}</ul></div>`;
}
function card(s) {
  return `<article class="card ${isBad(s) ? 'bad' : ''}">
    ${thumb(s)}
    <div class="cbody" data-open="${s.id}">
      <div class="crow"><div><div class="cname">${esc(s.name)}</div><div class="carea">${esc(s.area)}</div></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">${archBadge(s)}${bestBadge(s)}${newBadge(s)}${typeBadge(s)}${oceanBadge(s)}${badBadge(s)}</div></div>
      ${priceHtml(s)}
      <div class="facts">${facts(s)}</div>
    </div>
    <div class="cfoot">${heartBtn(s)}${cmpBtn(s)}</div>
  </article>`;
}
function renderList() {
  const items = visible().sort((a, b) => isBad(a) - isBad(b) || (state.hearts[b.id]?.length || 0) - (state.hearts[a.id]?.length || 0));
  $('#view-list').innerHTML = items.length ? `<div class="list">${items.map(card).join('')}</div>` : '<div class="empty">조건에 맞는 숙소가 없어요</div>';
}

/* ---------- detail sheet ---------- */
function openSheet(id) {
  const s = state.stays.find((x) => x.id === id);
  if (!s) return;
  const r = s.rooms || {};
  const g = (label, v) => `<div class="g ${v == null ? 'q' : ''}"><span>${label}</span><b>${v == null ? '–' : esc(v)}</b></div>`;
  const pp = perPerson(s);
  const li = (a) => a.map((x) => `<li>${esc(x)}</li>`).join('');
  $('#sheet').innerHTML = `
    <div style="position:relative">${gallery(s)}<button class="x" data-close>✕</button></div>
    <div class="sh">
      <div style="display:flex;gap:6px;margin-bottom:8px">${bestBadge(s)}${newBadge(s)}${typeBadge(s)}${oceanBadge(s)}${badBadge(s)}<span class="badge b-unk">${s.source === 'ai' ? 'AI 추천' : '검색 결과'}</span></div>
      <h2>${esc(s.name)}</h2><div class="carea">${esc(s.area)}</div>
      ${priceHtml(s)}
      ${s.price?.note ? `<div class="carea" style="margin-top:4px">${esc(s.price.note)}</div>` : ''}
    </div>
    ${s.statusNote ? `<div class="alert">${esc(s.statusNote)}</div>` : ''}
    <div class="grid">
      ${g('침실', r.bedrooms, true)}
      ${g('화장실', r.bathrooms, true)}
      ${g('거실/공용공간', r.living == null ? null : r.living ? '있음' : '없음', true)}
      ${g('인원', s.capacity && s.capacity.max != null ? `기준 ${s.capacity.base} · 최대 ${s.capacity.max}` : null)}
      ${g('바다까지', seaText(s))}
      ${g('편의점', meters(s.distStore))}
      ${g('버스터미널', transit(s.distBus, s.nearestBus))}
      ${g('기차역', transit(s.distTrain, s.nearestTrain))}
      ${g('주차', s.parking)}
      ${g('난방', s.heating)}
      ${g('체크인', s.checkin)}
      ${g('체크아웃', s.checkout)}
    </div>
    <div class="sec"><h3>필수 조건</h3><div class="crit">${criteria(s).map(([n, v]) => `<span class="cr ${v === true ? 'ok' : v === false ? 'no' : 'q'}">${v === true ? '✓' : v === false ? '✕' : '?'} ${n}</span>`).join('')}</div></div>
    ${r.bathroomNote ? `<div class="alert" style="background:#fff8e6;color:#9a6700">${esc(r.bathroomNote)}</div>` : ''}
    ${(s.pros?.length || auto(s).pros.length) ? `<div class="sec"><h3>있어요</h3><ul class="pl">${li([...(s.pros || []), ...auto(s).pros])}</ul></div>` : ''}
    ${(s.cons?.length || auto(s).cons.length) ? `<div class="sec"><h3>아쉬워요</h3><ul class="mi">${li([...(s.cons || []), ...auto(s).cons])}</ul></div>` : ''}
    ${s.check?.length ? `<div class="sec"><h3>확인할 것</h3><ul class="ck">${li(s.check)}</ul></div>` : ''}
    ${sources(s)}
    ${s.reviewSummary ? `<div class="sec"><h3>후기 요약</h3><div class="rev">${esc(s.reviewSummary)}</div></div>` : ''}
    <div class="actions">
      ${heartBtn(s)}${cmpBtn(s)}
      <a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">예약 페이지</a>
      ${s.contact ? `<a class="btn ghost" href="tel:${esc(s.contact)}">전화</a>` : ''}
    </div>`;
  $('#sheet').dataset.id = id;
  $('#sheet').hidden = false; $('#sheetBg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; delete $('#sheet').dataset.id; }

/* ---------- compare ---------- */
function renderCompare() {
  const items = state.compare.map((id) => state.stays.find((s) => s.id === id)).filter(Boolean);
  $('#cmpCount').textContent = items.length ? `(${items.length})` : '';
  if (!items.length) { $('#view-compare').innerHTML = '<div class="empty">목록에서 “+ 비교”를 눌러 2~4개를 골라 보세요</div>'; return; }
  const q = (v, fmt = (x) => x) => (v == null ? '<span class="q">–</span>' : esc(fmt(v)));
  const rows = [
    ['', (s) => `<b>${esc(s.name)}</b><br>${typeBadge(s)} ${badBadge(s)}`],
    ['1인', (s) => q(perPerson(s), won)],
    ['총액', (s) => q(s.price?.total, won)],
    ['위치', (s) => typeLabel(s.type)],
    ['바다까지', (s) => q(seaText(s))],
    ['오션뷰', (s) => (s.oceanView == null ? q(null) : s.oceanView ? '있음' : '없음')],
    ['편의점', (s) => q(meters(s.distStore))],
    ['침실', (s) => q(s.rooms.bedrooms, undefined, true)],
    ['화장실', (s) => q(s.rooms.bathrooms, undefined, true)],
    ['공용공간', (s) => q(s.rooms.living, (x) => (x ? '있음' : '없음'), true)],
    ['인원', (s) => q(capText(s))],
    ['버스터미널', (s) => q(transit(s.distBus, s.nearestBus))],
    ['기차역', (s) => q(transit(s.distTrain, s.nearestTrain))],
    ['주차', (s) => q(s.parking)],
    ['하트', (s) => `♥ ${(state.hearts[s.id] || []).length}`],
    ['있어요', (s) => (s.pros || []).map((x) => '+ ' + esc(x)).join('<br>')],
    ['아쉬워요', (s) => (s.cons || []).map((x) => '– ' + esc(x)).join('<br>')],
    ['', (s) => `<a href="#" data-open="${s.id}">자세히</a> · <a href="${esc(s.url)}" target="_blank" rel="noopener">예약</a>`],
  ];
  $('#view-compare').innerHTML = `<div class="cmpwrap"><table>${rows.map(([h, fn]) => `<tr><th>${h}</th>${items.map((s) => `<td>${fn(s)}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
function toggleCompare(id) {
  const i = state.compare.indexOf(id);
  if (i >= 0) state.compare.splice(i, 1);
  else { if (state.compare.length >= 4) { alert('비교는 최대 4개까지예요'); return; } state.compare.push(id); }
  try { localStorage.setItem('cmp', JSON.stringify(state.compare)); } catch {}
  render();
}

/* ---------- map ---------- */
function loadKakao() {
  return new Promise((res, rej) => {
    if (window.kakao?.maps) return kakao.maps.load(res);
    const sc = document.createElement('script');
    sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.kakaoJsKey}&autoload=false`;
    sc.onload = () => kakao.maps.load(res);
    sc.onerror = () => rej(new Error('kakao sdk'));
    document.head.appendChild(sc);
  });
}
async function initMap() {
  const msg = $('#mapMsg');
  try {
    await loadKakao();
    state.map = new kakao.maps.Map($('#map'), {
      center: new kakao.maps.LatLng(CONFIG.center.lat, CONFIG.center.lng), level: 9,
    });
    msg.hidden = true;
    new ResizeObserver(() => fitMap()).observe($('#map'));
    renderMap();
  } catch (e) {
    msg.hidden = false;
    msg.innerHTML = '지도를 불러오지 못했어요.<br>카카오 개발자 콘솔에서 “카카오맵” 사용 설정과 웹 도메인 등록을 확인해 주세요.';
  }
}
function renderMap() {
  if (!state.map) return;
  state.overlays.forEach((o) => o.setMap(null));
  state.overlays = [];
  const bounds = new kakao.maps.LatLngBounds();
  let n = 0;
  for (const s of visible()) {
    if (s.lat == null) continue;
    const pp = perPerson(s);
    const cls = isBad(s) ? 'bad' : s.type || 'unk';
    const el = document.createElement('div');
    el.className = `pin ${cls}${s.oceanView ? ' ocean' : ''}`;
    const hc = (state.hearts[s.id] || []).length;
    el.innerHTML = `${pp ? man(pp) : '?'}${hc ? `<small>♥${hc}</small>` : ''}`;
    el.onclick = () => openSheet(s.id);
    const pos = new kakao.maps.LatLng(s.lat, s.lng);
    const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1 });
    ov.setMap(state.map);
    state.overlays.push(ov); bounds.extend(pos); n++;
  }
  if (state.showAct) {
    for (const a of state.acts) {
      if (a.lat == null) continue;
      const el = document.createElement('div');
      el.className = 'pin act';
      el.textContent = '★ ' + a.name.split(' ')[0];
      el.onclick = () => openAct(a.id);
      const pos = new kakao.maps.LatLng(a.lat, a.lng);
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1 });
      ov.setMap(state.map); state.overlays.push(ov); bounds.extend(pos); n++;
    }
  }
  state.bounds = n ? bounds : null;
  fitMap();
}
function fitMap() {
  if (!state.map || !state.bounds || !$('#map').offsetWidth) return;
  state.map.relayout();
  state.map.setBounds(state.bounds, 70, 50, 50, 50);
}

/* ---------- activities ---------- */
const km = (a, b) => {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
function nearStays(a) {
  if (a.lat == null) return [];
  return state.stays.filter((s) => s.lat != null && s.status === 'ok' && !s.archived)
    .map((s) => ({ s, d: km(a, s) })).sort((x, y) => x.d - y.d);
}
function actCard(a) {
  return `<article class="card"><div class="cbody" data-act="${a.id}">
    <div class="crow"><div><div class="cname">${esc(a.name)}</div><div class="carea">${esc(a.area)}</div></div></div>
    <div class="facts" style="margin-top:8px">${(a.tags || []).map((t) => `<span class="f">${esc(t)}</span>`).join('')}</div>
    <p class="adesc">${esc(a.summary)}</p>
    <div class="facts"><span class="f">🕘 ${esc(a.hours.split(' (')[0])}</span></div>
  </div></article>`;
}
function renderActivity() {
  $('#view-activity').innerHTML = state.acts.length
    ? `<div class="list">${state.acts.map(actCard).join('')}</div>` : '<div class="empty">액티비티가 아직 없어요</div>';
}
function openAct(id) {
  const a = state.acts.find((x) => x.id === id);
  if (!a) return;
  const li = (arr) => arr.map((x) => `<li>${esc(x)}</li>`).join('');
  const rows = a.items.map((i) => `<tr><td><b>${esc(i.name)}</b></td>
    <td>${i.price ? won(i.price) : '<span class="q">–</span>'}${i.two ? `<br><small class="q">2회권 ${won(i.two)}</small>` : ''}</td>
    <td>${i.price ? '≈ ' + won(i.price * CONFIG.headcount) : '–'}</td>
    <td class="q">${esc(i.limit)}</td></tr>`).join('');
  const near = nearStays(a).slice(0, 5);
  $('#sheet').innerHTML = `
    <div class="sh" style="padding-top:22px"><button class="x" data-close>✕</button>
      <div style="display:flex;gap:6px;margin-bottom:8px">${(a.tags || []).map((t) => `<span class="badge b-unk">${esc(t)}</span>`).join('')}</div>
      <h2>${esc(a.name)}</h2><div class="carea">${esc(a.address)}</div>
      <p class="adesc" style="margin-top:12px">${esc(a.summary)}</p></div>
    <div class="grid">
      <div class="g"><span>운영시간</span><b>${esc(a.hours)}</b></div>
      <div class="g"><span>휴무</span><b>${esc(a.closed)}</b></div>
      ${a.entry ? `<div class="g"><span>${esc(a.entry.label)}</span><b>${esc(a.entry.price)}</b></div>` : ''}
      <div class="g"><span>문의</span><b><a href="tel:${esc(a.phone)}">${esc(a.phone)}</a></b></div>
    </div>
    <div class="sec"><h3>종류 · 요금 (1회권) · 9명 합계</h3>
      <div class="cmpwrap" style="padding:0"><table class="acttbl"><tr><th>체험</th><th>1인</th><th>9명</th><th>제한</th></tr>${rows}</table></div></div>
    ${a.packages?.length ? `<div class="sec"><h3>패키지 · 참고</h3><ul class="pl">${li(a.packages)}</ul></div>` : ''}
    ${a.extra?.length ? `<div class="sec"><h3>알아두면 좋아요</h3><ul class="pl">${li(a.extra)}</ul></div>` : ''}
    ${a.check?.length ? `<div class="sec"><h3>확인할 것</h3><ul class="ck">${li(a.check)}</ul></div>` : ''}
    ${near.length ? `<div class="sec"><h3>가까운 숙소 (직선거리)</h3><ul class="near">${near.map((n) => `<li><a href="#" data-open="${n.s.id}">${esc(n.s.name)}</a><span>${n.d.toFixed(1)}km</span></li>`).join('')}</ul></div>` : ''}
    ${sources(a)}
    <div class="actions"><a class="btn" href="${esc(a.sources[0].url)}" target="_blank" rel="noopener">공식 정보 보기</a><a class="btn ghost" href="tel:${esc(a.phone)}">전화</a></div>`;
  $('#sheet').dataset.id = ''; $('#sheet').hidden = false; $('#sheetBg').hidden = false;
}

/* ---------- shell ---------- */
function render() {
  renderWho();
  renderList(); renderCompare(); renderActivity(); renderMap();
  for (const t of ['map', 'list', 'activity', 'compare']) $(`#view-${t}`).hidden = state.tab !== t;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  $('#filters').hidden = state.tab === 'compare' || state.tab === 'activity';
  if (state.tab === 'map' && state.map) state.map.relayout();
  const sid = $('#sheet').dataset.id; if (sid && !$('#sheet').hidden) openSheet(sid);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button,[data-open],[data-act]');
  if (!t) { return; }
  if (t.dataset.tab) { state.tab = t.dataset.tab; location.hash = state.tab; render(); }
  else if (t.dataset.heart) toggleHeart(t.dataset.heart);
  else if (t.dataset.cmp) toggleCompare(t.dataset.cmp);
  else if (t.dataset.act) openAct(t.dataset.act);
  else if (t.dataset.open) { e.preventDefault(); openSheet(t.dataset.open); }
  else if ('close' in t.dataset) closeSheet();
  else if (t.id === 'who') askName();
  else if (t.closest('.chips')) {
    const grp = t.closest('.chips').dataset.group;
    state[grp] = t.dataset.v;
    t.closest('.chips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === t));
    render();
  }
});
$('#sheetBg').onclick = closeSheet;
$('#showAct').onchange = (e) => { state.showAct = e.target.checked; render(); };
$('#ocean').onchange = (e) => { state.ocean = e.target.checked; render(); };
$('#showArch').onchange = (e) => { state.showArch = e.target.checked; render(); };

(async () => {
  const h = location.hash.slice(1);
  if (['map', 'list', 'activity', 'compare'].includes(h)) state.tab = h;
  await loadData();
  render();
  initMap();
  initHearts();
})();
