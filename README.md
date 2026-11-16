# ALTUĞ KUYUMCULUK — Canlı Altın, Döviz ve Mağaza Fiyat Panosu

Gerçek **Harem Altın** verileriyle çalışan, bulutta fiyat güncelleyen, **Firebase**
üzerinden müşteri TV'sine ve yönetim paneline dağıtan profesyonel sistem.

**Kesin mimari söz:** Kullanıcının bilgisayarına Node.js veya Python **kurulmaz**,
yerel sunucu **çalıştırılmaz**, bilgisayarın sürekli açık kalması **gerekmez**.

---

## 1. Mimari

```
Harem Altın (Socket.IO)
        │  birincil bağlantı (bulutta)
        ▼
Bulut Fiyat Toplama Hizmeti  ◄──  Google Cloud Run konteyneri (sürekli açık)
  - veri doğrulama (boş/0/negatif/NaN/Infinity/ani sıçrama/eksik sembol)
  - hasBuy, hasSell, usdBuy, usdSell, eurBuy, eurSell ayrıştırma
        │  custom token: auth.uid == "ingest-service"
        ▼
Firebase Realtime Database  (ham fiyatlar + ayarlar + ürünler + reklamlar)
        │  Security Rules: TV yalnızca okur, yönetici yazar, bulut sadece fiyat yazar
        ▼
 Admin paneli (/admin)          TV ekranı (/tv)
  e-posta+şifre ile giriş        kimlik doğrulama YOK (salt okuma)
  hesaplamalar anında TV'ye      Firebase REST poll ile güncellenir
  yansır (RTDB aboneliği)        bayat akışta Harem tarayıcı yedeği
```

Bulut bağlantısı birincil kaynaktır. `allowBrowserFallback` etkinse TV ve
yönetim paneli bayat veri durumunda Harem'e ayrıca bağlanabilir; yönetim
paneli bu yedek akıştan geçerli fiyat alanlarını Firebase'e de senkronize eder.
Bu nedenle "tek bağlantı" yalnızca normal/bulut akışı için geçerlidir.

**Önemli dürüstlük notları:**

1. **Hesaplanan fiyatlar** TV ve admin tarafında istemcide hesaplanır
   (ortak HAS referansı + çarpanlar). Veritabanında ham fiyat + çarpan
   saklanır; referans/çarpan değiştiği anda iki ekran da yeniden hesaplar.
   Bu, "her değişiklik TV'ye anında yansısın" koşulını sayfa yenilemeden sağlar.
2. **Cloud Run sürekli bağlantı için uygundur** (Cloud Functions değildir).
   `min-instances=1` + `--no-cpu-throttling` ile Socket.IO bağlantısı
   bosta da ayakta kalır. Cloud Functions kısa ömürlü olduğu için
   sürekli Socket.IO bağlantısını **desteklemez** — bu projede kullanılmadı.
3. **Harem mesaj şeması CANLI DOĞRULANDI (3 Kas 2026, `cloud/price-ingestion/probe.js`):**
   Şema ayrıca kullanıcı katkısı `tools/harem-live-test.html` ile de doğrulandı.
   `dir.alis_dir` / `dir.satis_dir` yön alanları sisteme entegredir: TV'de
   altın satırlarında ve USD/EUR kutularında ▲/▼ okları gösterilir
   (`hasBuyDir` vb. alanları bulut hizmeti yazar; beyaz liste up/down).
   Sunucudan gerçek `price_changed` akışı yakalandı. Kesin yapı:
   `{ meta:{time:<ms>}, data:{ ALTIN:{alis,satis,...}, USDTRY:{...}, EURTRY:{...}, ... } }`
   — fiyatlar `data` altındadır; değerler kimi sembollerde string ("50.0700"), kimi sayı.
   `updatedAt` için `meta.time` (gerçek piyasa saati) kullanılır. Abonelik şart değildir;
   sunucu bağlantı anında otomatik yayar. Örnek anlık değerler: ALTIN 6369,49 · USDTRY
   50,07/50,15 · EURTRY 55,85/56,00. Şema artık varsayım değil, gözlem sonuçudur.
4. Harem kullanım koşullarını ihlal eden hiçbir yöntem (CAPTCHA/Cloudflare
   atlama vb.) kullanılmamıştır.

---

## 2. Dosya Yapısı

```
altug-kuyumculuk/
├── public/                  → Firebase Hosting'de /tv ve /admin olarak yayınlanır
│   ├── index.html           → varsayılan kullanıcı ekranı; ?admin/?login ile yönetim girişi
│   ├── 404.html             → bilinmeyen adres sayfası
│   ├── offline.html         → Service Worker çevrimdışı ekranı
│   ├── manifest.webmanifest → TV PWA bildirimi
│   ├── login.html           → yönetim girişi (e-posta/şifre)
│   ├── admin.html + js/admin.js + css/admin.css   → 14 bölümlük yönetim paneli
│   ├── tv.html + js/tv.js + css/tv.css            → Toshiba TV fiyat ekranı (ES5)
│   ├── sw.js + icons/icon.svg → TV Service Worker ve PWA simgesi
│   ├── tests.html           → 11 senaryonun tarayıcı test koşumu
│   └── js/
│       ├── config.js        → databaseURL vb. (TEK doldurulacak dosya)
│       ├── db.js            → Firebase katmanı (eski SDK, safeStorage)
│       ├── price-engine.js  → HAS ortak referans + USD/EUR TL düzeltmesi
│       ├── price-validator.js → veri doğrulama (ortak mantık)
│       └── price-formatter.js → "35.616,00 TL" (yuvarlama yalnızca gösterimde)
├── cloud/price-ingestion/   → Cloud Run konteyneri (Node 18, bulutta çalışır)
│   ├── index.js, harem-map.js, firebase-writer.js
│   ├── probe.js             → CANLI sema dogrulama araci (tek seferlik, ag gerektirir)
│   ├── Dockerfile, package.json, cloudbuild.yaml
├── firebase/
│   ├── database.rules.json  → güvenlik kuralları (aşağıda özet)
│   └── storage.rules        → reklam/logo görselleri
├── tests/run-tests.js       → 17 otomatik motor/doğrulama/Harem eşleme testi
├── firebase.json            → Hosting + rules + /tv /admin rewrite
└── .env.example             → secret ŞABLOLARI (gerçek değerler PC'de TUTULMAZ)
```

---

## 3. Kurulum Kılavuzu (Firebase — tarayıcıdan, ~20 dk)

> Hiçbir adımda bilgisayarınıza bir şey kurmanıza gerek yoktur.

1. **Firebase projesi:** console.firebase.google.com → mevcut projeyi seçin
   veya yenisini oluşturun. Yeni proje kullanılıyorsa `public/js/config.js`,
   `FB_PROJECT_ID` ve `FB_DATABASE_URL` aynı projeye ait olmalıdır.
2. **Realtime Database:** Sol menü → Realtime Database → **europe-west1**
   bölgesi seç → "Test modda başlat" DEĞİL, sonra adım 5'te kuralları yükleyin.
   Database URL'ini kopyalayın.
3. **Authentication:** Sol menü → Authentication → Get Started →
   **Email/Password** etkinleştir. Bu yapılmadan ne yönetim girişi ne de
   `tools/create-admin.js` çalışır (REST'te `PASSWORD_LOGIN_DISABLED` / `OPERATION_NOT_ALLOWED` hatası alınır).
   Authentication → Users → Add user ile root yönetici hesabını oluşturun ve UID'sini kopyalayın.
4. **Root admin'i provision edin (kuralları yayımlamadan önce):** Realtime
   Database → Data bölümünde `admins/rootAdminUid` değerini bu UID olarak
   ekleyin. Firebase Console kullanımı kurallardan bağımsızdır. UID
   tanımlanmadan sıkı kuralları yayımlarsanız istemciden ilk yönetici
   oluşturulamaz; güvenlik amacıyla otomatik yetki devri kapalıdır.
   `tools/create-admin.js` yalnızca kurallar yayımlanmadan önceki geçici
   kurulum için kullanılmalıdır.
5. **Kuralları yükleyin:** Realtime Database → Rules sekmesine
   `firebase/database.rules.json` içeriğini yapıştırın → Publish. Sonra
   Storage → Rules sekmesine `firebase/storage.rules` içeriğini yapıştırın
   → Publish. UID'nin doğru olduğunu ve yalnızca root yöneticinin yazabildiğini
   Rules Playground'da doğrulayın.
6. **Storage admin claim'i:** Google Cloud Shell gibi güvenilir bir ortamda
   `cloud/price-ingestion` dizinine geçip `npm ci` ve
   `node set-admin-claim.js <root-uid>` çalıştırın. `FB_PROJECT_ID`,
   `FB_DATABASE_URL`, `FB_CLIENT_EMAIL` ve `FB_PRIVATE_KEY` değerlerini Secret
   Manager'dan sağlayın. Betik UID'nin `admins/rootAdminUid` ile eşleştiğini
   doğrular. Bu claim yalnızca Storage görsel
   yükleme/silme yetkisi verir. Kimlik belirtecinin yenilenmesi için
   yöneticinin çıkış yapıp yeniden giriş yapması gerekir. Servis hesabı
   anahtarını repoya veya herkese açık makineye koymayın.
7. **Legacy yetkilendirme (ZORUNLU):** Project Settings → General →
   aşağıda **"Legacy authentication for Realtime Database"** kutusunu işaretleyin.
   Eski TV uyumlu SDK bu mekanizmayı kullanır.
8. **config.js:** `public/js/config.js` içindeki Firebase yapılandırmasının
   seçtiğiniz projeyle eşleştiğini doğrulayın. Storage için Console'daki
   gerçek bucket değerini `storageBucket` alanına yazın. Değer boşsa görsel
   dosya yükleme çalışmaz; URL ile reklam/logo ekleme kullanılabilir.
9. **Hosting:** Firebase Hosting'e `public/` içeriğini yayınlayın. Proje
   kökündeki `firebase.json` Hosting rewrite, başlık ve 404 davranışını
   tanımlar.
10. **Admin paneli:** site adresi `/admin` → giriş yapın → sol menüdeki
   **⚠ Kurulum / Önyükleme** düğmesiyle 11 başlangıç ürününü ekleyin.
11. **Yerel SDK kopyası (ZATEN DEPODA HAZIR):** Eski TV tarayıcısı CDN'leri
   engelleyebildigi için sayfalardaki tek SDK referansı **yerel**
   `public/js/lib/firebase.js`'tir (v8.10.1 monolitik UMD — app+auth+database+storage
   tek dosya; cdnjs'den indirilir). Yeniden indirmek gerekirse:
   `node tools/get-sdk.js`. Dosya eksik/neksik kalırsa ekran önbellekteki son
   geçerli fiyatı "GÜNCEL DEĞİL" bandıyla gösterir (beyaz ekran olmaz).

---

## 4. Bulut Fiyat Toplama Hizmeti — Dağıtım (tarayıcıdan, Cloud Build)

Gerekli: Google Cloud hesabı (firebasewith aynı proje önerilir).

1. console.cloud.google.com → aynı projeyi seçin.
2. **API'leri etkinleştirin:** Cloud Run, Cloud Build, Secret Manager,
   Service Account Credentials.
3. **Servis hesabı:** IAM → Service Accounts → "price-ingestion" oluşturun →
   Key → Add Key → JSON indirin → içindeki `client_email` ve `private_key`'i not edin.
4. **Secret Manager:** 5 secret oluşturun (`.env.example` adlarıyla birebir):
   `FB_PROJECT_ID`, `FB_CLIENT_EMAIL`, `FB_PRIVATE_KEY` (satır sonları `\n`
   olarak), `FB_DATABASE_URL` ve `FB_API_KEY`. API anahtarı web yapılandırmasında
   da kullanılan herkese açık Firebase anahtarıdır; parola/servis hesabı anahtarı
   değildir. Diğer kimlik bilgileri bulut gizli kasasında tutulmalıdır.
   `FB_PROJECT_ID` ve `FB_DATABASE_URL`, web `config.js`'deki Firebase
   projesiyle aynı olmalıdır.
5. **Servis hesabı erişimi:** `price-ingestion` servis hesabına bu secret'lar
   için Secret Manager Secret Accessor rolü verin. Cloud Build deploy kimliği
   de bu servis hesabını kullanabilmelidir (`Service Account User`).
6. **Repo:** `cloud/price-ingestion` klasörünü GitHub repo'suna atın
   (veya Cloud Build → "Upload file" ile zip yükleyin).
7. **Cloud Build:** Repo'yu bağlayın; `cloudbuild.yaml` otomatik çalışır:
   imaj bulutta derlenir → Cloud Run'a deploy edilir.
   Ilk deploy'dan sonra Cloud Run servisinde **min-instances=1** olduğunu doğrulayın.
8. **Doğrulama:** Cloud Run → Hizmet → Logs (Cloud Run) sekmesinde:
   - `Baglandi. ID=...` satırı → Harem bağlantısı kuruldu
   - `WROTE {...} @<meta.time>` satırları → Firebase'e fiyat yazılıyor (şema
     3 Kas 2026 canlı probe ile doğrulandı; normalde bu satırları göreceksiniz)
   - `ESLESMEYEN veri` / `OLAY ...` satırları YALNIZCA Harem protokolünü
     değiştirirse görünür; o durumda `node probe.js` ile yeni şemayı yakalayıp
     `harem-map.js`'i güncelleyin (repo'ya push → Cloud Build yeniden derler).
8. TV ve admin açık olmasa bile bu servis 7/24 fiyat çeker (Test 7'nin
   kanıtı bu loglardır).

---

## 5. Kullanım Kılavuzu (mağaza yöneticisi)

- **TV:** Toshiba kumandasından tarayıcıyı açın → `…/tv` adresini yazın.
  Ekran 1920×1080 ve 1366×768'e otomatik uyar; kaydırma çubuğu yoktur.
- **Yönetim:** telefondan/tabletten `…/admin` → giriş.
  - **HAS Referansı:** alış/satış seçimi TÜM ürünlerin hem alış hem satış
    fiyatını aynı ortak bazdan yeniden hesaplar (anında TV'ye yansır).
  - **Ürün Yönetimi:** ekle / düzenle / sıral ↑↓ / TV'de göster-gizle /
    arşivdeki ürünü yayına al / onaylı sil.
  - **USD/EUR Ayarları:** yüzde değil **sabit TL** düzeltmesi (+/-),
    göster/gizle ve yalnızca alış/satış modları birbirinden bağımsız.
  - **TV Görünüm:** altın alış/satış sütun modu, döviz bölümünü tamamen
    gizleme, alt bilgi notu.
  - **Reklam Yönetimi:** başlık/açıklama/görsel/süre; **"DOSYADAN YÜKLE"**
    düğmesi görseli doğrudan Firebase Storage'a koyar ve URL'yi otomatik doldurur.
    Sürelerce döner, reklam yoksa şık varsayılan marka tasarımı görünür.
- **Fiyat hiçbir zaman "uydurulmaz":** veri 3 dakikadan eskiyse TV'de
  kırmızı **"FİYATLAR GÜNCEL DEĞİL"** bandı çıkar, son geçerli fiyat korunur.

---

## 6. Güvenlik Özeti (database.rules.json)

| Alan | TV (oturumsuz) | Yönetici (girişli) | Bulut hizmeti |
|---|---|---|---|
| marketPrices, connectionStatus | okur | root admin yazar | `ingest-service` yazar |
| settings, products, ads, branding, adjustments | okur | **yazar** (`uid=rootAdminUid`) | yazamaz |
| `admins` | oturum gerektirir | yönetici UID'sini okur/yazar | hayır |
| `operationLogs` | hayır | root admin okur/yazar | hayır |

- `rootAdminUid` yok/boşken Realtime Database yazmaları kapalıdır. Root UID,
  sıkı kurallar yayımlanmadan önce Firebase Console'dan provision edilmelidir.
- Storage'daki reklam/logo dosyaları herkese okunabilir; yazma/silme için
  root yönetici hesabında `admin: true` Firebase Auth custom claim'i gerekir.
- Fiyat alanları sıfır/negatif değerleri reddeder; `marketTime` kaynak piyasa
  zamanıdır, `updatedAt` ise verinin alınıp kaydedildiği zamandır.
- Web `apiKey` ve RTDB URL istemci yapılandırmalarıdır, servis hesabı anahtarı
  değildir. Servis hesabı anahtarı yalnızca Secret Manager'da tutulmalıdır.
- Rules Playground ve Storage Rules simülatörüyle yetkisiz/yetkili senaryolar
  dağıtım öncesi ayrıca doğrulanmalıdır.

---

## 7. Test Durumu — DÜRÜST RAPOR

| # | Senaryo | Durum |
|---|---|---|
| V | **Harem canlı şeması** (`price_changed` → `data.{ALTIN,USDTRY,EURTRY}`) | ✅ **CANLI probe ile doğrulandı** + 3 otomatik E2E test (gerçek payload, ağ gerektirmez) |
| 1 | HAS alış referansı (35.616 / 36.400) | ✅ Otomatik test geçti (`tests/run-tests.js`) |
| 2 | HAS satış referansı — ortak baz | ✅ Otomatik test geçti |
| 3 | Ürün ekleme → hesap kapsamı | ✅ Motor otomatik; yönetim UI yazımı ayrıca doğrulanmalı |
| 4 | Çarpan düzenleme → yeniden hesaplama | ✅ Otomatik test geçti |
| 5 | TV'den gizleme, kayıtta kalması | ✅ Otomatik test geçti |
| 6 | USD sabit TL düzeltmesi (50,30/50,40) | ✅ Otomatik test geçti |
| 7 | Site kapalıyken bulut güncellemesi | ⚠ Cloud Run log doğrulaması GEREKİR (bkz. §4/7) — dağıtım yapılmadan iddia edilmez |
| 8 | TV açılışında son geçerli fiyat | ✅ RTDB kalıcı + localStorage önbellek kodda; tarayıcıda manuel doğrulama önerilir |
| 9 | Bağlantı kesintisi → son fiyat + uyarı | ✅ Reddetme mantığı otomatik test; uçtan uca senaryo manuel |
| 10 | Reklam yükleme → TV'de gösterim | ⚠ Admin önizleme ile manuel doğrulama |
| 11 | Yetkisiz kullanıcı yazamasın | ⚠ Rules dosyası hazır; Console Rules Playground'da testedin |
| — | **Gerçek Toshiba cihazında test** | ❌ **YAPILMADI.** Kod ES5 + eski SDK + savunmalı try/catch ile eski tarayıcıya göre yazıldı, ancak gerçek cihazda test edilmeden kesin uyumluluk iddia edilmez. |

Ayrıca: `tests/run-tests.js` 17 motor/doğrulama/Harem eşleme testi içerir.
Bu testler Firebase Rules veya gerçek Cloud Run dağıtımını doğrulamaz.
`public/tests.html` tarayıcıda aynı senaryoların koşumunu gösterir.

---

## 8. Maliyet ve Sınırlar (Açık ve Net)

| Hizmet | Çalışma Modeli | Limit | Tahmini Ücret |
|---|---|---|---|
| Firebase Realtime Database | Bulut NoSQL, anlık yayın | Blaze planında 1 GB depolama, 10 GB aktarım ücretsiz | Bu projede aylık ~0–1 TL; fiyati küçük JSON |
| Firebase Hosting | Statik site, CDN | 10 GB depolama, 360 MB/gün ücretsiz | ~0 TL |
| Firebase Authentication | E-posta/şifre | 50.000 MAU'ya kadar ücretsiz | 0 TL |
| **Cloud Run (min-instance=1)** | **7/24 açık tek konteyner** (Socket.IO için şart) | 256 MiB RAM + 1 vCPU ayrılmış | **~4–7 USD/ay** (europe-west1, ayrılmış instans saatlik ~%100 fiyatı). Kesinti olmasın diye bilerek tam ücretli mod. |
| Cloud Build | Imaj derleme (ayda ~2-3 kez) | İlk 128 dk/gün ücretsiz, üstü dk ~0,003 USD | ~0 TL |
| Secret Manager | Anahtar kasası | 2 secret'a kadar ücretsiz | ~0 TL |

**Neden Cloud Functions değil?** Cloud Functions kısa ömürlüdür; sürekli
Socket.IO bağlantısını **desteklemez**. Cloud Run yönetilen ve sürekli
çalışan tek uygun maliyetli Google hizmetidir.

**Neden ücretsiz "scale-to-zero" Cloud Run değil?** Bosta konteyner donar,
Socket.IO bağlantısı düşer; piyasa açıkken anlık akış bozulur. Mağaza için
aylık ~5 USD, kesintisiz canlılık için bilinçli seçimdir. (Bütçe sıfır
ise alternatif: Harem'in izin verdiği bir HTTP API bulup 1 dk'lık zamanlı
yoklama ile Cloud Run Job kullanmak — ancak böyle bir API doğrulanmadan
sahte polling mimarisi satılmaz.)

**Toplam işletme maliyeti: yaklaşık 5–7 USD/ay + 0 TL Firebase.**

---

## 9. Son Kabul Kriterleri Durumu

- ✅ Node.js/Python kurulumu gerektirmiyor (kullanıcı tarafı salt tarayıcı)
- ✅ Bulut mimarisi kurulabilir durumda (Cloud Run + Cloud Build, PC kapalıyken çalışır)
- ✅ Ortak HAS referansı (alış/satış aynı baz), çarpanlar bağımsız
- ✅ USD/EUR sabit TL düzeltmeleri bağımsız; altın çarpanlarından ayrı
- ✅ Dinamik ürün yönetimi (ekle/düzenle/sırala/gizle/arşiv/onaylı sil)
- ✅ Reklam yönetimi ve rotasyonu
- ✅ Sayfa yenilemeden anlık senkronizasyon (RTDB abonelikleri)
- ✅ Veri doğrulama + son geçerli fiyat koruma + "güncel değil" uyarısı
- ✅ Security Rules (TV okar, admin yazar, bulut sadece fiyat yazar)
- ✅ Otomatik testler yazıldı ve geçirildi (17/17)
- ✅ Harem gerçek mesaj şeması: **CANLI probe ile doğrulandı** (`meta.time` + `data.{ALTIN,USDTRY,EURTRY}`)
- ⚠ Test 7 (site kapalıyken güncelleme): **dağıtım sonrası Cloud Run loguyla kanıtlanmalı**
- ❌ Gerçek Toshiba tarayıcı testi: **yapılmadı; uyumluluk iddiası yoktur**
