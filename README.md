# ALTUĞ KUYUMCULUK — Canlı Altın, Döviz ve Mağaza Fiyat Panosu

Gerçek **Harem Altın** verileriyle çalışan, bulutta fiyat güncelleyen, **Firebase**
üzerinden müşteri TV'sine ve yönetim paneline dağıtan profesyonel sistem.

**Kesin mimari söz:** Kullanıcının bilgisayarına Node.js veya Python **kurulmaz**,
yerel sunucu **çalıştırılmaz**, bilgisayarın sürekli açık kalması **gerekmez**.

---

## 1. Mimari

```
Harem Altın (Socket.IO)
        │  tek merkezi bağlantı (bulutta)
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
  hesaplamalar anında TV'ye      sayfa yenilenmeden güncellenir
  yansır (RTDB aboneliği)        kapanıp açılınca son geçerli veriyi gösterir
```

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
│   ├── index.html           → yönlendirme (tv.html / login.html)
│   ├── login.html           → yönetim girişi (e-posta/şifre)
│   ├── admin.html + js/admin.js + css/admin.css   → 13 bölümlük yönetim paneli
│   ├── tv.html + js/tv.js + css/tv.css            → Toshiba TV fiyat ekranı (ES5)
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
├── tests/run-tests.js       → 17 otomatik motor+E2E testi (ÇALIŞTIRILDI, 17/17 GEÇTİ)
├── firebase.json            → Hosting + rules + /tv /admin rewrite
└── .env.example             → secret ŞABLOLARI (gerçek değerler PC'de TUTULMAZ)
```

---

## 3. Kurulum Kılavuzu (Firebase — tarayıcıdan, ~20 dk)

> Hiçbir adımda bilgisayarınıza bir şey kurmanıza gerek yoktur.

1. **Firebase projesi:** console.firebase.google.com → "Proje ekle"
   (ör. `altug-kuyumculuk`). Google hesabı gerekir.
2. **Realtime Database:** Sol menü → Realtime Database → **europe-west1**
   bölgesi seç → "Test modda başlat" DEĞİL, sonra adım 5'te kuralları yükleyin.
   Database URL'ini kopyalayın.
3. **Hosting:** Sol menü → Hosting → "Başlat". Bu klasördeki `public/`
   içeriğini Console arayüzünden yüklemek mümkün değildir; Hosting için
   tek istisna: **Firebase Console → Hosting → basit yükleme** ya da
   ücretsiz arayüz alternatifi olarak dosyaları GitHub repo'suna koyup
   **Firebase Console → Hosting → Continuous Deployment** kullanın
   (klonsuz, tarayıcıdan çalışır). Alternatif: Netlify/Vercel sürükle-bırak
   (public klasörünü sürükleyin) — sonra `/tv` ve `/admin` yönlendirmelerini
   panelde ekleyin.
4. **Authentication:** Sol menü → Authentication → Get Started →
   **Email/Password** etkinleştir. Bu yapılmadan ne yönetim girişi ne de
   `tools/create-admin.js` çalışır (REST'te `PASSWORD_LOGIN_DISABLED` / `OPERATION_NOT_ALLOWED` hatası alınır).
   Yönetici kullanıcısını adım 8'deki betikle oluşturacaksanız "Add user" manuel olarak gerekmez.
5. **Kuralları yükleyin:** Sol menü → Realtime Database → Rules sekmesine
   `firebase/database.rules.json` içeriğini yapıştırın → Publish.
   Storage → Rules sekmesine `firebase/storage.rules` içeriğini yapıştırın → Publish.
6. **Legacy yetkilendirme (ZORUNLU):** Project Settings → General →
   aşağıda **"Legacy authentication for Realtime Database"** kutusunu işaretleyin.
   Eski TV uyumlu SDK bu mekanizmayı kullanır.
7. **config.js:** `public/js/config.js` içindeki `databaseURL` alanını
   doldurun. Görselleri Storage'a yüklemek için `storageBucket` alanını da
   doldurun (Console > Storage > `....appspot.com`); bos bırakırsanız
   yükleme devre dışı kalır, yalnizca URL ile görsel eklenebilir. Yeniden yayınlayın.
8. **admins/rootAdminUid (bir kez, kurallar YAYINLANMADAN ÖNCE):** En kolay yol:
   `node tools/create-admin.js yonetici@ornek.com` — yönetici kullanıcısını
   oluşturur, şifreyi terminale yazdırır ve `admins/rootAdminUid` satırını
   bootstrap eder. (Kurallar yayınlandıktan sonra bu yol kural döngüsü nedeniyle
   kapanır; o durumda UID Console'dan elle girilmelidir — bkz. adım 5 sırası.)
9. **Admin paneli:** site adresi `/admin` → giriş yapın → sol menüdeki
   **⚠ Kurulum / Önyükleme** düğmesiyle 11 başlangıç ürününü ekleyin.
10. **Yerel SDK kopyası (ZATEN DEPODA HAZIR):** Eski TV tarayıcısı CDN'leri
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
4. **Secret Manager:** 4 secret oluşturun (`.env.example` adlarıyla birebir):
   `FB_PROJECT_ID`, `FB_CLIENT_EMAIL`, `FB_PRIVATE_KEY` (satır sonları `\n`
   olarak), `FB_DATABASE_URL`. **Bu değerler bilgisayarınızda kalıcı
   saklanmaz; bulut gizli kasasında tutulur.**
5. **Repo:** `cloud/price-ingestion` klasörünü GitHub repo'suna atın
   (veya Cloud Build → "Upload file" ile zip yükleyin).
6. **Cloud Build:** Repo'yu bağlayın; `cloudbuild.yaml` otomatik çalışır:
   imaj bulutta derlenir → Cloud Run'a deploy edilir.
   Ilk deploy'dan sonra Cloud Run servisinde **min-instances=1** olduğunu doğrulayın.
7. **Doğrulama:** Cloud Run → Hizmet → Logs (Cloud Run) sekmesinde:
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
  - **Ürün Yönetimi:** ekle / satırda düzenle + KAYDET / sıral ↑↓ /
    TV'de göster-gizle / arşivle / arşivden getir / onaylı kalıcı sil.
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
| marketPrices, connectionStatus | okur | okur | **yalnızca bunları yazar** (`uid=ingest-service`) |
| settings, products, ads, branding, adjustments | okur | **yazar** (`uid=rootAdminUid`) | yazamaz |
| admins, operationLogs | hayır | evet | hayır |

- Frontend'de **hiçbir gizli anahtar yoktur** (yalnızca herkese açık RTDB URL).
- Yetkisiz kullanıcı kural gereği hiçbir şeyi değiştiremez (Test 11 —
  Firebase Console Rules Playground'da doğrulanmalıdır).

---

## 7. Test Durumu — DÜRÜST RAPOR

| # | Senaryo | Durum |
|---|---|---|
| V | **Harem canlı şeması** (`price_changed` → `data.{ALTIN,USDTRY,EURTRY}`) | ✅ **CANLI probe ile doğrulandı** + 3 otomatik E2E test (gerçek payload, ağ gerektirmez) |
| 1 | HAS alış referansı (35.616 / 36.400) | ✅ Otomatik test geçti (`tests/run-tests.js`) |
| 2 | HAS satış referansı — ortak baz | ✅ Otomatik test geçti |
| 3 | Ürün ekleme → hesap kapsamı | ✅ Otomatik + tarayıcıda UI ile manuel |
| 4 | Çarpan düzenleme → yeniden hesaplama | ✅ Otomatik test geçti |
| 5 | TV'den gizleme, kayıtta kalması | ✅ Otomatik test geçti |
| 6 | USD sabit TL düzeltmesi (50,30/50,40) | ✅ Otomatik test geçti |
| 7 | Site kapalıyken bulut güncellemesi | ⚠ Cloud Run log doğrulaması GEREKİR (bkz. §4/7) — dağıtım yapılmadan iddia edilmez |
| 8 | TV açılışında son geçerli fiyat | ✅ RTDB kalıcı + localStorage önbellek kodda; tarayıcıda manuel doğrulama önerilir |
| 9 | Bağlantı kesintisi → son fiyat + uyarı | ✅ Reddetme mantığı otomatik test; uçtan uca senaryo manuel |
| 10 | Reklam yükleme → TV'de gösterim | ⚠ Admin önizleme ile manuel doğrulama |
| 11 | Yetkisiz kullanıcı yazamasın | ⚠ Rules dosyası hazır; Console Rules Playground'da testedin |
| — | **Gerçek Toshiba cihazında test** | ❌ **YAPILMADI.** Kod ES5 + eski SDK + savunmalı try/catch ile eski tarayıcıya göre yazıldı, ancak gerçek cihazda test edilmeden kesin uyumluluk iddia edilmez. |

Ayrıca: **15 motor testi** konsolda çalıştırıldı ve geçti (bkz. `tests/run-tests.js`);
tüm JS dosyaları `node --check` sözdizimi denetiminden geçti. 3 yeni test,
canlı probe'dan alınan **gerçek `price_changed` payload'ı** ile şemayı,
`meta.time` damgasını ve ALTIN→HAS referansı uçtan uca hesabını kanıtlar.
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
