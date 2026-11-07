// ============================================================================
//  Your Firebase project settings.
//  These values are meant to be public (they identify the project, they are
//  not passwords). Data is protected by the rules in firestore.rules.
// ============================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCQMqZzCR5nBPykUiJzz0Waktaj_MjW4oo",
  authDomain: "consumable-reorder.firebaseapp.com",
  projectId: "consumable-reorder",
  storageBucket: "consumable-reorder.firebasestorage.app",
  messagingSenderId: "1034370388042",
  appId: "1:1034370388042:web:241c694ad4b3c1e6e7d6b3",
};

export const SETTINGS = {
  siteName: "Consumables Reorder",
  // The only account allowed to do the one-time "first admin" setup (setup.html).
  // Must match the email in firestore.rules.
  firstAdminEmail: "kpatel@signifi.com",
  // Public board shows this many days.
  boardDays: 14,
  // "Already ordered" tab loads this many rows at a time (keeps Firebase reads low).
  orderedPageSize: 50,
};
