# KPI Tracker

## Firebase setup (Google SSO + Firestore)

- **Firebase Console**
  - Create a project
  - Enable **Authentication → Sign-in method → Google**
  - Create **Firestore Database**
  - Add a **Web app** to get config values

## Local dev

1) Create `.env.local` from `.env.example` and fill in values:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- (optional) `VITE_FIREBASE_STORAGE_BUCKET`
- (optional) `VITE_FIREBASE_MESSAGING_SENDER_ID`

2) Install and run:

```bash
npm install
npm run dev
```

## Firestore document used

This app stores all data in a single doc: `app/state`

## Firestore security rules (simple)

Allow any signed-in Google user:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```
