/* =====================================================================
 * ALTUĞ KUYUMCULUK - Kullanici Ekrani Tasarim Yoneticisi (ES5)
 * =====================================================================
 * Gorev: Firebase'de yayinlanan aktif tasarimi (settings.activeUserTheme)
 * cozumler, tv.html icindeki dogru tasarim kokunu gosterir.
 *
 * ONEMLI TASARIM KURALI (TALIMAT bolum 7): Bu yonetici HICBIR veri
 * baglantisi acmaz. Harem socket, Firebase REST poll ve fiyat motoru
 * tv.js'de (tek katman) kalmaya devam eder; tasarim degisince yalnizca
 * gorunen DOM kökü değişir, baglanti kesilmez.
 *
 * cozum ONECELIĞI (TALIMAT bolum 8 + 5):
 *   1) URL ?uiTheme=<id>           -> yonetim onizlemesi (yayına dokunmaz)
 *   2) settings.activeUserTheme    -> Firebase'de yayinlanan deger
 *   3) localStorage onbellegi      -> internet kesikse son bilinen tasarim
 *   4) theme-1                     -> hiçbiri yoksa mevcut ekran (guvenli varsayilan)
 * ===================================================================== */

var ThemeManager = (function () {
  "use strict";

  var CACHE_KEY = "altug_active_ui_theme";
  var currentId = null;
  var forcedId = null;   /* ?uiTheme= onizleme zorlamasi */
  var previewMode = false;
  var thumbMode = false; /* admin kartlarindaki kucuk canli kapi */

  function byId(id) { return document.getElementById(id); }

  function urlParam(name) {
    try {
      var m = (window.location.search || "").match(new RegExp("[?&]" + name + "=([A-Za-z0-9_-]+)"));
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  function valid(id) {
    return !!(window.ThemeRegistry && id && ThemeRegistry.isValid(id));
  }

  function cachedId() {
    try {
      var v = (window.AppDb && AppDb.safeGet) ? AppDb.safeGet(CACHE_KEY) : null;
      return valid(v) ? v : null;
    } catch (e) { return null; }
  }

  function resolve(settings) {
    if (forcedId) { return forcedId; }
    var pub = settings && settings.activeUserTheme;
    if (valid(pub)) { return pub; }
    var c = cachedId();
    if (c) { return c; }
    return ThemeRegistry ? ThemeRegistry.defaultId() : "theme-1";
  }

  /* html + body siniflari: tema kok stilleri ve kaydirma davranisi
   * (tv.css html/body overflow:hidden kullanir; Tema 2 mobilde kaydirma
   * istediginden sinif html kokune de yazilir). */
  function setRootClass(id) {
    var els = [document.documentElement, document.body], i, parts, out, j;
    for (i = 0; i < els.length; i++) {
      if (!els[i]) { continue; }
      parts = String(els[i].className || "").split(/\s+/);
      out = [];
      for (j = 0; j < parts.length; j++) {
        if (parts[j] && parts[j].indexOf("ui-theme-") !== 0) { out.push(parts[j]); }
      }
      out.push("ui-theme-" + String(id).replace(/^theme-/, ""));
      els[i].className = out.join(" ");
    }
  }

  function applyRoots(id) {
    var list = ThemeRegistry.all(), i, el, t;
    for (i = 0; i < list.length; i++) {
      t = list[i];
      el = byId(t.rootId);
      if (!el) { continue; }
      if (t.id === id) { el.style.display = ""; el.removeAttribute("aria-hidden"); }
      else { el.style.display = "none"; el.setAttribute("aria-hidden", "true"); }
    }
    setRootClass(id);
    var bar = byId("ui-preview-bar");
    var showBar = !!(previewMode && !thumbMode);
    if (bar) { bar.style.display = showBar ? "block" : "none"; }
    /* Onizleme cubugu fixed'tir; ustten header'i ortmesin diye govdeye
     * ic padding verilir (ui-preview-on sinifi tv.css'i de kapsar). */
    try {
      var cn = String(document.documentElement.className || "").replace(/\s*ui-preview-on/g, "");
      document.documentElement.className = cn + (showBar ? " ui-preview-on" : "");
    } catch (e) {}
  }

  /* tv.js her veri guncellemesinde cagrir; tasarim degistiyse kökü çevirir.
   * Sayfa yenilenmez, abonelikler korunur. */
  function sync(settings) {
    if (!window.ThemeRegistry) { return currentId || "theme-1"; }
    var next = resolve(settings);
    if (next !== currentId) {
      currentId = next;
      applyRoots(next);
      /* Onizleme/ziyade zorlamasi onbellege YAZILMAZ (bolum 8: Firebase asil
       * kaynak; localStorage yalnizca son bilinen yayin icin gecici onbellek). */
      if (!forcedId) {
        try { if (window.AppDb && AppDb.safeSet) { AppDb.safeSet(CACHE_KEY, next); } } catch (e) {}
      }
    }
    return currentId;
  }

  function init() {
    var t = urlParam("uiTheme");
    forcedId = valid(t) ? t : null;
    previewMode = urlParam("uiPreview") === "1";
    thumbMode = urlParam("uiThumb") === "1";
    applyTvMode();
    /* Ayarlar gelmeden son bilinen/yayinlanan tasarim hemen uygulansin
     * (sayfa yenilendiginde tasarım korunur; internet yoksa onbellek). */
    sync(null);
    /* Cizgi TV/tarayici penceresi boyutu degisirse TV modu yeniden degerlendirilir. */
    try { if (window.addEventListener) { window.addEventListener("resize", applyTvMode, false); } } catch (e) {}
  }

  /* ---------- TV MODU ALGILAMASI ----------
   * Zengin masaustu duzeni CSS grid/sticky/gradient kullanir; eski Toshiba
   * Chromium bunlari desteklemez -> bozulur. Bu yuzden pasif TV duzeni
   * html.tv-mode sinifina baglanir. tv-mode su hallerde ACILIR:
   *  1) ?device=tv  veya  localStorage altug_device=="tv"  (bilincli secim)
   *  2) TV tarayici User-Agent'i (SmartTV/Tizen/Viera/Bravia/Toshiba...)
   *  3) CSS grid DESTEKLENMIYORSA ve genis ekran (>=1280) -> guvenli gerileme
   * Modern masaustu (grid destekli, tv-mode degil) >=1181px'te zengin duzeni alir. */
  function detectTvMode() {
    var ua = "";
    try { ua = String(navigator.userAgent || "").toLowerCase(); } catch (e) {}
    var dev = urlParam("device");
    var stored = null;
    try { stored = (window.AppDb && AppDb.safeGet) ? AppDb.safeGet("altug_device") : null; } catch (e) {}
    var explicit = (dev === "tv") || (stored === "tv");
    var tvUa = /smarttv|smart-tv|smart\.tv|internettv|internet-tv|tizen|webos|web0s|netcast|nettv|livebrowser|googletv|hbbtv|appletv|apple tv|roku|vizio|bravia|viera|aquos|philips.?tv|toshiba.?tv|aquant|\.tv\b/.test(ua);
    var gridOk = false;
    try { gridOk = !!(window.CSS && CSS.supports && (CSS.supports("display", "grid") || CSS.supports("grid-template-columns", "1fr 1fr"))); } catch (e) { gridOk = false; }
    var wide = (window.innerWidth || document.documentElement.clientWidth || 0) >= 1280;
    return explicit || tvUa || (!gridOk && wide);
  }
  function applyTvMode() {
    try {
      var cn = String(document.documentElement.className || "").replace(/\s*tv-mode/g, "").replace(/^\s+/, "");
      document.documentElement.className = detectTvMode() ? (cn ? cn + " tv-mode" : "tv-mode") : cn;
    } catch (e) {}
  }

  function current() { return currentId || (ThemeRegistry ? ThemeRegistry.defaultId() : "theme-1"); }
  function isPreview() { return previewMode; }
  function isThumb() { return thumbMode; }

  return {
    init: init,
    sync: sync,
    current: current,
    isPreview: isPreview,
    isThumb: isThumb,
    resolve: resolve
  };
})();
