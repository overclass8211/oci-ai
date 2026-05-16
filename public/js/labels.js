// =============================================================
// Labels — 워드 사전 dictionary 모듈
//
// 백엔드 GET /api/labels 결과를 sessionStorage 에 캐시(10분 TTL)
// 그리고 DOM의 [data-label="<scope>.<key>"] 요소들의 텍스트를 치환.
//
// 사용법:
//   1) HTML 마커:  <th data-label="leads.customer_name">고객사</th>
//      (data-label 텍스트가 dictionary 의 값으로 치환됨)
//   2) JS 직접:    Labels.get('leads.customer_name')   // 동기 조회
//   3) 페이지 렌더 직후:  Labels.apply()  // [data-label] 일괄 치환
//   4) 캐시 무효화: Labels.invalidate()
//
// 부팅 시 자동 fetch + apply.  페이지 전환 시에도 자동 재적용.
// =============================================================
'use strict';

const Labels = {
  _dict: null,            // { scope: { key: 'label' } }
  _ttl: 10 * 60 * 1000,   // 10분
  _key: 'oci_labels_cache',
  _loading: null,         // in-flight Promise

  // ── 캐시 로드 ────────────────────────────────────────────
  _loadFromCache() {
    try {
      const raw = sessionStorage.getItem(this._key);
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      if (!ts || !data) return null;
      if (Date.now() - ts > this._ttl) return null;
      return data;
    } catch (_) { return null; }
  },

  _saveToCache(data) {
    try {
      sessionStorage.setItem(this._key, JSON.stringify({ ts: Date.now(), data }));
    } catch (_) { /* quota / private mode 무시 */ }
  },

  invalidate() {
    this._dict = null;
    try { sessionStorage.removeItem(this._key); } catch (_) {}
  },

  // ── fetch ────────────────────────────────────────────────
  async ensureLoaded() {
    if (this._dict) return this._dict;
    const cached = this._loadFromCache();
    if (cached) { this._dict = cached; return cached; }
    if (this._loading) return this._loading;

    this._loading = (async () => {
      try {
        const token = localStorage.getItem('oci_token') || sessionStorage.getItem('oci_token');
        const r = await fetch('/api/labels', {
          headers: token ? { 'Authorization': 'Bearer ' + token } : {},
          credentials: 'include',
        });
        if (!r.ok) throw new Error('labels fetch failed: ' + r.status);
        const j = await r.json();
        const data = j.data || {};
        this._dict = data;
        this._saveToCache(data);
        return data;
      } catch (err) {
        // 실패 시 빈 dict — data-label 마커는 원본 텍스트 그대로 유지
        this._dict = {};
        return this._dict;
      } finally {
        this._loading = null;
      }
    })();
    return this._loading;
  },

  // ── 단건 조회 ────────────────────────────────────────────
  // Labels.get('leads.customer_name')  →  '거래처' (또는 fallback)
  get(qualified, fallback) {
    if (!this._dict) return fallback ?? qualified;
    const [scope, key] = String(qualified).split('.');
    const v = this._dict?.[scope]?.[key];
    return v || fallback || qualified;
  },

  // ── DOM 치환 ─────────────────────────────────────────────
  // root 미지정 시 document 전체. 페이지 렌더 후 1회 호출.
  apply(root) {
    if (!this._dict) return;
    const scope = root || document;
    const nodes = scope.querySelectorAll('[data-label]');
    nodes.forEach(el => {
      const key = el.getAttribute('data-label');
      if (!key) return;
      const v = this.get(key);
      // 빈 문자열 가드 — 백엔드에서 빈 라벨 들어왔을 때 원본 보존
      if (v && v !== key) {
        // 텍스트 노드만 치환 (자식 element 보존)
        if (el.children.length === 0) {
          el.textContent = v;
        } else {
          // 자식 요소가 있는 경우, 첫 텍스트 노드만 교체
          const firstText = Array.from(el.childNodes).find(n => n.nodeType === 3);
          if (firstText) firstText.nodeValue = v;
        }
      }
    });
  },

  // ── 부팅 헬퍼 ───────────────────────────────────────────
  async init() {
    await this.ensureLoaded();
    this.apply();
  },
};

// 즉시 외부 노출
if (typeof window !== 'undefined') {
  window.Labels = Labels;
  // 부팅 시 자동 1회 (DOMContentLoaded 후)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Labels.init());
  } else {
    Labels.init();
  }
}
