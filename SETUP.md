# Konfigurasi database SARPRAS

## Sumber data

Firebase Realtime Database pada node `/sarpras` adalah sumber data aplikasi (inventaris, peminjaman, audit, aktivitas, dan tanda tangan). Google Spreadsheet dengan ID `1C1DYPRg_Iau_AwiAfnAPy4eD3ZMz5wa3RTD2FD6t9RU` hanya dipakai sebagai direktori akun login pada sheet `Users`. Apps Script tidak membuat atau menulis sheet inventaris, transaksi, snapshot, maupun log sinkronisasi.

`setupSarpras()` membuat sheet `Users` dengan header `Username`, `Email Firebase`, `Aktif`, `Role`, dan `Nama` jika belum tersedia. Fungsi ini tidak menambahkan akun contoh dan tidak menghapus sheet lama, untuk mencegah penghapusan data tanpa sengaja. Jika spreadsheet sudah memiliki sheet lain dari konfigurasi lama, hapus sheet tersebut secara manual hanya setelah memastikan isinya tidak diperlukan.

## Persiapan

1. Salin `Code.gs` ke proyek Google Apps Script.
2. Berikan akun yang menjalankan Apps Script hak editor pada Spreadsheet `1C1DYPRg_Iau_AwiAfnAPy4eD3ZMz5wa3RTD2FD6t9RU`.
3. Jalankan `setupSarpras()` sekali dan berikan izin akses Spreadsheet serta Google Drive. Selain menyiapkan `Users`, Apps Script menyiapkan folder foto dan tanda tangan di Drive.
4. Aktifkan **Authentication → Sign-in method → Email/Password** di Firebase. URL Realtime Database dan Web API Key Firebase sudah dikonfigurasi di aplikasi.
5. Tambahkan satu baris per pengguna pada sheet `Users`: `Username`, `Email Firebase`, `Aktif`, `Role`, `Nama`. Contoh nilai: `admin_sarpras`, `admin_sarpras@sarpras.local`, `YA`, `Admin`, `Nama Petugas`. Buat akun Firebase Authentication dengan email pada baris itu dan atur password di Firebase. Pengguna memasukkan username dan password pada aplikasi. **Jangan simpan password di Spreadsheet.**
6. Deploy Apps Script sebagai Web app yang bisa diakses aplikasi browser, lalu pastikan URL `/exec` di `SYNC_CONFIG.appsScriptUrl` cocok dengan deployment aktif. Setelah mengubah Apps Script, buat deployment versi baru.
7. Pastikan Firebase Realtime Database dapat diakses sesuai aturan autentikasi yang dipakai aplikasi. Jika Apps Script memerlukan token database, simpan sebagai Script Property `FIREBASE_AUTH_TOKEN`.

## Sinkronisasi dan berkas

Tombol **Sinkronkan** mengirim data aplikasi ke Firebase melalui Apps Script. Spreadsheet tetap khusus untuk direktori login. Foto dan tanda tangan dapat disimpan di Google Drive pada folder `SARPRAS_FOTO` dan `SARPRAS_TANDA_TANGAN`.

## Keamanan

Jangan gunakan aturan Firebase publik untuk data sekolah. URL Web app dapat diketahui pengguna, sehingga akses Apps Script harus dibatasi atau dilengkapi validasi autentikasi sisi server. Login di browser saja tidak melindungi endpoint Apps Script publik.
