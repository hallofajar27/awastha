# Aturan Coding & Pedoman Implementasi (role.md)

Dokumen ini berisi pedoman ketat untuk penulisan kode proyek **Peta Sebaran Kerusakan Infrastruktur** berbasis 100% Google Apps Script (GAS) dan Google Sheets.

---

## 1. Arsitektur Tanpa Server (Zero-Server-Cost)
- Seluruh logika server ditulis dalam file `Code.gs`.
- Frontend dikembangkan menggunakan file HTML (misal: `index.html`) yang disajikan melalui `HtmlService`.
- Semua interaksi client-server wajib menggunakan `google.script.run` untuk RPC asinkron atau endpoint REST API (`doGet` / `doPost`).

---

## 2. Manajemen Database & Validasi Sheets
- **Race Condition:** Setiap kali menulis data ke Google Sheets (`appendRow`, `setValue`), wajib menggunakan `LockService`:
  ```javascript
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // 30 detik timeout
  // ...operasi tulis Sheets...
  lock.releaseLock();
  ```
- **Kunci Relasional (FK):** Pastikan kode relawan `ID_Relawan` dan kode desa `ID_Desa` divalidasi keberadaannya di tab `Master_User` dan `Master_Desa` sebelum laporan disimpan.
- **Standarisasi ID_Desa:** `ID_Desa` wajib bertipe string dengan format pemisah titik (`.`) standar Kemendagri 10-digit (contoh: `53.01.01.2001`).

---

## 3. Otentikasi & Sesi Admin
- **Enkripsi Hash:** Password admin tidak boleh disimpan dalam teks polos (*plaintext*). Wajib menggunakan SHA-256 + Salt via `Utilities.computeDigest`:
  ```javascript
  function hashPassword(password, salt) {
    const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt, Utilities.Charset.UTF_8);
    // Konversi byte array ke Hex String
    let output = "";
    for (let i = 0; i < rawHash.length; i++) {
      let byteValue = rawHash[i];
      if (byteValue < 0) byteValue += 256;
      let byteString = byteValue.toString(16);
      if (byteString.length == 1) byteString = "0" + byteString;
      output += byteString;
    }
    return output;
  }
  ```
- **Session Caching:** Token sesi admin disimpan di browser `sessionStorage` dan dicatat di sisi server menggunakan `CacheService.getScriptCache()` dengan TTL maksimal 8 jam untuk menghindari pembacaan berulang tab `Master_User`.

---

## 4. Penyimpanan Media & Hak Akses Drive
- **Base64 Upload:** Konversi gambar dari format Base64 menjadi BLOB di server, simpan ke Google Drive folder terdedikasi.
- **Izin Publik:** File gambar yang terunggah wajib diset hak aksesnya menjadi publik:
  ```javascript
  const file = folder.createFile(blob);
  file.setSharing(MimeType.PNG, DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  ```

---

## 5. Kinerja & Kuota Google Apps Script
- **Time-driven Trigger:** Agregasi spasial skor kerusakan ($S_{damage}$) dilakukan secara latar belakang menggunakan trigger berkala (5 menit) ke tab `Cache_Choropleth`. Fungsi `doGet()` hanya diperbolehkan membaca data dari tab cache tersebut guna menjamin respons di bawah 1.0 detik.
- **Kompresi Browser:** Foto wajib dikompresi di sisi client (HTML5 Canvas) sebelum diunggah menjadi maks 500 KB guna menghemat kuota transmisi dan penyimpanan Google Drive.
