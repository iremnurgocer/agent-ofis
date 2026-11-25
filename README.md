# Agent Ofis

Bilgisayarındaki tüm **Claude Code** oturumlarını canlı bir **3B sanal ofiste** gösteren, yerel çalışan kontrol paneli.
Her oturum bir çalışan: çalışan masasına oturup yazar (ekranında o an yaptığı iş görünür), araştıran kitaplığa gider,
ekip yöneten ekrana geçer, boşta olan kanepede dinlenir, senden onay bekleyen kalkıp sana döner ve elini uzatır.
Üzerine gelince sana bakar; tıklayınca ne yaptığını adım adım gösteren panel açılır.

*English: a local dashboard that shows every Claude Code session on your Mac as an animated character in a 3D office.
No dependencies, nothing leaves your machine. The UI is in Turkish.*

## Özellikler

- **Genel bakış:** şu an çalışanlar, onay bekleyenler, dikkat gerektirenler, son 6 saatin temposu, canlı akış
- **Ofis (3B / 2B):** her proje bir oda, her oturum bir masa; alt agent'lar ofiste dolaşan küçük karakterler.
  Sürükle/çimdikle gez, karaktere tıkla.
- **Canlı akış:** tüm oturumların adımları insan diliyle ("Jira'da kayıt arıyor", "Tarayıcıda sayfayı okuyor"…), türe/projeye göre süzülür
- **Oturumlar:** sıralanabilir tablo; Terminal'de kaldığın yerden devam et, VS Code'da aç, klasörü göster
- **Projeler:** Claude ile çalıştığın klasörler, git durumu, hafıza notları, tek tıkla yeni oturum
- **Telefondan erişim (isteğe bağlı):** aynı Wi-Fi'den, gizli anahtarlı bağlantı ve karekodla
- Kısayollar: `⌘K` ara, `1–5` ekranlar, `Esc` paneli kapat

## Kurulum

Gereken tek şey [Node.js](https://nodejs.org) 18 veya üstü. Ek paket yok.

```bash
git clone https://github.com/iremnurgocer/agent-ofis.git
cd agent-ofis
node server.js        # → http://127.0.0.1:4777
```

ya da Finder'da `Ofisi-Ac.command` dosyasına çift tıkla.

**Bilgisayar açılınca kendiliğinden başlasın (macOS):**

```bash
./install-autostart.sh     # kaldırmak için: ./uninstall-autostart.sh
```

## Ayarlar

`ofis.config.example.json` dosyasını `ofis.config.json` adıyla kopyalayıp düzenle:

| Ayar | Ne işe yarar | Varsayılan |
|---|---|---|
| `projectRoots` | Projelerinin durduğu klasörler (yoksa atlanır) | `~/Projects`, `~/Projeler`, `~/Developer`, `~/code`, `~/src` |
| `activeWindowSec` | Bir oturum kaç sn içinde yazdıysa "çalışıyor" sayılır | `90` |
| `recentDays` | Ofiste masası olan son kullanılan oturumlar (gün) | `14` |
| `lan` | Aynı Wi-Fi'deki telefondan erişim | `false` |

**Telefondan açmak için** `"lan": true` yap, sunucuyu yeniden başlat, sol menüde **📱 Telefondan aç** düğmesine bas ve karekodu okut.
Bağlantıdaki gizli anahtar `.ofis-token` dosyasında durur; silersen yenisi üretilir ve eski bağlantılar geçersiz olur.

## Veri nereden geliyor?

Agent Ofis yalnızca okur; hiçbir dosyayı değiştirmez ve internete veri göndermez.

| Kaynak | Ne verir |
|---|---|
| `~/.claude/sessions/<pid>.json` | Şu an açık oturumlar, adları, çalışıyor/boşta durumu |
| `~/.claude/projects/*/<id>.jsonl` | Her oturumun klasörü, başlığı, son isteğin, son araçları |
| `~/.claude/projects/*/<id>/subagents/` | Alt agent'lar ve görevleri |
| `~/.claude/projects/*/memory/` | Proje hafıza notları |
| `projectRoots` klasörleri | Diskteki projeler, git durumu, CLAUDE.md |

Büyük kayıt dosyalarının yalnızca başı ve sonu okunur, sonra yalnızca yeni eklenen satırlar işlenir.

## Bilinen sınırlar

- **macOS izinleri:** Masaüstü/Belgeler (iCloud) altındaki klasörlerin git bilgisi, sunucu arka planda (LaunchAgent) çalışırken
  okunamayabilir. Gerekirse Sistem Ayarları → Gizlilik ve Güvenlik → Tam Disk Erişimi'ne `node`'u ekle
  (bu izin bilgisayardaki tüm Node programlarına verilir).
- **"Onay bekliyor" durumu** Claude Code'un kayıtlarından tahmin edilir; her zaman kesin değildir.
- 3B görünüm three.js kütüphanesini internetten (jsDelivr) yükler; bağlantı yoksa 2B görünüme geçer.
- Uygulamayı açma/Terminal'de devam etme düğmeleri macOS'e özgüdür; panel Linux'ta da çalışır ama bu düğmeler çalışmaz.

## Geliştirici notları

Tarayıcı sekmesi arka plandayken animasyon durur. Test için konsolda `__o3.step(300)` kareleri elle ilerletir,
`__o3.transform = (rooms) => …` ile sahte durum verilebilir.

## Lisans ve emeği geçenler

Kod: [MIT](LICENSE) © İrem Nur Göçer.
3B karakter ve mobilya modelleri: [Kenney](https://www.kenney.nl) — *Mini Characters* ve *Furniture Kit*, CC0 1.0
(lisans dosyaları `public/assets` içinde). 3B motor: [three.js](https://threejs.org) (MIT).
