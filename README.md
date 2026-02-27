# IT Asset Management (GitHub Pages + Firebase)

Static web app deploy trên **GitHub Pages**, dùng **Firebase Firestore** làm database và **Firebase Auth** để đăng nhập.

## 1) Tạo Firebase project

- Vào Firebase Console → tạo Project.
- Build → **Authentication** → Get started → bật **Email/Password**.
- Build → **Firestore Database** → Create database (Production hoặc Test tuỳ bạn).
- Project settings → Your apps → Add app (Web) → copy **Firebase config**.

## 2) Dán Firebase config vào app

Mở file `js/firebase-config.js` và thay các giá trị:

- `apiKey`
- `authDomain`
- `projectId`
- `storageBucket`
- `messagingSenderId`
- `appId`

> Firebase config là **public**, có thể commit lên GitHub.

## 3) Thiết lập Firestore Rules

Trong Firebase Console → Firestore → Rules, copy nội dung file `firestore.rules` vào.

- Thay `"PASTE_ADMIN_UID_HERE"` bằng UID thật.
- Lấy UID bằng cách đăng nhập app, hoặc xem trong Firebase Authentication → Users.

## 4) Import dữ liệu lần đầu

App có trang import: `import.html`

1. Mở `import.html`
2. Đăng nhập (Email/Password)
3. Chọn file JSON có format:

```json
{
  "transactions": [],
  "stock": [],
  "minipc": [],
  "stores": [],
  "offices": [],
  "warehouses": []
}
```

`offices` và `warehouses` là optional.

## 5) Deploy lên GitHub Pages

- Tạo repo GitHub, push toàn bộ file trong thư mục này.
- Vào repo → Settings → Pages:
  - Source: Deploy from a branch
  - Branch: `main` / root
  - Save

Sau đó mở link GitHub Pages là chạy được.

## Ghi chú quan trọng

- GitHub Pages chỉ host **static**, nên database phải là dịch vụ ngoài (Firebase).
- Bảo mật nằm ở **Firestore Rules** (đừng để write public).

