/**
 * Backatorp IF – Dev (dev.backatorpif.se)
 *
 * Utvecklingsmiljö med två separata autentiseringsvägar:
 * - Portal (Ledarportalen): /portal/login med email+lösenord
 * - Admin: /login med username+lösenord+association_id
 *
 * Deep-testerna använder portal-auth och crawlar dynamiskt.
 * E2E-testerna använder båda auth-kontexterna.
 */

export default {
  id: 'backatorpif-dev',
  name: 'Backatorp IF Ledarportal (Dev)',
  baseURL: process.env.BIF_BASE_URL || 'https://dev.backatorpif.se',

  // Portal auth (används av deep-tester och e2e-portal)
  auth: {
    loginPath: '/portal/login',
    logoutPath: '/portal/logout',
    postLoginPattern: /\/portal(?!\/login)/,
    loginRedirectPattern: /\/login/,

    credentials: {
      username: process.env.BIF_DEV_USERNAME || 'js@vda.se',
      password: process.env.BIF_DEV_PASSWORD || process.env.BIF_ADMIN_PASSWORD || '',
    },

    selectors: {
      username: 'input[name="email"], input[type="email"]',
      password: 'input[name="password"]',
      submit: 'button[type="submit"]',
    },

    extraFields: [],
  },

  // Admin auth (används av e2e-admin)
  adminAuth: {
    loginPath: '/login',
    logoutPath: '/logout',
    postLoginPattern: /\/admin/,
    loginRedirectPattern: /\/login/,

    credentials: {
      username: process.env.BIF_DEV_ADMIN_USERNAME || 'admin',
      password: process.env.BIF_DEV_ADMIN_PASSWORD || 'admin123',
    },

    selectors: {
      username: '#username',
      password: '#password',
      submit: 'button[type="submit"]',
    },

    extraFields: [
      { selector: '#association_id', action: 'select', value: '1' },
    ],
  },

  // Startpunkt för crawling – deep-testerna upptäcker resten dynamiskt
  portalStart: '/portal',

  // Tom routes – deep-testerna crawlar istället för statiska routes
  routes: {},

  responsivePages: [],
  criticalPages: [],
};
