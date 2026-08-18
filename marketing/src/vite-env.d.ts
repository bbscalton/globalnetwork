/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string
  readonly VITE_R2_MEDIA_PROXY_BASE_URL?: string
  readonly VITE_FUNCTIONS_HEALTH_URL?: string
  readonly VITE_OPS_WEB_URL?: string
  readonly VITE_CUSTOMER_WEB_URL?: string
  readonly VITE_MARKETING_URL?: string
  readonly VITE_ANDROID_APK_URL?: string
  readonly VITE_DESK_APK_URL?: string
  readonly VITE_IOS_IPA_URL?: string
  readonly VITE_IOS_TESTFLIGHT_URL?: string
  readonly VITE_ORG_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
