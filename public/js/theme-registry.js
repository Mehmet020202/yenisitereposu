/* =====================================================================
 * ALTUĞ KUYUMCULUK - Kullanici Ekrani Tasarim Kaydi (ES5)
 * =====================================================================
 * Genisletilebilir mimarinin merkezi listesi (TALIMAT bolum 9):
 * yeni tasarım eklemek = buraya bir kayıt + tv.html'e kök DOM +
 * css/theme-N.css + js/themes/theme-N.js. Fiyat motoruna DOKUNULMAZ.
 *
 * Her kayit:
 *   id      : Firebase settings.activeUserTheme degeriyle ayni kimlik
 *   name    : yonetim panelinde gorunen ad
 *   desc    : yonetim panelinde aciklama
 *   rootId  : tv.html icindeki kokelementin id'si
 * ===================================================================== */

window.ThemeRegistry = (function () {
  "use strict";

  var THEMES = [
    {
      id: "theme-1",
      name: "Klasik Koyu Altın",
      desc: "Mevcut ALTUĞ KUYUMCULUK kullanıcı ekranı (koyu antrasit, altın sarısı).",
      /* tv-dashboard, tv-root'u saran koyu zemin katmanıdır; Tema 2'ye
       * geciste bu kök gizlenir (sadece #tv-root gizlenirse zemin kalır). */
      rootId: "tv-dashboard"
    },
    {
      id: "theme-2",
      name: "Premium Yeşil",
      desc: "Zeytin yeşili, krem ve altın renkli modern kullanıcı ekranı.",
      rootId: "theme2-root"
    }
  ];

  function all() { return THEMES; }

  function get(id) {
    var i;
    for (i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) { return THEMES[i]; }
    }
    return null;
  }

  function isValid(id) { return get(id) !== null; }

  /* Varsayilan: her zaman mevcut (Tasarim 1) ekran; aktif yayın yoksa bu açılır. */
  function defaultId() { return "theme-1"; }

  return { all: all, get: get, isValid: isValid, defaultId: defaultId };
})();
