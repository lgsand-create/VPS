export default {
  id: 'template',
  name: 'Systemnamn',
  baseURL: process.env.TEMPLATE_BASE_URL || 'https://example.com',

  auth: {
    loginPath: '/login',
    logoutPath: '/logout',
    postLoginPattern: /\/dashboard/,
    loginRedirectPattern: /\/login/,

    credentials: {
      username: process.env.TEMPLATE_USERNAME || '',
      password: process.env.TEMPLATE_PASSWORD || '',
    },

    selectors: {
      username: 'input[name="username"]',
      password: 'input[name="password"]',
      submit: 'button[type="submit"]',
    },

    extraFields: [],
  },

  routes: {
    'Huvudsidor': [
      '/dashboard',
      '/settings',
    ],
  },

  responsivePages: [
    { path: '/dashboard', name: 'Dashboard' },
  ],

  criticalPages: [
    '/dashboard',
  ],
};
