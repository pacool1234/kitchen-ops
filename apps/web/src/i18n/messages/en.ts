import type { Messages } from "./es";

// English, the second language (#86). Typed by the Spanish file: a missing or extra key fails
// the typecheck.

export const en: Messages = {
  app: {
    name: "kitchen-ops",
  },
  language: {
    label: "Language",
    current: "Language: {language}",
    saveFailed: "Your language could not be saved. Try again.",
  },
  roles: {
    counter: "Staff",
    office: "Office",
    owner: "Owner",
  },
  units: {
    g: "grams",
    ml: "millilitres",
    unit: "units",
  },
  signIn: {
    title: "Sign in",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    codePrompt: "Enter the 6-digit code from your authenticator app.",
    code: "Code",
    verify: "Verify",
    wrongPassword: "Wrong email or password.",
    tooManyAttempts: "Too many attempts. Wait a few minutes and try again.",
    invalidCode: "That code is not valid. Enter the current one from your app.",
  },
  twoFactor: {
    title: "Set up two-factor authentication",
    intro:
      "Owner accounts sign in with their password and a code from an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.",
    stepPassword: "Confirm your password",
    password: "Password",
    continue: "Continue",
    wrongPassword: "Wrong password.",
    unexpectedAnswer: "Unexpected answer from the server. Try again.",
    stepScan: "Scan the code with the app",
    qrAlt: "QR code for your authenticator app",
    manualKey: "Can't scan it? Type this key into the app:",
    copyKey: "Copy the key",
    keyCopied: "Key copied",
    stepBackup: "Keep the backup codes",
    backupText:
      "Each works once if you lose your phone. Store them somewhere safe now; they are not shown again.",
    copyCodes: "Copy the codes",
    codesCopied: "Codes copied",
    copyFailed: "Couldn't copy. Select it and copy it by hand.",
    stepConfirm: "Enter the code the app shows",
    code: "Code from the app",
    submit: "Turn on 2FA",
  },
  home: {
    title: "Home",
    greeting: "Hello, {name}",
    intro: "What would you like to do?",
  },
  products: {
    title: "Products",
    caption: "Active products",
    name: "Name",
    baseUnit: "Base unit",
    description: "See the active products and the unit each is counted in.",
    loadFailed:
      "Could not load the products. Check your connection and try again.",
    empty: "No products yet",
    emptyDescription: "Products appear here once they're added.",
  },
  shell: {
    skipToContent: "Skip to content",
    mainNav: "Main",
    breadcrumb: "You are here",
    userMenu: "User menu",
    signOut: "Sign out",
  },
  ui: {
    optional: "optional",
    loading: "Loading…",
    close: "Close",
    select: {
      placeholder: "Choose an option",
    },
    combobox: {
      placeholder: "Type to search",
      empty: "No results.",
      toggle: "Show the options",
    },
    number: {
      invalid: "Enter a number, such as 2.5.",
      tooManyDecimals: "Enter at most {max} decimals.",
      negative: "It can't be negative.",
    },
    table: {
      pagination: "Pages",
      page: "Page {page} of {pages}",
      showing: "{first}–{last} of {total}",
      previous: "Previous page",
      next: "Next page",
      empty: "Nothing here yet.",
    },
    error: {
      title: "Something went wrong",
      retry: "Try again",
    },
    toast: {
      region: "Notifications",
      close: "Close the notification",
    },
  },
  errors: {
    unauthorized: "Your session has ended. Sign in again.",
    forbidden: "Your role can't do this.",
    two_factor_required: "Set up two-factor authentication first.",
    unexpected_response: "Unexpected answer from the server. Try again.",
    unknown: "Something went wrong. Try again.",
  },
};
